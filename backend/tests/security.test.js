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
process.env.PAYMENT_SECRET = 'test-payment-secret';
process.env.AUTH_SECRET = 'test-auth-secret';
// This suite verifies the production-safe posture, so simulated payment is OFF.
// The Node test runner runs each test file in its own process, so this does not
// affect the other suites that enable it.
process.env.ALLOW_SIMULATED_PAYMENT = 'false';

const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'xiaoxiai-sec-test-'));
process.env.XIAOXIAI_DB_PATH = path.join(tempDir, 'test.sqlite');

const [{ app }, dbModule, orders] = await Promise.all([
  import('../server.js'),
  import('../db.js'),
  import('../orders.js'),
]);

await dbModule.dbReady;

let server;
let baseUrl;

async function postJson(route, payload, headers = {}) {
  const response = await fetch(`${baseUrl}${route}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: process.env.ALLOWED_ORIGIN, ...headers },
    body: JSON.stringify(payload),
  });
  return { status: response.status, body: await response.json() };
}

test.before(async () => {
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  if (server) {
    await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
  await dbModule.closeDb();
  await fs.rm(tempDir, { recursive: true, force: true });
});

test('instant tip is blocked and mints no coins when simulated payment is disabled', async () => {
  const userId = 'sec_tip_user';
  const sync = await postJson('/api/user/sync', { userId });
  const before = sync.body.user.coins;

  const tip = await postJson('/api/action/tip', { userId, amount: 131.4, paymentMethod: 'wechat' });
  assert.equal(tip.status, 403);
  assert.equal(tip.body.error.code, 'TIP_SIMULATION_DISABLED');

  // No coins minted and no tip ledger row written — the free-coin faucet is closed.
  const after = (await postJson('/api/user/sync', { userId })).body.user.coins;
  assert.equal(after, before);
  const ledger = await postJson('/api/transactions', { userId });
  assert.equal(ledger.body.transactions.filter((t) => t.category === 'tip').length, 0);

  // The 403 must fire BEFORE createOrder — pin it so a future regression that
  // moves the flag check below order creation is caught (no dangling order row).
  const orderRows = await dbModule.dbAll('SELECT id FROM orders WHERE user_id = ?', [userId]);
  assert.equal(orderRows.length, 0);
});

test('order/create does not hand out a replayable signed callback when disabled', async () => {
  const userId = 'sec_order_user';
  await postJson('/api/user/sync', { userId });

  const create = await postJson('/api/order/create', { userId, amount: 5, paymentMethod: 'wechat' });
  assert.equal(create.status, 200);
  assert.equal(create.body.order.status, 'pending');
  // The client must NOT receive a pre-signed callback it could replay to self-credit.
  assert.equal(create.body.simulatedCallback, undefined);
});

test('a real signed gateway callback still settles even with simulation disabled', async () => {
  const userId = 'sec_gateway_user';
  const sync = await postJson('/api/user/sync', { userId });
  const before = sync.body.user.coins;

  const create = await postJson('/api/order/create', { userId, amount: 5, paymentMethod: 'wechat' });
  const outTradeNo = create.body.order.outTradeNo;

  // A real gateway holds PAYMENT_SECRET and posts a signed callback server-to-
  // server. That path must keep working — only the client-replayable shortcut is gone.
  const params = { out_trade_no: outTradeNo, total_amount: 5, gateway_txn_id: 'WXREAL', result: 'SUCCESS' };
  const sign = orders.signParams(params, process.env.PAYMENT_SECRET);
  const settle = await postJson('/api/payment/callback', { ...params, sign });
  assert.equal(settle.status, 200);
  assert.equal(settle.body.settled, true);

  const after = (await postJson('/api/user/sync', { userId })).body.user.coins;
  assert.equal(after, before + 100);

  // Replaying a captured valid callback (gateway retry / attacker replay) must be
  // an idempotent no-op — no double credit.
  const replay = await postJson('/api/payment/callback', { ...params, sign });
  assert.equal(replay.status, 200);
  assert.equal(replay.body.settled, false);
  assert.equal(replay.body.alreadyPaid, true);
  const afterReplay = (await postJson('/api/user/sync', { userId })).body.user.coins;
  assert.equal(afterReplay, before + 100);
});
