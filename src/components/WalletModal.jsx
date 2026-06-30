import * as React from 'react';

const { useState, useMemo } = React;

const CATEGORY_META = {
  feed: { icon: '🍱', label: '喂食' },
  gift: { icon: '🎁', label: '送礼' },
  tip: { icon: '💝', label: '打赏/充值' },
  task_reward: { icon: '📋', label: '任务奖励' },
  checkin: { icon: '📅', label: '签到奖励' },
  refund: { icon: '↩️', label: '打赏退款' },
};

const TXN_FILTERS = [
  { key: 'all', label: '全部' },
  { key: 'earn', label: '收入' },
  { key: 'spend', label: '支出' },
];

function getCategoryMeta(category) {
  return CATEGORY_META[category] || { icon: '💰', label: '其他' };
}

const ORDER_STATUS = {
  created: { label: '待支付', color: 'var(--text-muted)' },
  pending: { label: '支付中', color: '#f6c945' },
  paid: { label: '已支付', color: '#4ade80' },
  failed: { label: '支付失败', color: '#ff7597' },
  refunded: { label: '已退款', color: 'var(--text-muted)' },
};
const PM_LABEL = { wechat: '微信支付', alipay: '支付宝' };
const PM_ICON = { wechat: '💚', alipay: '💙' };

export default function WalletModal({
  isOpen,
  onClose,
  coins,
  ownedThemes = [],
  transactions = [],
  isLoadingTransactions = false,
  loadTransactions,
  orders = [],
  isLoadingOrders = false,
  loadOrders,
}) {
  const [txnFilter, setTxnFilter] = useState('all');

  // Asset overview + income/expense totals are derived from the loaded ledger
  // (most recent slice), so label them as "近期". `useMemo` keeps the reduce off
  // every keystroke-free re-render. Hooks run before the early return below.
  const { recentEarned, recentSpent } = useMemo(() => {
    let earned = 0;
    let spent = 0;
    for (const txn of transactions) {
      if (txn.type === 'earn') earned += txn.amount;
      else if (txn.type === 'spend') spent += txn.amount;
    }
    return { recentEarned: earned, recentSpent: spent };
  }, [transactions]);

  const visibleTransactions = useMemo(
    () => (txnFilter === 'all' ? transactions : transactions.filter((t) => t.type === txnFilter)),
    [transactions, txnFilter]
  );

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
        <div style={{ textAlign: 'center', marginBottom: '12px' }}>
          <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '4px' }}>当前钱包余额</div>
          <div className="gold-glow-text" style={{ color: 'var(--accent-gold)', fontWeight: 'bold', fontSize: '22px' }}>
            <span className="coin-icon"></span> {coins} 爱心币
          </div>
        </div>

        {/* Asset overview */}
        <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
          {[
            { label: '拥有主题', value: `${ownedThemes.length} 款` },
            { label: '近期获得', value: `+${recentEarned}`, color: '#4ade80' },
            { label: '近期支出', value: `-${recentSpent}`, color: '#ff7597' },
          ].map((item) => (
            <div
              key={item.label}
              className="task-item"
              style={{ flex: 1, textAlign: 'center', padding: '8px 6px' }}
            >
              <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{item.label}</div>
              <div style={{ fontWeight: 'bold', fontSize: '15px', marginTop: '2px', color: item.color || 'var(--text-main)' }}>
                {item.value}
              </div>
            </div>
          ))}
        </div>

        {/* Refresh + category filter */}
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

        <div style={{ display: 'flex', gap: '6px', marginBottom: '10px' }}>
          {TXN_FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              className={txnFilter === f.key ? 'btn-primary' : 'btn-secondary'}
              onClick={() => setTxnFilter(f.key)}
              style={{ padding: '3px 14px', fontSize: '12px' }}
            >
              {f.label}
            </button>
          ))}
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
          ) : visibleTransactions.length === 0 ? (
            <div style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: '13px', padding: '24px 0' }}>
              当前筛选条件下没有记录。
            </div>
          ) : (
            visibleTransactions.map((txn) => {
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

        {/* Recharge / order history */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '18px 0 10px' }}>
          <div className="section-title" style={{ fontSize: '13px', margin: 0 }}>🧾 充值 / 订单记录</div>
          <button
            type="button"
            className="btn-secondary"
            onClick={loadOrders}
            disabled={isLoadingOrders}
            style={{ padding: '4px 12px', fontSize: '12px' }}
          >
            {isLoadingOrders ? '刷新中...' : '刷新'}
          </button>
        </div>

        <div style={{ maxHeight: '240px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {isLoadingOrders && orders.length === 0 ? (
            <div style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: '13px', padding: '24px 0' }}>
              正在加载订单...
            </div>
          ) : orders.length === 0 ? (
            <div style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: '13px', padding: '24px 0' }}>
              还没有充值订单，去给小希充值/打赏后就会出现在这里~
            </div>
          ) : (
            orders.map((order) => {
              const st = ORDER_STATUS[order.status] || { label: order.status, color: 'var(--text-muted)' };

              return (
                <div
                  key={order.id}
                  className="task-item"
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexGrow: 1, minWidth: 0 }}>
                    <span style={{ fontSize: '20px' }}>{PM_ICON[order.paymentMethod] || '💳'}</span>
                    <div style={{ minWidth: 0 }}>
                      <div className="task-name" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        充值 ¥{order.amount} · {order.coins} 爱心币
                      </div>
                      <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>
                        {PM_LABEL[order.paymentMethod] || order.paymentMethod} · {order.createdAt || '—'}
                      </div>
                    </div>
                  </div>

                  <div style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <div style={{ fontWeight: 'bold', fontSize: '13px', color: st.color }}>{st.label}</div>
                    <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>¥{order.amount}</div>
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
