import { dbAll, dbGet, dbRun } from './db.js';
import { DEFAULT_TASKS } from './gameConfig.js';

export function getNowTimestamp() {
  return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function getTodayKey() {
  return new Date().toLocaleDateString('zh-CN');
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
    'SELECT task_id as id, name, reward, progress, target, completed, claimed FROM tasks WHERE user_id = ?',
    [userId]
  );

  return formatTasks(tasks);
}

export async function ensureUserTasks(userId) {
  for (const task of DEFAULT_TASKS) {
    await dbRun(
      `INSERT INTO tasks (user_id, task_id, name, reward, progress, target, completed, claimed)
       VALUES (?, ?, ?, ?, 0, ?, 0, 0)
       ON CONFLICT(user_id, task_id) DO UPDATE SET
         name = excluded.name,
         reward = excluded.reward,
         target = excluded.target`,
      [userId, task.id, task.name, task.reward, task.target]
    );
  }
}

export async function resetDailyTasksIfNeeded(userId, user) {
  const todayKey = getTodayKey();
  if (user.last_task_reset === todayKey) {
    return;
  }

  await dbRun(
    `UPDATE tasks
     SET progress = 0, completed = 0, claimed = 0
     WHERE user_id = ? AND task_id IN ('checkin', 'chat_3', 'feed_1', 'gift_1')`,
    [userId]
  );
  await dbRun('UPDATE users SET last_task_reset = ? WHERE id = ?', [todayKey, userId]);
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

export async function addAffection(userId, user, points) {
  let newAffection = user.affection + points;
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
