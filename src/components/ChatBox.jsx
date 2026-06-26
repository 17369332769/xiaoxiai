import * as React from 'react';

// 小希 立绘
import xiaoxiNormal from '../assets/characters/xiaoxi/normal.jpg';
import xiaoxiHappy from '../assets/characters/xiaoxi/happy.jpg';
import xiaoxiBlush from '../assets/characters/xiaoxi/blush.jpg';

// 小雅 立绘
import xiaoyaNormal from '../assets/characters/xiaoya/normal.png';
import xiaoyaHappy from '../assets/characters/xiaoya/happy.png';
import xiaoyaBlush from '../assets/characters/xiaoya/blush.png';

const CHARACTER_ASSETS = {
  xiaoxi: { normal: xiaoxiNormal, happy: xiaoxiHappy, blush: xiaoxiBlush },
  xiaoya: { normal: xiaoyaNormal, happy: xiaoyaHappy, blush: xiaoyaBlush },
};

const { useRef, useEffect, useState } = React;

const QUICK_PROMPTS = [
  '小希，你现在饿了吗？',
  '你最喜欢什么礼物呀？',
  '小希，你可以亲我一下吗？',
  '给我讲个甜蜜的情话吧~',
  '今天有点累，求安抚...'
];

// Sub-component for AI messages (with interactive avatar and dynamic reactions)
function AiMessage({ msg, animate = false, streaming = false, onPlayVoice, isSpeaking = false, characterSkin = 'xiaoxi' }) {
  const [hearts, setHearts] = useState([]);
  const fullText = msg.text || '';
  const [displayText, setDisplayText] = useState(animate ? '' : fullText);

  // Typewriter reveal for freshly-arrived replies; history renders instantly.
  // Streaming messages skip the client-side typewriter entirely — their text is
  // already revealed token-by-token by the live SSE stream (animate=false), so
  // here we just mirror fullText as it grows.
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
    const assets = CHARACTER_ASSETS[characterSkin] || CHARACTER_ASSETS.xiaoxi;
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
        {((animate && displayText.length < fullText.length) || streaming) && (
          <span className="typing-caret" aria-hidden="true">▍</span>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '4px' }}>
          <span className="message-timestamp" style={{ margin: 0 }}>{msg.timestamp}</span>
          {onPlayVoice && fullText && !streaming && (
            <button
              type="button"
              onClick={() => onPlayVoice(fullText, msg.id)}
              disabled={isSpeaking}
              title="听小希读这句"
              aria-label="播放语音"
              style={{ background: 'none', border: 'none', cursor: isSpeaking ? 'default' : 'pointer', fontSize: '13px', padding: 0, opacity: isSpeaking ? 0.6 : 1 }}
            >
              {isSpeaking ? '🔊…' : '🔊'}
            </button>
          )}
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
  onPlayVoice,
  speakingMessageId = null,
  characterSkin = 'xiaoxi',
}) {
  const [inputText, setInputText] = useState('');
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);
  const wasSendingRef = useRef(false);
  const recognitionRef = useRef(null);
  const [isListening, setIsListening] = useState(false);
  const isComposerDisabled = isSendingMessage || isInteractionLocked;
  // Browser-native speech-to-text (no key needed); hidden where unsupported.
  const speechSupported = typeof window !== 'undefined'
    && Boolean(window.SpeechRecognition || window.webkitSpeechRecognition);

  // Stop any in-flight recognition when the component unmounts.
  useEffect(() => () => {
    try { recognitionRef.current?.stop(); } catch { /* ignore */ }
  }, []);

  const toggleMic = () => {
    if (!speechSupported || isComposerDisabled) return;
    if (isListening) {
      try { recognitionRef.current?.stop(); } catch { /* ignore */ }
      return;
    }
    const SpeechRecognitionImpl = window.SpeechRecognition || window.webkitSpeechRecognition;
    const recognition = new SpeechRecognitionImpl();
    recognition.lang = 'zh-CN';
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.onresult = (event) => {
      const transcript = event?.results?.[0]?.[0]?.transcript || '';
      if (transcript) setInputText((prev) => (prev ? `${prev} ${transcript}` : transcript));
    };
    recognition.onend = () => setIsListening(false);
    recognition.onerror = () => setIsListening(false);
    recognitionRef.current = recognition;
    setIsListening(true);
    try { recognition.start(); } catch { setIsListening(false); }
  };

  // Auto-scroll to the bottom of the chat list
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatHistory]);

  // The composer input is disabled while a message is in flight (and on a
  // button click focus moves off it), so the browser drops focus. Once the
  // send finishes, restore focus so the user can keep typing without having
  // to click back into the field.
  useEffect(() => {
    if (wasSendingRef.current && !isSendingMessage && !isInteractionLocked) {
      inputRef.current?.focus();
    }
    wasSendingRef.current = isSendingMessage;
  }, [isSendingMessage, isInteractionLocked]);

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
            // this one re-renders with animate=false and shows in full. A live
            // streaming bubble reveals via the SSE deltas (not the client-side
            // typewriter), and the finalized `streamed` reply skips re-typing.
            const isLatestReply = idx === chatHistory.length - 1;
            const isStreaming = Boolean(msg.streaming);
            return (
              <AiMessage
                key={msg.id}
                msg={msg}
                animate={isLatestReply && !isStreaming && !msg.streamed}
                streaming={isStreaming}
                onPlayVoice={onPlayVoice}
                isSpeaking={speakingMessageId === msg.id}
                characterSkin={characterSkin}
              />
            );
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
          ref={inputRef}
          type="text"
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={isComposerDisabled}
          placeholder="说点甜言蜜语逗小希开心吧..."
          className="chat-input"
        />
        {speechSupported && (
          <button
            type="button"
            onClick={toggleMic}
            disabled={isComposerDisabled}
            className="btn-secondary chat-mic-btn"
            title={isListening ? '停止录音' : '语音输入（说话）'}
            aria-label="语音输入"
            style={{ padding: '0 12px', fontSize: '16px' }}
          >
            {isListening ? '🔴' : '🎤'}
          </button>
        )}
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
