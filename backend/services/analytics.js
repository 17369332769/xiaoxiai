import { dbAll, dbGet, dbRun } from '../core/db.js';
import { getTodayKey } from './gameplay.js';
import { createLogger } from '../core/logger.js';

const logger = createLogger('analytics');

function newId() {
  return `evt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// Best-effort behavior tracking. Analytics must never break a gameplay request,
// so every write is wrapped and failures are only logged.
export async function recordEvent(userId, type, payload = {}) {
  try {
    await dbRun(
      'INSERT INTO events (id, user_id, type, payload, day_key) VALUES (?, ?, ?, ?, ?)',
      [newId(), userId, type, JSON.stringify(payload || {}), getTodayKey()]
    );
    return true;
  } catch (error) {
    logger.warn('Failed to record analytics event', { userId, type, error: error.message });
    return false;
  }
}

export async function hasEvent(userId, type) {
  try {
    const row = await dbGet('SELECT 1 FROM events WHERE user_id = ? AND type = ? LIMIT 1', [userId, type]);
    return Boolean(row);
  } catch (error) {
    logger.warn('Failed to check analytics event existence', { userId, type, error: error.message });
    return true; // fail-closed: avoid spamming "first time" milestones on read errors
  }
}

// Record a milestone the first time it ever happens for a user (e.g. first_chat).
// Returns true only on the first occurrence.
export async function recordFirstTime(userId, type, payload = {}) {
  if (await hasEvent(userId, type)) {
    return false;
  }
  await recordEvent(userId, type, payload);
  return true;
}

async function hasEventToday(userId, type) {
  try {
    const row = await dbGet(
      'SELECT 1 FROM events WHERE user_id = ? AND type = ? AND day_key = ? LIMIT 1',
      [userId, type, getTodayKey()]
    );
    return Boolean(row);
  } catch {
    return true;
  }
}

// Lightweight once-per-day session marker so DAU is well defined even for users
// who only open the app without taking an explicit action.
export async function recordDailyActive(userId) {
  if (await hasEventToday(userId, 'session')) {
    return false;
  }
  return recordEvent(userId, 'session', {});
}

function safeNumber(value) {
  return Number.isFinite(value) ? value : 0;
}

export async function getStats() {
  const todayKey = getTodayKey();

  const [
    totalUsersRow,
    newUsersTodayRow,
    dauRow,
    payingRow,
    revenueRow,
    paidOrdersRow,
    returningRow,
    yesterdayCohortRow,
    yesterdayRetainedRow,
  ] = await Promise.all([
    dbGet('SELECT COUNT(*) as c FROM users'),
    dbGet("SELECT COUNT(*) as c FROM users WHERE date(created_at, 'localtime') = date('now', 'localtime')"),
    dbGet('SELECT COUNT(DISTINCT user_id) as c FROM events WHERE day_key = ?', [todayKey]),
    dbGet("SELECT COUNT(DISTINCT user_id) as c FROM orders WHERE status = 'paid'"),
    dbGet("SELECT COALESCE(SUM(tier_amount), 0) as s FROM orders WHERE status = 'paid'"),
    dbGet("SELECT COUNT(*) as c FROM orders WHERE status = 'paid'"),
    dbGet(
      `SELECT COUNT(DISTINCT e.user_id) as c FROM events e
       WHERE e.day_key = ?
         AND EXISTS (SELECT 1 FROM events e2 WHERE e2.user_id = e.user_id AND e2.day_key <> ?)`,
      [todayKey, todayKey]
    ),
    // Next-day (D1) retention cohort: users who registered yesterday. Cohort is
    // keyed on users.created_at (a real DATETIME) rather than MIN(day_key) because
    // day_key is a non-zero-padded locale string ("2026/6/9") that does not sort.
    dbGet("SELECT COUNT(*) as c FROM users WHERE date(created_at, 'localtime') = date('now', '-1 day', 'localtime')"),
    // ...of whom were active today (have any event with today's day_key).
    dbGet(
      `SELECT COUNT(DISTINCT u.id) as c FROM users u
       WHERE date(u.created_at, 'localtime') = date('now', '-1 day', 'localtime')
         AND EXISTS (SELECT 1 FROM events e WHERE e.user_id = u.id AND e.day_key = ?)`,
      [todayKey]
    ),
  ]);

  const funnelRows = await dbAll(
    `SELECT type, COUNT(*) as c FROM events
     WHERE type IN ('first_chat', 'first_checkin', 'first_gift', 'first_tip', 'level_up')
     GROUP BY type`
  );
  const funnel = Object.fromEntries(funnelRows.map((row) => [row.type, row.c]));

  const payingUsers = safeNumber(payingRow?.c);
  const totalRevenue = safeNumber(revenueRow?.s);
  const dau = safeNumber(dauRow?.c);
  const returning = safeNumber(returningRow?.c);
  const yesterdayCohort = safeNumber(yesterdayCohortRow?.c);
  const yesterdayRetained = safeNumber(yesterdayRetainedRow?.c);

  return {
    totalUsers: safeNumber(totalUsersRow?.c),
    newUsersToday: safeNumber(newUsersTodayRow?.c),
    dau,
    returningUsersToday: returning,
    // Share of today's active users who were also active on some earlier day —
    // a "returning-user rate", NOT the standard D1 retention (kept for the
    // existing dashboard tile; see nextDayRetention for true cohort retention).
    returnRate: dau > 0 ? Math.round((returning / dau) * 100) : 0,
    retentionRate: dau > 0 ? Math.round((returning / dau) * 100) : 0,
    // Standard next-day (D1) retention: of users who registered yesterday, the
    // share active again today. 0 when yesterday had no new registrations.
    newUsersYesterday: yesterdayCohort,
    nextDayRetention: yesterdayCohort > 0 ? Math.round((yesterdayRetained / yesterdayCohort) * 100) : 0,
    payingUsers,
    paidOrders: safeNumber(paidOrdersRow?.c),
    totalRevenue: Math.round(totalRevenue * 100) / 100,
    arppu: payingUsers > 0 ? Math.round((totalRevenue / payingUsers) * 100) / 100 : 0,
    payConversion: safeNumber(totalUsersRow?.c) > 0
      ? Math.round((payingUsers / safeNumber(totalUsersRow.c)) * 100)
      : 0,
    milestones: {
      firstChat: safeNumber(funnel.first_chat),
      firstCheckin: safeNumber(funnel.first_checkin),
      firstGift: safeNumber(funnel.first_gift),
      firstTip: safeNumber(funnel.first_tip),
      levelUps: safeNumber(funnel.level_up),
    },
  };
}

export async function loadRecentEvents(limit = 50) {
  return dbAll(
    `SELECT id, user_id, type, payload,
            strftime('%m-%d %H:%M', created_at, 'localtime') as timestamp
     FROM events ORDER BY created_at DESC, rowid DESC LIMIT ?`,
    [limit]
  );
}
