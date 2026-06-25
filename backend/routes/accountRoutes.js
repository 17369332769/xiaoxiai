import { dbGet, dbRun } from '../core/db.js';
import { AppError } from '../core/appError.js';
import { asyncHandler, sanitizeUserId, sendJson } from '../core/httpUtils.js';
import { ensureUserTasks } from '../services/gameplay.js';
import {
  createAccount,
  detectIdentifierType,
  findAccountByIdentifier,
  findAccountByUserId,
  incrementTokenVersion,
  issueToken,
  normalizeCredentials,
  resetAccountPassword,
  verifyPassword,
  verifyToken,
} from '../services/accounts.js';
import { recordEvent } from '../services/analytics.js';
import { createLoginThrottle } from '../services/authThrottle.js';
import {
  OTP_DEV_ECHO,
  REQUIRE_REGISTRATION_OTP,
  requestVerificationCode,
  verifyAndConsumeCode,
} from '../services/verification.js';

async function ensureUserRow(userId) {
  let user = await dbGet('SELECT * FROM users WHERE id = ?', [userId]);
  if (!user) {
    await dbRun(
      'INSERT INTO users (id, level, affection, energy, mood, coins, last_checkin) VALUES (?, 1, 10, 80, 70, 200, NULL)',
      [userId]
    );
    await ensureUserTasks(userId);
    user = await dbGet('SELECT * FROM users WHERE id = ?', [userId]);
  }
  return user;
}

function publicAccount(account) {
  return { identifier: account.identifier, identifierType: account.identifier_type, userId: account.user_id };
}

// Formal account system layered on top of the anonymous guest profile:
//   register -> binds the current guest userId to a credential (guest -> formal)
//   login    -> returns the canonical userId for cross-device sync
//   bind     -> attach a credential to an already-playing guest profile
export function registerAccountRoutes(app, { authSecret }) {
  const loginThrottle = createLoginThrottle();

  app.post('/api/auth/register', asyncHandler(async (req, res) => {
    const { identifier, identifierType, password } = normalizeCredentials(req.body?.identifier, req.body?.password);
    const guestUserId = sanitizeUserId(req.body?.userId);

    // Optional registration OTP (off by default; existing flow is unchanged when
    // REQUIRE_REGISTRATION_OTP is unset). When on, a valid code is mandatory.
    if (REQUIRE_REGISTRATION_OTP && !(await verifyAndConsumeCode(identifier, 'register', req.body?.code))) {
      throw new AppError(400, 'INVALID_CODE', '验证码无效或已过期，请重新获取');
    }

    await ensureUserRow(guestUserId);
    if (await findAccountByUserId(guestUserId)) {
      throw new AppError(409, 'USER_ALREADY_BOUND', '当前游客身份已绑定账号，请直接登录');
    }

    const account = await createAccount({ identifier, identifierType, password, userId: guestUserId });
    await recordEvent(guestUserId, 'account_register', { identifierType });

    sendJson(res, {
      token: issueToken({ accountId: account.id, userId: account.user_id, tokenVersion: account.token_version }, authSecret),
      account: publicAccount(account),
    });
  }));

  app.post('/api/auth/login', asyncHandler(async (req, res) => {
    // Login only normalizes the identifier; it must NOT enforce password format
    // rules (that would leak validity and reject otherwise-checkable passwords).
    const identifier = typeof req.body?.identifier === 'string' ? req.body.identifier.trim().toLowerCase() : '';
    const password = req.body?.password;
    if (!identifier || typeof password !== 'string' || !password) {
      throw new AppError(400, 'INVALID_CREDENTIALS', '账号和密码不能为空');
    }

    // Brute-force guard: after repeated failures for this identifier+IP, lock out
    // briefly so credential stuffing is expensive.
    const ip = req.ip || req.socket?.remoteAddress || 'unknown';
    const gate = loginThrottle.check(identifier, ip);
    if (!gate.allowed) {
      throw new AppError(429, 'TOO_MANY_ATTEMPTS', '登录尝试过于频繁，请稍后再试');
    }

    const account = await findAccountByIdentifier(identifier);
    if (!account || !verifyPassword(password, account.password_hash)) {
      loginThrottle.recordFailure(identifier, ip);
      throw new AppError(401, 'INVALID_LOGIN', '账号或密码不正确');
    }
    loginThrottle.recordSuccess(identifier, ip);

    await ensureUserRow(account.user_id);
    await recordEvent(account.user_id, 'account_login', {});

    sendJson(res, {
      token: issueToken({ accountId: account.id, userId: account.user_id, tokenVersion: account.token_version }, authSecret),
      account: publicAccount(account),
    });
  }));

  app.post('/api/auth/bind', asyncHandler(async (req, res) => {
    const { identifier, identifierType, password } = normalizeCredentials(req.body?.identifier, req.body?.password);
    const guestUserId = sanitizeUserId(req.body?.userId);

    await ensureUserRow(guestUserId);
    if (await findAccountByUserId(guestUserId)) {
      throw new AppError(409, 'USER_ALREADY_BOUND', '当前身份已经绑定过账号了');
    }

    const account = await createAccount({ identifier, identifierType, password, userId: guestUserId });
    await recordEvent(guestUserId, 'account_bind', { identifierType });

    sendJson(res, {
      token: issueToken({ accountId: account.id, userId: account.user_id, tokenVersion: account.token_version }, authSecret),
      account: publicAccount(account),
    });
  }));

  // Resolve the live account behind a Bearer token, or throw 401. Used by the
  // refresh/logout endpoints (which aren't behind resolveUser). A token is only
  // accepted if its `ver` still matches the account's token_version — a logged-out
  // (revoked) token is treated as unauthenticated.
  async function requireTokenAccount(req) {
    const header = req.get('authorization') || '';
    const m = /^Bearer\s+(.+)$/i.exec(header.trim());
    const payload = m ? verifyToken(m[1], authSecret) : null;
    if (!payload || !payload.accountId || typeof payload.userId !== 'string') {
      throw new AppError(401, 'AUTH_REQUIRED', '登录状态已失效，请重新登录');
    }
    const account = await findAccountByUserId(payload.userId);
    if (!account || account.id !== payload.accountId) {
      throw new AppError(401, 'AUTH_REQUIRED', '登录状态已失效，请重新登录');
    }
    if (typeof payload.ver === 'number' && (account.token_version || 0) !== payload.ver) {
      throw new AppError(401, 'AUTH_REQUIRED', '登录状态已失效，请重新登录');
    }
    return account;
  }

  // Rotate the token's expiry WITHOUT revoking other sessions: re-issue at the
  // account's CURRENT token_version so the client can extend a still-valid login.
  app.post('/api/auth/refresh', asyncHandler(async (req, res) => {
    const account = await requireTokenAccount(req);
    sendJson(res, {
      token: issueToken({ accountId: account.id, userId: account.user_id, tokenVersion: account.token_version }, authSecret),
      account: publicAccount(account),
    });
  }));

  // Server-side logout: bump token_version so EVERY outstanding token for this
  // account stops resolving (logout-everywhere / revoke a leaked token).
  app.post('/api/auth/logout', asyncHandler(async (req, res) => {
    const account = await requireTokenAccount(req);
    await incrementTokenVersion(account.id);
    await recordEvent(account.user_id, 'account_logout', {});
    sendJson(res, {});
  }));

  // Validate + normalize an identifier on its own (no password), for code requests.
  function normalizeIdentifier(raw) {
    const identifier = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
    if (!detectIdentifierType(identifier)) {
      throw new AppError(400, 'INVALID_IDENTIFIER', '请输入合法的手机号、邮箱或 3-32 位用户名');
    }
    return identifier;
  }

  // Request a verification code for registration ('register') or password reset
  // ('reset'). For reset we ALWAYS return a generic ok and only actually send to
  // an existing account, so the response can't be used to enumerate which
  // identifiers are registered.
  app.post('/api/auth/request-code', asyncHandler(async (req, res) => {
    const purpose = req.body?.purpose === 'reset' ? 'reset' : 'register';
    const identifier = normalizeIdentifier(req.body?.identifier);
    const account = await findAccountByIdentifier(identifier);
    if (purpose === 'register' && account) {
      throw new AppError(409, 'ACCOUNT_EXISTS', '该账号已被注册，请直接登录');
    }
    let code = null;
    if (purpose === 'register' || account) {
      code = await requestVerificationCode(identifier, purpose);
    }
    const body = { ok: true, sent: true };
    // Dev-only echo so the flow is testable without a real SMS/email provider.
    if (OTP_DEV_ECHO && code) body.devCode = code;
    sendJson(res, body);
  }));

  // Reset a forgotten password with a valid 'reset' code. On success the password
  // is replaced and ALL existing sessions are revoked (token_version bump); a
  // fresh token is returned so the user is logged straight in.
  app.post('/api/auth/reset-password', asyncHandler(async (req, res) => {
    const { identifier, password } = normalizeCredentials(req.body?.identifier, req.body?.password);
    if (!(await verifyAndConsumeCode(identifier, 'reset', req.body?.code))) {
      throw new AppError(400, 'INVALID_CODE', '验证码无效或已过期，请重新获取');
    }
    const account = await findAccountByIdentifier(identifier);
    if (!account) {
      throw new AppError(400, 'INVALID_CODE', '验证码无效或已过期，请重新获取');
    }
    await resetAccountPassword(account.id, password);
    await recordEvent(account.user_id, 'account_reset_password', {});
    const fresh = await findAccountByIdentifier(identifier);
    sendJson(res, {
      token: issueToken({ accountId: fresh.id, userId: fresh.user_id, tokenVersion: fresh.token_version }, authSecret),
      account: publicAccount(fresh),
    });
  }));
}
