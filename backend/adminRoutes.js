import { dbAll } from './db.js';
import { AppError } from './appError.js';
import { asyncHandler, sendJson } from './httpUtils.js';
import { createRequireAdmin } from './adminAuth.js';
import { getStats, loadRecentEvents } from './analytics.js';
import { deactivateBroadcast, loadBroadcasts, pushBroadcast } from './broadcasts.js';
import { refundOrder, serializeOrder } from './orders.js';
import { loadAdminAudit, recordAdminAudit } from './adminAudit.js';
import { applyConfigOverrides, getConfigSnapshot } from './configOverrides.js';

function clampLimit(value, fallback, max) {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(n, max);
}

// Operator backend. Every route is protected by the admin token. Provides the
// data-ops dashboard (stats), content moderation (announcements), and order
// management (refunds) the requirements call for.
export function registerAdminRoutes(app, { adminToken, presence }) {
  const requireAdmin = createRequireAdmin(adminToken);
  app.use('/api/admin', requireAdmin);

  app.post('/api/admin/stats', asyncHandler(async (req, res) => {
    const stats = await getStats();
    sendJson(res, {
      stats: { ...stats, onlineNow: presence ? presence.displayCount() : 0 },
    });
  }));

  app.post('/api/admin/users', asyncHandler(async (req, res) => {
    const limit = clampLimit(req.body?.limit, 50, 200);
    const users = await dbAll(
      `SELECT id, level, affection, energy, mood, coins, checkin_streak, login_streak,
              strftime('%Y-%m-%d %H:%M', created_at, 'localtime') as createdAt
       FROM users ORDER BY created_at DESC LIMIT ?`,
      [limit]
    );
    sendJson(res, { users });
  }));

  app.post('/api/admin/orders', asyncHandler(async (req, res) => {
    const limit = clampLimit(req.body?.limit, 50, 200);
    const orders = await dbAll(
      `SELECT id, user_id as userId, out_trade_no as outTradeNo, tier_amount as amount, coins,
              payment_method as paymentMethod, status,
              strftime('%Y-%m-%d %H:%M', created_at, 'localtime') as createdAt
       FROM orders ORDER BY created_at DESC LIMIT ?`,
      [limit]
    );
    sendJson(res, { orders });
  }));

  app.post('/api/admin/events', asyncHandler(async (req, res) => {
    const limit = clampLimit(req.body?.limit, 80, 300);
    const events = await loadRecentEvents(limit);
    sendJson(res, { events });
  }));

  app.post('/api/admin/broadcasts', asyncHandler(async (req, res) => {
    const broadcasts = await loadBroadcasts(50);
    sendJson(res, { broadcasts });
  }));

  app.post('/api/admin/announcement', asyncHandler(async (req, res) => {
    const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
    if (!text) throw new AppError(400, 'INVALID_PARAMETER', 'announcement text is required');
    if (text.length > 200) throw new AppError(400, 'TEXT_TOO_LONG', 'announcement must be 200 chars or fewer');
    const priority = Number.isFinite(req.body?.priority) ? req.body.priority : 10;
    const id = await pushBroadcast('announcement', text, priority);
    await recordAdminAudit('announcement_publish', { targetType: 'broadcast', targetId: id, detail: { text, priority }, ip: req.ip });
    sendJson(res, { id });
  }));

  app.post('/api/admin/announcement/deactivate', asyncHandler(async (req, res) => {
    const id = typeof req.body?.id === 'string' ? req.body.id : '';
    if (!id) throw new AppError(400, 'INVALID_PARAMETER', 'broadcast id is required');
    const ok = await deactivateBroadcast(id);
    if (!ok) throw new AppError(404, 'BROADCAST_NOT_FOUND', 'Broadcast not found');
    await recordAdminAudit('announcement_deactivate', { targetType: 'broadcast', targetId: id, ip: req.ip });
    sendJson(res, {});
  }));

  app.post('/api/admin/order/refund', asyncHandler(async (req, res) => {
    const orderId = typeof req.body?.orderId === 'string' ? req.body.orderId : '';
    if (!orderId) throw new AppError(400, 'INVALID_PARAMETER', 'orderId is required');
    const result = await refundOrder(orderId);
    // Audit only an actual refund — a no-op (already-refunded race) didn't move
    // money, so recording it would falsely imply funds were returned.
    if (result.refunded) {
      await recordAdminAudit('order_refund', {
        targetType: 'order',
        targetId: orderId,
        detail: { coins: result.order?.coins },
        ip: req.ip,
      });
    }
    sendJson(res, { refunded: result.refunded, order: serializeOrder(result.order) });
  }));

  app.post('/api/admin/audit', asyncHandler(async (req, res) => {
    const limit = clampLimit(req.body?.limit, 80, 300);
    const audit = await loadAdminAudit(limit);
    sendJson(res, { audit });
  }));

  // Live gameplay configuration with operator overrides applied (shop items,
  // tipping tiers, task catalog). GET reads; POST writes overrides (or, with no
  // `overrides` body, just reads — kept for backward compatibility).
  app.get('/api/admin/config', asyncHandler(async (req, res) => {
    sendJson(res, { config: getConfigSnapshot() });
  }));

  app.post('/api/admin/config', asyncHandler(async (req, res) => {
    const overrides = req.body?.overrides;
    if (overrides === undefined) {
      sendJson(res, { config: getConfigSnapshot() });
      return;
    }
    const applied = await applyConfigOverrides(overrides);
    await recordAdminAudit('config_override', {
      targetType: 'config',
      detail: { applied },
      ip: req.ip || null,
    });
    sendJson(res, { config: getConfigSnapshot(), applied });
  }));
}
