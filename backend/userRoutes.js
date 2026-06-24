import { AppError } from './appError.js';
import { asyncHandler, sendJson } from './httpUtils.js';
import { exportUserData, deleteUserAccount } from './userExportDelete.js';

// Self-service data rights (privacy/compliance): a logged-in user can export all
// of their data or permanently delete their account. Both require a real account
// (a bare guest has nothing bound and no token), enforced via resolveUser +
// req.accountId.
export function registerUserRoutes(app, { resolveUser }) {
  app.use(['/api/user/export', '/api/user/delete'], resolveUser);

  function requireAccount(req) {
    if (req.isGuest || !req.accountId) {
      throw new AppError(401, 'AUTH_REQUIRED', '请登录后再操作账号数据');
    }
  }

  app.post('/api/user/export', asyncHandler(async (req, res) => {
    requireAccount(req);
    const data = await exportUserData(req.userId);
    if (!data.user) throw new AppError(404, 'USER_NOT_FOUND', 'User not found');
    sendJson(res, { export: data });
  }));

  app.post('/api/user/delete', asyncHandler(async (req, res) => {
    requireAccount(req);
    if (req.body?.confirm !== true) {
      throw new AppError(400, 'INVALID_PARAMETER', '注销需要显式确认（confirm: true）');
    }
    const existing = await exportUserData(req.userId);
    if (!existing.user) throw new AppError(404, 'USER_NOT_FOUND', 'User not found');

    const removed = await deleteUserAccount(req.userId);
    sendJson(res, { removed });
  }));
}
