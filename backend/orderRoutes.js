import { dbGet, dbRun } from './db.js';
import { AppError } from './appError.js';
import { TIPPING_TIERS } from './gameConfig.js';
import { asyncHandler, sanitizeUserId, sendJson, validateChoice } from './httpUtils.js';
import {
  createOrder,
  getOrder,
  getOrderByOutTradeNo,
  markOrderFailed,
  serializeOrder,
  settleOrder,
  signParams,
  verifySignature,
} from './orders.js';
import { recordEvent, recordFirstTime } from './analytics.js';
import { pushBroadcast } from './broadcasts.js';

// Real payment closed loop:
//   1. /api/order/create  -> create a pending order; returns a pre-signed
//      callback payload that, in production, the payment gateway (WeChat/Alipay)
//      would POST back server-to-server. In this demo the client replays it to
//      simulate "扫码支付完成".
//   2. /api/payment/callback -> verify the gateway signature, then idempotently
//      settle (credit coins exactly once). Replays and gateway retries are safe.
//   3. /api/order/query  -> poll order status.
export function registerOrderRoutes(app, { paymentSecret, presence, logger }) {
  app.post('/api/order/create', asyncHandler(async (req, res) => {
    const userId = sanitizeUserId(req.body?.userId);
    const amount = String(req.body?.amount);
    const paymentMethod = validateChoice(req.body?.paymentMethod, ['wechat', 'alipay'], 'paymentMethod');
    const tier = TIPPING_TIERS[amount];
    if (!tier) throw new AppError(400, 'INVALID_TIP_TIER', 'Invalid recharge tier');

    const user = await dbGet('SELECT id FROM users WHERE id = ?', [userId]);
    if (!user) throw new AppError(404, 'USER_NOT_FOUND', 'User not found');
    if (presence) presence.touch(userId);

    const order = await createOrder(userId, tier, paymentMethod);
    await recordEvent(userId, 'order_create', { amount: tier.amount, paymentMethod });

    // Simulated gateway notification, signed with the shared secret.
    const callbackParams = {
      out_trade_no: order.out_trade_no,
      total_amount: tier.amount,
      gateway_txn_id: `${paymentMethod === 'wechat' ? 'WX' : 'ALI'}${Date.now()}`,
      result: 'SUCCESS',
    };
    const sign = signParams(callbackParams, paymentSecret);

    sendJson(res, {
      order: serializeOrder(order),
      coins: tier.coins,
      // The QR string is illustrative only — real gateways return a code_url.
      qrContent: `xiaoxiai://pay?out_trade_no=${order.out_trade_no}&amount=${tier.amount}`,
      simulatedCallback: { ...callbackParams, sign },
    });
  }));

  app.post('/api/payment/callback', asyncHandler(async (req, res) => {
    const { out_trade_no: outTradeNo, total_amount: totalAmount, gateway_txn_id: gatewayTxnId, result, sign } = req.body || {};
    if (typeof outTradeNo !== 'string') {
      throw new AppError(400, 'INVALID_PARAMETER', 'out_trade_no is required');
    }

    const verifyParams = { out_trade_no: outTradeNo, total_amount: totalAmount, gateway_txn_id: gatewayTxnId, result };
    if (!verifySignature(verifyParams, sign, paymentSecret)) {
      logger.warn('Rejected payment callback with invalid signature', { outTradeNo });
      throw new AppError(400, 'INVALID_SIGNATURE', 'Payment callback signature verification failed');
    }

    const order = await getOrderByOutTradeNo(outTradeNo);
    if (!order) throw new AppError(404, 'ORDER_NOT_FOUND', 'Order not found');

    // Amount tampering guard: the notified amount must match the recorded order.
    if (Number(totalAmount) !== Number(order.tier_amount)) {
      logger.warn('Payment callback amount mismatch', { outTradeNo, totalAmount, expected: order.tier_amount });
      throw new AppError(400, 'AMOUNT_MISMATCH', 'Callback amount does not match the order');
    }

    if (result !== 'SUCCESS') {
      await markOrderFailed(outTradeNo);
      await recordEvent(order.user_id, 'order_failed', { outTradeNo });
      sendJson(res, { settled: false, status: 'failed' });
      return;
    }

    const settlement = await settleOrder(outTradeNo, gatewayTxnId);

    // Side effects only on the first successful settlement.
    if (settlement.settled) {
      const sysMsgId = `sys-recharge-${Date.now()}`;
      const sysText = `💳 充值成功！你为小希充值了 ¥${order.tier_amount}，获得 ${order.coins} 爱心币，余额已到账~`;
      await dbRun(
        'INSERT INTO chat_messages (id, user_id, sender, text, avatar_state) VALUES (?, ?, "system", ?, "normal")',
        [sysMsgId, order.user_id, sysText]
      );
      await recordEvent(order.user_id, 'order_paid', { outTradeNo, amount: order.tier_amount });
      await recordFirstTime(order.user_id, 'first_tip', { amount: order.tier_amount });
      await pushBroadcast('tip', `💝 感谢亲爱的为小希充值 ¥${order.tier_amount} 元，满满的支持！`, 1);
    }

    sendJson(res, {
      settled: settlement.settled,
      alreadyPaid: settlement.alreadyPaid,
      status: 'paid',
      coins: settlement.coins,
      order: serializeOrder(settlement.order),
    });
  }));

  app.post('/api/order/query', asyncHandler(async (req, res) => {
    const userId = sanitizeUserId(req.body?.userId);
    const orderId = typeof req.body?.orderId === 'string' ? req.body.orderId : null;
    const outTradeNo = typeof req.body?.outTradeNo === 'string' ? req.body.outTradeNo : null;
    if (!orderId && !outTradeNo) {
      throw new AppError(400, 'INVALID_PARAMETER', 'orderId or outTradeNo is required');
    }

    const order = orderId ? await getOrder(orderId) : await getOrderByOutTradeNo(outTradeNo);
    if (!order || order.user_id !== userId) {
      throw new AppError(404, 'ORDER_NOT_FOUND', 'Order not found');
    }

    sendJson(res, { order: serializeOrder(order) });
  }));
}
