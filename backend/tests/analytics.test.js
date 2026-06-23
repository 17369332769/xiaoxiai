import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

process.env.LOG_LEVEL = 'error';
process.env.LOG_REQUESTS = 'false';

const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'xiaoxiai-analytics-'));
process.env.XIAOXIAI_DB_PATH = path.join(tempDir, 'test.sqlite');

const [analytics, gameplay, dbModule] = await Promise.all([
  import('../analytics.js'),
  import('../gameplay.js'),
  import('../db.js'),
]);

await dbModule.dbReady;
const { dbRun } = dbModule;
const todayKey = gameplay.getTodayKey();

test.after(async () => {
  await dbModule.closeDb();
  await fs.rm(tempDir, { recursive: true, force: true });
});

test('getStats computes DAU, retention, paying conversion and ARPPU from seeded data', async () => {
  // Two users.
  await dbRun("INSERT INTO users (id, level, affection, energy, mood, coins) VALUES ('u1', 1, 10, 80, 70, 200)");
  await dbRun("INSERT INTO users (id, level, affection, energy, mood, coins) VALUES ('u2', 1, 10, 80, 70, 200)");

  // Both active today → DAU = 2.
  await dbRun("INSERT INTO events (id, user_id, type, payload, day_key) VALUES ('e1', 'u1', 'session', '{}', ?)", [todayKey]);
  await dbRun("INSERT INTO events (id, user_id, type, payload, day_key) VALUES ('e2', 'u2', 'session', '{}', ?)", [todayKey]);
  // u1 was also active on a prior day → counts as "returning" today.
  await dbRun("INSERT INTO events (id, user_id, type, payload, day_key) VALUES ('e3', 'u1', 'session', '{}', '2000/1/1')");
  // A first-chat milestone for the funnel.
  await dbRun("INSERT INTO events (id, user_id, type, payload, day_key) VALUES ('e4', 'u1', 'first_chat', '{}', ?)", [todayKey]);

  // u1 paid one ¥52 order.
  await dbRun(
    "INSERT INTO orders (id, user_id, out_trade_no, tier_amount, coins, payment_method, status) VALUES ('o1', 'u1', 'XX1', 52, 1200, 'wechat', 'paid')"
  );

  const stats = await analytics.getStats();

  assert.equal(stats.totalUsers, 2);
  assert.equal(stats.dau, 2);
  assert.equal(stats.returningUsersToday, 1);
  assert.equal(stats.retentionRate, 50); // 1 returning / 2 DAU
  assert.equal(stats.payingUsers, 1);
  assert.equal(stats.paidOrders, 1);
  assert.equal(stats.totalRevenue, 52);
  assert.equal(stats.arppu, 52); // 52 revenue / 1 paying user
  assert.equal(stats.payConversion, 50); // 1 paying / 2 total users
  assert.equal(stats.milestones.firstChat, 1);
});

test('getStats outputs are finite numbers (no NaN leaking from guarded ratios)', async () => {
  // The safeNumber wrapper + zero-guards on arppu/retention/payConversion must
  // keep every metric a finite number even as the data shifts.
  const stats = await analytics.getStats();
  assert.ok(Number.isFinite(stats.arppu));
  assert.ok(Number.isFinite(stats.totalRevenue));
  assert.ok(Number.isInteger(stats.retentionRate));
  assert.ok(Number.isInteger(stats.payConversion));
  assert.ok(Number.isInteger(stats.dau));
});
