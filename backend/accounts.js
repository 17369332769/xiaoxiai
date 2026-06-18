import crypto from 'crypto';
import { dbGet, dbRun } from './db.js';
import { AppError } from './appError.js';

const SCRYPT_KEYLEN = 64;

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, SCRYPT_KEYLEN).toString('hex');
  return `${salt}:${derived}`;
}

export function verifyPassword(password, stored) {
  if (typeof stored !== 'string' || !stored.includes(':')) return false;
  const [salt, expected] = stored.split(':');
  const derived = crypto.scryptSync(password, salt, SCRYPT_KEYLEN).toString('hex');
  const a = Buffer.from(derived, 'hex');
  const b = Buffer.from(expected, 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export function detectIdentifierType(identifier) {
  if (/^1[3-9]\d{9}$/.test(identifier)) return 'phone';
  if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(identifier)) return 'email';
  if (/^[a-zA-Z0-9_]{3,32}$/.test(identifier)) return 'username';
  return null;
}

export function normalizeCredentials(rawIdentifier, rawPassword) {
  if (typeof rawIdentifier !== 'string' || typeof rawPassword !== 'string') {
    throw new AppError(400, 'INVALID_CREDENTIALS', '账号和密码不能为空');
  }
  const identifier = rawIdentifier.trim().toLowerCase();
  const password = rawPassword;
  const identifierType = detectIdentifierType(identifier);
  if (!identifierType) {
    throw new AppError(400, 'INVALID_IDENTIFIER', '请输入合法的手机号、邮箱或 3-32 位用户名');
  }
  if (password.length < 6 || password.length > 64) {
    throw new AppError(400, 'INVALID_PASSWORD', '密码长度需在 6-64 位之间');
  }
  return { identifier, identifierType, password };
}

export async function findAccountByIdentifier(identifier) {
  return dbGet('SELECT * FROM accounts WHERE identifier = ?', [identifier]);
}

export async function findAccountByUserId(userId) {
  return dbGet('SELECT * FROM accounts WHERE user_id = ?', [userId]);
}

export async function createAccount({ identifier, identifierType, password, userId }) {
  const existing = await findAccountByIdentifier(identifier);
  if (existing) {
    throw new AppError(409, 'ACCOUNT_EXISTS', '该账号已被注册，请直接登录');
  }
  const id = `acct-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
  try {
    await dbRun(
      'INSERT INTO accounts (id, identifier, identifier_type, password_hash, user_id) VALUES (?, ?, ?, ?, ?)',
      [id, identifier, identifierType, hashPassword(password), userId]
    );
  } catch (error) {
    // Translate the UNIQUE-constraint backstop (which also closes the TOCTOU
    // race the app-level checks leave open) into the right 409.
    const message = error.message || '';
    if (message.includes('accounts.user_id')) {
      throw new AppError(409, 'USER_ALREADY_BOUND', '当前游客身份已绑定账号，请直接登录');
    }
    if (message.includes('accounts.identifier') || message.includes('UNIQUE')) {
      throw new AppError(409, 'ACCOUNT_EXISTS', '该账号已被注册，请直接登录');
    }
    throw error;
  }
  return dbGet('SELECT * FROM accounts WHERE id = ?', [id]);
}

function base64url(input) {
  return Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// Compact signed token: base64url(payload).hmac. No expiry rotation logic for the
// demo — a real deployment would add exp + refresh.
export function issueToken({ accountId, userId }, secret) {
  const payload = base64url(JSON.stringify({ accountId, userId, iat: Date.now() }));
  const sig = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  return `${payload}.${sig}`;
}

export function verifyToken(token, secret) {
  if (typeof token !== 'string' || !token.includes('.')) return null;
  const [payload, sig] = token.split('.');
  const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  const a = Buffer.from(sig || '');
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    return JSON.parse(Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString());
  } catch {
    return null;
  }
}
