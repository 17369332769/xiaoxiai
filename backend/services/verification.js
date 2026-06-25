import crypto from 'crypto';
import { dbGet, dbRun } from '../core/db.js';
import { AppError } from '../core/appError.js';
import { createLogger } from '../core/logger.js';
import { resolvePositiveIntEnv } from '../core/envUtils.js';

const logger = createLogger('verification');

// Short-lived numeric codes for registration OTP and password reset.
const CODE_TTL_MS = resolvePositiveIntEnv(process.env.OTP_TTL_SECONDS, 600) * 1000; // 10 min
const RESEND_COOLDOWN_MS = resolvePositiveIntEnv(process.env.OTP_RESEND_COOLDOWN_SECONDS, 60) * 1000;
const MAX_ATTEMPTS = 5;

// Feature flags (read once at load; per-process in tests, so each test file can
// opt in without affecting others).
export const OTP_DEV_ECHO = process.env.OTP_DEV_ECHO === 'true';
export const REQUIRE_REGISTRATION_OTP = process.env.REQUIRE_REGISTRATION_OTP === 'true';

function hashCode(identifier, purpose, code) {
  return crypto.createHash('sha256').update(`${identifier}:${purpose}:${code}`).digest('hex');
}

function generateCode() {
  // 6-digit, zero-padded, drawn from a CSPRNG.
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
}

// Pluggable delivery. INTEGRATION POINT: wire a real SMS/email provider here
// (branch on identifier type). Until then the code is logged server-side so the
// flow is fully usable in dev/testing. The code is NEVER returned to the client
// unless OTP_DEV_ECHO is explicitly enabled (see the request-code route).
async function sendVerificationCode(identifier, code, purpose) {
  logger.info('Verification code issued (dev delivery: server log only)', { identifier, purpose, code });
}

// Generate, persist (hashed), and "send" a code for an identifier+purpose. One
// active code per (identifier, purpose): a new request replaces the old. Throws
// 429 if requested again within the resend cooldown. Returns the plaintext code
// (so the route can dev-echo it when OTP_DEV_ECHO is on).
export async function requestVerificationCode(identifier, purpose) {
  const existing = await dbGet(
    'SELECT created_at FROM verification_codes WHERE identifier = ? AND purpose = ?',
    [identifier, purpose]
  );
  const now = Date.now();
  if (existing && typeof existing.created_at === 'number' && now - existing.created_at < RESEND_COOLDOWN_MS) {
    throw new AppError(429, 'CODE_COOLDOWN', '验证码发送过于频繁，请稍后再试');
  }
  const code = generateCode();
  await dbRun(
    `INSERT INTO verification_codes (identifier, purpose, code_hash, expires_at, attempts, created_at)
     VALUES (?, ?, ?, ?, 0, ?)
     ON CONFLICT(identifier, purpose) DO UPDATE SET
       code_hash = excluded.code_hash,
       expires_at = excluded.expires_at,
       attempts = 0,
       created_at = excluded.created_at`,
    [identifier, purpose, hashCode(identifier, purpose, code), now + CODE_TTL_MS, now]
  );
  await sendVerificationCode(identifier, code, purpose);
  return code;
}

// Verify a submitted code; consume (delete) it on success. Returns true/false.
// A wrong code increments an attempt counter and locks after MAX_ATTEMPTS; an
// expired code is dropped. Constant-time comparison on the stored hash.
export async function verifyAndConsumeCode(identifier, purpose, submittedCode) {
  if (typeof submittedCode !== 'string' || !/^\d{6}$/.test(submittedCode)) return false;
  const row = await dbGet(
    'SELECT code_hash, expires_at, attempts FROM verification_codes WHERE identifier = ? AND purpose = ?',
    [identifier, purpose]
  );
  if (!row) return false;
  if (typeof row.expires_at === 'number' && Date.now() >= row.expires_at) {
    await dbRun('DELETE FROM verification_codes WHERE identifier = ? AND purpose = ?', [identifier, purpose]);
    return false;
  }
  if ((row.attempts || 0) >= MAX_ATTEMPTS) {
    return false;
  }
  const expected = Buffer.from(row.code_hash || '', 'hex');
  const actual = Buffer.from(hashCode(identifier, purpose, submittedCode), 'hex');
  const match = expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
  if (!match) {
    await dbRun(
      'UPDATE verification_codes SET attempts = attempts + 1 WHERE identifier = ? AND purpose = ?',
      [identifier, purpose]
    );
    return false;
  }
  await dbRun('DELETE FROM verification_codes WHERE identifier = ? AND purpose = ?', [identifier, purpose]);
  return true;
}
