import { dbAll, dbRun } from '../core/db.js';
import { createLogger } from '../core/logger.js';

const logger = createLogger('error-log');

function newErrorId() {
  return `err-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// Persist a server-side (5xx) failure for operator review. Best-effort: a logging
// failure must never mask or replace the original error, so every write is wrapped
// and only warns. Long fields are truncated to keep the table compact.
export async function recordError({ code = 'INTERNAL_ERROR', status = 500, message = '', path = '', method = '', stack = '' } = {}) {
  try {
    await dbRun(
      `INSERT INTO error_logs (id, code, status, message, path, method, stack)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        newErrorId(),
        String(code).slice(0, 80),
        Number.isFinite(status) ? status : 500,
        String(message || '').slice(0, 500),
        String(path || '').slice(0, 200),
        String(method || '').slice(0, 10),
        String(stack || '').slice(0, 2000),
      ]
    );
    return true;
  } catch (error) {
    logger.warn('Failed to record error log', { error: error.message });
    return false;
  }
}

export async function loadErrorLogs(limit = 80) {
  try {
    return await dbAll(
      `SELECT id, code, status, message, path, method,
              strftime('%m-%d %H:%M', created_at, 'localtime') as timestamp
       FROM error_logs
       ORDER BY created_at DESC, rowid DESC LIMIT ?`,
      [limit]
    );
  } catch (error) {
    logger.warn('Failed to load error logs', { error: error.message });
    return [];
  }
}
