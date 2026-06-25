import { dbGet } from '../core/db.js';
import { AppError } from '../core/appError.js';
import { asyncHandler, sendJson } from '../core/httpUtils.js';
import { recordEvent } from '../services/analytics.js';

const ALLOWED_CLIENT_EVENTS = new Set([
  'open_shop',
  'open_wallet',
  'open_tipping',
  'open_auth',
  'play_music',
  'click_avatar',
  'view_tasks',
]);

// Lightweight client-side behavior beacon. Only a whitelist of UI events is
// accepted so the table can't be flooded with arbitrary types.
export function registerAnalyticsRoutes(app, { resolveUser }) {
  app.use('/api/analytics', resolveUser);

  app.post('/api/analytics/track', asyncHandler(async (req, res) => {
    const userId = req.userId;
    const type = String(req.body?.type || '');
    if (!ALLOWED_CLIENT_EVENTS.has(type)) {
      throw new AppError(400, 'INVALID_EVENT', 'Unknown analytics event type');
    }

    const user = await dbGet('SELECT id FROM users WHERE id = ?', [userId]);
    if (!user) throw new AppError(404, 'USER_NOT_FOUND', 'User not found');

    const payload = req.body?.payload && typeof req.body.payload === 'object' ? req.body.payload : {};
    await recordEvent(userId, `client_${type}`, payload);

    sendJson(res, {});
  }));
}
