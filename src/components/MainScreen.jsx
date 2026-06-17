import React, { useState } from 'react';
import xiaoxiNormal from '../assets/xiaoxi_normal.png';
import xiaoxiHappy from '../assets/xiaoxi_happy.png';
import xiaoxiBlush from '../assets/xiaoxi_blush.png';

export default function MainScreen({ level, affection, energy, mood, avatarState }) {
  const [clickHearts, setClickHearts] = useState([]);

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


