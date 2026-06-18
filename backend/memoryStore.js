import { dbAll, dbGet, dbRun } from './db.js';
import { createLogger } from './logger.js';

const logger = createLogger('memory-store');

// Hard cap on long-term semantic memories per user. Beyond this, the lowest
// priority (least reinforced, oldest) facts are evicted so the memory card stays
// focused and the prompt stays bounded.
export const MEMORY_CAP = 20;

export async function listMemories(userId) {
  return dbAll(
    `SELECT memory_key as key, memory_value as value, COALESCE(weight, 1) as weight,
            strftime('%Y-%m-%d %H:%M', updated_at, 'localtime') as updatedAt
     FROM user_memories WHERE user_id = ?
     ORDER BY weight DESC, updated_at DESC`,
    [userId]
  );
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
// reinforcement handling).
export async function upsertMemory(userId, key, value) {
  await dbRun(
    `INSERT INTO user_memories (user_id, memory_key, memory_value, weight, updated_at)
     VALUES (?, ?, ?, 1, CURRENT_TIMESTAMP)
     ON CONFLICT(user_id, memory_key) DO UPDATE SET
       memory_value = excluded.memory_value,
       weight = COALESCE(user_memories.weight, 1) + 1,
       updated_at = CURRENT_TIMESTAMP`,
    [userId, key, value]
  );
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
