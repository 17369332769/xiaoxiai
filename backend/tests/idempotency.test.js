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
process.env.AUTH_SECRET = 'test-auth-secret';

const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'xiaoxiai-idem-test-'));
process.env.XIAOXIAI_DB_PATH = path.join(tempDir, 'test.sqlite');

const [{ app }, dbModule, configModule] = await Promise.all([
  import('../server.js'),
  import('../core/db.js'),
  import('../services/configOverrides.js'),
]);
await dbModule.dbReady;

// Use a real food id + cost from the same catalog the handler reads, so the test
// stays correct if the catalog changes.
const [FOOD_ID, FOOD] = Object.entries(configModule.getEffectiveFood())[0];
const FOOD_COST = FOOD.cost;

let server;
let baseUrl;

async function req(route, payload) {
  const response = await fetch(`${baseUrl}${route}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: process.env.ALLOWED_ORIGIN },
    body: JSON.stringify(payload),
  });
  return { status: response.status, body: await response.json() };
}

async function seedUser(userId, coins = 100000) {
  await req('/api/user/sync', { userId });
  await dbModule.dbRun('UPDATE users SET coins = ? WHERE id = ?', [coins, userId]);
}

async function coinsOf(userId) {
  const row = await dbModule.dbGet('SELECT coins FROM users WHERE id = ?', [userId]);
  return row.coins;
}

async function feedMsgCount(userId) {
  const rows = await dbModule.dbAll(
    "SELECT id FROM chat_messages WHERE user_id = ? AND (id LIKE 'sys-feed%' OR id LIKE 'ai-feed%')",
    [userId]
  );
  return rows.length;
}

test.before(async () => {
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  if (server) await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  await dbModule.closeDb();
  await fs.rm(tempDir, { recursive: true, force: true });
});

test('concurrent feeds with the SAME requestId debit coins exactly once', async () => {
  const uid = 'idem_same';
  await seedUser(uid);
  const before = await coinsOf(uid);
  const requestId = 'fixed-key-1';
  const [a, b] = await Promise.all([
    req('/api/action/feed', { userId: uid, foodId: FOOD_ID, requestId }),
    req('/api/action/feed', { userId: uid, foodId: FOOD_ID, requestId }),
  ]);
  assert.equal(a.status, 200);
  assert.equal(b.status, 200);
  // Exactly one request wins the claim; the other is the deduped no-op.
  assert.equal([a, b].filter((r) => r.body.duplicate).length, 1, 'exactly one response is the deduped duplicate');
  assert.equal(await coinsOf(uid), before - FOOD_COST, 'coins debited once, not twice');
  assert.equal(await feedMsgCount(uid), 2, 'only one feed inserted its sys+ai messages');
});

test('feeds with DIFFERENT requestIds both apply (distinct actions are not blocked)', async () => {
  const uid = 'idem_diff';
  await seedUser(uid);
  const before = await coinsOf(uid);
  const [a, b] = await Promise.all([
    req('/api/action/feed', { userId: uid, foodId: FOOD_ID, requestId: 'k-a' }),
    req('/api/action/feed', { userId: uid, foodId: FOOD_ID, requestId: 'k-b' }),
  ]);
  assert.equal(a.status, 200);
  assert.equal(b.status, 200);
  assert.equal([a, b].filter((r) => r.body.duplicate).length, 0, 'neither is deduped');
  assert.equal(await coinsOf(uid), before - 2 * FOOD_COST, 'two distinct feeds debit twice');
});

test('a feed without a requestId keeps the legacy behavior (applies once)', async () => {
  const uid = 'idem_legacy';
  await seedUser(uid);
  const before = await coinsOf(uid);
  const res = await req('/api/action/feed', { userId: uid, foodId: FOOD_ID });
  assert.equal(res.status, 200);
  assert.equal(Boolean(res.body.duplicate), false);
  assert.equal(await coinsOf(uid), before - FOOD_COST);
});

test('a replayed requestId after completion is rejected as a duplicate', async () => {
  const uid = 'idem_replay';
  await seedUser(uid);
  const requestId = 'replay-key';
  const first = await req('/api/action/feed', { userId: uid, foodId: FOOD_ID, requestId });
  const afterFirst = await coinsOf(uid);
  const second = await req('/api/action/feed', { userId: uid, foodId: FOOD_ID, requestId });
  assert.equal(Boolean(first.body.duplicate), false, 'first request applies');
  assert.equal(second.body.duplicate, true, 'replay of the same key is deduped');
  assert.equal(await coinsOf(uid), afterFirst, 'replay does not debit again');
});
