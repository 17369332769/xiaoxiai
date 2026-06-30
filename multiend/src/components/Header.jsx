import * as React from 'react';
import { View, Text } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { createClientLogger } from '../utils/clientLogger';
import { useLanguage } from '../i18n/index.js';

const { useState, useRef } = React;
const logger = createClientLogger('header');

export default function Header({
  onlineCount,
  coins,
  dailyCheckIn,
  isCheckInCompleted,
  isCheckInPending,
  lastFailedAction,
  retryLastFailedAction,
  notify,
}) {
  const { t, lang, setLang } = useLanguage();
  const [isPlaying, setIsPlaying] = useState(false);
  const audioRef = useRef(null);
  const hasShownAudioHintRef = useRef(false);

  // Lazily create the cross-end audio context (replaces the browser <audio> element).
  const ensureAudio = () => {
    if (!audioRef.current) {
      const ctx = Taro.createInnerAudioContext();
      ctx.src = 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-8.mp3';
      ctx.loop = true;
      ctx.onPlay(() => {
        hasShownAudioHintRef.current = false;
      });
      ctx.onError((error) => {
        logger.warn('Audio playback was blocked by the browser', { error });
        if (!hasShownAudioHintRef.current) {
          notify?.(t('header.musicBlocked'), 'info', t('header.musicBlockedTitle'));
          hasShownAudioHintRef.current = true;
        }
      });
      audioRef.current = ctx;
    }
    return audioRef.current;
  };

  // Toggle Background Music
  const togglePlay = () => {
    const audio = ensureAudio();
    if (!audio) return;
    if (isPlaying) {
      audio.pause();
      hasShownAudioHintRef.current = false;
    } else {
      audio.play();
    }
    setIsPlaying(!isPlaying);
  };

  const isCheckInDisabled = isCheckInCompleted || isCheckInPending;

  return (
    <View className="site-header">
      {/* Background Music Player handled via Taro.createInnerAudioContext (see ensureAudio) */}

      <View className="logo-container">
        <Text className="logo-icon">💖</Text>
        <Text className="logo-text">xiaoxiai.com</Text>
      </View>

      <View className="header-meta">
        {/* Language toggle (中 / EN) */}
        <View
          className="btn-secondary lang-toggle"
          onClick={() => setLang(lang === 'zh' ? 'en' : 'zh')}
          style={{ padding: '6px 12px', borderRadius: '20px', fontSize: '13px', fontWeight: 600 }}
        >
          <Text>{lang === 'zh' ? 'EN' : '中'}</Text>
        </View>

        {/* Dynamic Online Count */}
        <View className="online-users">
          <Text className="online-dot"></Text>
          <Text>{t('header.online', { count: onlineCount.toLocaleString() })}</Text>
        </View>

        {/* Coins Counter */}
        <View className="coins-display">
          <View>
            <Text className="coin-icon"></Text>
          </View>
          <Text>{t('header.coins', { coins })}</Text>
        </View>

        {/* Daily Check-in Button */}
        <View className="header-checkin-group">
          <View
            onClick={isCheckInDisabled ? undefined : dailyCheckIn}
            className={`btn-secondary checkin-btn ${isCheckInCompleted ? 'completed' : ''}${isCheckInDisabled ? ' disabled' : ''}`}
            style={{
              padding: '6px 14px',
              borderRadius: '20px',
              fontSize: '13px',
              fontWeight: '600',
              background: isCheckInCompleted ? 'rgba(34, 197, 94, 0.1)' : 'rgba(255, 117, 151, 0.15)',
              color: isCheckInCompleted ? '#4ade80' : '#ff7597',
              borderColor: isCheckInCompleted ? '#22c55e' : '#ff7597',
              cursor: (isCheckInCompleted || isCheckInPending) ? 'not-allowed' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '4px'
            }}
          >
            <Text>📅</Text>
            <Text>{isCheckInCompleted ? t('header.checkedIn') : (isCheckInPending ? t('header.checkingIn') : t('header.dailyCheckin'))}</Text>
          </View>

          {lastFailedAction?.kind === 'checkin' && (
            <View
              className={`btn-secondary checkin-retry-inline${isCheckInPending ? ' disabled' : ''}`}
              onClick={isCheckInPending ? undefined : retryLastFailedAction}
            >
              <Text>{isCheckInPending ? t('common.retrying') : t('header.retryCheckin')}</Text>
            </View>
          )}
        </View>

        {/* Sound toggle button */}
        <View
          onClick={togglePlay}
          className="sound-toggle"
          style={{
            position: 'relative',
            overflow: 'visible'
          }}
        >
          <Text>{isPlaying ? '🎵' : '🔇'}</Text>
          {isPlaying && (
            <Text
              style={{
                position: 'absolute',
                top: '-5px',
                right: '-5px',
                fontSize: '10px',
                animation: 'breathe 1.5s infinite'
              }}
            >
              ✨
            </Text>
          )}
        </View>
      </View>
    </View>
  );
}
