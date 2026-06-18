const CATEGORY_META = {
  feed: { icon: '🍱', label: '喂食' },
  gift: { icon: '🎁', label: '送礼' },
  tip: { icon: '💝', label: '打赏/充值' },
  task_reward: { icon: '📋', label: '任务奖励' },
  checkin: { icon: '📅', label: '签到奖励' },
  refund: { icon: '↩️', label: '打赏退款' },
};

function getCategoryMeta(category) {
  return CATEGORY_META[category] || { icon: '💰', label: '其他' };
}

export default function WalletModal({
  isOpen,
  onClose,
  coins,
  transactions = [],
  isLoadingTransactions = false,
  loadTransactions,
}) {
  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>

        {/* Modal Header */}
        <div className="modal-header">
          <div className="modal-title">
            <span>📒</span><span>我的钱包 · 消费记录 (Wallet)</span>
          </div>
          <button className="close-btn" onClick={onClose}>&times;</button>
        </div>

        {/* Current Balance */}
        <div style={{ textAlign: 'center', marginBottom: '16px' }}>
          <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '4px' }}>当前钱包余额</div>
          <div className="gold-glow-text" style={{ color: 'var(--accent-gold)', fontWeight: 'bold', fontSize: '22px' }}>
            <span className="coin-icon"></span> {coins} 爱心币
          </div>
        </div>

        {/* Refresh */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
          <div className="section-title" style={{ fontSize: '13px', margin: 0 }}>📊 最近账单明细</div>
          <button
            type="button"
            className="btn-secondary"
            onClick={loadTransactions}
            disabled={isLoadingTransactions}
            style={{ padding: '4px 12px', fontSize: '12px' }}
          >
            {isLoadingTransactions ? '刷新中...' : '刷新'}
          </button>
        </div>

        {/* Transaction List */}
        <div style={{ maxHeight: '320px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {isLoadingTransactions && transactions.length === 0 ? (
            <div style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: '13px', padding: '24px 0' }}>
              正在加载账单...
            </div>
          ) : transactions.length === 0 ? (
            <div style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: '13px', padding: '24px 0' }}>
              还没有任何爱心币流水，去聊天、做任务或送礼互动一下吧~
            </div>
          ) : (
            transactions.map((txn) => {
              const meta = getCategoryMeta(txn.category);
              const isEarn = txn.type === 'earn';

              return (
                <div
                  key={txn.id}
                  className="task-item"
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexGrow: 1, minWidth: 0 }}>
                    <span style={{ fontSize: '20px' }}>{meta.icon}</span>
                    <div style={{ minWidth: 0 }}>
                      <div className="task-name" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {txn.description || meta.label}
                      </div>
                      <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>
                        {meta.label} · {txn.timestamp}
                      </div>
                    </div>
                  </div>

                  <div style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <div style={{ fontWeight: 'bold', fontSize: '14px', color: isEarn ? '#4ade80' : '#ff7597' }}>
                      {isEarn ? '+' : '-'}{txn.amount}
                    </div>
                    <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>
                      余额 {txn.balance}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

      </div>
    </div>
  );
}
