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
// Opt this process into OTP so register requires a code and the code is echoed.
process.env.OTP_DEV_ECHO = 'true';
process.env.REQUIRE_REGISTRATION_OTP = 'true';
// Keep the resend cooldown short so the cooldown test is fast but real.
process.env.OTP_RESEND_COOLDOWN_SECONDS = '60';

const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'xiaoxiai-otp-test-'));
process.env.XIAOXIAI_DB_PATH = path.join(tempDir, 'test.sqlite');

const [{ app }, dbModule] = await Promise.all([
  import('../server.js'),
  import('../db.js'),
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

test('registration is rejected without a verification code when OTP is required', async () => {
  const res = await req('POST', '/api/auth/register', {
    userId: 'guest_otp_nootp',
    identifier: 'nootp@example.com',
    password: 'secret123',
  });
  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, 'INVALID_CODE');
});

test('request-code + register completes the OTP registration flow', async () => {
  const codeRes = await req('POST', '/api/auth/request-code', {
    identifier: 'otpuser@example.com',
    purpose: 'register',
  });
  assert.equal(codeRes.status, 200);
  assert.match(String(codeRes.body.devCode), /^\d{6}$/);

  const reg = await req('POST', '/api/auth/register', {
    userId: 'guest_otp_1',
    identifier: 'otpuser@example.com',
    password: 'secret123',
    code: codeRes.body.devCode,
  });
  assert.equal(reg.status, 200);
  assert.ok(reg.body.token, 'a token is issued on successful OTP registration');
});

test('request-code for an already-registered identifier is rejected', async () => {
  const res = await req('POST', '/api/auth/request-code', {
    identifier: 'otpuser@example.com',
    purpose: 'register',
  });
  assert.equal(res.status, 409);
  assert.equal(res.body.error.code, 'ACCOUNT_EXISTS');
});

test('reset request echoes a code only for an existing account (anti-enumeration)', async () => {
  const existing = await req('POST', '/api/auth/request-code', {
    identifier: 'otpuser@example.com',
    purpose: 'reset',
  });
  assert.equal(existing.status, 200);
  assert.match(String(existing.body.devCode), /^\d{6}$/);

  const ghost = await req('POST', '/api/auth/request-code', {
    identifier: 'ghost@example.com',
    purpose: 'reset',
  });
  assert.equal(ghost.status, 200, 'reset always returns a generic ok');
  assert.equal(ghost.body.devCode, undefined, 'no code is generated for a non-existent account');
});

test('full password-reset flow: bad code rejected, good code resets + logs in', async () => {
  // Register a dedicated account via the OTP flow.
  const regCode = await req('POST', '/api/auth/request-code', { identifier: 'reset@example.com', purpose: 'register' });
  await req('POST', '/api/auth/register', {
    userId: 'guest_reset_1',
    identifier: 'reset@example.com',
    password: 'oldpass123',
    code: regCode.body.devCode,
  });

  // Request a reset code.
  const resetCode = await req('POST', '/api/auth/request-code', { identifier: 'reset@example.com', purpose: 'reset' });
  assert.match(String(resetCode.body.devCode), /^\d{6}$/);

  // A wrong code is rejected.
  const bad = await req('POST', '/api/auth/reset-password', {
    identifier: 'reset@example.com',
    code: '000000',
    password: 'newpass456',
  });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error.code, 'INVALID_CODE');

  // The correct code resets the password and logs the user in.
  const ok = await req('POST', '/api/auth/reset-password', {
    identifier: 'reset@example.com',
    code: resetCode.body.devCode,
    password: 'newpass456',
  });
  assert.equal(ok.status, 200);
  assert.ok(ok.body.token, 'reset returns a fresh token');

  // The new password works; the old one no longer does.
  const newLogin = await req('POST', '/api/auth/login', { identifier: 'reset@example.com', password: 'newpass456' });
  assert.equal(newLogin.status, 200);
  const oldLogin = await req('POST', '/api/auth/login', { identifier: 'reset@example.com', password: 'oldpass123' });
  assert.equal(oldLogin.status, 401);
});

test('a second code request within the cooldown is throttled', async () => {
  const first = await req('POST', '/api/auth/request-code', { identifier: 'cooldown@example.com', purpose: 'register' });
  assert.equal(first.status, 200);
  const second = await req('POST', '/api/auth/request-code', { identifier: 'cooldown@example.com', purpose: 'register' });
  assert.equal(second.status, 429);
  assert.equal(second.body.error.code, 'CODE_COOLDOWN');
});

test('a code locks out after too many wrong attempts (brute-force defense)', async () => {
  const requested = await req('POST', '/api/auth/request-code', { identifier: 'lockout@example.com', purpose: 'register' });
  const correct = String(requested.body.devCode);
  const wrong = correct === '000000' ? '111111' : '000000';

  // Exhaust the 5-attempt limit with wrong codes.
  for (let i = 0; i < 5; i += 1) {
    const bad = await req('POST', '/api/auth/register', {
      userId: `guest_lock_${i}`,
      identifier: 'lockout@example.com',
      password: 'secret123',
      code: wrong,
    });
    assert.equal(bad.status, 400);
    assert.equal(bad.body.error.code, 'INVALID_CODE');
  }

  // Even the CORRECT code is now rejected — the code is locked, not brute-forceable.
  const locked = await req('POST', '/api/auth/register', {
    userId: 'guest_lock_final',
    identifier: 'lockout@example.com',
    password: 'secret123',
    code: correct,
  });
  assert.equal(locked.status, 400);
  assert.equal(locked.body.error.code, 'INVALID_CODE');
});
