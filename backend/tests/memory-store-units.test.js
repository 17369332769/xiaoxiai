import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

process.env.LOG_LEVEL = 'error';
process.env.LOG_REQUESTS = 'false';

const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'xiaoxiai-memstore-'));
process.env.XIAOXIAI_DB_PATH = path.join(tempDir, 'test.sqlite');

const [memoryStore, dbModule] = await Promise.all([
  import('../memoryStore.js'),
  import('../db.js'),
]);

await dbModule.dbReady;
const { dbRun, dbAll } = dbModule;

test.after(async () => {
  await dbModule.closeDb();
  await fs.rm(tempDir, { recursive: true, force: true });
});

// pruneStaleMemories only runs when MEMORY_TTL_DAYS > 0 (off by default), so it
// is otherwise unexercised by the suite — cover it directly.
test('pruneStaleMemories removes stale low-weight memories past the TTL, keeps high-weight and recent', async () => {
  const uid = 'mem_u1';
  await dbRun("INSERT INTO user_memories (user_id, memory_key, memory_value, weight, updated_at) VALUES (?, 'old_low', 'x', 1, datetime('now', '-100 days'))", [uid]);
  await dbRun("INSERT INTO user_memories (user_id, memory_key, memory_value, weight, updated_at) VALUES (?, 'old_high', 'x', 5, datetime('now', '-100 days'))", [uid]);
  await dbRun("INSERT INTO user_memories (user_id, memory_key, memory_value, weight, updated_at) VALUES (?, 'recent_low', 'x', 1, CURRENT_TIMESTAMP)", [uid]);

  const removed = await memoryStore.pruneStaleMemories(uid, 30);
  assert.equal(removed, 1);

  const keys = (await dbAll('SELECT memory_key FROM user_memories WHERE user_id = ?', [uid])).map((r) => r.memory_key);
  assert.ok(!keys.includes('old_low'), 'stale low-weight pruned');
  assert.ok(keys.includes('old_high'), 'high-weight survives on age alone');
  assert.ok(keys.includes('recent_low'), 'recent low-weight survives');
});

test('pruneStaleMemories is a no-op when the TTL is disabled (<= 0)', async () => {
  const uid = 'mem_u2';
  await dbRun("INSERT INTO user_memories (user_id, memory_key, memory_value, weight, updated_at) VALUES (?, 'old_low', 'x', 1, datetime('now', '-100 days'))", [uid]);

  assert.equal(await memoryStore.pruneStaleMemories(uid, 0), 0);
  assert.equal(await memoryStore.pruneStaleMemories(uid, -1), 0);

  const rows = await dbAll('SELECT 1 FROM user_memories WHERE user_id = ?', [uid]);
  assert.equal(rows.length, 1);
});

test('enforceMemoryCap evicts the lowest-priority memories beyond the cap', async () => {
  const uid = 'mem_u3';
  for (let weight = 1; weight <= 5; weight += 1) {
    await dbRun('INSERT INTO user_memories (user_id, memory_key, memory_value, weight) VALUES (?, ?, ?, ?)', [uid, `k${weight}`, 'v', weight]);
  }

  const removed = await memoryStore.enforceMemoryCap(uid, 3);
  assert.equal(removed, 2); // keep the 3 highest-weight, evict the 2 lowest

  const keys = (await dbAll('SELECT memory_key FROM user_memories WHERE user_id = ?', [uid])).map((r) => r.memory_key).sort();
  assert.deepEqual(keys, ['k3', 'k4', 'k5']);
});
