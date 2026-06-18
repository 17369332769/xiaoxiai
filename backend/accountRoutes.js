import { dbGet, dbRun } from './db.js';
import { AppError } from './appError.js';
import { asyncHandler, sanitizeUserId, sendJson } from './httpUtils.js';
import { ensureUserTasks } from './gameplay.js';
import {
  createAccount,
  findAccountByIdentifier,
  findAccountByUserId,
  issueToken,
  normalizeCredentials,
  verifyPassword,
} from './accounts.js';
import { recordEvent } from './analytics.js';

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
  app.post('/api/auth/register', asyncHandler(async (req, res) => {
    const { identifier, identifierType, password } = normalizeCredentials(req.body?.identifier, req.body?.password);
    const guestUserId = sanitizeUserId(req.body?.userId);

    await ensureUserRow(guestUserId);
    if (await findAccountByUserId(guestUserId)) {
      throw new AppError(409, 'USER_ALREADY_BOUND', '当前游客身份已绑定账号，请直接登录');
    }

    const account = await createAccount({ identifier, identifierType, password, userId: guestUserId });
    await recordEvent(guestUserId, 'account_register', { identifierType });

    sendJson(res, {
      token: issueToken({ accountId: account.id, userId: account.user_id }, authSecret),
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

    const account = await findAccountByIdentifier(identifier);
    if (!account || !verifyPassword(password, account.password_hash)) {
      throw new AppError(401, 'INVALID_LOGIN', '账号或密码不正确');
    }

    await ensureUserRow(account.user_id);
    await recordEvent(account.user_id, 'account_login', {});

    sendJson(res, {
      token: issueToken({ accountId: account.id, userId: account.user_id }, authSecret),
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
      token: issueToken({ accountId: account.id, userId: account.user_id }, authSecret),
      account: publicAccount(account),
    });
  }));
}
