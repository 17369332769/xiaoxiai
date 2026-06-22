import crypto from 'crypto';
import { AppError } from './appError.js';

// Guards the operator backend. The token is supplied via the `x-admin-token`
// header and compared in constant time. If no ADMIN_TOKEN is configured the
// admin surface is disabled entirely (fail-closed).
export function createRequireAdmin(adminToken) {
  return (req, res, next) => {
    if (!adminToken) {
      next(new AppError(503, 'ADMIN_DISABLED', 'Admin API is disabled (set ADMIN_TOKEN to enable)'));
      return;
    }

    // Header-only: accepting the token in the body risks it leaking into request
    // logs/analytics payloads. Operators must send the x-admin-token header.
    const provided = req.get('x-admin-token') || '';
    const a = Buffer.from(String(provided));
    const b = Buffer.from(adminToken);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      next(new AppError(403, 'ADMIN_FORBIDDEN', 'Invalid admin token'));
      return;
    }

    next();
  };
}
