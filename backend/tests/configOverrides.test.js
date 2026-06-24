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
process.env.ADMIN_TOKEN = 'test-admin-token';

const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'xiaoxiai-cfg-test-'));
process.env.XIAOXIAI_DB_PATH = path.join(tempDir, 'test.sqlite');

const [{ app }, dbModule, configOverrides] = await Promise.all([
  import('../server.js'),
  import('../db.js'),
  import('../configOverrides.js'),
]);
await dbModule.dbReady;

let server;
let baseUrl;
const ADMIN = { 'x-admin-token': 'test-admin-token' };

async function req(method, route, payload, headers = {}) {
  const response = await fetch(`${baseUrl}${route}`, {
    method,
    headers: { 'Content-Type': 'application/json', Origin: process.env.ALLOWED_ORIGIN, ...headers },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });
  return { status: response.status, body: await response.json() };
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

test('GET /api/admin/config returns the live snapshot', async () => {
  const res = await req('GET', '/api/admin/config', undefined, ADMIN);
  assert.equal(res.status, 200);
  const coffee = res.body.config.food.find((f) => f.id === 'coffee');
  assert.ok(coffee, 'base config is present');
  assert.equal(coffee.cost, 30);
});

test('POST /api/admin/config writes an override that takes effect at runtime', async () => {
  const res = await req('POST', '/api/admin/config', { overrides: { 'food:coffee:cost': 999 } }, ADMIN);
  assert.equal(res.status, 200);
  assert.equal(res.body.applied['food:coffee:cost'].to, 999);
  const coffee = res.body.config.food.find((f) => f.id === 'coffee');
  assert.equal(coffee.cost, 999, 'the snapshot reflects the override');
  // The purchase path reads the same effective getter.
  assert.equal(configOverrides.getEffectiveFood().coffee.cost, 999);
});

test('overrides persist across a reload (loadConfigOverrides)', async () => {
  await configOverrides.loadConfigOverrides();
  assert.equal(configOverrides.getEffectiveFood().coffee.cost, 999);
});

test('POST rejects an unknown override key', async () => {
  const res = await req('POST', '/api/admin/config', { overrides: { 'food:nonesuch:cost': 10 } }, ADMIN);
  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, 'INVALID_OVERRIDE_KEY');
});

test('POST rejects a non-positive value', async () => {
  const res = await req('POST', '/api/admin/config', { overrides: { 'food:coffee:cost': -5 } }, ADMIN);
  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, 'INVALID_OVERRIDE_VALUE');
});

test('POST with no overrides body still reads the config (backward compatible)', async () => {
  const res = await req('POST', '/api/admin/config', {}, ADMIN);
  assert.equal(res.status, 200);
  assert.ok(Array.isArray(res.body.config.food));
});

test('the config endpoints require the admin token', async () => {
  const res = await req('GET', '/api/admin/config', undefined);
  assert.ok([401, 403].includes(res.status), `admin guard rejects unauthenticated access (got ${res.status})`);
});
