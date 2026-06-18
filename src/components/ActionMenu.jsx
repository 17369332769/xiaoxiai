import { useState } from 'react';

export default function ActionMenu({
  tasks,
  claimTaskReward,
  openShop,
  openTipping,
  isInteractionLocked = false,
  claimingTaskIds = []
}) {
  const [showTasks, setShowTasks] = useState(false);

  // Check if there are any unclaimed completed tasks
  const pendingTaskCount = tasks.filter(t => t.completed && !t.claimed).length;

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

      {/* Daily Tasks Expansion Card */}
      {showTasks && (
        <div className="daily-tasks-card">
          <div className="section-title" style={{ fontSize: '13px', borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: '6px', marginBottom: '8px' }}>
            📅 今日日常任务 (Daily Tasks)
          </div>
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {tasks.map(task => {
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
            })}
          </div>
        </div>
      )}
    </div>
  );
}
