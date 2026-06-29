import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

process.env.LOG_LEVEL = 'error';
process.env.LOG_REQUESTS = 'false';

const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'xiaoxiai-orders-'));
process.env.XIAOXIAI_DB_PATH = path.join(tempDir, 'test.sqlite');

const [orders, dbModule] = await Promise.all([
  import('../services/orders.js'),
  import('../core/db.js'),
]);

await dbModule.dbReady;
const { dbRun, dbGet } = dbModule;

test.after(async () => {
  await dbModule.closeDb();
  await fs.rm(tempDir, { recursive: true, force: true });
});

async function seedUser(id, coins = 200) {
  await dbRun('INSERT INTO users (id, level, affection, energy, mood, coins) VALUES (?, 1, 10, 80, 70, ?)', [id, coins]);
}

test('settleOrder credits the coins exactly once (idempotent on replay)', async () => {
  await seedUser('ord_u1', 200);
  const order = await orders.createOrder('ord_u1', { amount: 52, coins: 1200 }, 'wechat');

  const first = await orders.settleOrder(order.out_trade_no, 'GW1');
  assert.equal(first.settled, true);
  assert.equal(first.coins, 1400); // 200 + 1200

  // Replaying the same settlement must be a no-op (gateway retry / double click).
  const second = await orders.settleOrder(order.out_trade_no, 'GW1');
  assert.equal(second.settled, false);
  assert.equal(second.alreadyPaid, true);
  assert.equal(second.coins, 1400);

  const user = await dbGet("SELECT coins FROM users WHERE id = 'ord_u1'");
  assert.equal(user.coins, 1400);
});

test('listOrders returns only the user\'s own orders, newest first', async () => {
  await seedUser('ord_list_a', 200);
  await seedUser('ord_list_b', 200);
  const o1 = await orders.createOrder('ord_list_a', { amount: 5, coins: 100 }, 'wechat');
  const o2 = await orders.createOrder('ord_list_a', { amount: 52, coins: 1200 }, 'alipay');
  await orders.settleOrder(o2.out_trade_no, 'GWX');
  await orders.createOrder('ord_list_b', { amount: 30, coins: 600 }, 'wechat'); // other user

  // Backdate o1 so the newest-first ordering is deterministic (CURRENT_TIMESTAMP
  // is only second-resolution, so same-second inserts would tie).
  await dbRun("UPDATE orders SET created_at = '2020-01-01 00:00:00' WHERE id = ?", [o1.id]);

  const list = await orders.listOrders('ord_list_a');
  assert.equal(list.length, 2, 'only A\'s two orders are returned');
  assert.ok(list.every((o) => o.id === o1.id || o.id === o2.id), 'no other user\'s order leaks in');
  assert.equal(list[0].id, o2.id, 'newest first');
  assert.equal(list[0].status, 'paid');
  assert.equal(list[0].coins, 1200);
  assert.equal(list[0].amount, 52);
  assert.equal(list[0].paymentMethod, 'alipay');
  assert.ok(list[0].createdAt, 'createdAt is populated');

  const listB = await orders.listOrders('ord_list_b');
  assert.equal(listB.length, 1, 'user B sees only their own order');
});

test('refundOrder reverses a paid order once, then rejects further refunds', async () => {
  await seedUser('ord_u2', 200);
  const order = await orders.createOrder('ord_u2', { amount: 5, coins: 100 }, 'alipay');
  await orders.settleOrder(order.out_trade_no, 'GW2'); // 200 + 100 = 300

  const refund = await orders.refundOrder(order.id);
  assert.equal(refund.refunded, true);
  assert.equal(refund.coins, 200); // 300 - 100 reversed

  // A second refund of the now-refunded order is rejected (no double reverse).
  await assert.rejects(
    () => orders.refundOrder(order.id),
    (err) => err.code === 'ORDER_NOT_REFUNDABLE'
  );
  const user = await dbGet("SELECT coins FROM users WHERE id = 'ord_u2'");
  assert.equal(user.coins, 200);
});

test('refundOrder rejects an unpaid (pending) order and a missing order', async () => {
  await seedUser('ord_u3', 200);
  const pending = await orders.createOrder('ord_u3', { amount: 5, coins: 100 }, 'wechat');

  await assert.rejects(
    () => orders.refundOrder(pending.id),
    (err) => err.code === 'ORDER_NOT_REFUNDABLE'
  );
  await assert.rejects(
    () => orders.refundOrder('does-not-exist'),
    (err) => err.code === 'ORDER_NOT_FOUND'
  );
});
