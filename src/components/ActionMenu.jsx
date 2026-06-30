import * as React from 'react';
import { useT } from '../i18n/index.js';

const { useState } = React;

export default function ActionMenu({
  tasks,
  claimTaskReward,
  openShop,
  openTipping,
  openWallet,
  openMemory,
  openTheme,
  openStory,
  openAuth,
  characterSkin = 'xiaoxi',
  onSwitchCharacter,
  checkinStreak = 0,
  accountBound = false,
  isInteractionLocked = false,
  claimingTaskIds = [],
  lastFailedAction,
  retryLastFailedAction,
  isRetryingFailedAction = false,
}) {
  const t = useT();
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
            <span><span className="coin-icon"></span> {t('tasks.reward', { reward: task.reward })}</span>
          </div>
        </div>

        {/* Task Action Button */}
        <div>
          {task.claimed ? (
            <button disabled className="task-btn">{t('tasks.claimed')}</button>
          ) : task.completed ? (
            <button onClick={() => claimTaskReward(task.id)} disabled={isClaiming || isInteractionLocked} className="task-btn" style={{
              background: 'linear-gradient(135deg, #4ade80 0%, #22c55e 100%)',
              color: 'white',
              borderColor: '#22c55e',
              animation: 'breathe 2s infinite'
            }}>
              {isClaiming ? t('tasks.claiming') : t('tasks.claim')}
            </button>
          ) : (
            <button disabled className="task-btn" style={{ opacity: 0.6 }}>{t('tasks.locked')}</button>
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
          <span>{t('actions.sectionTitle')}</span>
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
              {t('actions.rewardsPending', { count: pendingTaskCount })}
            </span>
          )}
        </div>

        {lastFailedAction?.kind === 'task-claim' && (
          <div className="action-retry-banner">
            <div className="action-retry-copy">
              <div className="action-retry-label">{t('actions.claimFailed')}</div>
              <div className="action-retry-preview">{lastFailedAction.label}</div>
            </div>
            <button
              type="button"
              className="btn-secondary action-retry-action"
              onClick={retryLastFailedAction}
              disabled={isInteractionLocked || isRetryingFailedAction}
            >
              {(isInteractionLocked || isRetryingFailedAction) ? t('common.retrying') : t('actions.retryClaim')}
            </button>
          </div>
        )}
        
        <div className="action-buttons">
          {/* Feed Shop Button */}
          <button onClick={() => openShop('food')} className="btn-secondary action-btn" disabled={isInteractionLocked}>
            <span className="action-icon">🍔</span>
            <span>{t('actions.feedShop')}</span>
          </button>

          {/* Gift Shop Button */}
          <button onClick={() => openShop('gift')} className="btn-secondary action-btn" disabled={isInteractionLocked}>
            <span className="action-icon">🎁</span>
            <span>{t('actions.giftShop')}</span>
          </button>

          {/* Tipping / Donation Button */}
          <button onClick={openTipping} className="btn-primary action-btn" disabled={isInteractionLocked}>
            <span className="action-icon" style={{ textShadow: 'none' }}>💝</span>
            <span>{t('actions.tip')}</span>
          </button>

          {/* Wallet / Transaction History Button */}
          <button onClick={openWallet} className="btn-secondary action-btn" disabled={isInteractionLocked}>
            <span className="action-icon">📒</span>
            <span>{t('actions.wallet')}</span>
          </button>

          {/* Memory Center Button */}
          <button onClick={openMemory} className="btn-secondary action-btn" disabled={isInteractionLocked}>
            <span className="action-icon">📔</span>
            <span>{t('actions.memory')}</span>
          </button>

          {/* Theme / Wardrobe Button */}
          <button onClick={openTheme} className="btn-secondary action-btn" disabled={isInteractionLocked}>
            <span className="action-icon">🎀</span>
            <span>{t('actions.theme')}</span>
          </button>

          {/* Story / 剧情 Button */}
          <button onClick={openStory} className="btn-secondary action-btn" disabled={isInteractionLocked}>
            <span className="action-icon">📖</span>
            <span>{t('actions.story')}</span>
          </button>

          {/* Character Skin Switch Button */}
          <button
            onClick={onSwitchCharacter}
            className="btn-secondary action-btn"
            title={characterSkin === 'xiaoxi' ? t('actions.switchXiaoyaTitle') : t('actions.switchXiaoxiTitle')}
          >
            <span className="action-icon">🧑‍🎨</span>
            <span>{characterSkin === 'xiaoxi' ? t('actions.switchToXiaoya') : t('actions.switchToXiaoxi')}</span>
          </button>

          {/* Account Center Button */}
          <button onClick={openAuth} className="btn-secondary action-btn" disabled={isInteractionLocked}>
            <span className="action-icon">{accountBound ? '💞' : '👤'}</span>
            <span>{accountBound ? t('actions.myAccount') : t('actions.loginRegister')}</span>
          </button>

          {/* Task List Toggle Button */}
          <button onClick={() => setShowTasks(!showTasks)} className={`btn-secondary action-btn ${showTasks ? 'active' : ''}`} disabled={isInteractionLocked} style={{
            borderColor: showTasks ? 'var(--primary-pink)' : '',
            color: showTasks ? 'var(--text-pink)' : ''
          }}>
            <span className="action-icon">📋</span>
            <span>{t('actions.taskList')}</span>
          </button>
        </div>
      </div>

      {/* Daily + Growth Tasks Expansion Card */}
      {showTasks && (
        <div className="daily-tasks-card">
          <div className="task-category-title">
            <span>{t('tasks.dailyTitle')}</span>
            {checkinStreak > 0 && (
              <span className="task-category-pill">{t('tasks.checkinStreak', { streak: checkinStreak })}</span>
            )}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {dailyTasks.map(renderTask)}
          </div>

          {growthTasks.length > 0 && (
            <>
              <div className="task-category-title">
                <span>{t('tasks.growthTitle')}</span>
                <span className="task-category-pill">{t('tasks.growthSub')}</span>
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
