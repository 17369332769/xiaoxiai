import { dbAll, dbGet, dbRun } from './db.js';
import { DAILY_TASK_IDS, DEFAULT_TASKS, getCheckinStreakReward } from './gameConfig.js';
import { createLogger } from './logger.js';

const logger = createLogger('gameplay');

export function getNowTimestamp() {
  return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function getTodayKey() {
  return new Date().toLocaleDateString('zh-CN');
}

// Per-user chat history cap so chat_messages can't grow without bound.
// Configurable via CHAT_HISTORY_CAP; invalid/missing falls back to the default.
const DEFAULT_CHAT_HISTORY_CAP = 300;
export const CHAT_HISTORY_CAP = (() => {
  const parsed = parseInt(process.env.CHAT_HISTORY_CAP, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_CHAT_HISTORY_CAP;
})();

// Keep only the newest `keep` chat rows for a user (sync renders the last 40 and
// reflection reads the last 15, so the default leaves ample headroom). Called on
// /api/user/sync — NOT in the chat path, so it can't interfere with the
// "every 5th message" reflection trigger that counts chat_messages. Pruning all
// message types here also bounds growth for users who only take actions and
// never chat. Returns the number of pruned rows.
export async function pruneUserChat(userId, keep = CHAT_HISTORY_CAP) {
  // Fail safe: never interpret a non-positive cap as "delete everything".
  if (!Number.isFinite(keep) || keep < 1) {
    return 0;
  }
  // Filter by rowid (never NULL) rather than the TEXT id, avoiding the
  // NULL-in-NOT-IN pitfall entirely.
  const result = await dbRun(
    `DELETE FROM chat_messages
     WHERE user_id = ? AND rowid NOT IN (
       SELECT rowid FROM chat_messages
       WHERE user_id = ?
       ORDER BY created_at DESC, rowid DESC
       LIMIT ?
     )`,
    [userId, userId, keep]
  );
  return result.changes;
}

export function formatTasks(tasks) {
  return tasks.map((task) => ({
    ...task,
    completed: task.completed === 1,
    claimed: task.claimed === 1,
  }));
}

export function createChatMessage(id, sender, text, extra = {}) {
  return {
    id,
    sender,
    text,
    timestamp: getNowTimestamp(),
    ...extra,
  };
}

export async function loadFormattedTasks(userId) {
  const tasks = await dbAll(
    "SELECT task_id as id, name, reward, progress, target, completed, claimed, COALESCE(category, 'daily') as category FROM tasks WHERE user_id = ? ORDER BY category DESC, rowid ASC",
    [userId]
  );

  return formatTasks(tasks);
}

export async function ensureUserTasks(userId) {
  for (const task of DEFAULT_TASKS) {
    await dbRun(
      `INSERT INTO tasks (user_id, task_id, name, reward, progress, target, completed, claimed, category)
       VALUES (?, ?, ?, ?, 0, ?, 0, 0, ?)
       ON CONFLICT(user_id, task_id) DO UPDATE SET
         name = excluded.name,
         reward = excluded.reward,
         target = excluded.target,
         category = excluded.category`,
      [userId, task.id, task.name, task.reward, task.target, task.category || 'daily']
    );
  }
}

export async function resetDailyTasksIfNeeded(userId, user) {
  const todayKey = getTodayKey();
  if (user.last_task_reset === todayKey) {
    return;
  }

  const placeholders = DAILY_TASK_IDS.map(() => '?').join(', ');
  await dbRun(
    `UPDATE tasks
     SET progress = 0, completed = 0, claimed = 0
     WHERE user_id = ? AND task_id IN (${placeholders})`,
    [userId, ...DAILY_TASK_IDS]
  );
  await dbRun('UPDATE users SET last_task_reset = ? WHERE id = ?', [todayKey, userId]);
}

// Growth tasks tracked by an absolute value (e.g. relationship level) rather
// than an increment. We never move progress backwards.
export async function syncAbsoluteTask(userId, taskId, value) {
  const task = await dbGet('SELECT * FROM tasks WHERE user_id = ? AND task_id = ?', [userId, taskId]);
  if (!task) return;
  const newProgress = Math.min(task.target, Math.max(task.progress, Math.floor(value)));
  const completed = newProgress >= task.target ? 1 : 0;
  if (newProgress !== task.progress || completed !== task.completed) {
    await dbRun(
      'UPDATE tasks SET progress = ?, completed = ? WHERE user_id = ? AND task_id = ?',
      [newProgress, completed, userId, taskId]
    );
  }
}

// Apply a daily check-in and advance the continuous streak counter. Returns the
// resulting streak length and the streak bonus coins to award.
export function computeCheckinStreak(previousStreak, lastCheckin, todayKey, yesterdayKey) {
  let streak;
  if (lastCheckin === yesterdayKey) {
    streak = (Number.isFinite(previousStreak) ? previousStreak : 0) + 1;
  } else if (lastCheckin === todayKey) {
    streak = Number.isFinite(previousStreak) && previousStreak > 0 ? previousStreak : 1;
  } else {
    streak = 1;
  }
  return { streak, bonus: getCheckinStreakReward(streak) };
}

export function getYesterdayKey() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toLocaleDateString('zh-CN');
}

export async function incrementTask(userId, taskId, amount = 1) {
  const task = await dbGet('SELECT * FROM tasks WHERE user_id = ? AND task_id = ?', [userId, taskId]);
  if (task && task.completed === 0) {
    const newProgress = Math.min(task.target, task.progress + amount);
    const completed = newProgress >= task.target ? 1 : 0;
    await dbRun(
      'UPDATE tasks SET progress = ?, completed = ? WHERE user_id = ? AND task_id = ?',
      [newProgress, completed, userId, taskId]
    );
  }
}

// Atomic coin mutation helpers. Using a single `coins = coins + ?` / guarded
// `coins = coins - ?` statement avoids the read-modify-write lost-update race
// that a separate SELECT-then-UPDATE would have under concurrent requests.
export async function creditCoins(userId, amount) {
  const result = await dbRun('UPDATE users SET coins = coins + ? WHERE id = ?', [amount, userId]);
  if (result.changes === 0) return null;
  const row = await dbGet('SELECT coins FROM users WHERE id = ?', [userId]);
  return row ? row.coins : null;
}

// Guarded debit: only succeeds (changes === 1) when the balance can cover it,
// so two concurrent spends can never drive coins negative.
export async function debitCoins(userId, amount) {
  const result = await dbRun(
    'UPDATE users SET coins = coins - ? WHERE id = ? AND coins >= ?',
    [amount, userId, amount]
  );
  if (result.changes === 0) return { ok: false, balance: null };
  const row = await dbGet('SELECT coins FROM users WHERE id = ?', [userId]);
  return { ok: true, balance: row ? row.coins : null };
}

// Floored refund/decrement (never below zero), atomic.
export async function refundCoins(userId, amount) {
  await dbRun('UPDATE users SET coins = MAX(0, coins - ?) WHERE id = ?', [amount, userId]);
  const row = await dbGet('SELECT coins FROM users WHERE id = ?', [userId]);
  return row ? row.coins : 0;
}

export async function recordTransaction(userId, { type, category, amount, balance, description }) {
  const id = `txn-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  try {
    await dbRun(
      'INSERT INTO transactions (id, user_id, type, category, amount, balance, description) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [id, userId, type, category, amount, balance, description]
    );
    return id;
  } catch (error) {
    // The ledger is a best-effort audit log; users.coins is the source of truth.
    // A logging-table failure must never turn a financially successful coin
    // operation (already persisted) into a 500 for the user.
    logger.error('Failed to record transaction (ledger desync possible)', {
      userId,
      category,
      type,
      amount,
      error: error.message,
    });
    return null;
  }
}

export async function loadTransactions(userId, limit = 30) {
  return dbAll(
    `SELECT id, type, category, amount, balance, description,
            strftime('%m-%d %H:%M', created_at, 'localtime') as timestamp
     FROM transactions
     WHERE user_id = ?
     ORDER BY created_at DESC, rowid DESC
     LIMIT ?`,
    [userId, limit]
  );
}

export async function addAffection(userId, user, points) {
  let newAffection = Math.max(0, user.affection + points);
  let newLevel = user.level;
  const systemMessages = [];

  while (newAffection >= 100 + (newLevel - 1) * 50) {
    const maxAffection = 100 + (newLevel - 1) * 50;
    newAffection -= maxAffection;
    newLevel += 1;

    const msgId = `sys-level-${Date.now()}-${newLevel}`;
    const levelUpText = `🎉 恭喜！你们的羁绊等级提升到了 Lv.${newLevel}！小希对你更信任了哦~`;
    await dbRun(
      'INSERT INTO chat_messages (id, user_id, sender, text, avatar_state) VALUES (?, ?, "system", ?, "normal")',
      [msgId, userId, levelUpText]
    );
    systemMessages.push(createChatMessage(msgId, 'system', levelUpText));
  }

  await dbRun('UPDATE users SET level = ?, affection = ? WHERE id = ?', [newLevel, newAffection, userId]);
  return { newLevel, newAffection, systemMessages };
}
