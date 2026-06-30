import crypto from 'crypto';
import { dbAll, dbGet, dbRun } from '../core/db.js';
import { AppError } from '../core/appError.js';
import { creditCoins, recordTransaction, refundCoins } from './gameplay.js';
import { createLogger } from '../core/logger.js';

const logger = createLogger('orders');

export function generateOutTradeNo() {
  return `XX${Date.now()}${crypto.randomBytes(4).toString('hex')}`;
}

// Canonical signing string: sorted key=value pairs joined by '&', HMAC-SHA256
// with the shared payment secret. This mirrors how real gateways (WeChat Pay /
// Alipay) sign and verify callback notifications.
export function signParams(params, secret) {
  const canonical = Object.keys(params)
    .filter((key) => key !== 'sign' && params[key] !== undefined && params[key] !== null)
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join('&');
  return crypto.createHmac('sha256', secret).update(canonical).digest('hex');
}

export function verifySignature(params, sign, secret) {
  if (!sign) return false;
  const expected = signParams(params, secret);
  const a = Buffer.from(expected);
  const b = Buffer.from(String(sign));
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export async function createOrder(userId, tier, paymentMethod) {
  const id = `order-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
  const outTradeNo = generateOutTradeNo();
  await dbRun(
    `INSERT INTO orders (id, user_id, out_trade_no, tier_amount, coins, payment_method, status)
     VALUES (?, ?, ?, ?, ?, ?, 'pending')`,
    [id, userId, outTradeNo, tier.amount, tier.coins, paymentMethod]
  );
  return dbGet('SELECT * FROM orders WHERE id = ?', [id]);
}

export async function getOrderByOutTradeNo(outTradeNo) {
  return dbGet('SELECT * FROM orders WHERE out_trade_no = ?', [outTradeNo]);
}

export async function getOrder(orderId) {
  return dbGet('SELECT * FROM orders WHERE id = ?', [orderId]);
}

// Idempotent settlement: the conditional UPDATE atomically claims the order so
// only the FIRST caller that flips pending->paid credits the coins. Repeated
// callbacks (gateway retries, double clicks) are no-ops that still report
// success. Returns { settled, alreadyPaid, coins, order }.
export async function settleOrder(outTradeNo, gatewayTxnId) {
  const claim = await dbRun(
    `UPDATE orders SET status = 'paid', gateway_txn_id = ?, paid_at = CURRENT_TIMESTAMP
     WHERE out_trade_no = ? AND status IN ('created', 'pending')`,
    [gatewayTxnId || null, outTradeNo]
  );

  const order = await getOrderByOutTradeNo(outTradeNo);
  if (!order) {
    throw new AppError(404, 'ORDER_NOT_FOUND', 'Order not found');
  }

  if (claim.changes === 0) {
    // Either already paid (idempotent replay) or in a terminal non-payable state.
    const user = await dbGet('SELECT coins FROM users WHERE id = ?', [order.user_id]);
    return {
      settled: false,
      alreadyPaid: order.status === 'paid',
      coins: user ? user.coins : null,
      order,
    };
  }

  // We won the claim — credit coins exactly once, atomically.
  const newCoins = await creditCoins(order.user_id, order.coins);
  if (newCoins === null) {
    logger.error('Settled order references a missing user', { outTradeNo, userId: order.user_id });
    throw new AppError(404, 'USER_NOT_FOUND', 'User not found');
  }

  await recordTransaction(order.user_id, {
    type: 'earn',
    category: 'tip',
    amount: order.coins,
    balance: newCoins,
    description: `打赏 ¥${order.tier_amount}（${order.payment_method === 'wechat' ? '微信支付' : '支付宝'}）`,
  });

  logger.info('Order settled and coins credited', {
    outTradeNo,
    userId: order.user_id,
    coins: order.coins,
  });

  return { settled: true, alreadyPaid: false, coins: newCoins, order };
}

export async function markOrderFailed(outTradeNo) {
  await dbRun(
    "UPDATE orders SET status = 'failed' WHERE out_trade_no = ? AND status IN ('created', 'pending')",
    [outTradeNo]
  );
  return getOrderByOutTradeNo(outTradeNo);
}

// Refund a paid order: reverse the coin grant (never below zero) and write a
// reversing ledger entry. Idempotent on the paid->refunded transition.
export async function refundOrder(orderId) {
  const order = await getOrder(orderId);
  if (!order) {
    throw new AppError(404, 'ORDER_NOT_FOUND', 'Order not found');
  }
  if (order.status !== 'paid') {
    throw new AppError(400, 'ORDER_NOT_REFUNDABLE', `Order in status '${order.status}' cannot be refunded`);
  }

  const claim = await dbRun(
    "UPDATE orders SET status = 'refunded', refunded_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'paid'",
    [orderId]
  );
  if (claim.changes === 0) {
    return { refunded: false, order: await getOrder(orderId) };
  }

  const newCoins = await refundCoins(order.user_id, order.coins);
  await recordTransaction(order.user_id, {
    type: 'spend',
    category: 'refund',
    amount: order.coins,
    balance: newCoins,
    description: `打赏退款 ¥${order.tier_amount}`,
  });

  logger.info('Order refunded', { orderId, userId: order.user_id, coins: order.coins });
  return { refunded: true, coins: newCoins, order: await getOrder(orderId) };
}

// Operator-triggered manual settlement (补单) for an order confirmed paid
// out-of-band — e.g. the gateway callback was lost (network blip). Reuses the
// idempotent settleOrder path, so racing a late real callback is safe (the
// second caller is a no-op). A refunded/failed order can't be revived.
export async function manualSettleOrder(orderId, gatewayTxnId) {
  const order = await getOrder(orderId);
  if (!order) {
    throw new AppError(404, 'ORDER_NOT_FOUND', 'Order not found');
  }
  if (order.status === 'refunded' || order.status === 'failed') {
    throw new AppError(400, 'ORDER_NOT_SETTLEABLE', `Order in status '${order.status}' cannot be settled`);
  }
  return settleOrder(order.out_trade_no, gatewayTxnId || `manual-${Date.now()}`);
}

// Reconciliation summary over a created_at date range (inclusive, local time).
// Both bounds default to the last 30 days. Returns per-status counts + amounts
// plus paid totals so operators can tie out gateway settlements against orders.
export async function reconcileOrders(fromDate = null, toDate = null) {
  const rows = await dbAll(
    `SELECT status, COUNT(*) as count, COALESCE(SUM(tier_amount), 0) as amount
       FROM orders
      WHERE date(created_at, 'localtime') >= COALESCE(?, date('now', 'localtime', '-30 days'))
        AND date(created_at, 'localtime') <= COALESCE(?, date('now', 'localtime'))
      GROUP BY status`,
    [fromDate, toDate]
  );

  const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
  const byStatus = {};
  let totalOrders = 0;
  let paidCount = 0;
  let paidAmount = 0;
  for (const row of rows) {
    byStatus[row.status] = { count: row.count, amount: round2(row.amount) };
    totalOrders += row.count;
    if (row.status === 'paid') {
      paidCount += row.count;
      paidAmount += row.amount;
    }
  }
  return { from: fromDate, to: toDate, totalOrders, paidCount, paidAmount: round2(paidAmount), byStatus };
}

export function serializeOrder(order) {
  if (!order) return null;
  return {
    id: order.id,
    outTradeNo: order.out_trade_no,
    amount: order.tier_amount,
    coins: order.coins,
    paymentMethod: order.payment_method,
    status: order.status,
  };
}

// The user's own recharge/order history, newest first. Backs the wallet's order
// records view. Scoped to userId by the caller; timestamps are pre-formatted for
// display (local time).
export async function listOrders(userId, limit = 50) {
  const rows = await dbAll(
    `SELECT id, out_trade_no, tier_amount, coins, payment_method, status,
            strftime('%Y-%m-%d %H:%M', created_at, 'localtime') AS created_at,
            strftime('%Y-%m-%d %H:%M', paid_at, 'localtime') AS paid_at
       FROM orders WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`,
    [userId, limit]
  );
  return rows.map((o) => ({
    id: o.id,
    outTradeNo: o.out_trade_no,
    amount: o.tier_amount,
    coins: o.coins,
    paymentMethod: o.payment_method,
    status: o.status,
    createdAt: o.created_at,
    paidAt: o.paid_at,
  }));
}
