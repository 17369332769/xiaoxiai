import { AppError } from './appError.js';
import { sanitizeUserId } from './httpUtils.js';
import { findAccountByUserId, verifyToken } from '../services/accounts.js';

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

// True when a structurally-valid token has been revoked: the bound account still
// exists but its token_version has moved past the token's `ver` (a logout bumped
// it). Tokens without a numeric `ver` (pre-revocation legacy tokens) and tokens
// whose account isn't a bound row are never treated as revoked here — that keeps
// "a valid token is authoritative" intact and leaves account-existence checks to
// the handlers (a deleted account's user row is gone, so they 404 anyway).
async function isTokenRevoked(payload, tokenUserId) {
  if (typeof payload.ver !== 'number') return false;
  const account = await findAccountByUserId(tokenUserId);
  if (!account) return false;
  return (account.token_version || 0) !== payload.ver;
}

export function createResolveUser(authSecret) {
  return async (req, res, next) => {
    try {
      const header = req.get('authorization') || '';
      const match = /^Bearer\s+(.+)$/i.exec(header.trim());
      if (match) {
        const payload = verifyToken(match[1], authSecret);
        const tokenUserId = payload && typeof payload.userId === 'string' ? payload.userId.trim() : '';
        if (tokenUserId && USER_ID_PATTERN.test(tokenUserId)) {
          // Server-side revocation: a token only resolves if its `ver` still
          // matches the account's current token_version. Logout bumps the
          // version, so older tokens stop here. Legacy tokens (no `ver`) and
          // freshly-migrated accounts both sit at 0, so they keep working.
          const revoked = await isTokenRevoked(payload, tokenUserId);
          if (!revoked) {
            req.userId = tokenUserId;
            req.accountId = payload.accountId || null;
            req.isGuest = false;
            next();
            return;
          }
        }
        // Invalid/expired/malformed/revoked token: fall through to body resolution (lenient).
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
