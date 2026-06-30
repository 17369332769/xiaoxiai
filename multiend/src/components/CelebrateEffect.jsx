import { useEffect, useState } from 'react';
import { View, Text } from '@tarojs/components';

// Cross-end (H5 + 微信小程序) celebration overlay.
// The web version drew particles on a <canvas> driven by requestAnimationFrame
// and window/document — none of which port to the mini-program runtime. We keep
// the same props (active, type) and default export, but render a lightweight
// shower of emoji as absolutely-positioned <Text> nodes inside a fixed <View>.
// The fall is driven by a setInterval timer (available on both ends) instead of
// canvas / requestAnimationFrame, since keyframe CSS cannot be declared from a
// single self-contained component file.

const ROSE_EMOJI = ['🌹', '🌷', '💐', '🌸'];
const HEART_EMOJI = ['💖', '❤️', '💗', '💕', '✨'];
const STAR_EMOJI = ['⭐', '🌟', '✨', '💫'];

function emojiSetFor(type) {
  if (type === 'roses') return ROSE_EMOJI;
  if (type === 'hearts') return HEART_EMOJI;
  return STAR_EMOJI;
}

function createParticles(type) {
  const emojis = emojiSetFor(type);
  const count = type === 'roses' ? 18 : 24;
  const particles = [];
  for (let i = 0; i < count; i++) {
    particles.push({
      id: i,
      // Percentages relative to the full-screen fixed overlay (no window needed).
      left: Math.random() * 100,
      top: Math.random() * -120, // staggered start above the viewport
      size: Math.random() * 18 + 16,
      speedY: Math.random() * 1.2 + 0.9,
      drift: Math.random() * 2 - 1,
      rotation: Math.random() * 360,
      rotationSpeed: Math.random() * 4 - 2,
      opacity: Math.random() * 0.4 + 0.6,
      emoji: emojis[Math.floor(Math.random() * emojis.length)],
    });
  }
  return particles;
}

export default function CelebrateEffect({ active, type = 'roses' }) {
  const [particles, setParticles] = useState([]);

  useEffect(() => {
    if (!active) {
      setParticles([]);
      return undefined;
    }

    setParticles(createParticles(type));

    const intervalId = setInterval(() => {
      setParticles((prev) =>
        prev.map((p) => {
          let top = p.top + p.speedY;
          let left = p.left;
          let opacity = p.opacity;
          const rotation = p.rotation + p.rotationSpeed;

          // Roses sway as they fall; everything else drifts gently sideways.
          if (type === 'roses') {
            left += Math.sin(top / 18) * 0.6;
          } else {
            left += p.drift * 0.3;
          }

          // Recycle particles that fall off the bottom.
          if (top > 110) {
            top = -10;
            left = Math.random() * 100;
            opacity = Math.random() * 0.4 + 0.6;
          }
          if (left < -5) left = 105;
          if (left > 105) left = -5;

          return { ...p, top, left, rotation, opacity };
        }),
      );
    }, 60);

    return () => clearInterval(intervalId);
  }, [active, type]);

  if (!active) return null;

  return (
    <View
      className="celebrate-effect"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100vw',
        height: '100vh',
        overflow: 'hidden',
        pointerEvents: 'none',
        zIndex: 9999,
        background: 'transparent',
      }}
    >
      {particles.map((p) => (
        <Text
          key={p.id}
          style={{
            position: 'absolute',
            top: `${p.top}%`,
            left: `${p.left}%`,
            fontSize: `${p.size}px`,
            lineHeight: 1,
            opacity: p.opacity,
            transform: `rotate(${p.rotation}deg)`,
            pointerEvents: 'none',
          }}
        >
          {p.emoji}
        </Text>
      ))}
    </View>
  );
}
