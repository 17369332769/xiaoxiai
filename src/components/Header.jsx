import React, { useState, useRef, useEffect } from 'react';

export default function Header({ onlineCount, coins, dailyCheckIn, isCheckInCompleted }) {
  const [isPlaying, setIsPlaying] = useState(false);
  const audioRef = useRef(null);

  // Toggle Background Music
  const togglePlay = () => {
    if (!audioRef.current) return;
    if (isPlaying) {
      audioRef.current.pause();
    } else {
      audioRef.current.play().catch(err => console.log("Audio play blocked by browser. Need user interaction first."));
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
        {/* Dynamic Online Count */}
        <div className="online-users" title="当前和小希共同约会的在线人数">
          <span className="online-dot"></span>
          <span>在线: {onlineCount.toLocaleString()} 人</span>
        </div>

        {/* Coins Counter */}
        <div className="coins-display" title="你的爱心币余额 (可用于购买礼物和食物)">
          <span><span className="coin-icon"></span></span>
          <span>{coins} 爱心币</span>
        </div>

        {/* Daily Check-in Button */}
        <button
          onClick={dailyCheckIn}
          disabled={isCheckInCompleted}
          className={`btn-secondary checkin-btn ${isCheckInCompleted ? 'completed' : ''}`}
          style={{
            padding: '6px 14px',
            borderRadius: '20px',
            fontSize: '13px',
            fontWeight: '600',
            background: isCheckInCompleted ? 'rgba(34, 197, 94, 0.1)' : 'rgba(255, 117, 151, 0.15)',
            color: isCheckInCompleted ? '#4ade80' : '#ff7597',
            borderColor: isCheckInCompleted ? '#22c55e' : '#ff7597',
            cursor: isCheckInCompleted ? 'not-allowed' : 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '4px'
          }}
        >
          <span>📅</span>
          <span>{isCheckInCompleted ? '已签到' : '每日签到'}</span>
        </button>

        {/* Sound toggle button */}
        <button
          onClick={togglePlay}
          className="sound-toggle"
          title={isPlaying ? "关闭背景音乐" : "播放甜美背景音乐"}
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
