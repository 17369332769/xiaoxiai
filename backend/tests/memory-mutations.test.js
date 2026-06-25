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

const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'xiaoxiai-mem-test-'));
process.env.XIAOXIAI_DB_PATH = path.join(tempDir, 'test.sqlite');

const [{ app }, dbModule] = await Promise.all([import('../server.js'), import('../core/db.js')]);
await dbModule.dbReady;
const { dbRun } = dbModule;

let server;
let baseUrl;

async function postJson(route, payload) {
  const response = await fetch(`${baseUrl}${route}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: process.env.ALLOWED_ORIGIN },
    body: JSON.stringify(payload),
  });
  return { status: response.status, body: await response.json() };
}

const USER = 'mem_user_1';

test.before(async () => {
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  await dbRun('INSERT INTO users (id) VALUES (?)', [USER]);
});

test.after(async () => {
  if (server) await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  await dbModule.closeDb();
  await fs.rm(tempDir, { recursive: true, force: true });
});

test('POST /api/memory/add stores a user-authored memory', async () => {
  const res = await postJson('/api/memory/add', { userId: USER, text: '我喜欢喝美式咖啡' });
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.ok(res.body.memories.some((m) => m.value === '我喜欢喝美式咖啡'));
});

test('POST /api/memory/add honors a caller-supplied key (topic)', async () => {
  const res = await postJson('/api/memory/add', { userId: USER, text: '每天晚上跑步', key: 'hobby' });
  assert.equal(res.status, 200);
  const hobby = res.body.memories.find((m) => m.key === 'hobby');
  assert.ok(hobby, 'memory stored under the given key');
  assert.equal(hobby.value, '每天晚上跑步');
  assert.equal(hobby.weight, 1);
});

test('POST /api/memory/add screens unsafe content', async () => {
  const res = await postJson('/api/memory/add', { userId: USER, text: '我想了解毒品交易' });
  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, 'CONTENT_BLOCKED');
});

test('POST /api/memory/update edits in place and preserves weight', async () => {
  const res = await postJson('/api/memory/update', { userId: USER, key: 'hobby', text: '改成游泳了' });
  assert.equal(res.status, 200);
  const hobby = res.body.memories.find((m) => m.key === 'hobby');
  assert.equal(hobby.value, '改成游泳了');
  assert.equal(hobby.weight, 1, 'an edit is not reinforcement; weight is unchanged');
});

test('POST /api/memory/update 404s on an unknown key', async () => {
  const res = await postJson('/api/memory/update', { userId: USER, key: 'no_such_key', text: 'x' });
  assert.equal(res.status, 404);
  assert.equal(res.body.error.code, 'MEMORY_NOT_FOUND');
});

test('POST /api/memory/add rejects empty text', async () => {
  const res = await postJson('/api/memory/add', { userId: USER, text: '   ' });
  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, 'INVALID_PARAMETER');
});
