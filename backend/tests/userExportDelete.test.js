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

const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'xiaoxiai-exp-test-'));
process.env.XIAOXIAI_DB_PATH = path.join(tempDir, 'test.sqlite');

const [{ app }, dbModule] = await Promise.all([import('../server.js'), import('../core/db.js')]);
await dbModule.dbReady;

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

const bearer = (token) => ({ Authorization: `Bearer ${token}` });
const GUEST = 'exp_guest_1';
let token;

test.before(async () => {
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  const reg = await postJson('/api/auth/register', { userId: GUEST, identifier: 'exp@example.com', password: 'secret123' });
  token = reg.body.token;
  await postJson('/api/memory/add', { text: '记住我喜欢猫' }, bearer(token));
});

test.after(async () => {
  if (server) await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  await dbModule.closeDb();
  await fs.rm(tempDir, { recursive: true, force: true });
});

test('POST /api/user/export returns the full data bundle', async () => {
  const res = await postJson('/api/user/export', {}, bearer(token));
  assert.equal(res.status, 200);
  assert.equal(res.body.export.user.id, GUEST);
  assert.equal(res.body.export.account.identifier, 'exp@example.com');
  assert.ok(!('password_hash' in res.body.export.account), 'the password hash is never exported');
  assert.ok(res.body.export.memories.some((m) => m.memory_value === '记住我喜欢猫'));
});

test('export is rejected for an unauthenticated guest', async () => {
  const res = await postJson('/api/user/export', { userId: 'some_unbound_guest' });
  assert.equal(res.status, 401);
  assert.equal(res.body.error.code, 'AUTH_REQUIRED');
});

test('delete requires an explicit confirm flag', async () => {
  const res = await postJson('/api/user/delete', {}, bearer(token));
  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, 'INVALID_PARAMETER');
});

test('delete removes the account and all user rows', async () => {
  const res = await postJson('/api/user/delete', { confirm: true }, bearer(token));
  assert.equal(res.status, 200);
  assert.equal(res.body.removed.users, 1);
  assert.equal(res.body.removed.accounts, 1);

  // The user is gone: a follow-up export 404s.
  const after = await postJson('/api/user/export', {}, bearer(token));
  assert.equal(after.status, 404);
  assert.equal(after.body.error.code, 'USER_NOT_FOUND');
});
