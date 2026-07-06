import * as React from 'react';
import { View, Text, Image, Input, ScrollView } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { useT } from '../i18n/index.js';
import { CHARACTER_ASSETS } from '../utils/characterAssets';

const { useRef, useEffect, useState } = React;

// Anchor id at the bottom of the message ScrollView; auto-scroll targets it.
const BOTTOM_ANCHOR_ID = 'chat-bottom-anchor';

// Turn bare http(s) URLs inside message text into highlighted spans. The model
// may include source / official-site URLs in its replies; without this they
// render as inert plain text. Splitting on a capturing-group regex keeps the
// matched URLs at the odd indices of the result. (On mini-program these cannot
// open an external browser, so they render as styled <Text>, not a link.)
const URL_REGEX = /(https?:\/\/[^\s<>，。！？、；："'）)】》]+)/g;
function linkifyText(text) {
  const str = String(text ?? '');
  if (!str || str.indexOf('http') === -1) return str;
  return str.split(URL_REGEX).map((part, i) => (
    i % 2 === 1
      ? (
        <Text
          key={i}
          className="chat-link"
          style={{ color: 'var(--accent-gold, #ffd479)', textDecoration: 'underline', wordBreak: 'break-all' }}
        >
          {part}
        </Text>
      )
      : part
  ));
}

// Suggested quick prompts now live in the i18n dictionary (chat.quickPrompts).

// Sub-component for AI messages (with interactive avatar and dynamic reactions)
function AiMessage({ msg, animate = false, streaming = false, onPlayVoice, isSpeaking = false, characterSkin = 'xiaoxi' }) {
  const t = useT();
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
    <View className="message-row row-ai">
      <View className="ai-avatar-container" onClick={handleAvatarClick} title={t('chat.avatarHeart')}>
        <Image
          src={getAvatarSrc(msg.avatarState)}
          mode="aspectFit"
          className="ai-chat-avatar"
        />
        {hearts.map(heart => (
          <Text
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
          </Text>
        ))}
      </View>
      <View className="bubble bubble-ai">
        {linkifyText(displayText)}
        {((animate && displayText.length < fullText.length) || streaming) && (
          <Text className="typing-caret" aria-hidden="true">▍</Text>
        )}
        <View style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '4px' }}>
          <Text className="message-timestamp" style={{ margin: 0 }}>{msg.timestamp}</Text>
          {onPlayVoice && fullText && !streaming && (
            <View
              onClick={isSpeaking ? undefined : () => onPlayVoice(fullText, msg.id)}
              title={t('chat.playVoice')}
              aria-label={t('chat.playVoiceAria')}
              style={{ background: 'none', border: 'none', cursor: isSpeaking ? 'default' : 'pointer', fontSize: '13px', padding: 0, opacity: isSpeaking ? 0.6 : 1 }}
            >
              {isSpeaking ? '🔊…' : '🔊'}
            </View>
          )}
        </View>
      </View>
    </View>
  );
}

// Sub-component for User messages (with symmetric styling and sleek avatar icon)
function UserMessage({ msg }) {
  return (
    <View className="message-row row-user">
      <View className="bubble bubble-user">
        {linkifyText(msg.text)}
        <View className="message-timestamp text-right">
          {msg.timestamp}
        </View>
      </View>
      <View className="user-avatar-container">
        <View className="user-chat-avatar">
          👤
        </View>
      </View>
    </View>
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
  const t = useT();
  const [inputText, setInputText] = useState('');
  const [scrollAnchor, setScrollAnchor] = useState('');
  const inputRef = useRef(null);
  const wasSendingRef = useRef(false);
  const recognitionRef = useRef(null);
  const [isListening, setIsListening] = useState(false);
  const isComposerDisabled = isSendingMessage || isInteractionLocked;
  // Browser-native speech-to-text (no key needed); hidden where unsupported
  // (always hidden on mini-program, where `window` does not exist).
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

  // Auto-scroll the message ScrollView to the bottom anchor whenever the chat
  // history changes. Briefly clearing the target id forces the mini-program to
  // re-run scrollIntoView even when the anchor id itself is unchanged.
  useEffect(() => {
    setScrollAnchor('');
    Taro.nextTick(() => setScrollAnchor(BOTTOM_ANCHOR_ID));
  }, [chatHistory]);

  // The composer input is disabled while a message is in flight (and on a
  // button click focus moves off it), so the browser drops focus. Once the
  // send finishes, restore focus so the user can keep typing without having
  // to click back into the field. (Imperative focus is web-only; guarded so it
  // is a safe no-op on mini-program.)
  useEffect(() => {
    if (wasSendingRef.current && !isSendingMessage && !isInteractionLocked) {
      if (typeof inputRef.current?.focus === 'function') {
        inputRef.current.focus();
      }
    }
    wasSendingRef.current = isSendingMessage;
  }, [isSendingMessage, isInteractionLocked]);

  const handleSend = () => {
    if (!inputText.trim() || isComposerDisabled) return;
    sendMessage(inputText);
    setInputText('');
  };

  const handleQuickPrompt = (promptText) => {
    if (isComposerDisabled) return;
    sendMessage(promptText);
  };

  const isRelationshipUpdateMessage = (msg) => (
    msg.sender === 'system' && typeof msg.text === 'string' && msg.text.startsWith('📝 记忆更新：')
  );

  return (
    <View className="glass-panel chat-container">
      {/* Chat Box Header */}
      <View className="chat-header">
        <Text className="chat-title">{t('chat.title')}</Text>
        <Text style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
          {isInteractionLocked ? t('chat.syncing') : (isSendingMessage ? t('chat.sending') : t('chat.energyHint'))}
        </Text>
      </View>

      {lastFailedMessage && (
        <View className="chat-retry-banner">
          <View className="chat-retry-copy">
            <Text className="chat-retry-label">{t('chat.sendFailed')}</Text>
            <Text className="chat-retry-preview">{lastFailedMessage}</Text>
          </View>
          <View
            className={`btn-secondary chat-retry-action${isComposerDisabled ? ' is-disabled' : ''}`}
            onClick={isComposerDisabled ? undefined : retryLastFailedMessage}
          >
            {isSendingMessage ? t('common.retrying') : t('chat.retrySend')}
          </View>
        </View>
      )}

      {/* Message Scroll View */}
      <ScrollView
        scrollY
        scrollWithAnimation
        scrollIntoView={scrollAnchor}
        className="chat-messages"
      >
        {chatHistory.map((msg, idx) => {
          if (msg.sender === 'user') {
            return <UserMessage key={msg.id} msg={msg} />;
          } else if (msg.sender === 'system') {
            if (isRelationshipUpdateMessage(msg)) {
              return (
                <View
                  key={msg.id}
                  className="bubble bubble-system bubble-system-action"
                  style={{ margin: '8px auto' }}
                  onClick={onRelationshipUpdateClick}
                >
                  {msg.text}
                </View>
              );
            }

            return (
              <View key={msg.id} className="bubble bubble-system" style={{ margin: '8px auto' }}>
                {msg.text}
              </View>
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
        <View id={BOTTOM_ANCHOR_ID} />
      </ScrollView>

      {/* Suggested Quick Prompts */}
      <View className="chat-suggested">
        {t('chat.quickPrompts').map((prompt, idx) => (
          <View
            key={idx}
            onClick={isComposerDisabled ? undefined : () => handleQuickPrompt(prompt)}
            className={`suggest-btn${isComposerDisabled ? ' is-disabled' : ''}`}
          >
            {prompt}
          </View>
        ))}
      </View>

      {/* Chat Input Field */}
      <View className="chat-input-area">
        <Input
          ref={inputRef}
          value={inputText}
          onInput={(e) => setInputText(e.detail.value)}
          onConfirm={handleSend}
          disabled={isComposerDisabled}
          placeholder={t('chat.placeholder')}
          className="chat-input"
        />
        {speechSupported && (
          <View
            onClick={isComposerDisabled ? undefined : toggleMic}
            className={`btn-secondary chat-mic-btn${isComposerDisabled ? ' is-disabled' : ''}`}
            title={isListening ? t('chat.micStop') : t('chat.micStart')}
            aria-label={t('chat.micAria')}
            style={{ padding: '0 12px', fontSize: '16px' }}
          >
            {isListening ? '🔴' : '🎤'}
          </View>
        )}
        <View
          onClick={isComposerDisabled ? undefined : handleSend}
          className={`btn-primary chat-send-btn${isComposerDisabled ? ' is-disabled' : ''}`}
          title={isSendingMessage ? t('chat.sendTitleSending') : t('chat.sendTitle')}
        >
          {isSendingMessage ? '⏳' : '🚀'}
        </View>
      </View>
    </View>
  );
}
