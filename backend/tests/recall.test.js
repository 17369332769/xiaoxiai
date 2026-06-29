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

const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'xiaoxiai-recall-test-'));
process.env.XIAOXIAI_DB_PATH = path.join(tempDir, 'test.sqlite');

const [{ app }, dbModule] = await Promise.all([
  import('../server.js'),
  import('../core/db.js'),
]);
await dbModule.dbReady;

let server;
let baseUrl;

async function req(method, route, payload) {
  const response = await fetch(`${baseUrl}${route}`, {
    method,
    headers: { 'Content-Type': 'application/json', Origin: process.env.ALLOWED_ORIGIN },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });
  return { status: response.status, body: await response.json() };
}

const RECALL_MARKERS = ['想你', '好久不见', '天没见'];
const hasRecall = (history) => history.some((m) => RECALL_MARKERS.some((k) => String(m.text).includes(k)));

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

test('a fresh user gets no recall greeting (only the welcome)', async () => {
  const res = await req('POST', '/api/user/sync', { userId: 'recall_new' });
  assert.equal(res.status, 200);
  assert.equal(hasRecall(res.body.chatHistory), false);
});

test('returning after a 1-3 day absence yields the 好久不见 greeting', async () => {
  await req('POST', '/api/user/sync', { userId: 'recall_user' });
  await dbModule.dbRun('UPDATE users SET last_seen = ? WHERE id = ?', [Date.now() - 2 * 24 * 60 * 60 * 1000, 'recall_user']);
  const res = await req('POST', '/api/user/sync', { userId: 'recall_user' });
  assert.equal(res.status, 200);
  assert.ok(
    res.body.chatHistory.some((m) => String(m.text).includes('好久不见')),
    'a 1-3 day absence triggers the mid-tier greeting'
  );
});

test('a recent return does not re-trigger a recall greeting', async () => {
  await req('POST', '/api/user/sync', { userId: 'recall_recent' });
  const res = await req('POST', '/api/user/sync', { userId: 'recall_recent' });
  assert.equal(res.status, 200);
  assert.equal(hasRecall(res.body.chatHistory), false);
});

test('a 3+ day absence reports the day count', async () => {
  await req('POST', '/api/user/sync', { userId: 'recall_long' });
  await dbModule.dbRun('UPDATE users SET last_seen = ? WHERE id = ?', [Date.now() - 5 * 24 * 60 * 60 * 1000, 'recall_long']);
  const res = await req('POST', '/api/user/sync', { userId: 'recall_long' });
  assert.ok(
    res.body.chatHistory.some((m) => String(m.text).includes('天没见到你')),
    'the 3+ day tier mentions how many days it has been'
  );
});

// Regression: React StrictMode double-invokes the mount effect in dev, firing two
// concurrent /api/user/sync requests that both read the same old state. The recall
// greeting, the welcome seed, and the new-user row insert must each happen once.
test('concurrent duplicate syncs insert the recall greeting only once', async () => {
  const uid = 'recall_concurrent';
  await req('POST', '/api/user/sync', { userId: uid });
  await dbModule.dbRun('UPDATE users SET last_seen = ? WHERE id = ?', [Date.now() - 2 * 24 * 60 * 60 * 1000, uid]);
  // Two syncs race before either stamps last_seen — the pre-fix bug inserted two.
  const [a, b] = await Promise.all([
    req('POST', '/api/user/sync', { userId: uid }),
    req('POST', '/api/user/sync', { userId: uid }),
  ]);
  assert.equal(a.status, 200);
  assert.equal(b.status, 200);
  const rows = await dbModule.dbAll(
    "SELECT id FROM chat_messages WHERE user_id = ? AND text LIKE '%好久不见%'",
    [uid]
  );
  assert.equal(rows.length, 1, 'exactly one recall greeting despite the concurrent duplicate sync');
});

test('concurrent syncs with empty history seed the welcome only once', async () => {
  const uid = 'welcome_concurrent';
  await req('POST', '/api/user/sync', { userId: uid }); // creates the user + seeds the welcome
  await dbModule.dbRun('DELETE FROM chat_messages WHERE user_id = ?', [uid]); // back to empty history
  const [a, b] = await Promise.all([
    req('POST', '/api/user/sync', { userId: uid }),
    req('POST', '/api/user/sync', { userId: uid }),
  ]);
  assert.equal(a.status, 200);
  assert.equal(b.status, 200);
  // Both responses must still surface the welcome (one inserts it, the other reloads it).
  assert.ok(a.body.chatHistory.length >= 1 && b.body.chatHistory.length >= 1);
  const rows = await dbModule.dbAll('SELECT id FROM chat_messages WHERE user_id = ?', [uid]);
  assert.equal(rows.length, 1, 'exactly one welcome despite the concurrent empty-history sync');
});

test('concurrent first syncs for a brand-new user create one row without erroring', async () => {
  const uid = 'firstsync_concurrent';
  const [a, b] = await Promise.all([
    req('POST', '/api/user/sync', { userId: uid }),
    req('POST', '/api/user/sync', { userId: uid }),
  ]);
  // Neither request 500s on a primary-key collision.
  assert.equal(a.status, 200, 'first concurrent sync succeeds');
  assert.equal(b.status, 200, 'second concurrent sync succeeds (INSERT OR IGNORE, no PK clash)');
  const users = await dbModule.dbAll('SELECT id FROM users WHERE id = ?', [uid]);
  assert.equal(users.length, 1);
  // register is recorded exactly once (only the actual row creator counts as new).
  const regs = await dbModule.dbAll("SELECT id FROM events WHERE user_id = ? AND type = 'register'", [uid]);
  assert.equal(regs.length, 1, 'register event fires exactly once');
});
