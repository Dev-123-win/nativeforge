import React, { useRef, useEffect } from 'react';
import { motion, AnimatePresence, useMotionValue, useTransform, animate } from 'framer-motion';
import { useCurrentFrame, useVideoSync } from '../core';
import { useSFX } from '../hooks/useSFX';

// ─── Google Fonts Import ──────────────────────────────────────────────────────
const fontImport = `
  @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&family=Playfair+Display:ital,wght@0,600;0,700;1,500&family=JetBrains+Mono:wght@600;800&display=swap');
  .apple-h1 { font-family: 'Playfair Display', serif; font-weight: 700; color: #1D1D1F; }
  .apple-h2 { font-family: 'Playfair Display', serif; font-weight: 600; color: #1D1D1F; }
  .apple-body { font-family: 'Plus Jakarta Sans', sans-serif; font-weight: 500; color: #6E6E73; }
  .apple-mono { font-family: 'JetBrains Mono', monospace; font-weight: 800; }
`;

// ─── Design System ─────────────────────────────────────────────────────────────
const appleCardStyle: React.CSSProperties = {
  background: 'rgba(255, 255, 255, 0.92)',
  backdropFilter: 'blur(30px) saturate(190%)',
  border: '1px solid rgba(255, 255, 255, 0.5)',
  borderRadius: '24px',
  padding: '36px',
  color: '#1D1D1F',
  boxShadow: '0 30px 80px rgba(0, 0, 0, 0.06), 0 0 1px rgba(0, 0, 0, 0.04)',
};

const overlayBg: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  background: '#F5F5F7',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  flexDirection: 'column',
};

const easeOutBack = [0.34, 1.56, 0.64, 1] as const; // Elastic overshoot
const easeExpo = [0.16, 1, 0.3, 1] as const;       // Smooth luxury ease
const f = (s: number) => Math.round(s * 25);

// ─── Component: Animated Number Counter ──────────────────────────────────────
function CountingNumber({ value, duration = 1.2, delay = 0.3 }: { value: number; duration?: number; delay?: number }) {
  const count = useMotionValue(0);
  const rounded = useTransform(count, (latest) => {
    return Math.round(latest).toLocaleString();
  });

  useEffect(() => {
    const controls = animate(count, value, {
      duration,
      delay,
      ease: 'easeOut',
    });
    return controls.stop;
  }, [value, count, duration, delay]);

  return <motion.span className="apple-mono">{rounded}</motion.span>;
}

export default function Edit04() {
  const frame = useCurrentFrame();
  const videoRef = useRef<HTMLVideoElement>(null);
  useVideoSync(videoRef);
  const sfx = useSFX();

  // Active beats with clear lifecycles
  const showFlow   = frame >= f(10.1) && frame < f(19.6);
  const showChart  = frame >= f(34.2) && frame < f(58.0);
  const showRipple = frame >= f(58.7) && frame < f(72.0);

  // One-shot SFX
  const fired = useRef<Record<string, boolean>>({});
  const fire = (key: string, fn: () => void) => {
    if (!fired.current[key]) { fired.current[key] = true; fn(); }
  };
  if (showFlow)   fire('flow',   () => sfx.whoosh({ volume: 0.2 } as any));
  if (showChart)  fire('chart',  () => sfx.numberLand({ volume: 0.2 } as any));
  if (showRipple) fire('ripple', () => sfx.tick({ volume: 0.15 } as any));

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden', fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
      <style>{fontImport}</style>

      {/* ── FLAT VIDEO BACKGROUND ── */}
      <video
        ref={videoRef}
        src="/assets/04.mp4"
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
        muted playsInline preload="auto"
      />

      {/* ── Overlay layer z:2 ── */}
      <div style={{ position: 'absolute', inset: 0, zIndex: 2, pointerEvents: 'none' }}>

        {/* ── BEAT 1: Side Panel — Flow diagram ── */}
        <AnimatePresence mode="wait">
          {showFlow && (
            <motion.div
              key="panel-flow"
              style={{ ...appleCardStyle, position: 'absolute', top: '50%', right: '3%', width: 430, transform: 'translateY(-50%)' }}
              initial={{ x: 100, scale: 0.95, opacity: 0 }}
              animate={{ x: 0, scale: 1, opacity: 1 }}
              exit={{ x: 80, scale: 0.98, opacity: 0 }}
              transition={{ type: 'spring', damping: 22, stiffness: 90 }}
            >
              <motion.div
                style={{ width: 48, height: 3, borderRadius: 2, background: '#A63A3A', marginBottom: 22 }}
                initial={{ scaleX: 0, originX: 0 }}
                animate={{ scaleX: 1 }}
                transition={{ duration: 0.5, delay: 0.15, ease: easeExpo }}
              />
              <p className="apple-body" style={{ margin: '0 0 20px', fontSize: 13, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#A63A3A', fontWeight: 700 }}>
                The Recalculation Trap
              </p>

              {[
                { text: 'No application on file', color: '#A63A3A' },
                { text: 'No automatic recalculation', color: '#A63A3A' },
                { text: 'Benefits left on table', color: '#A63A3A' },
              ].map((step, i) => (
                <React.Fragment key={step.text}>
                  <motion.div
                    style={{
                      padding: '14px 18px',
                      borderRadius: 12,
                      background: 'rgba(166,58,58,0.04)',
                      border: '1px solid rgba(166,58,58,0.2)',
                    }}
                    initial={{ x: 30, opacity: 0 }}
                    animate={{ x: 0, opacity: 1 }}
                    transition={{ type: 'spring', damping: 18, stiffness: 100, delay: 0.2 + i * 0.2 }}
                  >
                    <span className="apple-body" style={{ fontSize: 16, color: '#A63A3A', fontWeight: 600 }}>{step.text}</span>
                  </motion.div>
                  {i < 2 && (
                    <motion.div
                      style={{ display: 'flex', justifyContent: 'center', margin: '4px 0', fontSize: 18, color: '#A63A3A' }}
                      initial={{ scale: 0, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      transition={{ type: 'spring', damping: 12, stiffness: 100, delay: 0.35 + i * 0.2 }}
                    >
                      ↓
                    </motion.div>
                  )}
                </React.Fragment>
              ))}
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── BEAT 2: Full-Screen Takeover — Spousal top-up rule bar chart ── */}
        <AnimatePresence mode="wait">
          {showChart && (
            <motion.div
              key="takeover-topup"
              style={overlayBg}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.5, ease: easeExpo }}
            >
              <motion.div
                style={{ width: 560, padding: '0 20px' }}
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, y: -20 }}
                transition={{ type: 'spring', damping: 20, stiffness: 85 }}
              >
                <h1 className="apple-h1" style={{ margin: '0 0 10px', fontSize: 32, textAlign: 'center' }}>
                  Spousal Top-Up Rule
                </h1>
                <p className="apple-body" style={{ margin: '0 0 32px', fontSize: 16, textAlign: 'center', lineHeight: 1.5 }}>
                  If your benefit is less than 50% of your spouse's, you qualify.
                </p>

                {/* YOUR benefit bar */}
                <div style={{ marginBottom: 28 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                    <span className="apple-body" style={{ fontSize: 16, color: '#6E6E73', fontWeight: 600 }}>Your Work Benefit</span>
                    <span className="apple-mono" style={{ fontSize: 22, color: '#0066CC' }}>
                      $<CountingNumber value={700} delay={0.2} />
                    </span>
                  </div>
                  <div style={{ height: 28, borderRadius: 99, background: 'rgba(0,0,0,0.05)', overflow: 'hidden' }}>
                    <motion.div
                      style={{ height: '100%', borderRadius: 99, background: '#0066CC' }}
                      initial={{ width: '0%' }}
                      animate={{ width: '38%' }}
                      transition={{ duration: 0.8, delay: 0.25, ease: easeOutBack }}
                    />
                  </div>
                </div>

                {/* 50% spouse's benefit bar */}
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                    <span className="apple-body" style={{ fontSize: 16, color: '#1D1D1F', fontWeight: 600 }}>50% of Spouse's Benefit</span>
                    <span className="apple-mono" style={{ fontSize: 22, color: '#B58450' }}>
                      $<CountingNumber value={1200} delay={0.4} />
                    </span>
                  </div>
                  <div style={{ height: 28, borderRadius: 99, background: 'rgba(0,0,0,0.05)', overflow: 'hidden' }}>
                    <motion.div
                      style={{ height: '100%', borderRadius: 99, background: '#B58450' }}
                      initial={{ width: '0%' }}
                      animate={{ width: '65%' }}
                      transition={{ duration: 0.8, delay: 0.45, ease: easeOutBack }}
                    />
                  </div>
                </div>

                <motion.p
                  className="apple-h2"
                  style={{ margin: '36px 0 0', textAlign: 'center', fontSize: 22, color: '#347052' }}
                  initial={{ opacity: 0, y: 15 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.5, delay: 1.1, ease: easeExpo }}
                >
                  Entitled to +$500 spousal top-up
                </motion.p>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── BEAT 3: Lower-Third — Spousal raise warning pill ── */}
        <AnimatePresence mode="wait">
          {showRipple && (
            <motion.div
              key="lower-ripple"
              style={{
                position: 'absolute',
                bottom: '6%',
                left: '3%',
                right: '3%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'rgba(255, 255, 255, 0.95)',
                border: '1px solid rgba(181,132,80,0.3)',
                borderRadius: 16,
                padding: '16px 28px',
                boxShadow: '0 12px 36px rgba(0,0,0,0.05)',
                textAlign: 'center',
              }}
              initial={{ y: 60, scale: 0.9, opacity: 0 }}
              animate={{ y: 0, scale: 1, opacity: 1 }}
              exit={{ y: 40, scale: 0.95, opacity: 0 }}
              transition={{ type: 'spring', damping: 16, stiffness: 100 }}
            >
              <span className="apple-body" style={{ fontSize: 17, color: '#B58450', fontWeight: 700 }}>
                ⚠ Spouse's Fairness Act raise may lift your spousal amount too — not always automatic.
              </span>
            </motion.div>
          )}
        </AnimatePresence>

      </div>
    </div>
  );
}
