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

const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'xiaoxiai-theme-test-'));
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

async function seedUser(userId, coins) {
  await req('POST', '/api/user/sync', { userId });
  await dbModule.dbRun('UPDATE users SET coins = ? WHERE id = ?', [coins, userId]);
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

test('a fresh user owns only the free default theme', async () => {
  await seedUser('theme_user_1', 2000);
  const res = await req('POST', '/api/themes', { userId: 'theme_user_1' });
  assert.equal(res.status, 200);
  assert.ok(Array.isArray(res.body.catalog) && res.body.catalog.length >= 2);
  assert.deepEqual(res.body.owned, ['default']);
  assert.equal(res.body.equipped, 'default');
});

test('unlocking a theme debits coins, owns it, and equips it', async () => {
  const res = await req('POST', '/api/themes/unlock', { userId: 'theme_user_1', themeId: 'starry' });
  assert.equal(res.status, 200);
  assert.ok(res.body.owned.includes('starry'));
  assert.equal(res.body.equipped, 'starry');
  assert.equal(res.body.coins, 1400, '2000 - 600 (starry cost)');
});

test('a theme cannot be unlocked twice', async () => {
  const res = await req('POST', '/api/themes/unlock', { userId: 'theme_user_1', themeId: 'starry' });
  assert.equal(res.status, 409);
  assert.equal(res.body.error.code, 'THEME_OWNED');
});

test('the free default theme cannot be "unlocked"', async () => {
  const res = await req('POST', '/api/themes/unlock', { userId: 'theme_user_1', themeId: 'default' });
  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, 'THEME_FREE');
});

test('equipping requires ownership; owned themes equip fine', async () => {
  const notOwned = await req('POST', '/api/themes/equip', { userId: 'theme_user_1', themeId: 'ocean' });
  assert.equal(notOwned.status, 403);
  assert.equal(notOwned.body.error.code, 'THEME_NOT_OWNED');

  const backToDefault = await req('POST', '/api/themes/equip', { userId: 'theme_user_1', themeId: 'default' });
  assert.equal(backToDefault.status, 200);
  assert.equal(backToDefault.body.equipped, 'default');
});

test('unlocking is rejected when coins are insufficient', async () => {
  await seedUser('theme_poor', 100);
  const res = await req('POST', '/api/themes/unlock', { userId: 'theme_poor', themeId: 'ocean' });
  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, 'INSUFFICIENT_COINS');
});

test('sync exposes the user theme state', async () => {
  const sync = await req('POST', '/api/user/sync', { userId: 'theme_user_1' });
  assert.equal(sync.status, 200);
  assert.ok(sync.body.themes, 'sync includes themes');
  assert.ok(sync.body.themes.owned.includes('starry'));
  assert.equal(sync.body.themes.equipped, 'default');
});

test('deleting a user account also removes their owned themes (no orphans)', async () => {
  const before = await dbModule.dbAll('SELECT * FROM user_themes WHERE user_id = ?', ['theme_user_1']);
  assert.ok(before.length >= 1, 'the user owns at least one purchased theme');

  const removed = await deleteUserAccount('theme_user_1');
  assert.ok('user_themes' in removed, 'user_themes is part of the deletion cascade');

  const after = await dbModule.dbAll('SELECT * FROM user_themes WHERE user_id = ?', ['theme_user_1']);
  assert.equal(after.length, 0, 'owned themes are removed together with the account');
});
