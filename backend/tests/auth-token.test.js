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

const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'xiaoxiai-tok-test-'));
process.env.XIAOXIAI_DB_PATH = path.join(tempDir, 'test.sqlite');

const [{ app }, dbModule] = await Promise.all([import('../server.js'), import('../db.js')]);
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
const GUEST = 'tok_guest_1';

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

test('refresh rotates a still-valid token without revoking it', async () => {
  const reg = await postJson('/api/auth/register', { userId: GUEST, identifier: 'tok@example.com', password: 'secret123' });
  assert.equal(reg.status, 200);
  const token0 = reg.body.token;

  // The original token authorizes a protected route.
  const before = await postJson('/api/transactions', { userId: GUEST }, bearer(token0));
  assert.equal(before.status, 200);

  const refreshed = await postJson('/api/auth/refresh', {}, bearer(token0));
  assert.equal(refreshed.status, 200);
  assert.ok(refreshed.body.token, 'a fresh token is returned');

  // Refresh does NOT revoke: the original token still works.
  const stillOk = await postJson('/api/transactions', { userId: GUEST }, bearer(token0));
  assert.equal(stillOk.status, 200);
});

test('logout revokes every outstanding token for the account', async () => {
  const login = await postJson('/api/auth/login', { identifier: 'tok@example.com', password: 'secret123' });
  const token = login.body.token;

  const out = await postJson('/api/auth/logout', {}, bearer(token));
  assert.equal(out.status, 200);

  // The token used to log out is now revoked (version bumped) -> falls through to
  // body resolution, where the bound guest id requires auth -> 401.
  const after = await postJson('/api/transactions', { userId: GUEST }, bearer(token));
  assert.equal(after.status, 401);
  assert.equal(after.body.error.code, 'AUTH_REQUIRED');
});

test('a fresh login after logout works again (new token_version)', async () => {
  const login = await postJson('/api/auth/login', { identifier: 'tok@example.com', password: 'secret123' });
  assert.equal(login.status, 200);
  const ok = await postJson('/api/transactions', { userId: GUEST }, bearer(login.body.token));
  assert.equal(ok.status, 200);
});

test('refresh and logout reject missing/invalid tokens with 401', async () => {
  const noToken = await postJson('/api/auth/refresh', {});
  assert.equal(noToken.status, 401);
  const badRefresh = await postJson('/api/auth/refresh', {}, bearer('not-a-real-token'));
  assert.equal(badRefresh.status, 401);
  const badLogout = await postJson('/api/auth/logout', {}, bearer('not-a-real-token'));
  assert.equal(badLogout.status, 401);
});
