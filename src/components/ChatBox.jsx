import * as React from 'react';
import xiaoxiNormal from '../assets/xiaoxi_normal.jpg';
import xiaoxiHappy from '../assets/xiaoxi_happy.jpg';
import xiaoxiBlush from '../assets/xiaoxi_blush.jpg';

const { useRef, useEffect, useState } = React;

const QUICK_PROMPTS = [
  '小希，你现在饿了吗？',
  '你最喜欢什么礼物呀？',
  '小希，你可以亲我一下吗？',
  '给我讲个甜蜜的情话吧~',
  '今天有点累，求安抚...'
];

// Sub-component for AI messages (with interactive avatar and dynamic reactions)
function AiMessage({ msg, animate = false }) {
  const [hearts, setHearts] = useState([]);
  const fullText = msg.text || '';
  const [displayText, setDisplayText] = useState(animate ? '' : fullText);

  // Typewriter reveal for freshly-arrived replies; history renders instantly.
  useEffect(() => {
    if (!animate) {
      setDisplayText(fullText);
      return undefined;
    }
    setDisplayText('');
    let index = 0;
    const timer = setInterval(() => {
      index += 1;
      setDisplayText(fullText.slice(0, index));
      if (index >= fullText.length) {
        clearInterval(timer);
      }
    }, 30);
    return () => clearInterval(timer);
  }, [animate, fullText]);

  const getAvatarSrc = (avatarState) => {
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

  const handleAvatarClick = () => {
    const emoji = ['💖', '❤️', '💗', '💕', '🥰'][Math.floor(Math.random() * 5)];
    const newHeart = {
      id: Date.now() + Math.random(),
      left: Math.random() * 16 + 8, // slight offset to randomize heart position
      top: -10 - Math.random() * 10,
      emoji
    };

    setHearts(prev => [...prev, newHeart]);

    // Clear heart after animation finishes
    setTimeout(() => {
      setHearts(prev => prev.filter(h => h.id !== newHeart.id));
    }, 1500);
  };

  return (
    <div className="message-row row-ai">
      <div className="ai-avatar-container" onClick={handleAvatarClick} title="点击给小希送爱心">
        <img
          src={getAvatarSrc(msg.avatarState)}
          alt="Xiaoxi"
          className="ai-chat-avatar"
        />
        {hearts.map(heart => (
          <span
            key={heart.id}
            className="floating-heart"
            style={{
              left: `${heart.left}px`,
              top: `${heart.top}px`,
              position: 'absolute',
              pointerEvents: 'none',
              fontSize: '18px',
              animation: 'float-heart 1.5s ease-out forwards',
              zIndex: 10
            }}
          >
            {heart.emoji}
          </span>
        ))}
      </div>
      <div className="bubble bubble-ai">
        {displayText}
        {animate && displayText.length < fullText.length && (
          <span className="typing-caret" aria-hidden="true">▍</span>
        )}
        <div className="message-timestamp">
          {msg.timestamp}
        </div>
      </div>
    </div>
  );
}

// Sub-component for User messages (with symmetric styling and sleek avatar icon)
function UserMessage({ msg }) {
  return (
    <div className="message-row row-user">
      <div className="bubble bubble-user">
        {msg.text}
        <div className="message-timestamp text-right">
          {msg.timestamp}
        </div>
      </div>
      <div className="user-avatar-container">
        <div className="user-chat-avatar">
          👤
        </div>
      </div>
    </div>
  );
}

export default function ChatBox({
  chatHistory,
  sendMessage,
  lastFailedMessage = '',
  retryLastFailedMessage,
  isSendingMessage = false,
  isInteractionLocked = false,
  onRelationshipUpdateClick,
}) {
  const [inputText, setInputText] = useState('');
  const messagesEndRef = useRef(null);
  const isComposerDisabled = isSendingMessage || isInteractionLocked;

  // Auto-scroll to the bottom of the chat list
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatHistory]);

  const handleSend = () => {
    if (!inputText.trim() || isComposerDisabled) return;
    sendMessage(inputText);
    setInputText('');
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      handleSend();
    }
  };

  const handleQuickPrompt = (promptText) => {
    if (isComposerDisabled) return;
    sendMessage(promptText);
  };

  const isRelationshipUpdateMessage = (msg) => (
    msg.sender === 'system' && typeof msg.text === 'string' && msg.text.startsWith('📝 记忆更新：')
  );

  return (
    <div className="glass-panel chat-container">
      {/* Chat Box Header */}
      <div className="chat-header">
        <span className="chat-title">💬 与 小希 甜蜜对话中</span>
        <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
          {isInteractionLocked ? '正在同步账号数据...' : (isSendingMessage ? '消息发送中...' : '(体力耗尽后，回复增加的速度会变慢哦)')}
        </span>
      </div>

      {lastFailedMessage && (
        <div className="chat-retry-banner">
          <div className="chat-retry-copy">
            <span className="chat-retry-label">上一条消息发送失败</span>
            <span className="chat-retry-preview">{lastFailedMessage}</span>
          </div>
          <button
            type="button"
            className="btn-secondary chat-retry-action"
            onClick={retryLastFailedMessage}
            disabled={isComposerDisabled}
          >
            {isSendingMessage ? '重试中...' : '重试发送'}
          </button>
        </div>
      )}

      {/* Message Scroll View */}
      <div className="chat-messages">
        {chatHistory.map((msg, idx) => {
          if (msg.sender === 'user') {
            return <UserMessage key={msg.id} msg={msg} />;
          } else if (msg.sender === 'system') {
            if (isRelationshipUpdateMessage(msg)) {
              return (
                <button
                  key={msg.id}
                  type="button"
                  className="bubble bubble-system bubble-system-action"
                  style={{ margin: '8px auto' }}
                  onClick={onRelationshipUpdateClick}
                >
                  {msg.text}
                </button>
              );
            }

            return (
              <div key={msg.id} className="bubble bubble-system" style={{ margin: '8px auto' }}>
                {msg.text}
              </div>
            );
          } else {
            // Only the latest AI bubble types out; once a newer message arrives
            // this one re-renders with animate=false and shows in full.
            const isLatestReply = idx === chatHistory.length - 1;
            return <AiMessage key={msg.id} msg={msg} animate={isLatestReply} />;
          }
        })}
        <div ref={messagesEndRef} />
      </div>

      {/* Suggested Quick Prompts */}
      <div className="chat-suggested">
        {QUICK_PROMPTS.map((prompt, idx) => (
          <button
            key={idx}
            onClick={() => handleQuickPrompt(prompt)}
            className="suggest-btn"
            disabled={isComposerDisabled}
          >
            {prompt}
          </button>
        ))}
      </div>

      {/* Chat Input Field */}
      <div className="chat-input-area">
        <input
          type="text"
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={isComposerDisabled}
          placeholder="说点甜言蜜语逗小希开心吧..."
          className="chat-input"
        />
        <button
          onClick={handleSend}
          disabled={isComposerDisabled}
          className="btn-primary chat-send-btn"
          title={isSendingMessage ? '消息发送中' : '发送消息'}
        >
          {isSendingMessage ? '⏳' : '🚀'}
        </button>
      </div>
    </div>
  );
}
