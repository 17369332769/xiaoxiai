import React, { useState } from 'react';

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
  tipXiaoxi
}) {
  const [activeTab, setActiveTab] = useState(shopType || 'food');
  const [selectedTip, setSelectedTip] = useState(TIPPING_TIERS[0]);
  const [payChannel, setPayChannel] = useState('wechat'); // 'wechat' or 'alipay'
  const [isProcessing, setIsProcessing] = useState(false);

  if (!isOpen) return null;

  // Handle purchasing food/gift items
  const handlePurchase = (item, type) => {
    if (coins < item.cost) {
      alert('你的爱心币不足，快去和小希对话做任务，或者打赏小希获得爱心币吧！');
      return;
    }
    
    if (type === 'food') {
      const success = feedXiaoxi(item.id);
      if (success) onClose();
    } else {
      const success = giftXiaoxi(item.id);
      if (success) onClose();
    }
  };

  // Handle mock payment action
  const handleMockPay = () => {
    setIsProcessing(true);
    setTimeout(() => {
      setIsProcessing(false);
      tipXiaoxi(selectedTip.amount, payChannel);
      onClose();
    }, 1500); // Simulated delay
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
    <div className="modal-overlay" onClick={onClose}>
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
          <button className="close-btn" onClick={onClose}>&times;</button>
        </div>

        {/* SHOP MODE */}
        {mode === 'shop' && (
          <div>
            {/* Shop Category Tabs */}
            <div style={{ display: 'flex', gap: '10px', marginBottom: '20px' }}>
              <button
                onClick={() => setActiveTab('food')}
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
              {activeTab === 'food' ? (
                FOOD_ITEMS.map(item => (
                  <div key={item.id} className="shop-item">
                    <span className="shop-item-icon">{item.icon}</span>
                    <div className="shop-item-name">{item.name}</div>
                    <div className="shop-item-desc">{item.desc}</div>
                    
                    <div style={{ display: 'flex', gap: '10px', fontSize: '11px', color: 'var(--text-muted)', marginBottom: '10px' }}>
                      <span>⚡+{item.energy} 体力</span>
                      <span>❤️+{item.affection} 好感</span>
                    </div>

                    <button
                      onClick={() => handlePurchase(item, 'food')}
                      className="btn-primary"
                      style={{ padding: '6px 16px', fontSize: '13px', width: '100%' }}
                    >
                      <span className="coin-icon"></span> {item.cost} 购买
                    </button>
                  </div>
                ))
              ) : (
                GIFT_ITEMS.map(item => (
                  <div key={item.id} className="shop-item">
                    <span className="shop-item-icon">{item.icon}</span>
                    <div className="shop-item-name">{item.name}</div>
                    <div className="shop-item-desc">{item.desc}</div>
                    
                    <div style={{ display: 'flex', gap: '10px', fontSize: '11px', color: 'var(--text-muted)', marginBottom: '10px' }}>
                      <span>🎭+{item.mood} 心情</span>
                      <span>❤️+{item.affection} 好感</span>
                    </div>

                    <button
                      onClick={() => handlePurchase(item, 'gift')}
                      className="btn-primary"
                      style={{ padding: '6px 16px', fontSize: '13px', width: '100%' }}
                    >
                      <span className="coin-icon"></span> {item.cost} 购买
                    </button>
                  </div>
                ))
              )}
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
            {/* Presets Grid */}
            <div className="tipping-options">
              {TIPPING_TIERS.map((tier, idx) => (
                <button
                  key={idx}
                  onClick={() => setSelectedTip(tier)}
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
                  className={`pay-channel-btn ${payChannel === 'wechat' ? 'active wechat' : ''}`}
                >
                  🟢 微信支付 (WeChat)
                </button>
                <button
                  onClick={() => setPayChannel('alipay')}
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
                  【模拟支付】扫码或直接点击下方按钮完成
                </div>
              </div>

              {/* Action Button */}
              <button
                onClick={handleMockPay}
                disabled={isProcessing}
                className="btn-primary payment-status-sim"
                style={{
                  padding: '10px',
                  width: '100%',
                  fontSize: '14px',
                  background: payChannel === 'wechat' ? '#22c55e' : '#3b82f6',
                  boxShadow: payChannel === 'wechat' ? '0 0 10px rgba(34,197,94,0.3)' : '0 0 10px rgba(59,130,246,0.3)'
                }}
              >
                {isProcessing ? '🔄 正在建立安全加密链接...' : `点击确认支付 ¥${selectedTip.amount} 元`}
              </button>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
