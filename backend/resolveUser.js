import { AppError } from './appError.js';
import { sanitizeUserId } from './httpUtils.js';
import { findAccountByUserId, verifyToken } from './accounts.js';

// Resolves the authoritative userId for a business request and closes the
// account-takeover hole: a guest id that has been bound to a formal account can
// only be operated through a valid auth token, never by passing its userId in
// the body. Sets req.userId (authoritative), req.accountId, req.isGuest.
//
//   1. Valid `Authorization: Bearer <token>`  -> userId comes from the signed
//      token; req.body.userId is ignored entirely.
//   2. No / invalid token                      -> userId comes from req.body; if
//      that id is bound to an account, reject with 401 (must log in); otherwise
//      treat it as an anonymous guest and proceed.
//
// A present-but-invalid token (bad signature, expired, or even a structurally
// valid token carrying a malformed userId) falls through to body resolution so a
// guest on that device still works, rather than hard-failing every request.
const USER_ID_PATTERN = /^[a-zA-Z0-9_-]{4,64}$/;

export function createResolveUser(authSecret) {
  return async (req, res, next) => {
    try {
      const header = req.get('authorization') || '';
      const match = /^Bearer\s+(.+)$/i.exec(header.trim());
      if (match) {
        const payload = verifyToken(match[1], authSecret);
        const tokenUserId = payload && typeof payload.userId === 'string' ? payload.userId.trim() : '';
        if (tokenUserId && USER_ID_PATTERN.test(tokenUserId)) {
          req.userId = tokenUserId;
          req.accountId = payload.accountId || null;
          req.isGuest = false;
          next();
          return;
        }
        // Invalid/expired/malformed token: fall through to body resolution (lenient).
      }

      // sanitizeUserId throws 400 INVALID_USER_ID on a missing/garbage id,
      // preserving the previous per-handler validation behavior.
      const candidate = sanitizeUserId(req.body?.userId);
      const account = await findAccountByUserId(candidate);
      if (account) {
        throw new AppError(401, 'AUTH_REQUIRED', '该身份已绑定账号，请登录后再操作');
      }

      req.userId = candidate;
      req.accountId = null;
      req.isGuest = true;
      next();
    } catch (error) {
      next(error);
    }
  };
}
