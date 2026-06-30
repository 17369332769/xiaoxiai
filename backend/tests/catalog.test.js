import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

process.env.LOG_LEVEL = 'error';
process.env.LOG_REQUESTS = 'false';

const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'xiaoxiai-catalog-'));
process.env.XIAOXIAI_DB_PATH = path.join(tempDir, 'test.sqlite');

const [catalog, config, dbModule] = await Promise.all([
  import('../services/catalog.js'),
  import('../services/configOverrides.js'),
  import('../core/db.js'),
]);

await dbModule.dbReady;

test.after(async () => {
  await dbModule.closeDb();
  await fs.rm(tempDir, { recursive: true, force: true });
});

test('before seeding, getters fall back to the static defaults (back-compat)', () => {
  // No seed/load yet → in-memory lists are the static seeds, so existing code
  // paths (feed/gift/tasks) behave exactly as the old static config did.
  assert.ok(catalog.getFoodList().some((f) => f.id === 'coffee'));
  assert.ok(config.getEffectiveFood().coffee, 'configOverrides reads the catalog');
  assert.equal(config.getEffectiveFood().coffee.cost, 30);
});

test('seed + load makes the catalog DB-backed and editable', async () => {
  await catalog.seedCatalog();
  await catalog.loadCatalog();
  assert.ok(catalog.getFoodList().some((f) => f.id === 'coffee'));
  assert.ok(catalog.getTaskList().some((t) => t.id === 'checkin'));
  assert.equal(catalog.getDailyTasks().length, 4);
  assert.equal(catalog.getGrowthTasks().length, 3);
});

test('upsert adds a brand-new food item that flows through getEffectiveFood', async () => {
  await catalog.upsertCatalogItem('food', {
    id: 'pudding', name: '布丁', cost: 45, energy: 20, affection: 8, icon: '🍮', desc: '滑滑的布丁', sortOrder: 5,
  });
  const food = config.getEffectiveFood();
  assert.ok(food.pudding, 'new item is in the effective catalog');
  assert.equal(food.pudding.cost, 45);
  // And it is now a valid override target (proves configOverrides sees it).
  assert.doesNotThrow(() => config.getConfigSnapshot());
});

test('edit (upsert existing) changes fields; delete removes the item', async () => {
  await catalog.upsertCatalogItem('food', {
    id: 'coffee', name: '香浓拿铁', cost: 35, energy: 15, affection: 5, icon: '☕', desc: '改价后的拿铁',
  });
  assert.equal(config.getEffectiveFood().coffee.cost, 35);

  const removed = await catalog.deleteCatalogItem('food', 'pudding');
  assert.equal(removed, true);
  assert.equal(config.getEffectiveFood().pudding, undefined, 'deleted item is gone');

  const removedMissing = await catalog.deleteCatalogItem('food', 'nope');
  assert.equal(removedMissing, false);
});

test('a new task flows into getEffectiveTasks (and seeds onto users)', async () => {
  await catalog.upsertCatalogItem('task', {
    id: 'chat_10', name: '畅聊 10 次', target: 10, reward: 80, category: 'growth', sortOrder: 9,
  });
  const tasks = config.getEffectiveTasks();
  assert.ok(tasks.some((t) => t.id === 'chat_10' && t.reward === 80));
});

test('upsert rejects invalid items', async () => {
  await assert.rejects(
    () => catalog.upsertCatalogItem('food', { id: 'bad id!', name: 'x', cost: 1, energy: 0, affection: 0, icon: '🍪', desc: 'd' }),
    (err) => err.code === 'INVALID_CATALOG_ITEM'
  );
  await assert.rejects(
    () => catalog.upsertCatalogItem('food', { id: 'ok', name: 'x', cost: 0, energy: 0, affection: 0, icon: '🍪', desc: 'd' }),
    (err) => err.code === 'INVALID_CATALOG_ITEM'
  );
  await assert.rejects(
    () => catalog.upsertCatalogItem('mystery', { id: 'ok' }),
    (err) => err.code === 'INVALID_PARAMETER'
  );
});
