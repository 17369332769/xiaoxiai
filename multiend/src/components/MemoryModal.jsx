import * as React from 'react';
import { View, Text, ScrollView } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { humanizeMemoryKey } from '@shared/memoryLabels';
import { useT } from '../i18n/index.js';

void React;

export default function MemoryModal({
  isOpen,
  onClose,
  memories = [],
  memorySummary = '',
  isLoadingMemories = false,
  loadMemories,
  deleteMemory,
  clearMemories,
}) {
  const t = useT();
  if (!isOpen) return null;

  const hasMemories = memories.length > 0;
  const refreshDisabled = isLoadingMemories;
  const clearDisabled = isLoadingMemories || !hasMemories;

  const handleClearAll = async () => {
    if (!hasMemories || !clearMemories) {
      return;
    }

    const res = await Taro.showModal({ content: t('memory.confirmClear') });
    if (res.confirm) {
      clearMemories();
    }
  };

  return (
    <View className="modal-overlay" onClick={onClose}>
      <View className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '460px' }}>
        <View className="modal-header">
          <View className="modal-title"><Text>📔</Text><Text>{t('memory.title')}</Text></View>
          <View className="close-btn" onClick={onClose}>×</View>
        </View>

        <View style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '12px' }}>
          这些是小希记住的、关于你的事情。你可以随时清理不想保留的记忆。
        </View>

        {memorySummary && (
          <View
            style={{
              background: 'rgba(255, 117, 151, 0.08)',
              border: '1px solid rgba(255, 117, 151, 0.2)',
              borderRadius: '10px',
              padding: '10px 12px',
              marginBottom: '14px',
              fontSize: '13px',
              color: '#f0e6f5',
            }}
          >
            <View style={{ fontSize: '11px', color: 'var(--text-pink)', marginBottom: '4px' }}>关系摘要</View>
            <Text>{memorySummary}</Text>
          </View>
        )}

        <View style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
          <View className="section-title" style={{ fontSize: '13px', margin: 0 }}>🧠 记忆卡片</View>
          <View style={{ display: 'flex', gap: '8px' }}>
            <View
              className={`btn-secondary${refreshDisabled ? ' disabled' : ''}`}
              onClick={refreshDisabled ? undefined : loadMemories}
              style={{ padding: '4px 12px', fontSize: '12px' }}
            >
              {isLoadingMemories ? '刷新中...' : '刷新'}
            </View>
            <View
              className={`btn-secondary${clearDisabled ? ' disabled' : ''}`}
              onClick={clearDisabled ? undefined : handleClearAll}
              style={{ padding: '4px 12px', fontSize: '12px' }}
            >
              清空全部
            </View>
          </View>
        </View>

        <ScrollView
          scrollY
          style={{ maxHeight: '320px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '8px' }}
        >
          {isLoadingMemories && memories.length === 0 ? (
            <View style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: '13px', padding: '24px 0' }}>
              正在加载记忆...
            </View>
          ) : memories.length === 0 ? (
            <View style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: '13px', padding: '24px 0' }}>
              小希还没有记下关于你的特别事项，多和她聊聊吧~（需配置大模型后自动提炼）
            </View>
          ) : (
            memories.map((memory) => (
              <View key={memory.key} className="memory-item">
                <View style={{ minWidth: 0 }}>
                  <View className="memory-key">{memory.label || humanizeMemoryKey(memory.key)}</View>
                  <View className="memory-value">{memory.value}</View>
                  {memory.updatedAt && (
                    <View style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '3px' }}>
                      更新于 {memory.updatedAt} · 重要度 {memory.weight}
                    </View>
                  )}
                </View>
                <View
                  className="memory-delete-btn"
                  onClick={() => deleteMemory(memory.key)}
                >
                  删除
                </View>
              </View>
            ))
          )}
        </ScrollView>
      </View>
    </View>
  );
}
