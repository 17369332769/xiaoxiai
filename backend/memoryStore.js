import { dbAll, dbGet, dbRun } from './db.js';
import { createLogger } from './logger.js';
import { resolvePositiveIntEnv } from './envUtils.js';
import { humanizeMemoryKey } from '../shared/memoryLabels.js';

const logger = createLogger('memory-store');

const DEFAULT_MEMORY_CAP = 20;

// Hard cap on long-term semantic memories per user. Beyond this, the lowest
// priority (least reinforced, oldest) facts are evicted so the memory card stays
// focused and the prompt stays bounded. Configurable via the MEMORY_CAP env var;
// invalid or missing values fall back to the default.
export const MEMORY_CAP = resolvePositiveIntEnv(process.env.MEMORY_CAP, DEFAULT_MEMORY_CAP);

// Bounds applied when sanitizing an extracted fact before it ever hits the DB,
// so neither runaway LLM output nor noisy local heuristics can bloat the card.
export const MEMORY_KEY_MAX_LENGTH = 64;
export const MEMORY_VALUE_MAX_LENGTH = 200;

// Validate and normalize a single memory entry. Returns a { key, value } pair
// trimmed (and value-truncated) ready for upsert, or null when the entry is too
// empty/invalid to be worth remembering. Pure function — reusable from the
// consolidation worker so both the LLM and local-fallback paths share one gate.
export function sanitizeMemoryEntry(key, value) {
  if (typeof key !== 'string' || typeof value !== 'string') {
    return null;
  }

  const trimmedKey = key.trim();
  const trimmedValue = value.trim();
  if (!trimmedKey || !trimmedValue) {
    return null;
  }

  // An over-long key is almost always a malformed extraction, so reject it
  // rather than truncate (a truncated key would collide / lose meaning).
  if (trimmedKey.length > MEMORY_KEY_MAX_LENGTH) {
    return null;
  }

  return {
    key: trimmedKey,
    value: trimmedValue.length > MEMORY_VALUE_MAX_LENGTH
      ? trimmedValue.slice(0, MEMORY_VALUE_MAX_LENGTH)
      : trimmedValue,
  };
}

// Convenience boolean wrapper for callers that only need a yes/no check.
export function isValidMemoryEntry(key, value) {
  return sanitizeMemoryEntry(key, value) !== null;
}

export async function listMemories(userId) {
  const rows = await dbAll(
    `SELECT memory_key as key, memory_value as value, COALESCE(weight, 1) as weight,
            strftime('%Y-%m-%d %H:%M', updated_at, 'localtime') as updatedAt
     FROM user_memories WHERE user_id = ?
     ORDER BY weight DESC, updated_at DESC`,
    [userId]
  );
  // Attach a human-friendly Chinese label so the UI never shows the raw
  // English snake_case key produced by the consolidation model.
  return rows.map((row) => ({ ...row, label: humanizeMemoryKey(row.key) }));
}

export async function getMemory(userId, key) {
  return dbGet('SELECT memory_key as key, memory_value as value FROM user_memories WHERE user_id = ? AND memory_key = ?', [userId, key]);
}

export async function deleteMemory(userId, key) {
  const result = await dbRun('DELETE FROM user_memories WHERE user_id = ? AND memory_key = ?', [userId, key]);
  return result.changes > 0;
}

export async function clearMemories(userId) {
  const result = await dbRun('DELETE FROM user_memories WHERE user_id = ?', [userId]);
  // The rolling relationship summary is also consolidated personal memory that
  // gets injected into every chat prompt, so a "clear all" must wipe it too —
  // otherwise the AI keeps remembering the user after they cleared their data.
  await dbRun('UPDATE users SET summary = ? WHERE id = ?', ['', userId]);
  return result.changes;
}

// Upsert a fact. On conflict we keep the latest value AND increase its weight so
// repeatedly-reinforced facts gain priority and survive capping (conflict /
// reinforcement handling — last-write-wins is the intentional "reinforcement is
// the conflict resolution" strategy). Entries that fail validation are skipped
// and reported via the returned flag so callers can keep their counters honest.
export async function upsertMemory(userId, key, value) {
  const entry = sanitizeMemoryEntry(key, value);
  if (!entry) {
    return false;
  }

  await dbRun(
    `INSERT INTO user_memories (user_id, memory_key, memory_value, weight, updated_at)
     VALUES (?, ?, ?, 1, CURRENT_TIMESTAMP)
     ON CONFLICT(user_id, memory_key) DO UPDATE SET
       memory_value = excluded.memory_value,
       weight = COALESCE(user_memories.weight, 1) + 1,
       updated_at = CURRENT_TIMESTAMP`,
    [userId, entry.key, entry.value]
  );
  return true;
}

// Evict everything beyond the cap, lowest priority first.
export async function enforceMemoryCap(userId, cap = MEMORY_CAP) {
  const countRow = await dbGet('SELECT COUNT(*) as c FROM user_memories WHERE user_id = ?', [userId]);
  if (!countRow || countRow.c <= cap) {
    return 0;
  }
  const result = await dbRun(
    `DELETE FROM user_memories
     WHERE user_id = ? AND memory_key IN (
       SELECT memory_key FROM user_memories WHERE user_id = ?
       ORDER BY weight DESC, updated_at DESC
       LIMIT -1 OFFSET ?
     )`,
    [userId, userId, cap]
  );
  if (result.changes > 0) {
    logger.info('Pruned low-priority memories beyond cap', { userId, pruned: result.changes, cap });
  }
  return result.changes;
}

// Time-to-live for stale, never-reinforced memories, in days. Configurable via
// the MEMORY_TTL_DAYS env var; 0 (the default) disables time-based expiry.
export const MEMORY_TTL_DAYS = resolvePositiveIntEnv(process.env.MEMORY_TTL_DAYS, 0);

// Expire low-value stale memories: facts that were never reinforced (weight <= 1)
// and have not been touched within the TTL window. High-weight memories are
// important by definition and are NEVER dropped on age alone. Returns the number
// of rows removed; a non-positive ttlDays is a no-op so expiry can be toggled off.
export async function pruneStaleMemories(userId, ttlDays = MEMORY_TTL_DAYS) {
  if (!Number.isFinite(ttlDays) || ttlDays <= 0) {
    return 0;
  }

  const result = await dbRun(
    `DELETE FROM user_memories
     WHERE user_id = ?
       AND COALESCE(weight, 1) <= 1
       AND updated_at < datetime('now', ?)`,
    [userId, `-${ttlDays} days`]
  );
  if (result.changes > 0) {
    logger.info('Pruned stale low-value memories past TTL', { userId, pruned: result.changes, ttlDays });
  }
  return result.changes;
}
