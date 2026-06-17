import React, { useEffect, useRef } from 'react';

export default function CelebrateEffect({ active, type = 'roses' }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    if (!active) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    let animationFrameId;

    // Set canvas dimensions
    const resizeCanvas = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    // Particle Classes
    const particles = [];
    const maxParticles = type === 'roses' ? 70 : 100;

    class Particle {
      constructor() {
        this.x = Math.random() * canvas.width;
        this.y = Math.random() * -canvas.height;
        this.size = Math.random() * 15 + 8;
        this.speedY = Math.random() * 2 + 1.5;
        this.speedX = Math.random() * 2 - 1;
        this.rotation = Math.random() * 360;
        this.rotationSpeed = Math.random() * 2 - 1;
        this.opacity = Math.random() * 0.5 + 0.5;
        
        // Color configs based on type
        if (type === 'roses') {
          // Pink/Rose colors
          const hue = Math.floor(Math.random() * 20) + 340; // 340 to 360 (pink/red)
          this.color = `hsla(${hue}, 95%, 70%, ${this.opacity})`;
          this.isRosePetal = true;
        } else if (type === 'hearts') {
          // Heart emojis or pink dots
          this.emoji = ['💖', '❤️', '💗', '💕', '✨'][Math.floor(Math.random() * 5)];
          this.isEmoji = true;
        } else {
          // Stars (Gold Shimmer)
          this.color = `rgba(255, 210, 105, ${this.opacity})`;
          this.isStar = true;
        }
      }

      update() {
        this.y += this.speedY;
        this.x += this.speedX;
        this.rotation += this.rotationSpeed;

        // Drift sideways
        if (type === 'roses') {
          this.speedX = Math.sin(this.y / 30) * 0.8;
        }

        // Reset particle if off bottom
        if (this.y > canvas.height) {
          this.y = -20;
          this.x = Math.random() * canvas.width;
          this.opacity = Math.random() * 0.5 + 0.5;
        }
      }

      draw() {
        ctx.save();
        ctx.translate(this.x, this.y);
        ctx.rotate((this.rotation * Math.PI) / 180);

        if (this.isEmoji) {
          ctx.font = `${this.size}px Noto Sans SC`;
          ctx.fillText(this.emoji, -this.size / 2, this.size / 2);
        } else if (this.isRosePetal) {
          // Draw a curved rose petal
          ctx.beginPath();
          ctx.fillStyle = this.color;
          ctx.ellipse(0, 0, this.size, this.size / 1.5, 0, 0, Math.PI * 2);
          ctx.fill();
          
          // Petal veins/highlight
          ctx.beginPath();
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
          ctx.lineWidth = 1;
          ctx.moveTo(-this.size, 0);
          ctx.lineTo(this.size, 0);
          ctx.stroke();
        } else if (this.isStar) {
          // Draw standard 5-point star
          ctx.fillStyle = this.color;
          ctx.beginPath();
          const spikes = 5;
          const outerRadius = this.size;
          const innerRadius = this.size / 2;
          let rot = (Math.PI / 2) * 3;
          let cx = 0;
          let cy = 0;
          let step = Math.PI / spikes;

          ctx.moveTo(cx, cy - outerRadius);
          for (let i = 0; i < spikes; i++) {
            cx = Math.cos(rot) * outerRadius;
            cy = Math.sin(rot) * outerRadius;
            ctx.lineTo(cx, cy);
            rot += step;

            cx = Math.cos(rot) * innerRadius;
            cy = Math.sin(rot) * innerRadius;
            ctx.lineTo(cx, cy);
            rot += step;
          }
          ctx.lineTo(0, 0 - outerRadius);
          ctx.closePath();
          ctx.shadowBlur = 10;
          ctx.shadowColor = 'rgba(255, 210, 105, 0.8)';
          ctx.fill();
        }

        ctx.restore();
      }
    }

    // Populate particles
    for (let i = 0; i < maxParticles; i++) {
      particles.push(new Particle());
    }

    // Animation Loop
    const drawFrame = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      
      particles.forEach(p => {
        p.update();
        p.draw();
      });

      animationFrameId = requestAnimationFrame(drawFrame);
    };

    drawFrame();

    // Cleanup
    return () => {
      cancelAnimationFrame(animationFrameId);
      window.removeEventListener('resize', resizeCanvas);
    };
  }, [active, type]);

  if (!active) return null;

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100vw',
        height: '100vh',
        pointerEvents: 'none',
        zIndex: 9999,
        background: 'transparent'
      }}
    />
  );
}
