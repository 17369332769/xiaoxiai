import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { dbRun } from './db.js';
import { createLogger } from './logger.js';
import { resolveNonNegativeIntEnv } from './envUtils.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const logger = createLogger('backup');

export const DEFAULT_BACKUP_KEEP = 5;
export const DEFAULT_BACKUP_INTERVAL_MS = 24 * 60 * 60 * 1000; // daily

// Only files we produced are eligible for pruning. The live db ("database.sqlite")
// and its WAL/SHM siblings never start with "database-", so they can never match.
const BACKUP_FILE_RE = /^database-.+\.sqlite$/;

function defaultBackupDir() {
  return process.env.DB_BACKUP_DIR || path.join(__dirname, 'backups');
}

function backupFileName() {
  // database-YYYY-MM-DD-HHMMSS-<rand>.sqlite — sorts roughly by time and the
  // random suffix keeps same-second backups from colliding (VACUUM INTO refuses
  // to overwrite an existing file).
  const d = new Date();
  const p = (n, w = 2) => String(n).padStart(w, '0');
  const stamp = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  const rand = Math.random().toString(36).slice(2, 6);
  return `database-${stamp}-${rand}.sqlite`;
}

// Keep only the newest `keep` backups (by mtime); delete the rest. Best-effort.
async function pruneOldBackups(dir, keep) {
  let entries;
  try {
    entries = await fs.readdir(dir);
  } catch {
    return;
  }
  const files = entries.filter((name) => BACKUP_FILE_RE.test(name));
  if (files.length <= keep) return;
  const stated = await Promise.all(
    files.map(async (name) => {
      const full = path.join(dir, name);
      try {
        const st = await fs.stat(full);
        return { full, mtime: st.mtimeMs };
      } catch {
        return { full, mtime: 0 };
      }
    })
  );
  stated.sort((a, b) => b.mtime - a.mtime); // newest first
  for (const { full } of stated.slice(keep)) {
    try {
      await fs.unlink(full);
      logger.info('Pruned old backup', { file: full });
    } catch (error) {
      logger.warn('Failed to prune old backup', { file: full, error: error.message });
    }
  }
}

// Take one atomic, WAL-safe snapshot via "VACUUM INTO" and enforce retention.
// Best-effort: returns the backup path on success, or null on any failure (a
// backup problem must never crash the app or fail a request).
export async function runBackup(dir = defaultBackupDir(), keep = DEFAULT_BACKUP_KEEP) {
  try {
    await fs.mkdir(dir, { recursive: true });
    const target = path.join(dir, backupFileName());
    // The path is server-controlled (no user input); still escape single quotes
    // defensively since VACUUM INTO takes a string literal.
    const escaped = target.replace(/'/g, "''");
    await dbRun(`VACUUM INTO '${escaped}'`);
    await pruneOldBackups(dir, keep);
    logger.info('Database backup written', { target });
    return target;
  } catch (error) {
    logger.warn('Database backup failed (skipped this cycle)', { error: error.message });
    return null;
  }
}

let scheduleHandle = null;

// Start interval-based backups. No-op (logs why) when disabled via
// DB_BACKUP_INTERVAL_MS=0 or DB_BACKUP_KEEP=0. Non-blocking: the first backup
// runs one interval later, not at boot.
export function startBackupSchedule({
  intervalMs = resolveNonNegativeIntEnv(process.env.DB_BACKUP_INTERVAL_MS, DEFAULT_BACKUP_INTERVAL_MS),
  dir = defaultBackupDir(),
  // Non-negative so DB_BACKUP_KEEP=0 is an explicit "disable" (matches intervalMs).
  keep = resolveNonNegativeIntEnv(process.env.DB_BACKUP_KEEP, DEFAULT_BACKUP_KEEP),
} = {}) {
  if (scheduleHandle) {
    logger.warn('Backup schedule already started; ignoring duplicate start');
    return scheduleHandle;
  }
  if (intervalMs <= 0 || keep <= 0) {
    logger.info('Automatic database backup disabled', { intervalMs, keep });
    return null;
  }
  logger.info('Backup scheduler started', { intervalMs, dir, keep });
  scheduleHandle = setInterval(() => {
    runBackup(dir, keep).catch((error) => logger.warn('Scheduled backup error', { error: error.message }));
  }, intervalMs);
  // Don't let the timer keep the process (or a test runner) alive.
  if (typeof scheduleHandle.unref === 'function') scheduleHandle.unref();
  return scheduleHandle;
}

// Stop the schedule (used by tests and graceful shutdown).
export function stopBackupSchedule() {
  if (scheduleHandle) {
    clearInterval(scheduleHandle);
    scheduleHandle = null;
  }
}
