import * as React from 'react';

const { useState } = React;

export default function ActionMenu({
  tasks,
  claimTaskReward,
  openShop,
  openTipping,
  openWallet,
  openMemory,
  openTheme,
  openAuth,
  checkinStreak = 0,
  accountBound = false,
  isInteractionLocked = false,
  claimingTaskIds = [],
  lastFailedAction,
  retryLastFailedAction,
  isRetryingFailedAction = false,
}) {
  const [showTasks, setShowTasks] = useState(false);

  // Check if there are any unclaimed completed tasks
  const pendingTaskCount = tasks.filter(t => t.completed && !t.claimed).length;
  const dailyTasks = tasks.filter(t => (t.category || 'daily') === 'daily');
  const growthTasks = tasks.filter(t => t.category === 'growth');

  const renderTask = (task) => {
    const percent = Math.min(100, (task.progress / task.target) * 100);
    const isClaiming = claimingTaskIds.includes(task.id);

    return (
      <div key={task.id} className="task-item">
        <div className="task-info" style={{ flexGrow: 1, marginRight: '15px' }}>
          <div className="task-name">{task.name}</div>

          {/* Task Progress Bar */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '4px' }}>
            <div style={{
              flexGrow: 1,
              height: '6px',
              background: 'rgba(0,0,0,0.3)',
              borderRadius: '3px',
              overflow: 'hidden'
            }}>
              <div style={{
                height: '100%',
                width: `${percent}%`,
                background: task.completed ? 'var(--accent-cyan)' : 'var(--primary-pink)',
                borderRadius: '3px',
                transition: 'width 0.3s'
              }}></div>
            </div>
            <span style={{ fontSize: '11px', color: 'var(--text-muted)', minWidth: '30px' }}>
              {task.progress}/{task.target}
            </span>
          </div>

          <div className="task-reward">
            <span><span className="coin-icon"></span> +{task.reward} 爱心币</span>
          </div>
        </div>

        {/* Task Action Button */}
        <div>
          {task.claimed ? (
            <button disabled className="task-btn">已领完</button>
          ) : task.completed ? (
            <button onClick={() => claimTaskReward(task.id)} disabled={isClaiming || isInteractionLocked} className="task-btn" style={{
              background: 'linear-gradient(135deg, #4ade80 0%, #22c55e 100%)',
              color: 'white',
              borderColor: '#22c55e',
              animation: 'breathe 2s infinite'
            }}>
              {isClaiming ? '领奖中...' : '领奖励'}
            </button>
          ) : (
            <button disabled className="task-btn" style={{ opacity: 0.6 }}>未达成</button>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="glass-panel actions-container">
      {/* Quick Action Navigation */}
      <div>
        <div className="section-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>💖 互动与培养 (Interaction & Play)</span>
          {pendingTaskCount > 0 && (
            <span style={{
              background: '#ff477e',
              color: 'white',
              fontSize: '11px',
              padding: '2px 8px',
              borderRadius: '10px',
              fontWeight: 'bold',
              animation: 'breathe 1.5s infinite'
            }}>
              {pendingTaskCount} 个奖励待领
            </span>
          )}
        </div>

        {lastFailedAction?.kind === 'task-claim' && (
          <div className="action-retry-banner">
            <div className="action-retry-copy">
              <div className="action-retry-label">上一次领奖失败</div>
              <div className="action-retry-preview">{lastFailedAction.label}</div>
            </div>
            <button
              type="button"
              className="btn-secondary action-retry-action"
              onClick={retryLastFailedAction}
              disabled={isInteractionLocked || isRetryingFailedAction}
            >
              {(isInteractionLocked || isRetryingFailedAction) ? '重试中...' : '重试领奖'}
            </button>
          </div>
        )}
        
        <div className="action-buttons">
          {/* Feed Shop Button */}
          <button onClick={() => openShop('food')} className="btn-secondary action-btn" disabled={isInteractionLocked}>
            <span className="action-icon">🍔</span>
            <span>喂食商店</span>
          </button>

          {/* Gift Shop Button */}
          <button onClick={() => openShop('gift')} className="btn-secondary action-btn" disabled={isInteractionLocked}>
            <span className="action-icon">🎁</span>
            <span>送礼商店</span>
          </button>

          {/* Tipping / Donation Button */}
          <button onClick={openTipping} className="btn-primary action-btn" disabled={isInteractionLocked}>
            <span className="action-icon" style={{ textShadow: 'none' }}>💝</span>
            <span>在线打赏</span>
          </button>

          {/* Wallet / Transaction History Button */}
          <button onClick={openWallet} className="btn-secondary action-btn" disabled={isInteractionLocked}>
            <span className="action-icon">📒</span>
            <span>消费记录</span>
          </button>

          {/* Memory Center Button */}
          <button onClick={openMemory} className="btn-secondary action-btn" disabled={isInteractionLocked}>
            <span className="action-icon">📔</span>
            <span>小希的记忆</span>
          </button>

          {/* Theme / Wardrobe Button */}
          <button onClick={openTheme} className="btn-secondary action-btn" disabled={isInteractionLocked}>
            <span className="action-icon">🎀</span>
            <span>形象换装</span>
          </button>

          {/* Account Center Button */}
          <button onClick={openAuth} className="btn-secondary action-btn" disabled={isInteractionLocked}>
            <span className="action-icon">{accountBound ? '💞' : '👤'}</span>
            <span>{accountBound ? '我的账号' : '登录/注册'}</span>
          </button>

          {/* Task List Toggle Button */}
          <button onClick={() => setShowTasks(!showTasks)} className={`btn-secondary action-btn ${showTasks ? 'active' : ''}`} disabled={isInteractionLocked} style={{
            borderColor: showTasks ? 'var(--primary-pink)' : '',
            color: showTasks ? 'var(--text-pink)' : ''
          }}>
            <span className="action-icon">📋</span>
            <span>任务清单</span>
          </button>
        </div>
      </div>

      {/* Daily + Growth Tasks Expansion Card */}
      {showTasks && (
        <div className="daily-tasks-card">
          <div className="task-category-title">
            <span>📅 今日日常任务 (Daily)</span>
            {checkinStreak > 0 && (
              <span className="task-category-pill">🔥 连续签到 {checkinStreak} 天</span>
            )}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {dailyTasks.map(renderTask)}
          </div>

          {growthTasks.length > 0 && (
            <>
              <div className="task-category-title">
                <span>🌱 成长成就任务 (Growth)</span>
                <span className="task-category-pill">长期累计 · 不重置</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {growthTasks.map(renderTask)}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
