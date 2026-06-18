import * as React from 'react';

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
  if (!isOpen) return null;

  const hasMemories = memories.length > 0;

  const handleClearAll = () => {
    if (!hasMemories || !clearMemories) {
      return;
    }

    const confirmed = window.confirm(
      '确定要清空小希记住的全部内容吗？此操作不可恢复，小希将忘记关于你的所有记忆。'
    );
    if (confirmed) {
      clearMemories();
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '460px' }}>
        <div className="modal-header">
          <div className="modal-title"><span>📔</span><span>小希的记忆 (Memories)</span></div>
          <button className="close-btn" onClick={onClose}>&times;</button>
        </div>

        <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '12px' }}>
          这些是小希记住的、关于你的事情。你可以随时清理不想保留的记忆。
        </div>

        {memorySummary && (
          <div
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
            <div style={{ fontSize: '11px', color: 'var(--text-pink)', marginBottom: '4px' }}>关系摘要</div>
            {memorySummary}
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
          <div className="section-title" style={{ fontSize: '13px', margin: 0 }}>🧠 记忆卡片</div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              type="button"
              className="btn-secondary"
              onClick={loadMemories}
              disabled={isLoadingMemories}
              style={{ padding: '4px 12px', fontSize: '12px' }}
            >
              {isLoadingMemories ? '刷新中...' : '刷新'}
            </button>
            <button
              type="button"
              className="btn-secondary"
              onClick={handleClearAll}
              disabled={isLoadingMemories || !hasMemories}
              style={{ padding: '4px 12px', fontSize: '12px' }}
            >
              清空全部
            </button>
          </div>
        </div>

        <div style={{ maxHeight: '320px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {isLoadingMemories && memories.length === 0 ? (
            <div style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: '13px', padding: '24px 0' }}>
              正在加载记忆...
            </div>
          ) : memories.length === 0 ? (
            <div style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: '13px', padding: '24px 0' }}>
              小希还没有记下关于你的特别事项，多和她聊聊吧~（需配置大模型后自动提炼）
            </div>
          ) : (
            memories.map((memory) => (
              <div key={memory.key} className="memory-item">
                <div style={{ minWidth: 0 }}>
                  <div className="memory-key">{memory.key}</div>
                  <div className="memory-value">{memory.value}</div>
                  {memory.updatedAt && (
                    <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '3px' }}>
                      更新于 {memory.updatedAt} · 重要度 {memory.weight}
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  className="memory-delete-btn"
                  onClick={() => deleteMemory(memory.key)}
                >
                  删除
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
