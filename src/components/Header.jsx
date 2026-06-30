import * as React from 'react';
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

  // Toggle Background Music
  const togglePlay = () => {
    if (!audioRef.current) return;
    if (isPlaying) {
      audioRef.current.pause();
      hasShownAudioHintRef.current = false;
    } else {
      audioRef.current.play().then(() => {
        hasShownAudioHintRef.current = false;
      }).catch((error) => {
        logger.warn('Audio playback was blocked by the browser', { error });
        if (!hasShownAudioHintRef.current) {
          notify?.(t('header.musicBlocked'), 'info', t('header.musicBlockedTitle'));
          hasShownAudioHintRef.current = true;
        }
      });
    }
    setIsPlaying(!isPlaying);
  };

  return (
    <header className="site-header">
      {/* Background Music Player (Gentle Romantic Piano Lofi) */}
      <audio
        ref={audioRef}
        src="https://www.soundhelix.com/examples/mp3/SoundHelix-Song-8.mp3"
        loop
      />

      <div className="logo-container">
        <span className="logo-icon">💖</span>
        <span className="logo-text">xiaoxiai.com</span>
      </div>

      <div className="header-meta">
        {/* Language toggle (中 / EN) */}
        <button
          type="button"
          className="btn-secondary lang-toggle"
          onClick={() => setLang(lang === 'zh' ? 'en' : 'zh')}
          title={t('header.langToggleTitle')}
          style={{ padding: '6px 12px', borderRadius: '20px', fontSize: '13px', fontWeight: 600 }}
        >
          {lang === 'zh' ? 'EN' : '中'}
        </button>

        {/* Dynamic Online Count */}
        <div className="online-users" title={t('header.onlineTitle')}>
          <span className="online-dot"></span>
          <span>{t('header.online', { count: onlineCount.toLocaleString() })}</span>
        </div>

        {/* Coins Counter */}
        <div className="coins-display" title={t('header.coinsTitle')}>
          <span><span className="coin-icon"></span></span>
          <span>{t('header.coins', { coins })}</span>
        </div>

        {/* Daily Check-in Button */}
        <div className="header-checkin-group">
          <button
            onClick={dailyCheckIn}
            disabled={isCheckInCompleted || isCheckInPending}
            className={`btn-secondary checkin-btn ${isCheckInCompleted ? 'completed' : ''}`}
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
            <span>📅</span>
            <span>{isCheckInCompleted ? t('header.checkedIn') : (isCheckInPending ? t('header.checkingIn') : t('header.dailyCheckin'))}</span>
          </button>

          {lastFailedAction?.kind === 'checkin' && (
            <button
              type="button"
              className="btn-secondary checkin-retry-inline"
              onClick={retryLastFailedAction}
              disabled={isCheckInPending}
            >
              {isCheckInPending ? t('common.retrying') : t('header.retryCheckin')}
            </button>
          )}
        </div>

        {/* Sound toggle button */}
        <button
          onClick={togglePlay}
          className="sound-toggle"
          title={isPlaying ? t('header.musicOff') : t('header.musicOn')}
          style={{
            position: 'relative',
            overflow: 'visible'
          }}
        >
          <span>{isPlaying ? '🎵' : '🔇'}</span>
          {isPlaying && (
            <span
              style={{
                position: 'absolute',
                top: '-5px',
                right: '-5px',
                fontSize: '10px',
                animation: 'breathe 1.5s infinite'
              }}
            >
              ✨
            </span>
          )}
        </button>
      </div>
    </header>
  );
}
