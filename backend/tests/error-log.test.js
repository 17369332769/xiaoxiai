import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

process.env.LOG_LEVEL = 'error';
process.env.LOG_REQUESTS = 'false';

const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'xiaoxiai-errlog-'));
process.env.XIAOXIAI_DB_PATH = path.join(tempDir, 'test.sqlite');

const [errorLog, middleware, appErrorMod, dbModule] = await Promise.all([
  import('../services/errorLog.js'),
  import('../core/middleware.js'),
  import('../core/appError.js'),
  import('../core/db.js'),
]);

await dbModule.dbReady;
const { AppError } = appErrorMod;

test.after(async () => {
  await dbModule.closeDb();
  await fs.rm(tempDir, { recursive: true, force: true });
});

function fakeRes() {
  return {
    headersSent: false,
    statusCode: null,
    body: null,
    headers: {},
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
    set(k, v) { this.headers[k] = v; return this; },
  };
}

const silentLogger = { error() {}, warn() {}, info() {} };

test('recordError persists and loadErrorLogs reads back newest-first', async () => {
  await errorLog.recordError({ code: 'A', status: 500, message: 'first', path: '/api/a', method: 'POST' });
  await errorLog.recordError({ code: 'B', status: 503, message: 'second', path: '/api/b', method: 'GET' });

  const logs = await errorLog.loadErrorLogs(10);
  assert.equal(logs.length, 2);
  assert.equal(logs[0].code, 'B'); // newest first
  assert.equal(logs[0].status, 503);
  assert.equal(logs[1].message, 'first');
});

test('createErrorHandler persists 5xx via onServerError but skips 4xx', async () => {
  const captured = [];
  const handler = middleware.createErrorHandler(silentLogger, async (info) => { captured.push(info); });

  handler(new Error('boom'), { originalUrl: '/api/x', method: 'POST' }, fakeRes(), () => {});
  handler(new AppError(400, 'BAD', 'nope'), { originalUrl: '/api/y', method: 'GET' }, fakeRes(), () => {});

  // onServerError is fired detached (Promise.resolve().catch) — flush microtasks.
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(captured.length, 1, 'only the 5xx is recorded');
  assert.equal(captured[0].status, 500);
  assert.equal(captured[0].code, 'INTERNAL_ERROR');
  assert.equal(captured[0].path, '/api/x');
});

test('a throwing onServerError never breaks the error response', async () => {
  const handler = middleware.createErrorHandler(silentLogger, async () => { throw new Error('sink down'); });
  const res = fakeRes();
  handler(new Error('boom'), { originalUrl: '/api/z', method: 'POST' }, res, () => {});
  // The client still gets the standard 500 envelope despite the failing sink.
  assert.equal(res.statusCode, 500);
  assert.equal(res.body.ok, false);
  await new Promise((resolve) => setTimeout(resolve, 0));
});
