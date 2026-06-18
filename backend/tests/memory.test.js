import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

process.env.OPENAI_API_KEY = '';
process.env.LOG_LEVEL = 'error';
process.env.LOG_REQUESTS = 'false';

const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'xiaoxiai-memory-test-'));
process.env.XIAOXIAI_DB_PATH = path.join(tempDir, 'test.sqlite');

const [dbModule, memoryStore] = await Promise.all([
  import('../db.js'),
  import('../memoryStore.js'),
]);

await dbModule.dbReady;
const { dbRun, dbGet } = dbModule;
const {
  upsertMemory,
  listMemories,
  clearMemories,
  enforceMemoryCap,
  pruneStaleMemories,
  sanitizeMemoryEntry,
  isValidMemoryEntry,
  MEMORY_VALUE_MAX_LENGTH,
  MEMORY_KEY_MAX_LENGTH,
} = memoryStore;

// Each test owns a fresh user row so foreign keys + counts stay isolated.
async function makeUser(userId) {
  await dbRun(
    'INSERT OR IGNORE INTO users (id, summary) VALUES (?, ?)',
    [userId, 'old summary']
  );
}

test.after(async () => {
  await dbModule.closeDb();
  await fs.rm(tempDir, { recursive: true, force: true });
});

// ---------- memory quality validation ----------

test('sanitizeMemoryEntry trims, rejects empties, and truncates long values', () => {
  assert.deepEqual(sanitizeMemoryEntry('  job  ', '  工程师  '), { key: 'job', value: '工程师' });

  // Empty / whitespace-only / wrong-typed entries are rejected.
  assert.equal(sanitizeMemoryEntry('   ', '工程师'), null);
  assert.equal(sanitizeMemoryEntry('job', '   '), null);
  assert.equal(sanitizeMemoryEntry('', ''), null);
  assert.equal(sanitizeMemoryEntry(null, '工程师'), null);
  assert.equal(sanitizeMemoryEntry('job', 12345), null);

  // Over-long key is rejected outright (truncating a key would lose meaning).
  const longKey = 'k'.repeat(MEMORY_KEY_MAX_LENGTH + 1);
  assert.equal(sanitizeMemoryEntry(longKey, 'value'), null);
  assert.ok(isValidMemoryEntry('k'.repeat(MEMORY_KEY_MAX_LENGTH), 'value'));

  // Over-long value is truncated to the max length, not rejected.
  const longValue = 'v'.repeat(MEMORY_VALUE_MAX_LENGTH + 50);
  const sanitized = sanitizeMemoryEntry('note', longValue);
  assert.equal(sanitized.value.length, MEMORY_VALUE_MAX_LENGTH);
  assert.equal(sanitized.key, 'note');
});

test('upsertMemory skips invalid entries and truncates over-long values in the DB', async () => {
  const userId = 'mem_validate_user';
  await makeUser(userId);

  assert.equal(await upsertMemory(userId, '  ', 'ignored'), false);
  assert.equal(await upsertMemory(userId, 'job', '   '), false);
  assert.equal(await upsertMemory(userId, 'job', '工程师'), true);

  const longValue = 'x'.repeat(MEMORY_VALUE_MAX_LENGTH + 100);
  assert.equal(await upsertMemory(userId, 'note', longValue), true);

  const stored = await dbGet(
    'SELECT memory_value FROM user_memories WHERE user_id = ? AND memory_key = ?',
    [userId, 'note']
  );
  assert.equal(stored.memory_value.length, MEMORY_VALUE_MAX_LENGTH);

  const list = await listMemories(userId);
  assert.equal(list.length, 2); // only the two valid keys landed
});

// ---------- clearMemories ----------

test('clearMemories wipes facts and the rolling relationship summary', async () => {
  const userId = 'mem_clear_user';
  await makeUser(userId);
  await dbRun('UPDATE users SET summary = ? WHERE id = ?', ['她记住了你的偏好', userId]);
  await upsertMemory(userId, 'favorite_drink', '奶茶');
  await upsertMemory(userId, 'hobby', '跑步');

  assert.equal((await listMemories(userId)).length, 2);

  const cleared = await clearMemories(userId);
  assert.equal(cleared, 2);
  assert.equal((await listMemories(userId)).length, 0);

  // The summary is consolidated personal memory and must be wiped too.
  const user = await dbGet('SELECT summary FROM users WHERE id = ?', [userId]);
  assert.equal(user.summary, '');
});

// ---------- enforceMemoryCap with a custom cap ----------

test('enforceMemoryCap with a custom cap keeps the highest-weight facts', async () => {
  const userId = 'mem_cap_user';
  await makeUser(userId);

  // Seed five facts with distinct weights so eviction order is deterministic.
  for (let i = 1; i <= 5; i += 1) {
    await dbRun(
      'INSERT INTO user_memories (user_id, memory_key, memory_value, weight) VALUES (?, ?, ?, ?)',
      [userId, `key_${i}`, `value_${i}`, i]
    );
  }

  const pruned = await enforceMemoryCap(userId, 2);
  assert.equal(pruned, 3);

  const remaining = await listMemories(userId);
  assert.equal(remaining.length, 2);
  // Highest weights (5 and 4) survive.
  assert.deepEqual(remaining.map((m) => m.key).sort(), ['key_4', 'key_5']);

  // A cap that is not exceeded is a no-op.
  assert.equal(await enforceMemoryCap(userId, 10), 0);
});

// ---------- TTL expiry of stale low-value memories ----------

test('pruneStaleMemories expires stale low-weight facts but keeps reinforced ones', async () => {
  const userId = 'mem_ttl_user';
  await makeUser(userId);

  // Stale + never reinforced (weight 1, updated 40 days ago) -> should be pruned.
  await dbRun(
    `INSERT INTO user_memories (user_id, memory_key, memory_value, weight, updated_at)
     VALUES (?, ?, ?, 1, datetime('now', '-40 days'))`,
    [userId, 'stale_low', '随口一提']
  );
  // Stale BUT reinforced (weight 5, updated 40 days ago) -> important, must stay.
  await dbRun(
    `INSERT INTO user_memories (user_id, memory_key, memory_value, weight, updated_at)
     VALUES (?, ?, ?, 5, datetime('now', '-40 days'))`,
    [userId, 'stale_high', '生日是十月']
  );
  // Recent + low weight -> within TTL window, must stay.
  await dbRun(
    `INSERT INTO user_memories (user_id, memory_key, memory_value, weight, updated_at)
     VALUES (?, ?, ?, 1, datetime('now', '-1 days'))`,
    [userId, 'fresh_low', '今天有点累']
  );

  const pruned = await pruneStaleMemories(userId, 30);
  assert.equal(pruned, 1);

  const remaining = (await listMemories(userId)).map((m) => m.key).sort();
  assert.deepEqual(remaining, ['fresh_low', 'stale_high']);

  // ttlDays <= 0 disables expiry entirely (no-op even with stale rows present).
  await dbRun(
    `INSERT INTO user_memories (user_id, memory_key, memory_value, weight, updated_at)
     VALUES (?, ?, ?, 1, datetime('now', '-99 days'))`,
    [userId, 'another_stale', '很久以前的事']
  );
  assert.equal(await pruneStaleMemories(userId, 0), 0);
  assert.equal((await listMemories(userId)).length, 3);
});
