import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

process.env.OPENAI_API_KEY = '';
process.env.ALLOWED_ORIGIN = 'http://localhost:5173';
process.env.RATE_LIMIT_MAX_REQUESTS = '10000';
process.env.LOG_LEVEL = 'error';
process.env.LOG_REQUESTS = 'false';
process.env.AUTH_SECRET = 'test-auth-secret';

const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'xiaoxiai-story-test-'));
process.env.XIAOXIAI_DB_PATH = path.join(tempDir, 'test.sqlite');

const [{ app }, dbModule] = await Promise.all([
  import('../server.js'),
  import('../core/db.js'),
]);
await dbModule.dbReady;
const { deleteUserAccount } = await import('../services/userExportDelete.js');

let server;
let baseUrl;

async function req(method, route, payload) {
  const response = await fetch(`${baseUrl}${route}`, {
    method,
    headers: { 'Content-Type': 'application/json', Origin: process.env.ALLOWED_ORIGIN },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });
  return { status: response.status, body: await response.json() };
}

async function seedUser(userId, { level = 1, coins = 200, affection = 10 } = {}) {
  await req('POST', '/api/user/sync', { userId });
  await dbModule.dbRun('UPDATE users SET level = ?, coins = ?, affection = ? WHERE id = ?', [level, coins, affection, userId]);
}

test.before(async () => {
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  if (server) await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  await dbModule.closeDb();
  await fs.rm(tempDir, { recursive: true, force: true });
});

test('a fresh user has the catalog, no read episodes, and their level', async () => {
  await seedUser('story_user_1', { level: 1, coins: 200 });
  const res = await req('POST', '/api/stories', { userId: 'story_user_1' });
  assert.equal(res.status, 200);
  assert.ok(Array.isArray(res.body.catalog) && res.body.catalog.length >= 2);
  assert.ok(res.body.catalog[0].scenes.length > 0, 'episodes carry their scenes');
  assert.deepEqual(res.body.read, []);
  assert.equal(res.body.level, 1);
});

test('reading an unlocked episode to the end grants its one-time reward', async () => {
  const res = await req('POST', '/api/stories/claim', { userId: 'story_user_1', storyId: 'rainy_meet' });
  assert.equal(res.status, 200);
  assert.equal(res.body.rewarded, true);
  assert.equal(res.body.reward.coins, 100);
  assert.equal(res.body.user.coins, 300, '200 + 100 (rainy_meet reward)');
  assert.ok(res.body.read.includes('rainy_meet'));
});

test('re-reading a finished episode grants nothing and does not change coins', async () => {
  const res = await req('POST', '/api/stories/claim', { userId: 'story_user_1', storyId: 'rainy_meet' });
  assert.equal(res.status, 200);
  assert.equal(res.body.rewarded, false);
  assert.equal(res.body.user.coins, 300, 'no second reward');
  assert.ok(res.body.read.includes('rainy_meet'));
});

test('a choice grants its affection on first completion (validated server-side)', async () => {
  // story_user_3 at Lv.3, affection 10. starry_confession's choice is scene index 5;
  // option 0 is worth +4 affection.
  await seedUser('story_user_3', { level: 3, coins: 0, affection: 10 });
  const res = await req('POST', '/api/stories/claim', {
    userId: 'story_user_3',
    storyId: 'starry_confession',
    choices: [{ scene: 5, option: 0 }],
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.rewarded, true);
  assert.equal(res.body.reward.affection, 4, 'option 0 affection');
  assert.equal(res.body.user.affection, 14, '10 + 4 from the choice');
  assert.equal(res.body.user.coins, 200, '0 + 200 (starry reward)');
});

test('bogus / out-of-range choice indices are ignored, not trusted', async () => {
  await seedUser('story_user_4', { level: 3, coins: 0, affection: 10 });
  const res = await req('POST', '/api/stories/claim', {
    userId: 'story_user_4',
    storyId: 'starry_confession',
    // a non-choice scene, an out-of-range option, and a junk scene — all ignored.
    choices: [{ scene: 0, option: 0 }, { scene: 5, option: 99 }, { scene: 999, option: 0 }],
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.reward.affection, 0, 'no affection from invalid picks');
  assert.equal(res.body.user.affection, 10, 'affection unchanged');
});

test('an episode above the user level is locked', async () => {
  const res = await req('POST', '/api/stories/claim', { userId: 'story_user_1', storyId: 'future_promise' });
  assert.equal(res.status, 403);
  assert.equal(res.body.error.code, 'STORY_LOCKED');
});

test('a higher-level user can read a higher-tier episode and earn its reward', async () => {
  await seedUser('story_user_2', { level: 5, coins: 0 });
  const res = await req('POST', '/api/stories/claim', { userId: 'story_user_2', storyId: 'little_quarrel' });
  assert.equal(res.status, 200);
  assert.equal(res.body.rewarded, true);
  assert.equal(res.body.user.coins, 300, '0 + 300 (little_quarrel reward)');
});

test('an unknown story id is rejected', async () => {
  const res = await req('POST', '/api/stories/claim', { userId: 'story_user_1', storyId: 'does_not_exist' });
  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, 'INVALID_STORY');
});

test('sync exposes the user story state', async () => {
  const sync = await req('POST', '/api/user/sync', { userId: 'story_user_1' });
  assert.equal(sync.status, 200);
  assert.ok(sync.body.stories, 'sync includes stories');
  assert.ok(sync.body.stories.read.includes('rainy_meet'));
  assert.equal(typeof sync.body.stories.level, 'number');
});

test('deleting a user account also removes their story progress (no orphans)', async () => {
  const before = await dbModule.dbAll('SELECT * FROM user_story_progress WHERE user_id = ?', ['story_user_1']);
  assert.ok(before.length >= 1, 'the user has finished at least one episode');

  const removed = await deleteUserAccount('story_user_1');
  assert.ok('user_story_progress' in removed, 'user_story_progress is part of the deletion cascade');

  const after = await dbModule.dbAll('SELECT * FROM user_story_progress WHERE user_id = ?', ['story_user_1']);
  assert.equal(after.length, 0, 'story progress is removed together with the account');
});
