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
