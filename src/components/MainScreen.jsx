import * as React from 'react';
import xiaoxiNormal from '../assets/xiaoxi_normal.jpg';
import xiaoxiHappy from '../assets/xiaoxi_happy.jpg';
import xiaoxiBlush from '../assets/xiaoxi_blush.jpg';

const { useEffect, useRef, useState } = React;
const RELATIONSHIP_FILTERS = [
  { id: 'all', label: '全部' },
  { id: 'preference', label: '偏好' },
  { id: 'goal', label: '目标' },
  { id: 'status', label: '近况' },
  { id: 'bond', label: '关系' },
];
const RELATIONSHIP_SOURCE_FILTERS = [
  { id: 'all', label: '全部来源' },
  { id: 'local_memory', label: '规则提取' },
  { id: 'llm_memory', label: '模型总结' },
  { id: 'summary_shift', label: '关系总结' },
];
const COLLAPSED_HISTORY_LIMIT = 3;

function getFilterLabel(filters, activeFilter, fallbackLabel) {
  return filters.find((filterOption) => filterOption.id === activeFilter)?.label || fallbackLabel;
}

export default function MainScreen({
  level,
  affection,
  energy,
  mood,
  avatarState,
  relationshipSummary = '',
  relationshipHighlights = [],
  relationshipRecentUpdates = [],
  hasFreshRelationshipUpdate = false,
  relationshipCardFocusToken = 0,
}) {
  const [clickHearts, setClickHearts] = useState([]);
  const [isRelationshipCardFocused, setIsRelationshipCardFocused] = useState(false);
  const [activeHistoryFilter, setActiveHistoryFilter] = useState('all');
  const [activeSourceFilter, setActiveSourceFilter] = useState('all');
  const [isHistoryExpanded, setIsHistoryExpanded] = useState(false);
  const relationshipCardRef = useRef(null);
  const relationshipCardFocusTimeoutRef = useRef(null);

  // Calculate maximum affection required for current level
  const maxAffection = 100 + (level - 1) * 50;
  const affectionPercent = Math.min(100, (affection / maxAffection) * 100);

  // Avatar image source based on state
  const getAvatarSrc = () => {
    switch (avatarState) {
      case 'happy':
        return xiaoxiHappy;
      case 'blush':
        return xiaoxiBlush;
      case 'normal':
      default:
        return xiaoxiNormal;
    }
  };

  // Avatar mood status description
  const getMoodDescription = () => {
    switch (avatarState) {
      case 'happy':
        return '😄 兴高采烈';
      case 'blush':
        return '😳 害羞脸红';
      case 'normal':
      default:
        return '😊 温柔恬静';
    }
  };

  // Click handler to spawn floating hearts
  const handleAvatarClick = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    const newHeart = {
      id: Date.now() + Math.random(),
      x,
      y,
      emoji: ['💖', '❤️', '💗', '💕', '🥰'][Math.floor(Math.random() * 5)]
    };

    setClickHearts(prev => [...prev, newHeart]);

    // Cleanup heart after animation
    setTimeout(() => {
      setClickHearts(prev => prev.filter(h => h.id !== newHeart.id));
    }, 2000);
  };

  useEffect(() => {
    return () => {
      if (relationshipCardFocusTimeoutRef.current) {
        clearTimeout(relationshipCardFocusTimeoutRef.current);
        relationshipCardFocusTimeoutRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!relationshipCardFocusToken) {
      return;
    }

    relationshipCardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    relationshipCardRef.current?.focus?.();
    setIsRelationshipCardFocused(true);

    if (relationshipCardFocusTimeoutRef.current) {
      clearTimeout(relationshipCardFocusTimeoutRef.current);
    }

    relationshipCardFocusTimeoutRef.current = setTimeout(() => {
      relationshipCardFocusTimeoutRef.current = null;
      setIsRelationshipCardFocused(false);
    }, 2200);
  }, [relationshipCardFocusToken]);

  const filteredRelationshipUpdates = relationshipRecentUpdates.filter((item) => (
    (activeHistoryFilter === 'all' ? true : (item.category || 'bond') === activeHistoryFilter)
      && (activeSourceFilter === 'all' ? true : (item.sourceType || 'local_memory') === activeSourceFilter)
  ));
  const displayedRelationshipUpdates = isHistoryExpanded
    ? filteredRelationshipUpdates
    : filteredRelationshipUpdates.slice(0, COLLAPSED_HISTORY_LIMIT);
  const hiddenRelationshipUpdateCount = Math.max(0, filteredRelationshipUpdates.length - displayedRelationshipUpdates.length);
  const activeHistoryFilterLabel = getFilterLabel(RELATIONSHIP_FILTERS, activeHistoryFilter, '全部');
  const activeSourceFilterLabel = getFilterLabel(RELATIONSHIP_SOURCE_FILTERS, activeSourceFilter, '全部来源');
  const showActiveFilterSummary = activeHistoryFilter !== 'all' || activeSourceFilter !== 'all';

  const handleHistoryFilterChange = (nextFilter) => {
    setActiveHistoryFilter(nextFilter);
    setIsHistoryExpanded(false);
  };

  const handleSourceFilterChange = (nextFilter) => {
    setActiveSourceFilter(nextFilter);
    setIsHistoryExpanded(false);
  };

  return (
    <div className="glass-panel character-panel">
      {/* Dynamic Status Bars */}
      <div className="status-bars">
        {/* Affection (好感度) */}
        <div className="status-bar-group">
          <div className="status-bar-label">
            <span>❤️ 好感度 (Affection)</span>
            <span>{affection} / {maxAffection} ({Math.round(affectionPercent)}%)</span>
          </div>
          <div className="status-bar-bg">
            <div className="status-bar-fill fill-affection" style={{ width: `${affectionPercent}%` }}></div>
          </div>
        </div>

        {/* Energy (体力) */}
        <div className="status-bar-group">
          <div className="status-bar-label">
            <span>⚡ 体力值 (Energy)</span>
            <span>{energy} / 100</span>
          </div>
          <div className="status-bar-bg">
            <div className="status-bar-fill fill-energy" style={{ width: `${energy}%` }}></div>
          </div>
        </div>

        {/* Mood (心情) */}
        <div className="status-bar-group">
          <div className="status-bar-label">
            <span>🎭 心情值 (Mood)</span>
            <span>{mood} / 100</span>
          </div>
          <div className="status-bar-bg">
            <div className="status-bar-fill fill-mood" style={{ width: `${mood}%` }}></div>
          </div>
        </div>
      </div>

      <div
        ref={relationshipCardRef}
        tabIndex={-1}
        className={`relationship-memory-card ${hasFreshRelationshipUpdate ? 'is-updated' : ''} ${isRelationshipCardFocused ? 'is-focused' : ''}`}
      >
        <div className="relationship-memory-title">小希的关系速记</div>
        {hasFreshRelationshipUpdate && (
          <div className="relationship-memory-update-pill">刚刚记住你了</div>
        )}
        <div className="relationship-memory-summary">
          {relationshipSummary || '再多聊几句吧。小希会慢慢记住你的喜好、近况和你们之间的小默契。'}
        </div>
        {relationshipHighlights.length > 0 && (
          <div className="relationship-memory-tags">
            {relationshipHighlights.slice(0, 4).map((memory) => (
              <span key={`${memory.key}-${memory.value}`} className="relationship-memory-tag">
                <strong>{memory.label}</strong>
                <span>{memory.value}</span>
              </span>
            ))}
          </div>
        )}
        {relationshipRecentUpdates.length > 0 && (
          <div className="relationship-memory-history">
            <div className="relationship-memory-history-header">
              <div className="relationship-memory-history-title">最近记住了什么</div>
              <div className="relationship-memory-history-meta">
                共 {filteredRelationshipUpdates.length} 条
              </div>
            </div>
            <div className="relationship-memory-filter-row">
              {RELATIONSHIP_FILTERS.map((filterOption) => (
                <button
                  key={filterOption.id}
                  type="button"
                  className={`relationship-memory-filter-chip ${activeHistoryFilter === filterOption.id ? 'is-active' : ''}`}
                  onClick={() => handleHistoryFilterChange(filterOption.id)}
                >
                  {filterOption.label}
                </button>
              ))}
            </div>
            <div className="relationship-memory-source-filter-row">
              {RELATIONSHIP_SOURCE_FILTERS.map((filterOption) => (
                <button
                  key={filterOption.id}
                  type="button"
                  className={`relationship-memory-filter-chip is-secondary ${activeSourceFilter === filterOption.id ? 'is-active' : ''}`}
                  onClick={() => handleSourceFilterChange(filterOption.id)}
                >
                  {filterOption.label}
                </button>
              ))}
            </div>
            {showActiveFilterSummary && (
              <div className="relationship-memory-active-filters">
                当前查看：{activeHistoryFilterLabel} · {activeSourceFilterLabel}
              </div>
            )}
            <div className="relationship-memory-history-list">
              {displayedRelationshipUpdates.map((item) => (
                <div
                  key={item.id}
                  className={`relationship-memory-history-item ${item.confidence === 'low' ? 'is-low-confidence' : ''}`}
                >
                  <span className="relationship-memory-history-time">{item.timestamp}</span>
                  <div className="relationship-memory-history-content">
                    <div className="relationship-memory-history-chip-row">
                      <span className={`relationship-memory-history-badge category-${item.category || 'bond'}`}>
                        {item.categoryLabel || '关系'}
                      </span>
                      {item.sourceLabel && (
                        <span className="relationship-memory-source-badge">
                          {item.sourceLabel}
                        </span>
                      )}
                      {item.confidenceLabel && (
                        <span className={`relationship-memory-confidence-badge confidence-${item.confidence || 'medium'}`}>
                          {item.confidenceLabel}
                        </span>
                      )}
                    </div>
                    <span className="relationship-memory-history-text">{item.text}</span>
                    {item.confidence === 'low' && (
                      <span className="relationship-memory-confidence-note">
                        可能是小希的推测，会随着更多聊天继续修正。
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
            {displayedRelationshipUpdates.length === 0 && (
              <div className="relationship-memory-history-empty">
                这一类记忆还没有更新，再和小希多聊聊吧。
              </div>
            )}
            {filteredRelationshipUpdates.length > COLLAPSED_HISTORY_LIMIT && (
              <button
                type="button"
                className="relationship-memory-toggle"
                onClick={() => setIsHistoryExpanded((current) => !current)}
              >
                {isHistoryExpanded ? '收起' : `展开查看更多${hiddenRelationshipUpdateCount > 0 ? `（+${hiddenRelationshipUpdateCount}）` : ''}`}
              </button>
            )}
          </div>
        )}
      </div>

      {/* Interactive Avatar Container */}
      <div className="character-avatar-container" onClick={handleAvatarClick} style={{ cursor: 'pointer' }}>
        {/* Mood Badge */}
        <div className="mood-badge">
          <span>小希状态: {getMoodDescription()}</span>
        </div>

        {/* Render Click-Generated Floating Hearts */}
        {clickHearts.map(heart => (
          <span
            key={heart.id}
            className="floating-heart"
            style={{
              left: `${heart.x}px`,
              top: `${heart.y}px`,
              position: 'absolute',
              userSelect: 'none'
            }}
          >
            {heart.emoji}
          </span>
        ))}

        <img
          src={getAvatarSrc()}
          alt="AI Girlfriend Xiaoxi"
          className="character-avatar"
        />

        {/* Level Badge */}
        <div className="level-badge">
          羁绊等级: Lv.{level}
        </div>
      </div>
    </div>
  );
}
