import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import ShopModal from './ShopModal';

void React;

const FOOD_ITEMS = [
  { id: 'coffee', name: '香浓拿铁', cost: 30, energy: 15, affection: 5, icon: '☕', desc: 'desc' },
];

const GIFT_ITEMS = [
  { id: 'rose', name: '水晶玫瑰', cost: 120, mood: 20, affection: 35, icon: '🌹', desc: 'desc' },
];

const TIPPING_TIERS = [
  { amount: 5, label: '一杯奶茶', coins: 100, desc: 'tip-desc' },
  { amount: 52, label: '一束花海', coins: 1200, desc: 'tip-desc-2' },
];

describe('ShopModal', () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  test('calls feed action and closes after a successful food purchase', async () => {
    const onClose = vi.fn();
    const feedXiaoxi = vi.fn().mockResolvedValue(true);
    const notify = vi.fn();

    render(
      <ShopModal
        isOpen
        mode="shop"
        shopType="food"
        onClose={onClose}
        coins={100}
        FOOD_ITEMS={FOOD_ITEMS}
        GIFT_ITEMS={GIFT_ITEMS}
        TIPPING_TIERS={TIPPING_TIERS}
        feedXiaoxi={feedXiaoxi}
        giftXiaoxi={vi.fn()}
        tipXiaoxi={vi.fn()}
        notify={notify}
      />
    );

    fireEvent.click(screen.getByText(/30 购买/));

    await waitFor(() => {
      expect(feedXiaoxi).toHaveBeenCalledWith('coffee');
    });
    expect(onClose).toHaveBeenCalled();
  });

  test('uses in-app notification when coins are insufficient for a purchase', () => {
    const notify = vi.fn();

    render(
      <ShopModal
        isOpen
        mode="shop"
        shopType="gift"
        onClose={vi.fn()}
        coins={10}
        FOOD_ITEMS={FOOD_ITEMS}
        GIFT_ITEMS={GIFT_ITEMS}
        TIPPING_TIERS={TIPPING_TIERS}
        feedXiaoxi={vi.fn()}
        giftXiaoxi={vi.fn()}
        tipXiaoxi={vi.fn()}
        notify={notify}
      />
    );

    fireEvent.click(screen.getByText('🎁 精美礼物 (Gifts)'));
    fireEvent.click(screen.getByText(/120 购买/));

    expect(notify).toHaveBeenCalledWith(
      '爱心币不足，先去聊天做任务，或者打赏补充一下吧。',
      'warning',
      '余额不足'
    );
  });

  test('submits tip payment after the simulated processing delay', async () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    const tipXiaoxi = vi.fn().mockResolvedValue(true);
    const notify = vi.fn();

    render(
      <ShopModal
        isOpen
        mode="tipping"
        shopType="food"
        onClose={onClose}
        coins={0}
        FOOD_ITEMS={FOOD_ITEMS}
        GIFT_ITEMS={GIFT_ITEMS}
        TIPPING_TIERS={TIPPING_TIERS}
        feedXiaoxi={vi.fn()}
        giftXiaoxi={vi.fn()}
        tipXiaoxi={tipXiaoxi}
        notify={notify}
      />
    );

    fireEvent.click(screen.getByText('一束花海'));
    fireEvent.click(screen.getByText('🔵 支付宝 (Alipay)'));
    fireEvent.click(screen.getByText('点击确认支付 ¥52 元'));

    await act(async () => {
      vi.advanceTimersByTime(1500);
      await Promise.resolve();
    });

    expect(tipXiaoxi).toHaveBeenCalledWith(52, 'alipay');
    expect(onClose).toHaveBeenCalled();
  });

  test('shows purchase pending state and disables other actions while a purchase is active', () => {
    render(
      <ShopModal
        isOpen
        mode="shop"
        shopType="food"
        onClose={vi.fn()}
        coins={100}
        FOOD_ITEMS={FOOD_ITEMS}
        GIFT_ITEMS={GIFT_ITEMS}
        TIPPING_TIERS={TIPPING_TIERS}
        feedXiaoxi={vi.fn()}
        giftXiaoxi={vi.fn()}
        tipXiaoxi={vi.fn()}
        activePurchaseKey="food:coffee"
        notify={vi.fn()}
      />
    );

    expect(screen.getByText('购买中...').closest('button')?.disabled).toBe(true);
    expect(screen.getByText('🎁 精美礼物 (Gifts)').closest('button')?.disabled).toBe(true);
  });

  test('shows a retry banner for the last failed purchase and retries it', () => {
    const retryLastFailedAction = vi.fn();

    render(
      <ShopModal
        isOpen
        mode="shop"
        shopType="food"
        onClose={vi.fn()}
        coins={100}
        FOOD_ITEMS={FOOD_ITEMS}
        GIFT_ITEMS={GIFT_ITEMS}
        TIPPING_TIERS={TIPPING_TIERS}
        feedXiaoxi={vi.fn()}
        giftXiaoxi={vi.fn()}
        tipXiaoxi={vi.fn()}
        lastFailedAction={{ kind: 'food', itemId: 'coffee', label: '香浓拿铁' }}
        retryLastFailedAction={retryLastFailedAction}
        notify={vi.fn()}
      />
    );

    expect(screen.getByText('上一次购买失败')).not.toBeNull();
    expect(screen.getAllByText('香浓拿铁').length).toBeGreaterThan(0);

    fireEvent.click(screen.getByText('重试购买'));
    expect(retryLastFailedAction).toHaveBeenCalled();
  });

  test('real scan-to-pay flow: creates an order, shows the QR placeholder, then confirms payment', async () => {
    const onClose = vi.fn();
    const notify = vi.fn();
    const order = {
      order: { id: 'order-1', outTradeNo: 'XX-1', amount: 52, coins: 1200, paymentMethod: 'alipay', status: 'pending' },
      coins: 1200,
      qrContent: 'xiaoxiai://pay?out_trade_no=XX-1&amount=52',
      simulatedCallback: { out_trade_no: 'XX-1', total_amount: 52, gateway_txn_id: 'ALI1', result: 'SUCCESS', sign: 'sig' },
    };
    const createOrder = vi.fn().mockResolvedValue(order);
    const queryOrder = vi.fn().mockResolvedValue({ ...order.order, status: 'paid' });
    const confirmPayment = vi.fn().mockResolvedValue({ settled: true, alreadyPaid: false, status: 'paid', coins: 1400 });

    render(
      <ShopModal
        isOpen
        mode="tipping"
        shopType="food"
        onClose={onClose}
        coins={0}
        FOOD_ITEMS={FOOD_ITEMS}
        GIFT_ITEMS={GIFT_ITEMS}
        TIPPING_TIERS={TIPPING_TIERS}
        feedXiaoxi={vi.fn()}
        giftXiaoxi={vi.fn()}
        tipXiaoxi={vi.fn()}
        createOrder={createOrder}
        queryOrder={queryOrder}
        confirmPayment={confirmPayment}
        notify={notify}
      />
    );

    fireEvent.click(screen.getByText('一束花海'));
    fireEvent.click(screen.getByText('🔵 支付宝 (Alipay)'));

    // Enter the real scan-to-pay state.
    fireEvent.click(screen.getByText(/真实扫码支付/));

    await waitFor(() => {
      expect(createOrder).toHaveBeenCalledWith(52, 'alipay');
    });

    // The QR content is rendered as a scannable placeholder.
    await screen.findByText(order.qrContent);
    expect(screen.getByText('我已完成支付')).not.toBeNull();

    // Confirm payment replays the pre-signed gateway callback and closes.
    fireEvent.click(screen.getByText('我已完成支付'));

    await waitFor(() => {
      expect(confirmPayment).toHaveBeenCalledWith(order.simulatedCallback);
    });
    expect(onClose).toHaveBeenCalled();
  });
});
