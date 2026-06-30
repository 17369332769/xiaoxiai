import { View, Text } from '@tarojs/components';

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
  transactions = [],
  isLoadingTransactions = false,
  loadTransactions,
  orders = [],
  isLoadingOrders = false,
  loadOrders,
}) {
  if (!isOpen) return null;

  return (
    <View className="modal-overlay" onClick={onClose}>
      <View className="modal-content" onClick={(e) => e.stopPropagation()}>

        {/* Modal Header */}
        <View className="modal-header">
          <View className="modal-title">
            <Text>📒</Text><Text>我的钱包 · 消费记录 (Wallet)</Text>
          </View>
          <View className="close-btn" onClick={onClose}>×</View>
        </View>

        {/* Current Balance */}
        <View style={{ textAlign: 'center', marginBottom: '16px' }}>
          <View style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '4px' }}>当前钱包余额</View>
          <View className="gold-glow-text" style={{ color: 'var(--accent-gold)', fontWeight: 'bold', fontSize: '22px' }}>
            <Text className="coin-icon"></Text> {coins} 爱心币
          </View>
        </View>

        {/* Refresh */}
        <View style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
          <View className="section-title" style={{ fontSize: '13px', margin: 0 }}>📊 最近账单明细</View>
          <View
            className={`btn-secondary${isLoadingTransactions ? ' is-disabled' : ''}`}
            onClick={isLoadingTransactions ? undefined : loadTransactions}
            style={{ padding: '4px 12px', fontSize: '12px' }}
          >
            {isLoadingTransactions ? '刷新中...' : '刷新'}
          </View>
        </View>

        {/* Transaction List */}
        <View style={{ maxHeight: '320px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {isLoadingTransactions && transactions.length === 0 ? (
            <View style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: '13px', padding: '24px 0' }}>
              正在加载账单...
            </View>
          ) : transactions.length === 0 ? (
            <View style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: '13px', padding: '24px 0' }}>
              还没有任何爱心币流水，去聊天、做任务或送礼互动一下吧~
            </View>
          ) : (
            transactions.map((txn) => {
              const meta = getCategoryMeta(txn.category);
              const isEarn = txn.type === 'earn';

              return (
                <View
                  key={txn.id}
                  className="task-item"
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}
                >
                  <View style={{ display: 'flex', alignItems: 'center', gap: '10px', flexGrow: 1, minWidth: 0 }}>
                    <Text style={{ fontSize: '20px' }}>{meta.icon}</Text>
                    <View style={{ minWidth: 0 }}>
                      <View className="task-name" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {txn.description || meta.label}
                      </View>
                      <View style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>
                        {meta.label} · {txn.timestamp}
                      </View>
                    </View>
                  </View>

                  <View style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <View style={{ fontWeight: 'bold', fontSize: '14px', color: isEarn ? '#4ade80' : '#ff7597' }}>
                      {isEarn ? '+' : '-'}{txn.amount}
                    </View>
                    <View style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>
                      余额 {txn.balance}
                    </View>
                  </View>
                </View>
              );
            })
          )}
        </View>

        {/* Recharge / order history */}
        <View style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '18px 0 10px' }}>
          <View className="section-title" style={{ fontSize: '13px', margin: 0 }}>🧾 充值 / 订单记录</View>
          <View
            className={`btn-secondary${isLoadingOrders ? ' is-disabled' : ''}`}
            onClick={isLoadingOrders ? undefined : loadOrders}
            style={{ padding: '4px 12px', fontSize: '12px' }}
          >
            {isLoadingOrders ? '刷新中...' : '刷新'}
          </View>
        </View>

        <View style={{ maxHeight: '240px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {isLoadingOrders && orders.length === 0 ? (
            <View style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: '13px', padding: '24px 0' }}>
              正在加载订单...
            </View>
          ) : orders.length === 0 ? (
            <View style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: '13px', padding: '24px 0' }}>
              还没有充值订单，去给小希充值/打赏后就会出现在这里~
            </View>
          ) : (
            orders.map((order) => {
              const st = ORDER_STATUS[order.status] || { label: order.status, color: 'var(--text-muted)' };

              return (
                <View
                  key={order.id}
                  className="task-item"
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}
                >
                  <View style={{ display: 'flex', alignItems: 'center', gap: '10px', flexGrow: 1, minWidth: 0 }}>
                    <Text style={{ fontSize: '20px' }}>{PM_ICON[order.paymentMethod] || '💳'}</Text>
                    <View style={{ minWidth: 0 }}>
                      <View className="task-name" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        充值 ¥{order.amount} · {order.coins} 爱心币
                      </View>
                      <View style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>
                        {PM_LABEL[order.paymentMethod] || order.paymentMethod} · {order.createdAt || '—'}
                      </View>
                    </View>
                  </View>

                  <View style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <View style={{ fontWeight: 'bold', fontSize: '13px', color: st.color }}>{st.label}</View>
                    <View style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>¥{order.amount}</View>
                  </View>
                </View>
              );
            })
          )}
        </View>

      </View>
    </View>
  );
}
