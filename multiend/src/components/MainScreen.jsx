import * as React from 'react';
import { View, Text, Image } from '@tarojs/components';
import { CHARACTER_ASSETS } from '../utils/characterAssets';

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
  characterSkin = 'xiaoxi',
  relationshipSummary = '',
  relationshipHighlights = [],
  relationshipRecentUpdates = [],
  hasFreshRelationshipUpdate = false,
  relationshipCardFocusToken = 0,
}) {
  const assets = CHARACTER_ASSETS[characterSkin] || CHARACTER_ASSETS.xiaoxi;
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

  // Avatar image source based on state and selected character skin
  const getAvatarSrc = () => {
    switch (avatarState) {
      case 'happy':
        return assets.happy;
      case 'blush':
        return assets.blush;
      case 'normal':
      default:
        return assets.normal;
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
    // Browser-coupled positioning falls back to weapp tap detail / origin.
    let x = 0;
    let y = 0;
    const target = e.currentTarget;
    if (target && typeof target.getBoundingClientRect === 'function' && typeof e.clientX === 'number') {
      const rect = target.getBoundingClientRect();
      x = e.clientX - rect.left;
      y = e.clientY - rect.top;
    } else if (e.detail && typeof e.detail.x === 'number') {
      x = e.detail.x;
      y = e.detail.y;
    }

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

    const cardNode = relationshipCardRef.current;
    if (cardNode && typeof cardNode.scrollIntoView === 'function') {
      cardNode.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    cardNode?.focus?.();
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
    <View className="glass-panel character-panel">
      {/* Dynamic Status Bars */}
      <View className="status-bars">
        {/* Affection (好感度) */}
        <View className="status-bar-group">
          <View className="status-bar-label">
            <Text>❤️ 好感度 (Affection)</Text>
            <Text>{affection} / {maxAffection} ({Math.round(affectionPercent)}%)</Text>
          </View>
          <View className="status-bar-bg">
            <View className="status-bar-fill fill-affection" style={{ width: `${affectionPercent}%` }}></View>
          </View>
        </View>

        {/* Energy (体力) */}
        <View className="status-bar-group">
          <View className="status-bar-label">
            <Text>⚡ 体力值 (Energy)</Text>
            <Text>{energy} / 100</Text>
          </View>
          <View className="status-bar-bg">
            <View className="status-bar-fill fill-energy" style={{ width: `${energy}%` }}></View>
          </View>
        </View>

        {/* Mood (心情) */}
        <View className="status-bar-group">
          <View className="status-bar-label">
            <Text>🎭 心情值 (Mood)</Text>
            <Text>{mood} / 100</Text>
          </View>
          <View className="status-bar-bg">
            <View className="status-bar-fill fill-mood" style={{ width: `${mood}%` }}></View>
          </View>
        </View>
      </View>

      <View
        ref={relationshipCardRef}
        tabIndex={-1}
        className={`relationship-memory-card ${hasFreshRelationshipUpdate ? 'is-updated' : ''} ${isRelationshipCardFocused ? 'is-focused' : ''}`}
      >
        <View className="relationship-memory-title">小希的关系速记</View>
        {hasFreshRelationshipUpdate && (
          <View className="relationship-memory-update-pill">刚刚记住你了</View>
        )}
        <View className="relationship-memory-summary">
          {relationshipSummary || '再多聊几句吧。小希会慢慢记住你的喜好、近况和你们之间的小默契。'}
        </View>
        {relationshipHighlights.length > 0 && (
          <View className="relationship-memory-tags">
            {relationshipHighlights.slice(0, 4).map((memory) => (
              <View key={`${memory.key}-${memory.value}`} className="relationship-memory-tag">
                <Text>{memory.label}</Text>
                <Text>{memory.value}</Text>
              </View>
            ))}
          </View>
        )}
        {relationshipRecentUpdates.length > 0 && (
          <View className="relationship-memory-history">
            <View className="relationship-memory-history-header">
              <View className="relationship-memory-history-title">最近记住了什么</View>
              <View className="relationship-memory-history-meta">
                共 {filteredRelationshipUpdates.length} 条
              </View>
            </View>
            <View className="relationship-memory-filter-row">
              {RELATIONSHIP_FILTERS.map((filterOption) => (
                <View
                  key={filterOption.id}
                  className={`relationship-memory-filter-chip ${activeHistoryFilter === filterOption.id ? 'is-active' : ''}`}
                  onClick={() => handleHistoryFilterChange(filterOption.id)}
                >
                  {filterOption.label}
                </View>
              ))}
            </View>
            <View className="relationship-memory-source-filter-row">
              {RELATIONSHIP_SOURCE_FILTERS.map((filterOption) => (
                <View
                  key={filterOption.id}
                  className={`relationship-memory-filter-chip is-secondary ${activeSourceFilter === filterOption.id ? 'is-active' : ''}`}
                  onClick={() => handleSourceFilterChange(filterOption.id)}
                >
                  {filterOption.label}
                </View>
              ))}
            </View>
            {showActiveFilterSummary && (
              <View className="relationship-memory-active-filters">
                当前查看：{activeHistoryFilterLabel} · {activeSourceFilterLabel}
              </View>
            )}
            <View className="relationship-memory-history-list">
              {displayedRelationshipUpdates.map((item) => (
                <View
                  key={item.id}
                  className={`relationship-memory-history-item ${item.confidence === 'low' ? 'is-low-confidence' : ''}`}
                >
                  <Text className="relationship-memory-history-time">{item.timestamp}</Text>
                  <View className="relationship-memory-history-content">
                    <View className="relationship-memory-history-chip-row">
                      <Text className={`relationship-memory-history-badge category-${item.category || 'bond'}`}>
                        {item.categoryLabel || '关系'}
                      </Text>
                      {item.sourceLabel && (
                        <Text className="relationship-memory-source-badge">
                          {item.sourceLabel}
                        </Text>
                      )}
                      {item.confidenceLabel && (
                        <Text className={`relationship-memory-confidence-badge confidence-${item.confidence || 'medium'}`}>
                          {item.confidenceLabel}
                        </Text>
                      )}
                    </View>
                    <Text className="relationship-memory-history-text">{item.text}</Text>
                    {item.confidence === 'low' && (
                      <Text className="relationship-memory-confidence-note">
                        可能是小希的推测，会随着更多聊天继续修正。
                      </Text>
                    )}
                  </View>
                </View>
              ))}
            </View>
            {displayedRelationshipUpdates.length === 0 && (
              <View className="relationship-memory-history-empty">
                这一类记忆还没有更新，再和小希多聊聊吧。
              </View>
            )}
            {filteredRelationshipUpdates.length > COLLAPSED_HISTORY_LIMIT && (
              <View
                className="relationship-memory-toggle"
                onClick={() => setIsHistoryExpanded((current) => !current)}
              >
                {isHistoryExpanded ? '收起' : `展开查看更多${hiddenRelationshipUpdateCount > 0 ? `（+${hiddenRelationshipUpdateCount}）` : ''}`}
              </View>
            )}
          </View>
        )}
      </View>

      {/* Interactive Avatar Container */}
      <View className="character-avatar-container" onClick={handleAvatarClick} style={{ cursor: 'pointer' }}>
        {/* Mood Badge */}
        <View className="mood-badge">
          <Text>小希状态: {getMoodDescription()}</Text>
        </View>

        {/* Render Click-Generated Floating Hearts */}
        {clickHearts.map(heart => (
          <Text
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
          </Text>
        ))}

        <Image
          src={getAvatarSrc()}
          mode="aspectFit"
          className="character-avatar"
        />

        {/* Level Badge */}
        <View className="level-badge">
          羁绊等级: Lv.{level}
        </View>
      </View>
    </View>
  );
}
