import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

process.env.OPENAI_API_KEY = '';
process.env.ALLOWED_ORIGIN = 'http://localhost:5173';
process.env.RATE_LIMIT_MAX_REQUESTS = '10000';
process.env.LOG_LEVEL = 'error';
process.env.LOG_REQUESTS = 'false';
process.env.PAYMENT_SECRET = 'test-payment-secret';
process.env.AUTH_SECRET = 'test-auth-secret';
process.env.ADMIN_TOKEN = 'test-admin-token';

const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'xiaoxiai-ext-test-'));
process.env.XIAOXIAI_DB_PATH = path.join(tempDir, 'test.sqlite');

const [{ app }, dbModule, gameplay, gameConfig, accounts] = await Promise.all([
  import('../server.js'),
  import('../db.js'),
  import('../gameplay.js'),
  import('../gameConfig.js'),
  import('../accounts.js'),
]);

await dbModule.dbReady;
const { dbRun } = dbModule;

let server;
let baseUrl;

async function postJson(route, payload, headers = {}) {
  const response = await fetch(`${baseUrl}${route}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: process.env.ALLOWED_ORIGIN, ...headers },
    body: JSON.stringify(payload),
  });
  return { status: response.status, body: await response.json() };
}

test.before(async () => {
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  if (server) {
    await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
  await dbModule.closeDb();
  await fs.rm(tempDir, { recursive: true, force: true });
});

// ---------- gameplay unit helpers ----------

test('check-in streak grows on consecutive days and resets after a gap', () => {
  const today = '2026/6/18';
  const yesterday = '2026/6/17';
  assert.deepEqual(gameplay.computeCheckinStreak(3, yesterday, today, yesterday).streak, 4);
  assert.deepEqual(gameplay.computeCheckinStreak(9, '2026/6/1', today, yesterday).streak, 1);
  assert.equal(gameConfig.getCheckinStreakReward(7), 100);
  assert.equal(gameConfig.getCheckinStreakReward(1), 10);
});

test('relationship tier deepens with level', () => {
  assert.equal(gameConfig.getRelationshipTier(1).key, 'acquaintance');
  assert.equal(gameConfig.getRelationshipTier(5).key, 'close');
  assert.equal(gameConfig.getRelationshipTier(12).key, 'sweetheart');
  assert.equal(gameConfig.getRelationshipTier(99).key, 'soulmate');
});

// ---------- payment / order closed loop ----------

test('order create + signed callback credits coins exactly once (idempotent)', async () => {
  const userId = 'order_user_1';
  await postJson('/api/user/sync', { userId });

  const create = await postJson('/api/order/create', { userId, amount: 5, paymentMethod: 'wechat' });
  assert.equal(create.status, 200);
  assert.equal(create.body.order.status, 'pending');
  const callback = create.body.simulatedCallback;
  assert.ok(callback.sign);

  const before = (await postJson('/api/user/sync', { userId })).body.user.coins;

  const settle1 = await postJson('/api/payment/callback', callback);
  assert.equal(settle1.status, 200);
  assert.equal(settle1.body.settled, true);
  assert.equal(settle1.body.coins, before + 100);

  // Replay the exact same callback — must be a no-op (no double credit).
  const settle2 = await postJson('/api/payment/callback', callback);
  assert.equal(settle2.status, 200);
  assert.equal(settle2.body.settled, false);
  assert.equal(settle2.body.alreadyPaid, true);
  assert.equal(settle2.body.coins, before + 100);

  const after = (await postJson('/api/user/sync', { userId })).body.user.coins;
  assert.equal(after, before + 100);
});

test('payment callback rejects a tampered signature', async () => {
  const userId = 'order_user_2';
  await postJson('/api/user/sync', { userId });
  const create = await postJson('/api/order/create', { userId, amount: 5, paymentMethod: 'alipay' });
  const tampered = { ...create.body.simulatedCallback, total_amount: 99999 };

  const result = await postJson('/api/payment/callback', tampered);
  assert.equal(result.status, 400);
  assert.equal(result.body.error.code, 'INVALID_SIGNATURE');
});

test('payment callback marks the order failed on a non-success result', async () => {
  const userId = 'order_user_3';
  await postJson('/api/user/sync', { userId });
  const create = await postJson('/api/order/create', { userId, amount: 52, paymentMethod: 'wechat' });

  // Re-sign a FAILED result so the signature is valid but payment did not succeed.
  const { signParams } = await import('../orders.js');
  const params = {
    out_trade_no: create.body.simulatedCallback.out_trade_no,
    total_amount: 52,
    gateway_txn_id: 'WXFAIL',
    result: 'FAIL',
  };
  const sign = signParams(params, process.env.PAYMENT_SECRET);

  const result = await postJson('/api/payment/callback', { ...params, sign });
  assert.equal(result.status, 200);
  assert.equal(result.body.settled, false);
  assert.equal(result.body.status, 'failed');

  const query = await postJson('/api/order/query', { userId, outTradeNo: params.out_trade_no });
  assert.equal(query.body.order.status, 'failed');
});

test('concurrent settlement of two orders credits both (no lost update)', async () => {
  const userId = 'order_concurrency_user';
  await postJson('/api/user/sync', { userId });
  const before = (await postJson('/api/user/sync', { userId })).body.user.coins;

  const [c1, c2] = await Promise.all([
    postJson('/api/order/create', { userId, amount: 5, paymentMethod: 'wechat' }),
    postJson('/api/order/create', { userId, amount: 5, paymentMethod: 'alipay' }),
  ]);

  // Fire both signed callbacks concurrently; both 100-coin credits must land.
  await Promise.all([
    postJson('/api/payment/callback', c1.body.simulatedCallback),
    postJson('/api/payment/callback', c2.body.simulatedCallback),
  ]);

  const after = (await postJson('/api/user/sync', { userId })).body.user.coins;
  assert.equal(after, before + 200);
});

test('concurrent duplicate check-in credits the bonus only once', async () => {
  const userId = 'checkin_concurrency_user';
  const sync = await postJson('/api/user/sync', { userId });
  const before = sync.body.user.coins;

  const results = await Promise.all([
    postJson('/api/checkin', { userId }),
    postJson('/api/checkin', { userId }),
  ]);
  const statuses = results.map((r) => r.status).sort();
  assert.deepEqual(statuses, [200, 400]);
  assert.equal(results.find((r) => r.status === 400).body.error.code, 'ALREADY_CHECKED_IN');

  const after = (await postJson('/api/user/sync', { userId })).body.user.coins;
  assert.equal(after, before + 10); // exactly one day-1 streak bonus
});

test('concurrent task claim pays the reward and writes the ledger only once', async () => {
  const userId = 'claim_concurrency_user';
  await postJson('/api/user/sync', { userId });
  for (let i = 0; i < 3; i += 1) {
    await postJson('/api/chat', { userId, text: `并发测试 ${i}` });
  }
  const before = (await postJson('/api/user/sync', { userId })).body.user.coins;

  const results = await Promise.all([
    postJson('/api/task/claim', { userId, taskId: 'chat_3' }),
    postJson('/api/task/claim', { userId, taskId: 'chat_3' }),
  ]);
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 400]);

  const after = (await postJson('/api/user/sync', { userId })).body.user.coins;
  assert.equal(after, before + 30); // chat_3 reward credited exactly once

  const ledger = await postJson('/api/transactions', { userId });
  const rewardRows = ledger.body.transactions.filter(
    (t) => t.category === 'task_reward' && t.description.includes('对话')
  );
  assert.equal(rewardRows.length, 1);
});

// ---------- accounts ----------

test('account register, login, and guest binding flow', async () => {
  const guestId = 'acct_guest_1';
  await postJson('/api/user/sync', { userId: guestId });

  const register = await postJson('/api/auth/register', {
    userId: guestId,
    identifier: 'tester@example.com',
    password: 'secret123',
  });
  assert.equal(register.status, 200);
  assert.ok(register.body.token);
  assert.equal(register.body.account.userId, guestId);

  // Token verifies against the configured secret.
  const decoded = accounts.verifyToken(register.body.token, process.env.AUTH_SECRET);
  assert.equal(decoded.userId, guestId);

  const login = await postJson('/api/auth/login', { identifier: 'TESTER@example.com', password: 'secret123' });
  assert.equal(login.status, 200);
  assert.equal(login.body.account.userId, guestId);

  const wrong = await postJson('/api/auth/login', { identifier: 'tester@example.com', password: 'nope' });
  assert.equal(wrong.status, 401);
  assert.equal(wrong.body.error.code, 'INVALID_LOGIN');

  const dup = await postJson('/api/auth/register', {
    userId: 'another_guest',
    identifier: 'tester@example.com',
    password: 'secret123',
  });
  assert.equal(dup.status, 409);
  assert.equal(dup.body.error.code, 'ACCOUNT_EXISTS');

  const alreadyBound = await postJson('/api/auth/bind', {
    userId: guestId,
    identifier: 'second@example.com',
    password: 'secret123',
  });
  assert.equal(alreadyBound.status, 409);
  assert.equal(alreadyBound.body.error.code, 'USER_ALREADY_BOUND');
});

test('accounts.user_id has a UNIQUE backstop preventing double-binding at the DB level', async () => {
  const userId = 'unique_guard_user';
  await postJson('/api/user/sync', { userId });
  await dbRun(
    'INSERT INTO accounts (id, identifier, identifier_type, password_hash, user_id) VALUES (?, ?, ?, ?, ?)',
    ['ug1', 'ug1@example.com', 'email', 'h', userId]
  );
  await assert.rejects(
    dbRun(
      'INSERT INTO accounts (id, identifier, identifier_type, password_hash, user_id) VALUES (?, ?, ?, ?, ?)',
      ['ug2', 'ug2@example.com', 'email', 'h', userId]
    ),
    /UNIQUE/
  );
});

test('account register validates identifier and password', async () => {
  const bad = await postJson('/api/auth/register', { userId: 'val_guest', identifier: 'x', password: '123456' });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error.code, 'INVALID_IDENTIFIER');

  const shortPw = await postJson('/api/auth/register', { userId: 'val_guest', identifier: 'good@example.com', password: '12' });
  assert.equal(shortPw.status, 400);
  assert.equal(shortPw.body.error.code, 'INVALID_PASSWORD');
});

// ---------- presence + broadcasts ----------

test('presence returns a real online count and the broadcast feed', async () => {
  const userId = 'presence_user_1';
  await postJson('/api/user/sync', { userId });
  const result = await postJson('/api/presence', { userId });
  assert.equal(result.status, 200);
  assert.equal(typeof result.body.onlineCount, 'number');
  assert.ok(result.body.onlineCount >= 1);
  assert.equal(Array.isArray(result.body.broadcasts), true);
});

test('a ring gift publishes a real site-wide broadcast', async () => {
  const userId = 'broadcast_user_1';
  await postJson('/api/user/sync', { userId });
  await dbRun('UPDATE users SET coins = 5000 WHERE id = ?', [userId]);

  await postJson('/api/action/gift', { userId, giftId: 'ring' });
  const feed = await postJson('/api/broadcasts', { userId });
  const hasRing = feed.body.broadcasts.some((b) => b.type === 'gift' && b.text.includes('真爱誓约戒指'));
  assert.equal(hasRing, true);
});

// ---------- memory management ----------

test('memory list and manual delete', async () => {
  const userId = 'memory_user_1';
  await postJson('/api/user/sync', { userId });
  await dbRun(
    'INSERT INTO user_memories (user_id, memory_key, memory_value, weight) VALUES (?, ?, ?, ?)',
    [userId, 'favorite_drink', '奶茶', 3]
  );

  const list = await postJson('/api/memory/list', { userId });
  assert.equal(list.status, 200);
  assert.equal(list.body.memories.length, 1);
  assert.equal(list.body.memories[0].key, 'favorite_drink');

  const missing = await postJson('/api/memory/delete', { userId, key: 'nope' });
  assert.equal(missing.status, 404);

  const del = await postJson('/api/memory/delete', { userId, key: 'favorite_drink' });
  assert.equal(del.status, 200);
  assert.equal(del.body.memories.length, 0);
});

// ---------- growth tasks ----------

test('growth tasks accumulate and do not reset daily', async () => {
  const userId = 'growth_user_1';
  await postJson('/api/user/sync', { userId });

  const sync = await postJson('/api/user/sync', { userId });
  const chatTotal = sync.body.tasks.find((t) => t.id === 'chat_total_50');
  assert.ok(chatTotal);
  assert.equal(chatTotal.category, 'growth');

  await postJson('/api/chat', { userId, text: '你好小希' });
  const after = await postJson('/api/user/sync', { userId });
  assert.equal(after.body.tasks.find((t) => t.id === 'chat_total_50').progress, 1);

  // Force a daily rollover; growth progress must survive.
  await dbRun('UPDATE users SET last_task_reset = ? WHERE id = ?', ['2000/1/1', userId]);
  const afterReset = await postJson('/api/user/sync', { userId });
  assert.equal(afterReset.body.tasks.find((t) => t.id === 'chat_total_50').progress, 1);
  assert.equal(afterReset.body.tasks.find((t) => t.id === 'chat_3').progress, 0);
});

// ---------- admin ----------

test('admin API requires a valid token', async () => {
  const noToken = await postJson('/api/admin/stats', {});
  assert.equal(noToken.status, 403);
  assert.equal(noToken.body.error.code, 'ADMIN_FORBIDDEN');

  const ok = await postJson('/api/admin/stats', {}, { 'x-admin-token': 'test-admin-token' });
  assert.equal(ok.status, 200);
  assert.equal(typeof ok.body.stats.totalUsers, 'number');
  assert.equal(typeof ok.body.stats.dau, 'number');
});

test('admin can publish an announcement and refund a paid order', async () => {
  const headers = { 'x-admin-token': 'test-admin-token' };

  const announce = await postJson('/api/admin/announcement', { text: '运营公告：今晚双倍好感度活动开启！' }, headers);
  assert.equal(announce.status, 200);
  assert.ok(announce.body.id);

  const feed = await postJson('/api/broadcasts', {});
  assert.equal(feed.body.broadcasts.some((b) => b.type === 'announcement'), true);

  // Create a paid order via the instant tip path, then refund it.
  const userId = 'refund_user_1';
  await postJson('/api/user/sync', { userId });
  const tip = await postJson('/api/action/tip', { userId, amount: 5, paymentMethod: 'wechat' });
  const coinsAfterTip = tip.body.user.coins;
  const orderId = tip.body.order.id;

  const refund = await postJson('/api/admin/order/refund', { orderId }, headers);
  assert.equal(refund.status, 200);
  assert.equal(refund.body.refunded, true);
  assert.equal(refund.body.order.status, 'refunded');

  const afterRefund = (await postJson('/api/user/sync', { userId })).body.user.coins;
  assert.equal(afterRefund, coinsAfterTip - 100);
});
