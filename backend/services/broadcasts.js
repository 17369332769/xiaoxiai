import { dbAll, dbGet, dbRun } from '../core/db.js';
import { createLogger } from '../core/logger.js';

const logger = createLogger('broadcasts');
const MAX_STORED = 300;

function newId() {
  return `bc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// Publish a real broadcast row. Driven by genuine site events (tips, milestone
// gifts, level-ups) and by operator announcements. Best-effort: a broadcast
// failure must never break the gameplay action that triggered it.
export async function pushBroadcast(type, text, priority = 0) {
  if (!text) return null;
  const id = newId();
  try {
    await dbRun(
      'INSERT INTO broadcasts (id, type, text, priority, active) VALUES (?, ?, ?, ?, 1)',
      [id, type, text, priority]
    );
    // Opportunistic pruning so the table cannot grow without bound.
    await dbRun(
      `DELETE FROM broadcasts WHERE id IN (
         SELECT id FROM broadcasts ORDER BY created_at DESC, rowid DESC LIMIT -1 OFFSET ?
       )`,
      [MAX_STORED]
    );
    return id;
  } catch (error) {
    logger.warn('Failed to push broadcast', { type, error: error.message });
    return null;
  }
}

export async function loadBroadcasts(limit = 12) {
  return dbAll(
    `SELECT id, type, text, priority,
            strftime('%H:%M', created_at, 'localtime') as timestamp
     FROM broadcasts
     WHERE active = 1
     ORDER BY priority DESC, created_at DESC, rowid DESC
     LIMIT ?`,
    [limit]
  );
}

export async function deactivateBroadcast(id) {
  const result = await dbRun('UPDATE broadcasts SET active = 0 WHERE id = ?', [id]);
  return result.changes > 0;
}

export async function getBroadcast(id) {
  return dbGet('SELECT id, type, text, priority, active FROM broadcasts WHERE id = ?', [id]);
}

// Seed a friendly default so a brand-new database still shows a welcome line.
export async function ensureSeedBroadcast() {
  const existing = await dbGet('SELECT COUNT(*) as c FROM broadcasts');
  if (existing && existing.c === 0) {
    await pushBroadcast('system', '系统：欢迎来到 xiaoxiai.com！小希在这里等待着你的关爱~', 5);
  }
}
