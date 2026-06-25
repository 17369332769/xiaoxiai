import { dbAll, dbRun } from '../core/db.js';
import { createLogger } from '../core/logger.js';

const logger = createLogger('admin-audit');

function newId() {
  return `audit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// Append-only operator action trail (refunds, announcements, …). Best-effort:
// an audit write must never break the admin action it records, so failures are
// only logged.
export async function recordAdminAudit(action, { targetType = null, targetId = null, detail = null, ip = null } = {}) {
  try {
    await dbRun(
      'INSERT INTO admin_audit (id, action, target_type, target_id, detail, ip) VALUES (?, ?, ?, ?, ?, ?)',
      [newId(), action, targetType, targetId, detail ? JSON.stringify(detail) : null, ip || null]
    );
    return true;
  } catch (error) {
    logger.warn('Failed to record admin audit entry', { action, error: error.message });
    return false;
  }
}

export async function loadAdminAudit(limit = 100) {
  return dbAll(
    `SELECT id, action, target_type as targetType, target_id as targetId, detail, ip,
            strftime('%Y-%m-%d %H:%M', created_at, 'localtime') as createdAt
     FROM admin_audit ORDER BY created_at DESC, rowid DESC LIMIT ?`,
    [limit]
  );
}
