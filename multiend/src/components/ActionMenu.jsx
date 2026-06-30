import * as React from 'react';
import { View, Text } from '@tarojs/components';
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
    const completedDisabled = isClaiming || isInteractionLocked;

    return (
      <View key={task.id} className="task-item">
        <View className="task-info" style={{ flexGrow: 1, marginRight: '15px' }}>
          <View className="task-name">{task.name}</View>

          {/* Task Progress Bar */}
          <View style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '4px' }}>
            <View style={{
              flexGrow: 1,
              height: '6px',
              background: 'rgba(0,0,0,0.3)',
              borderRadius: '3px',
              overflow: 'hidden'
            }}>
              <View style={{
                height: '100%',
                width: `${percent}%`,
                background: task.completed ? 'var(--accent-cyan)' : 'var(--primary-pink)',
                borderRadius: '3px',
                transition: 'width 0.3s'
              }}></View>
            </View>
            <Text style={{ fontSize: '11px', color: 'var(--text-muted)', minWidth: '30px' }}>
              {task.progress}/{task.target}
            </Text>
          </View>

          <View className="task-reward">
            <Text><Text className="coin-icon"></Text> {t('tasks.reward', { reward: task.reward })}</Text>
          </View>
        </View>

        {/* Task Action Button */}
        <View>
          {task.claimed ? (
            <View className="task-btn disabled">{t('tasks.claimed')}</View>
          ) : task.completed ? (
            <View
              onClick={completedDisabled ? undefined : () => claimTaskReward(task.id)}
              className={`task-btn ${completedDisabled ? 'disabled' : ''}`}
              style={{
                background: 'linear-gradient(135deg, #4ade80 0%, #22c55e 100%)',
                color: 'white',
                borderColor: '#22c55e',
                animation: 'breathe 2s infinite'
              }}
            >
              {isClaiming ? t('tasks.claiming') : t('tasks.claim')}
            </View>
          ) : (
            <View className="task-btn disabled" style={{ opacity: 0.6 }}>{t('tasks.locked')}</View>
          )}
        </View>
      </View>
    );
  };

  return (
    <View className="glass-panel actions-container">
      {/* Quick Action Navigation */}
      <View>
        <View className="section-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text>{t('actions.sectionTitle')}</Text>
          {pendingTaskCount > 0 && (
            <Text style={{
              background: '#ff477e',
              color: 'white',
              fontSize: '11px',
              padding: '2px 8px',
              borderRadius: '10px',
              fontWeight: 'bold',
              animation: 'breathe 1.5s infinite'
            }}>
              {t('actions.rewardsPending', { count: pendingTaskCount })}
            </Text>
          )}
        </View>

        {lastFailedAction?.kind === 'task-claim' && (
          <View className="action-retry-banner">
            <View className="action-retry-copy">
              <View className="action-retry-label">{t('actions.claimFailed')}</View>
              <View className="action-retry-preview">{lastFailedAction.label}</View>
            </View>
            <View
              className={`btn-secondary action-retry-action ${(isInteractionLocked || isRetryingFailedAction) ? 'disabled' : ''}`}
              onClick={(isInteractionLocked || isRetryingFailedAction) ? undefined : retryLastFailedAction}
            >
              {(isInteractionLocked || isRetryingFailedAction) ? t('common.retrying') : t('actions.retryClaim')}
            </View>
          </View>
        )}

        <View className="action-buttons">
          {/* Feed Shop Button */}
          <View
            onClick={isInteractionLocked ? undefined : () => openShop('food')}
            className={`btn-secondary action-btn ${isInteractionLocked ? 'disabled' : ''}`}
          >
            <Text className="action-icon">🍔</Text>
            <Text>{t('actions.feedShop')}</Text>
          </View>

          {/* Gift Shop Button */}
          <View
            onClick={isInteractionLocked ? undefined : () => openShop('gift')}
            className={`btn-secondary action-btn ${isInteractionLocked ? 'disabled' : ''}`}
          >
            <Text className="action-icon">🎁</Text>
            <Text>{t('actions.giftShop')}</Text>
          </View>

          {/* Tipping / Donation Button */}
          <View
            onClick={isInteractionLocked ? undefined : openTipping}
            className={`btn-primary action-btn ${isInteractionLocked ? 'disabled' : ''}`}
          >
            <Text className="action-icon" style={{ textShadow: 'none' }}>💝</Text>
            <Text>{t('actions.tip')}</Text>
          </View>

          {/* Wallet / Transaction History Button */}
          <View
            onClick={isInteractionLocked ? undefined : openWallet}
            className={`btn-secondary action-btn ${isInteractionLocked ? 'disabled' : ''}`}
          >
            <Text className="action-icon">📒</Text>
            <Text>{t('actions.wallet')}</Text>
          </View>

          {/* Memory Center Button */}
          <View
            onClick={isInteractionLocked ? undefined : openMemory}
            className={`btn-secondary action-btn ${isInteractionLocked ? 'disabled' : ''}`}
          >
            <Text className="action-icon">📔</Text>
            <Text>{t('actions.memory')}</Text>
          </View>

          {/* Theme / Wardrobe Button */}
          <View
            onClick={isInteractionLocked ? undefined : openTheme}
            className={`btn-secondary action-btn ${isInteractionLocked ? 'disabled' : ''}`}
          >
            <Text className="action-icon">🎀</Text>
            <Text>{t('actions.theme')}</Text>
          </View>

          {/* Story / 剧情 Button */}
          <View
            onClick={isInteractionLocked ? undefined : openStory}
            className={`btn-secondary action-btn ${isInteractionLocked ? 'disabled' : ''}`}
          >
            <Text className="action-icon">📖</Text>
            <Text>{t('actions.story')}</Text>
          </View>

          {/* Character Skin Switch Button */}
          <View
            onClick={onSwitchCharacter}
            className="btn-secondary action-btn"
            title={characterSkin === 'xiaoxi' ? t('actions.switchXiaoyaTitle') : t('actions.switchXiaoxiTitle')}
          >
            <Text className="action-icon">🧑‍🎨</Text>
            <Text>{characterSkin === 'xiaoxi' ? t('actions.switchToXiaoya') : t('actions.switchToXiaoxi')}</Text>
          </View>

          {/* Account Center Button */}
          <View
            onClick={isInteractionLocked ? undefined : openAuth}
            className={`btn-secondary action-btn ${isInteractionLocked ? 'disabled' : ''}`}
          >
            <Text className="action-icon">{accountBound ? '💞' : '👤'}</Text>
            <Text>{accountBound ? t('actions.myAccount') : t('actions.loginRegister')}</Text>
          </View>

          {/* Task List Toggle Button */}
          <View
            onClick={isInteractionLocked ? undefined : () => setShowTasks(!showTasks)}
            className={`btn-secondary action-btn ${showTasks ? 'active' : ''} ${isInteractionLocked ? 'disabled' : ''}`}
            style={{
              borderColor: showTasks ? 'var(--primary-pink)' : '',
              color: showTasks ? 'var(--text-pink)' : ''
            }}
          >
            <Text className="action-icon">📋</Text>
            <Text>{t('actions.taskList')}</Text>
          </View>
        </View>
      </View>

      {/* Daily + Growth Tasks Expansion Card */}
      {showTasks && (
        <View className="daily-tasks-card">
          <View className="task-category-title">
            <Text>{t('tasks.dailyTitle')}</Text>
            {checkinStreak > 0 && (
              <Text className="task-category-pill">{t('tasks.checkinStreak', { streak: checkinStreak })}</Text>
            )}
          </View>
          <View style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {dailyTasks.map(renderTask)}
          </View>

          {growthTasks.length > 0 && (
            <>
              <View className="task-category-title">
                <Text>{t('tasks.growthTitle')}</Text>
                <Text className="task-category-pill">{t('tasks.growthSub')}</Text>
              </View>
              <View style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {growthTasks.map(renderTask)}
              </View>
            </>
          )}
        </View>
      )}
    </View>
  );
}
