import * as React from 'react';
import { View, Text } from '@tarojs/components';

const { useState, useEffect, useRef, useCallback } = React;

const ORDER_POLL_INTERVAL_MS = 1500;
const ORDER_POLL_TIMEOUT_MS = 60000;

export default function ShopModal({
  isOpen,
  mode, // 'shop' or 'tipping'
  shopType, // 'food' or 'gift'
  onClose,
  coins,
  FOOD_ITEMS,
  GIFT_ITEMS,
  TIPPING_TIERS,
  feedXiaoxi,
  giftXiaoxi,
  tipXiaoxi,
  createOrder,
  queryOrder,
  confirmPayment,
  allowSimulatedPayment = false,
  activePurchaseKey,
  isTipping = false,
  lastFailedAction,
  retryLastFailedAction,
  notify
}) {
  const [activeTab, setActiveTab] = useState(shopType || 'food');
  const [selectedTip, setSelectedTip] = useState(TIPPING_TIERS[0]);
  const [payChannel, setPayChannel] = useState('wechat'); // 'wechat' or 'alipay'
  const [isProcessing, setIsProcessing] = useState(false);
  // Real scan-to-pay flow state. `activeOrder` holds the created order +
  // pre-signed callback while we show the QR placeholder and poll for status.
  const [activeOrder, setActiveOrder] = useState(null);
  const [isCreatingOrder, setIsCreatingOrder] = useState(false);
  const [isConfirmingPayment, setIsConfirmingPayment] = useState(false);
  const [orderStatus, setOrderStatus] = useState('idle'); // idle | pending | paid | timeout
  const pollTimerRef = useRef(null);
  const pollDeadlineRef = useRef(0);
  const activeOrderRef = useRef(null);
  const isScanning = Boolean(activeOrder);
  const isModalBusy =
    isProcessing || isCreatingOrder || isConfirmingPayment || isScanning || Boolean(activePurchaseKey) || isTipping;
  const currentItems = activeTab === 'food' ? FOOD_ITEMS : GIFT_ITEMS;

  const clearPollTimer = useCallback(() => {
    if (pollTimerRef.current) {
      clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  // ---- Real scan-to-pay flow (create order -> poll -> gateway callback) ----
  const stopScanFlow = useCallback(() => {
    clearPollTimer();
    activeOrderRef.current = null;
    setActiveOrder(null);
    setOrderStatus('idle');
  }, [clearPollTimer]);

  // Poll /api/order/query until the backend reports the order as paid, or until
  // the 60s deadline. Reschedules itself through a ref so the timer always calls
  // the latest callback without referencing it before it is declared.
  const pollOrderStatusRef = useRef(null);
  const pollOrderStatus = useCallback(async () => {
    const order = activeOrderRef.current;
    if (!order) return;

    const result = await queryOrder?.({ orderId: order.order.id });
    if (!activeOrderRef.current || activeOrderRef.current.order.id !== order.order.id) {
      return; // The order was replaced or cancelled while the query was in flight.
    }

    if (result?.status === 'paid') {
      setOrderStatus('paid');
      clearPollTimer();
      return;
    }

    if (Date.now() >= pollDeadlineRef.current) {
      setOrderStatus('timeout');
      clearPollTimer();
      return;
    }

    pollTimerRef.current = setTimeout(() => pollOrderStatusRef.current?.(), ORDER_POLL_INTERVAL_MS);
  }, [queryOrder, clearPollTimer]);
  useEffect(() => {
    pollOrderStatusRef.current = pollOrderStatus;
  }, [pollOrderStatus]);

  // Always clear the polling timer on unmount / modal close to avoid leaks.
  useEffect(() => () => clearPollTimer(), [clearPollTimer]);
  useEffect(() => {
    if (!isOpen) {
      clearPollTimer();
    }
  }, [isOpen, clearPollTimer]);

  if (!isOpen) return null;

  // Handle purchasing food/gift items
  const handlePurchase = async (item, type) => {
    if (isModalBusy) {
      return;
    }

    if (coins < item.cost) {
      notify?.('爱心币不足，先去聊天做任务，或者打赏补充一下吧。', 'warning', '余额不足');
      return;
    }

    if (type === 'food') {
      const success = await feedXiaoxi(item.id);
      if (success) onClose();
    } else {
      const success = await giftXiaoxi(item.id);
      if (success) onClose();
    }
  };

  // Handle mock payment action
  const handleMockPay = () => {
    if (isModalBusy) {
      return;
    }

    setIsProcessing(true);
    setTimeout(async () => {
      setIsProcessing(false);
      const success = await tipXiaoxi(selectedTip.amount, payChannel);
      if (success) {
        onClose();
      }
    }, 1500); // Simulated delay
  };

  const handleStartRealPayment = async () => {
    if (isModalBusy || !createOrder) {
      return;
    }

    setIsCreatingOrder(true);
    try {
      const data = await createOrder(selectedTip.amount, payChannel);
      if (!data) {
        return; // createOrder already surfaced the error via notify.
      }

      activeOrderRef.current = data;
      setActiveOrder(data);
      setOrderStatus('pending');
      pollDeadlineRef.current = Date.now() + ORDER_POLL_TIMEOUT_MS;
      clearPollTimer();
      pollTimerRef.current = setTimeout(pollOrderStatus, ORDER_POLL_INTERVAL_MS);
    } finally {
      setIsCreatingOrder(false);
    }
  };

  // "我已完成支付": replay the pre-signed gateway callback (idempotent on the
  // backend, so repeat clicks are safe). On settlement the store refreshes the
  // user snapshot, then we close the modal.
  const handleConfirmRealPayment = async () => {
    const order = activeOrderRef.current;
    if (!order || isConfirmingPayment || !confirmPayment) {
      return;
    }

    setIsConfirmingPayment(true);
    try {
      const data = await confirmPayment(order.simulatedCallback);
      if (!data) {
        return; // confirmPayment already surfaced the error via notify.
      }

      if (data.settled || data.alreadyPaid) {
        notify?.(`充值成功！获得 ${order.coins} 爱心币~`, 'success', '充值成功');
        stopScanFlow();
        onClose();
      }
    } finally {
      setIsConfirmingPayment(false);
    }
  };

  const handleRequestClose = () => {
    if (isScanning) {
      // Allow backing out of an unpaid scan without leaving a dangling poller.
      stopScanFlow();
      return;
    }
    if (!isModalBusy) {
      onClose();
    }
  };

  const renderPurchaseButton = (item, type) => {
    const purchaseKey = `${type}:${item.id}`;
    const isCurrentPurchase = activePurchaseKey === purchaseKey;

    return (
      <View
        onClick={isModalBusy ? undefined : () => handlePurchase(item, type)}
        className={`btn-primary${isModalBusy ? ' is-disabled' : ''}`}
        style={{ padding: '6px 16px', fontSize: '13px', width: '100%' }}
      >
        {isCurrentPurchase ? '购买中...' : <><Text className="coin-icon"></Text> {item.cost} 购买</>}
      </View>
    );
  };

  // Mock QR placeholder for WeChat/Alipay. The original web build drew an inline
  // <svg> "fake" QR; mini-program has no SVG primitive, so we render an
  // equivalent decorative View placeholder that keeps the channel color + heart.
  const renderMockQR = () => {
    const color = payChannel === 'wechat' ? '#22c55e' : '#3b82f6';
    return (
      <View
        style={{
          width: '140px',
          height: '140px',
          borderRadius: '8px',
          background: '#ffffff',
          border: `4px solid ${color}`,
          boxSizing: 'border-box',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          shapeRendering: 'crispEdges'
        }}
      >
        <View
          style={{
            width: '40px',
            height: '40px',
            borderRadius: '4px',
            background: color,
            opacity: 0.9,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}
        >
          <Text style={{ fontSize: '18px', fontWeight: 'bold', color: 'white' }}>❤</Text>
        </View>
      </View>
    );
  };

  return (
    <View className="modal-overlay" onClick={handleRequestClose}>
      <View className="modal-content" onClick={(e) => e.stopPropagation()}>

        {/* Modal Header */}
        <View className="modal-header">
          <View className="modal-title">
            {mode === 'shop' ? (
              <><Text>🏪</Text><Text>小希专属商店 (Love Shop)</Text></>
            ) : (
              <><Text>💝</Text><Text>在线打赏小希 (Support Xiaoxi)</Text></>
            )}
          </View>
          <View
            className={`close-btn${isModalBusy ? ' is-disabled' : ''}`}
            onClick={isModalBusy ? undefined : handleRequestClose}
          >×</View>
        </View>

        {/* SHOP MODE */}
        {mode === 'shop' && (
          <View>
            {lastFailedAction && (lastFailedAction.kind === 'food' || lastFailedAction.kind === 'gift') && (
              <View className="shop-retry-banner">
                <View className="shop-retry-copy">
                  <View className="shop-retry-label">上一次购买失败</View>
                  <View className="shop-retry-preview">{lastFailedAction.label}</View>
                </View>
                <View
                  className={`btn-secondary shop-retry-action${isModalBusy ? ' is-disabled' : ''}`}
                  onClick={isModalBusy ? undefined : retryLastFailedAction}
                >
                  {isModalBusy ? '重试中...' : '重试购买'}
                </View>
              </View>
            )}

            {/* Shop Category Tabs */}
            <View style={{ display: 'flex', gap: '10px', marginBottom: '20px' }}>
              <View
                onClick={isModalBusy ? undefined : () => setActiveTab('food')}
                className={`btn-secondary${isModalBusy ? ' is-disabled' : ''}`}
                style={{
                  flex: 1,
                  padding: '8px',
                  background: activeTab === 'food' ? 'rgba(255, 117, 151, 0.15)' : '',
                  borderColor: activeTab === 'food' ? 'var(--primary-pink)' : '',
                  color: activeTab === 'food' ? 'var(--text-pink)' : ''
                }}
              >
                🍜 喂食面板 (Food)
              </View>
              <View
                onClick={isModalBusy ? undefined : () => setActiveTab('gift')}
                className={`btn-secondary${isModalBusy ? ' is-disabled' : ''}`}
                style={{
                  flex: 1,
                  padding: '8px',
                  background: activeTab === 'gift' ? 'rgba(255, 117, 151, 0.15)' : '',
                  borderColor: activeTab === 'gift' ? 'var(--primary-pink)' : '',
                  color: activeTab === 'gift' ? 'var(--text-pink)' : ''
                }}
              >
                🎁 精美礼物 (Gifts)
              </View>
            </View>

            {/* Shop Grid */}
            <View className="shop-grid">
              {currentItems.map(item => {
                const isFood = activeTab === 'food';

                return (
                  <View key={item.id} className="shop-item">
                    <Text className="shop-item-icon">{item.icon}</Text>
                    <View className="shop-item-name">{item.name}</View>
                    <View className="shop-item-desc">{item.desc}</View>

                    <View style={{ display: 'flex', gap: '10px', fontSize: '11px', color: 'var(--text-muted)', marginBottom: '10px' }}>
                      {isFood ? (
                        <>
                          <Text>⚡+{item.energy} 体力</Text>
                          <Text>❤️+{item.affection} 好感</Text>
                        </>
                      ) : (
                        <>
                          <Text>🎭+{item.mood} 心情</Text>
                          <Text>❤️+{item.affection} 好感</Text>
                        </>
                      )}
                    </View>

                    {renderPurchaseButton(item, isFood ? 'food' : 'gift')}
                  </View>
                );
              })}
            </View>

            {/* Wallet Info */}
            <View style={{ textAlign: 'center', fontSize: '13px', color: 'var(--text-muted)' }}>
              当前钱包余额: <Text className="gold-glow-text" style={{ color: 'var(--accent-gold)', fontWeight: 'bold' }}><Text className="coin-icon"></Text> {coins} 爱心币</Text>
            </View>
          </View>
        )}

        {/* TIPPING MODE */}
        {mode === 'tipping' && (
          <View>
            {lastFailedAction?.kind === 'tip' && (
              <View className="shop-retry-banner">
                <View className="shop-retry-copy">
                  <View className="shop-retry-label">上一次打赏失败</View>
                  <View className="shop-retry-preview">{lastFailedAction.label}</View>
                </View>
                <View
                  className={`btn-secondary shop-retry-action${isModalBusy ? ' is-disabled' : ''}`}
                  onClick={isModalBusy ? undefined : retryLastFailedAction}
                >
                  {isModalBusy ? '重试中...' : '重试打赏'}
                </View>
              </View>
            )}

            {!isScanning && (
              <>
                {/* Presets Grid */}
                <View className="tipping-options">
                  {TIPPING_TIERS.map((tier, idx) => (
                    <View
                      key={idx}
                      onClick={isModalBusy ? undefined : () => setSelectedTip(tier)}
                      className={`tip-option-btn ${selectedTip.amount === tier.amount ? 'active' : ''}${isModalBusy ? ' is-disabled' : ''}`}
                    >
                      <View className="tip-option-amount">¥{tier.amount}</View>
                      <View className="tip-option-label">{tier.label}</View>
                      <View style={{ fontSize: '10px', color: 'var(--accent-gold)', marginTop: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <Text className="coin-icon"></Text>+{tier.coins}
                      </View>
                    </View>
                  ))}
                </View>

                {/* Payment Channel Selector */}
                <View style={{ display: 'flex', justifyContent: 'center', marginBottom: '15px' }}>
                  <View className="payment-channel-selector">
                    <View
                      onClick={isModalBusy ? undefined : () => setPayChannel('wechat')}
                      className={`pay-channel-btn ${payChannel === 'wechat' ? 'active wechat' : ''}${isModalBusy ? ' is-disabled' : ''}`}
                    >
                      🟢 微信支付 (WeChat)
                    </View>
                    <View
                      onClick={isModalBusy ? undefined : () => setPayChannel('alipay')}
                      className={`pay-channel-btn ${payChannel === 'alipay' ? 'active alipay' : ''}${isModalBusy ? ' is-disabled' : ''}`}
                    >
                      🔵 支付宝 (Alipay)
                    </View>
                  </View>
                </View>

                {/* QR Code Scan Area */}
                <View className="payment-qr-container">
                  <View className="payment-qr-wrapper">
                    {renderMockQR()}
                  </View>

                  <View className="payment-meta">
                    <View style={{ fontWeight: 'bold', fontSize: '14px', color: 'white', marginBottom: '4px' }}>
                      扫码打赏: ¥{selectedTip.amount} 元
                    </View>
                    <View>{selectedTip.desc}</View>
                    <View style={{ fontSize: '11px', color: 'var(--primary-pink)', marginTop: '4px' }}>
                      {allowSimulatedPayment
                        ? '【模拟支付】扫码或直接点击下方按钮完成'
                        : '扫码完成支付，或点击下方按钮创建订单'}
                    </View>
                  </View>

                  {/* Instant-settle shortcut — demo only. Hidden when simulated
                      payment is off, since /api/action/tip would return 403. */}
                  {allowSimulatedPayment && (
                    <View
                      onClick={isModalBusy ? undefined : handleMockPay}
                      className={`btn-primary payment-status-sim${isModalBusy ? ' is-disabled' : ''}`}
                      style={{
                        padding: '10px',
                        width: '100%',
                        fontSize: '14px',
                        background: payChannel === 'wechat' ? '#22c55e' : '#3b82f6',
                        boxShadow: payChannel === 'wechat' ? '0 0 10px rgba(34,197,94,0.3)' : '0 0 10px rgba(59,130,246,0.3)'
                      }}
                    >
                      {(isProcessing || isTipping) ? '🔄 正在建立安全加密链接...' : `点击确认支付 ¥${selectedTip.amount} 元`}
                    </View>
                  )}

                  {/* Real scan-to-pay entry: drives the actual order链路. Primary
                      style when it is the only available payment path. */}
                  <View
                    onClick={isModalBusy ? undefined : handleStartRealPayment}
                    className={`${allowSimulatedPayment ? 'btn-secondary' : 'btn-primary'}${isModalBusy ? ' is-disabled' : ''}`}
                    style={{ padding: '10px', width: '100%', fontSize: '13px', marginTop: allowSimulatedPayment ? '10px' : '0' }}
                  >
                    {isCreatingOrder ? '正在生成订单...' : '📷 真实扫码支付 (创建订单)'}
                  </View>
                </View>
              </>
            )}

            {/* Real scan-to-pay state: QR placeholder + polling + confirm */}
            {isScanning && (
              <View className="payment-qr-container">
                <View
                  style={{
                    fontFamily: 'monospace',
                    fontSize: '11px',
                    wordBreak: 'break-all',
                    background: 'rgba(0,0,0,0.3)',
                    border: '1px dashed var(--primary-pink)',
                    borderRadius: '10px',
                    padding: '14px',
                    color: '#f0e6f5',
                    textAlign: 'center',
                    marginBottom: '12px',
                  }}
                >
                  <View style={{ fontSize: '10px', color: 'var(--text-pink)', marginBottom: '6px' }}>【模拟扫码】二维码内容</View>
                  {activeOrder.qrContent}
                </View>

                <View className="payment-meta">
                  <View style={{ fontWeight: 'bold', fontSize: '14px', color: 'white', marginBottom: '4px' }}>
                    扫码支付: ¥{activeOrder.order.amount} 元
                  </View>
                  <View>请使用{payChannel === 'wechat' ? '微信' : '支付宝'}扫码完成支付</View>
                  <View style={{ fontSize: '11px', color: 'var(--primary-pink)', marginTop: '4px' }}>
                    {orderStatus === 'paid'
                      ? '✅ 已检测到支付成功，正在到账...'
                      : orderStatus === 'timeout'
                        ? (activeOrder.simulatedCallback
                          ? '⏱️ 查询超时，如已支付请点击下方按钮确认。'
                          : '⏱️ 查询超时，如已完成支付，重新打开本页面即可刷新到账。')
                        : '🔄 正在等待支付结果，到账后会自动更新...'}
                  </View>
                </View>

                {/* Manual confirm replays the pre-signed callback — only possible
                    in demo mode. With a real gateway, the poll above detects
                    settlement automatically, so this button is hidden. */}
                {activeOrder.simulatedCallback && (
                  <View
                    onClick={isConfirmingPayment ? undefined : handleConfirmRealPayment}
                    className={`btn-primary payment-status-sim${isConfirmingPayment ? ' is-disabled' : ''}`}
                    style={{
                      padding: '10px',
                      width: '100%',
                      fontSize: '14px',
                      background: payChannel === 'wechat' ? '#22c55e' : '#3b82f6',
                      boxShadow: payChannel === 'wechat' ? '0 0 10px rgba(34,197,94,0.3)' : '0 0 10px rgba(59,130,246,0.3)'
                    }}
                  >
                    {isConfirmingPayment ? '正在确认到账...' : '我已完成支付'}
                  </View>
                )}

                <View
                  onClick={isConfirmingPayment ? undefined : stopScanFlow}
                  className={`btn-secondary${isConfirmingPayment ? ' is-disabled' : ''}`}
                  style={{ padding: '8px', width: '100%', fontSize: '12px', marginTop: '8px' }}
                >
                  取消扫码
                </View>
              </View>
            )}
          </View>
        )}

      </View>
    </View>
  );
}
