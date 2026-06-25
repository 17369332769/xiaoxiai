import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

process.env.LOG_LEVEL = 'error';
process.env.LOG_REQUESTS = 'false';

const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'xiaoxiai-backup-test-'));
process.env.XIAOXIAI_DB_PATH = path.join(tempDir, 'database.sqlite');

const dbModule = await import('../core/db.js');
await dbModule.dbReady;
const backup = await import('../services/backup.js');

const BACKUP_DIR = path.join(tempDir, 'backups');

test.after(async () => {
  backup.stopBackupSchedule();
  await dbModule.closeDb();
  await fs.rm(tempDir, { recursive: true, force: true });
});

test('runBackup writes a timestamped VACUUM INTO snapshot', async () => {
  await dbModule.dbRun("INSERT INTO users (id) VALUES ('backup_user')");
  const out = await backup.runBackup(BACKUP_DIR, 5);
  assert.ok(out, 'returns the backup path');
  assert.match(path.basename(out), /^database-.+\.sqlite$/);
  const stat = await fs.stat(out);
  assert.ok(stat.size > 0, 'the snapshot file is non-empty');
});

test('runBackup retains only the newest N backups', async () => {
  // Three more snapshots with keep=2 → at most 2 backup files remain.
  await backup.runBackup(BACKUP_DIR, 2);
  await backup.runBackup(BACKUP_DIR, 2);
  await backup.runBackup(BACKUP_DIR, 2);
  const remaining = (await fs.readdir(BACKUP_DIR)).filter((f) => /^database-.+\.sqlite$/.test(f));
  assert.equal(remaining.length, 2, 'retention prunes down to keep=2');
});

test('startBackupSchedule is a no-op when disabled (interval 0 or keep 0)', () => {
  assert.equal(backup.startBackupSchedule({ intervalMs: 0, dir: BACKUP_DIR, keep: 5 }), null);
  assert.equal(backup.startBackupSchedule({ intervalMs: 1000, dir: BACKUP_DIR, keep: 0 }), null);
});

test('the disable sentinel works through env vars (DB_BACKUP_KEEP=0 / DB_BACKUP_INTERVAL_MS=0)', () => {
  const prevKeep = process.env.DB_BACKUP_KEEP;
  const prevInterval = process.env.DB_BACKUP_INTERVAL_MS;
  try {
    process.env.DB_BACKUP_KEEP = '0';
    delete process.env.DB_BACKUP_INTERVAL_MS;
    assert.equal(backup.startBackupSchedule({ dir: BACKUP_DIR }), null, 'DB_BACKUP_KEEP=0 disables');
    backup.stopBackupSchedule();

    process.env.DB_BACKUP_KEEP = '5';
    process.env.DB_BACKUP_INTERVAL_MS = '0';
    assert.equal(backup.startBackupSchedule({ dir: BACKUP_DIR }), null, 'DB_BACKUP_INTERVAL_MS=0 disables');
    backup.stopBackupSchedule();
  } finally {
    if (prevKeep === undefined) delete process.env.DB_BACKUP_KEEP; else process.env.DB_BACKUP_KEEP = prevKeep;
    if (prevInterval === undefined) delete process.env.DB_BACKUP_INTERVAL_MS; else process.env.DB_BACKUP_INTERVAL_MS = prevInterval;
  }
});

test('startBackupSchedule arms a timer and stopBackupSchedule clears it', () => {
  const handle = backup.startBackupSchedule({ intervalMs: 60000, dir: BACKUP_DIR, keep: 3 });
  assert.ok(handle, 'a timer handle is returned when enabled');
  // Second start is ignored while one is active.
  assert.equal(backup.startBackupSchedule({ intervalMs: 60000, dir: BACKUP_DIR, keep: 3 }), handle);
  backup.stopBackupSchedule();
  // After stopping, a fresh schedule can be armed again.
  const again = backup.startBackupSchedule({ intervalMs: 60000, dir: BACKUP_DIR, keep: 3 });
  assert.ok(again);
  backup.stopBackupSchedule();
});
