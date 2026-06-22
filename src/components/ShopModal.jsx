import * as React from 'react';

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
      <button
        onClick={() => handlePurchase(item, type)}
        disabled={isModalBusy}
        className="btn-primary"
        style={{ padding: '6px 16px', fontSize: '13px', width: '100%' }}
      >
        {isCurrentPurchase ? '购买中...' : <><span className="coin-icon"></span> {item.cost} 购买</>}
      </button>
    );
  };

  // Mock QR Code SVG Generator for WeChat/Alipay
  const renderMockQR = () => {
    const color = payChannel === 'wechat' ? '#22c55e' : '#3b82f6';
    return (
      <svg width="140" height="140" viewBox="0 0 100 100" style={{ shapeRendering: 'crispEdges' }}>
        {/* Border / Markers */}
        <path d="M0,0 h30 v10 h-20 v20 h-10 z" fill={color} />
        <path d="M70,0 h30 v30 h-10 v-20 h-20 z" fill={color} />
        <path d="M0,70 h10 v20 h20 v10 h-30 z" fill={color} />
        <path d="M90,90 v-20 h10 v30 h-30 v-10 z" fill={color} />
        {/* Inner squares */}
        <rect x="5" y="5" width="10" height="10" fill={color} />
        <rect x="85" y="5" width="10" height="10" fill={color} />
        <rect x="5" y="85" width="10" height="10" fill={color} />
        {/* Random QR pixels */}
        <path d="M25,10 h5 v5 h-5 z M40,5 h10 v5 h-10 z M60,10 h5 v10 h-5 z M45,20 h10 v5 h-10 z M15,35 h5 v15 h-5 z M30,30 h15 v5 h-15 z M65,35 h15 v5 h-15 z M85,45 h5 v15 h-5 z" fill="#333" />
        <path d="M20,60 h10 v5 h-10 z M45,55 h5 v15 h-5 z M60,60 h15 v5 h-15 z M75,50 h10 v5 h-10 z M30,75 h10 v5 h-10 z M55,80 h15 v5 h-15 z M75,85 h10 v5 h-10 z M50,85 h5 v5 h-5 z" fill="#333" />
        {/* Center icon placeholder */}
        <rect x="40" y="40" width="20" height="20" rx="4" fill={color} opacity="0.9" />
        <text x="50" y="54" fontSize="12" fontWeight="bold" textAnchor="middle" fill="white">❤</text>
      </svg>
    );
  };

  return (
    <div className="modal-overlay" onClick={handleRequestClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        
        {/* Modal Header */}
        <div className="modal-header">
          <div className="modal-title">
            {mode === 'shop' ? (
              <><span>🏪</span><span>小希专属商店 (Love Shop)</span></>
            ) : (
              <><span>💝</span><span>在线打赏小希 (Support Xiaoxi)</span></>
            )}
          </div>
          <button className="close-btn" onClick={handleRequestClose} disabled={isModalBusy}>&times;</button>
        </div>

        {/* SHOP MODE */}
        {mode === 'shop' && (
          <div>
            {lastFailedAction && (lastFailedAction.kind === 'food' || lastFailedAction.kind === 'gift') && (
              <div className="shop-retry-banner">
                <div className="shop-retry-copy">
                  <div className="shop-retry-label">上一次购买失败</div>
                  <div className="shop-retry-preview">{lastFailedAction.label}</div>
                </div>
                <button
                  type="button"
                  className="btn-secondary shop-retry-action"
                  onClick={retryLastFailedAction}
                  disabled={isModalBusy}
                >
                  {isModalBusy ? '重试中...' : '重试购买'}
                </button>
              </div>
            )}

            {/* Shop Category Tabs */}
            <div style={{ display: 'flex', gap: '10px', marginBottom: '20px' }}>
              <button
                onClick={() => setActiveTab('food')}
                disabled={isModalBusy}
                className={`btn-secondary`}
                style={{
                  flex: 1,
                  padding: '8px',
                  background: activeTab === 'food' ? 'rgba(255, 117, 151, 0.15)' : '',
                  borderColor: activeTab === 'food' ? 'var(--primary-pink)' : '',
                  color: activeTab === 'food' ? 'var(--text-pink)' : ''
                }}
              >
                🍜 喂食面板 (Food)
              </button>
              <button
                onClick={() => setActiveTab('gift')}
                disabled={isModalBusy}
                className={`btn-secondary`}
                style={{
                  flex: 1,
                  padding: '8px',
                  background: activeTab === 'gift' ? 'rgba(255, 117, 151, 0.15)' : '',
                  borderColor: activeTab === 'gift' ? 'var(--primary-pink)' : '',
                  color: activeTab === 'gift' ? 'var(--text-pink)' : ''
                }}
              >
                🎁 精美礼物 (Gifts)
              </button>
            </div>

            {/* Shop Grid */}
            <div className="shop-grid">
              {currentItems.map(item => {
                const isFood = activeTab === 'food';

                return (
                  <div key={item.id} className="shop-item">
                    <span className="shop-item-icon">{item.icon}</span>
                    <div className="shop-item-name">{item.name}</div>
                    <div className="shop-item-desc">{item.desc}</div>

                    <div style={{ display: 'flex', gap: '10px', fontSize: '11px', color: 'var(--text-muted)', marginBottom: '10px' }}>
                      {isFood ? (
                        <>
                          <span>⚡+{item.energy} 体力</span>
                          <span>❤️+{item.affection} 好感</span>
                        </>
                      ) : (
                        <>
                          <span>🎭+{item.mood} 心情</span>
                          <span>❤️+{item.affection} 好感</span>
                        </>
                      )}
                    </div>

                    {renderPurchaseButton(item, isFood ? 'food' : 'gift')}
                  </div>
                );
              })}
            </div>
            
            {/* Wallet Info */}
            <div style={{ textAlign: 'center', fontSize: '13px', color: 'var(--text-muted)' }}>
              当前钱包余额: <span className="gold-glow-text" style={{ color: 'var(--accent-gold)', fontWeight: 'bold' }}><span className="coin-icon"></span> {coins} 爱心币</span>
            </div>
          </div>
        )}

        {/* TIPPING MODE */}
        {mode === 'tipping' && (
          <div>
            {lastFailedAction?.kind === 'tip' && (
              <div className="shop-retry-banner">
                <div className="shop-retry-copy">
                  <div className="shop-retry-label">上一次打赏失败</div>
                  <div className="shop-retry-preview">{lastFailedAction.label}</div>
                </div>
                <button
                  type="button"
                  className="btn-secondary shop-retry-action"
                  onClick={retryLastFailedAction}
                  disabled={isModalBusy}
                >
                  {isModalBusy ? '重试中...' : '重试打赏'}
                </button>
              </div>
            )}

            {!isScanning && (
              <>
                {/* Presets Grid */}
                <div className="tipping-options">
                  {TIPPING_TIERS.map((tier, idx) => (
                    <button
                      key={idx}
                      onClick={() => setSelectedTip(tier)}
                      disabled={isModalBusy}
                      className={`tip-option-btn ${selectedTip.amount === tier.amount ? 'active' : ''}`}
                    >
                      <div className="tip-option-amount">¥{tier.amount}</div>
                      <div className="tip-option-label">{tier.label}</div>
                      <div style={{ fontSize: '10px', color: 'var(--accent-gold)', marginTop: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <span className="coin-icon"></span>+{tier.coins}
                      </div>
                    </button>
                  ))}
                </div>

                {/* Payment Channel Selector */}
                <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '15px' }}>
                  <div className="payment-channel-selector">
                    <button
                      onClick={() => setPayChannel('wechat')}
                      disabled={isModalBusy}
                      className={`pay-channel-btn ${payChannel === 'wechat' ? 'active wechat' : ''}`}
                    >
                      🟢 微信支付 (WeChat)
                    </button>
                    <button
                      onClick={() => setPayChannel('alipay')}
                      disabled={isModalBusy}
                      className={`pay-channel-btn ${payChannel === 'alipay' ? 'active alipay' : ''}`}
                    >
                      🔵 支付宝 (Alipay)
                    </button>
                  </div>
                </div>

                {/* QR Code Scan Area */}
                <div className="payment-qr-container">
                  <div className="payment-qr-wrapper">
                    {renderMockQR()}
                  </div>

                  <div className="payment-meta">
                    <div style={{ fontWeight: 'bold', fontSize: '14px', color: 'white', marginBottom: '4px' }}>
                      扫码打赏: ¥{selectedTip.amount} 元
                    </div>
                    <div>{selectedTip.desc}</div>
                    <div style={{ fontSize: '11px', color: 'var(--primary-pink)', marginTop: '4px' }}>
                      {allowSimulatedPayment
                        ? '【模拟支付】扫码或直接点击下方按钮完成'
                        : '扫码完成支付，或点击下方按钮创建订单'}
                    </div>
                  </div>

                  {/* Instant-settle shortcut — demo only. Hidden when simulated
                      payment is off, since /api/action/tip would return 403. */}
                  {allowSimulatedPayment && (
                    <button
                      onClick={handleMockPay}
                      disabled={isModalBusy}
                      className="btn-primary payment-status-sim"
                      style={{
                        padding: '10px',
                        width: '100%',
                        fontSize: '14px',
                        background: payChannel === 'wechat' ? '#22c55e' : '#3b82f6',
                        boxShadow: payChannel === 'wechat' ? '0 0 10px rgba(34,197,94,0.3)' : '0 0 10px rgba(59,130,246,0.3)'
                      }}
                    >
                      {(isProcessing || isTipping) ? '🔄 正在建立安全加密链接...' : `点击确认支付 ¥${selectedTip.amount} 元`}
                    </button>
                  )}

                  {/* Real scan-to-pay entry: drives the actual order链路. Primary
                      style when it is the only available payment path. */}
                  <button
                    onClick={handleStartRealPayment}
                    disabled={isModalBusy}
                    className={allowSimulatedPayment ? 'btn-secondary' : 'btn-primary'}
                    style={{ padding: '10px', width: '100%', fontSize: '13px', marginTop: allowSimulatedPayment ? '10px' : '0' }}
                  >
                    {isCreatingOrder ? '正在生成订单...' : '📷 真实扫码支付 (创建订单)'}
                  </button>
                </div>
              </>
            )}

            {/* Real scan-to-pay state: QR placeholder + polling + confirm */}
            {isScanning && (
              <div className="payment-qr-container">
                <div
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
                  <div style={{ fontSize: '10px', color: 'var(--text-pink)', marginBottom: '6px' }}>【模拟扫码】二维码内容</div>
                  {activeOrder.qrContent}
                </div>

                <div className="payment-meta">
                  <div style={{ fontWeight: 'bold', fontSize: '14px', color: 'white', marginBottom: '4px' }}>
                    扫码支付: ¥{activeOrder.order.amount} 元
                  </div>
                  <div>请使用{payChannel === 'wechat' ? '微信' : '支付宝'}扫码完成支付</div>
                  <div style={{ fontSize: '11px', color: 'var(--primary-pink)', marginTop: '4px' }}>
                    {orderStatus === 'paid'
                      ? '✅ 已检测到支付成功，正在到账...'
                      : orderStatus === 'timeout'
                        ? (activeOrder.simulatedCallback
                          ? '⏱️ 查询超时，如已支付请点击下方按钮确认。'
                          : '⏱️ 查询超时，如已完成支付，重新打开本页面即可刷新到账。')
                        : '🔄 正在等待支付结果，到账后会自动更新...'}
                  </div>
                </div>

                {/* Manual confirm replays the pre-signed callback — only possible
                    in demo mode. With a real gateway, the poll above detects
                    settlement automatically, so this button is hidden. */}
                {activeOrder.simulatedCallback && (
                  <button
                    onClick={handleConfirmRealPayment}
                    disabled={isConfirmingPayment}
                    className="btn-primary payment-status-sim"
                    style={{
                      padding: '10px',
                      width: '100%',
                      fontSize: '14px',
                      background: payChannel === 'wechat' ? '#22c55e' : '#3b82f6',
                      boxShadow: payChannel === 'wechat' ? '0 0 10px rgba(34,197,94,0.3)' : '0 0 10px rgba(59,130,246,0.3)'
                    }}
                  >
                    {isConfirmingPayment ? '正在确认到账...' : '我已完成支付'}
                  </button>
                )}

                <button
                  onClick={stopScanFlow}
                  disabled={isConfirmingPayment}
                  className="btn-secondary"
                  style={{ padding: '8px', width: '100%', fontSize: '12px', marginTop: '8px' }}
                >
                  取消扫码
                </button>
              </div>
            )}
          </div>
        )}

      </div>
    </div>
  );
}
