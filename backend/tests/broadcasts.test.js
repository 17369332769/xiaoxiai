import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

process.env.LOG_LEVEL = 'error';
process.env.LOG_REQUESTS = 'false';

const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'xiaoxiai-broadcasts-'));
process.env.XIAOXIAI_DB_PATH = path.join(tempDir, 'test.sqlite');

const [broadcasts, dbModule] = await Promise.all([
  import('../broadcasts.js'),
  import('../db.js'),
]);

await dbModule.dbReady;

test.after(async () => {
  await dbModule.closeDb();
  await fs.rm(tempDir, { recursive: true, force: true });
});

// Runs first against the fresh (empty) temp DB.
test('ensureSeedBroadcast seeds exactly one welcome line on an empty table, then no-ops', async () => {
  await broadcasts.ensureSeedBroadcast();
  const seeded = await broadcasts.loadBroadcasts(300);
  assert.equal(seeded.length, 1);
  assert.match(seeded[0].text, /欢迎来到/);

  await broadcasts.ensureSeedBroadcast(); // table no longer empty → no duplicate seed
  assert.equal((await broadcasts.loadBroadcasts(300)).length, 1);
});

test('loadBroadcasts orders by priority (then recency) and excludes deactivated rows', async () => {
  await broadcasts.pushBroadcast('system', 'low priority', 1);
  const highId = await broadcasts.pushBroadcast('announcement', 'high priority', 10);

  const list = await broadcasts.loadBroadcasts(50);
  const texts = list.map((b) => b.text);
  assert.ok(texts.indexOf('high priority') < texts.indexOf('low priority'), 'higher priority first');

  // Deactivating the high-priority row removes it from the active feed.
  assert.equal(await broadcasts.deactivateBroadcast(highId), true);
  const after = (await broadcasts.loadBroadcasts(50)).map((b) => b.text);
  assert.ok(!after.includes('high priority'), 'deactivated row excluded');
  assert.ok(after.includes('low priority'), 'active row retained');
});

test('deactivateBroadcast returns false for a missing id', async () => {
  assert.equal(await broadcasts.deactivateBroadcast('does-not-exist'), false);
});

test('pushBroadcast ignores empty text', async () => {
  assert.equal(await broadcasts.pushBroadcast('system', ''), null);
});
