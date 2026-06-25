import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

process.env.LOG_LEVEL = 'error';
process.env.LOG_REQUESTS = 'false';

const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'xiaoxiai-secunit-'));
process.env.XIAOXIAI_DB_PATH = path.join(tempDir, 'test.sqlite');

const [{ createResolveUser }, { createLoginThrottle }, accounts, dbModule] = await Promise.all([
  import('../core/resolveUser.js'),
  import('../services/authThrottle.js'),
  import('../services/accounts.js'),
  import('../core/db.js'),
]);

await dbModule.dbReady;
const { dbRun } = dbModule;

test.after(async () => {
  await dbModule.closeDb();
  await fs.rm(tempDir, { recursive: true, force: true });
});

const SECRET = 'unit-secret';

// Drive the middleware directly with a minimal req/res and capture next(err).
function runResolve(resolveUser, { authHeader, bodyUserId } = {}) {
  return new Promise((resolve) => {
    const req = {
      get: (name) => (name.toLowerCase() === 'authorization' ? authHeader : undefined),
      body: bodyUserId === undefined ? {} : { userId: bodyUserId },
    };
    resolveUser(req, {}, (err) => resolve({ err, req }));
  });
}

// ---------- resolveUser ----------

test('resolveUser: a valid token is authoritative over a spoofed body userId', async () => {
  const resolveUser = createResolveUser(SECRET);
  const token = accounts.issueToken({ accountId: 'acc1', userId: 'u_token' }, SECRET);
  const { err, req } = await runResolve(resolveUser, { authHeader: `Bearer ${token}`, bodyUserId: 'u_spoof' });
  assert.equal(err, undefined);
  assert.equal(req.userId, 'u_token');
  assert.equal(req.isGuest, false);
  assert.equal(req.accountId, 'acc1');
});

test('resolveUser: an unbound guest id (no token) proceeds as guest', async () => {
  const resolveUser = createResolveUser(SECRET);
  const { err, req } = await runResolve(resolveUser, { bodyUserId: 'u_unbound_guest' });
  assert.equal(err, undefined);
  assert.equal(req.userId, 'u_unbound_guest');
  assert.equal(req.isGuest, true);
});

test('resolveUser: a bound id without a token is rejected with AUTH_REQUIRED (401)', async () => {
  await dbRun(
    'INSERT INTO accounts (id, identifier, identifier_type, password_hash, user_id) VALUES (?, ?, ?, ?, ?)',
    ['acc-bound', 'bound@example.com', 'email', 'h', 'u_bound']
  );
  const resolveUser = createResolveUser(SECRET);
  const { err } = await runResolve(resolveUser, { bodyUserId: 'u_bound' });
  assert.ok(err);
  assert.equal(err.code, 'AUTH_REQUIRED');
  assert.equal(err.status, 401);
});

test('resolveUser: an invalid/garbage token falls through to body resolution', async () => {
  const resolveUser = createResolveUser(SECRET);
  const { err, req } = await runResolve(resolveUser, { authHeader: 'Bearer not.a.valid.token', bodyUserId: 'u_fallthru' });
  assert.equal(err, undefined);
  assert.equal(req.userId, 'u_fallthru');
  assert.equal(req.isGuest, true);
});

test('resolveUser: a signed token carrying a malformed userId falls through (not a hard 400)', async () => {
  const resolveUser = createResolveUser(SECRET);
  const badToken = accounts.issueToken({ accountId: 'acc2', userId: 'has spaces!' }, SECRET);
  const { err, req } = await runResolve(resolveUser, { authHeader: `Bearer ${badToken}`, bodyUserId: 'u_ok_guest' });
  assert.equal(err, undefined);
  assert.equal(req.userId, 'u_ok_guest');
  assert.equal(req.isGuest, true);
});

test('resolveUser: a missing body userId with no token yields INVALID_USER_ID (400)', async () => {
  const resolveUser = createResolveUser(SECRET);
  const { err } = await runResolve(resolveUser, {});
  assert.ok(err);
  assert.equal(err.code, 'INVALID_USER_ID');
  assert.equal(err.status, 400);
});

// ---------- loginThrottle ----------

test('loginThrottle: locks after maxFailed, isolates by IP, and a success clears it', () => {
  const throttle = createLoginThrottle({ maxFailed: 3, windowMs: 60000, lockMs: 60000 });
  const id = 'brute@example.com';

  assert.equal(throttle.check(id, '1.1.1.1').allowed, true);
  throttle.recordFailure(id, '1.1.1.1');
  throttle.recordFailure(id, '1.1.1.1');
  assert.equal(throttle.check(id, '1.1.1.1').allowed, true); // 2 < 3, still allowed

  throttle.recordFailure(id, '1.1.1.1'); // 3rd failure trips the lock
  assert.equal(throttle.check(id, '1.1.1.1').allowed, false);

  // A different IP is a separate bucket — not locked.
  assert.equal(throttle.check(id, '2.2.2.2').allowed, true);

  // A successful login clears the locked bucket.
  throttle.recordSuccess(id, '1.1.1.1');
  assert.equal(throttle.check(id, '1.1.1.1').allowed, true);
});

test('loginThrottle: a lock expires after lockMs', async () => {
  const throttle = createLoginThrottle({ maxFailed: 1, windowMs: 60000, lockMs: 30 });
  const id = 'x@y.com';
  const ip = '3.3.3.3';

  throttle.recordFailure(id, ip); // maxFailed=1 → immediate lock
  assert.equal(throttle.check(id, ip).allowed, false);

  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.equal(throttle.check(id, ip).allowed, true); // lock window elapsed
});
