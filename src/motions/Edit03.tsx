import React, { useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
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

const easeExpo = [0.16, 1, 0.3, 1] as const;
const f = (s: number) => Math.round(s * 25);

// ─── Component: Digit Scroller Odometer ───────────────────────────────────────
function Digit({ value, delay, color = '#B58450' }: { value: string; delay: number; color?: string }) {
  const num = parseInt(value, 10);
  if (isNaN(num)) {
    return <span className="apple-mono" style={{ fontSize: 90, color }}>{value}</span>;
  }
  return (
    <div style={{ height: 100, overflow: 'hidden', display: 'inline-block', position: 'relative' }}>
      <motion.div
        initial={{ y: 0 }}
        animate={{ y: -num * 100 }}
        transition={{ type: 'spring', damping: 15, stiffness: 60, delay }}
        style={{ display: 'flex', flexDirection: 'column' }}
      >
        {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
          <span key={n} className="apple-mono" style={{ fontSize: 90, height: 100, display: 'block', lineHeight: '100px', color }}>
            {n}
          </span>
        ))}
      </motion.div>
    </div>
  );
}

export default function Edit03() {
  const frame = useCurrentFrame();
  const videoRef = useRef<HTMLVideoElement>(null);
  useVideoSync(videoRef);
  const sfx = useSFX();

  // Active beats with clear entry, hold, and exit lifecycles
  const showSevenInTen = frame >= f(8.8)  && frame < f(18.0);
  const showSteps      = frame >= f(38.3) && frame < f(52.0);
  const showUrgency    = frame >= f(52.6) && frame < f(70.5);

  // One-shot SFX
  const fired = useRef<Record<string, boolean>>({});
  const fire = (key: string, fn: () => void) => {
    if (!fired.current[key]) { fired.current[key] = true; fn(); }
  };
  if (showSevenInTen) fire('7in10',   () => sfx.numberLand({ volume: 0.2 } as any));
  if (showSteps)      fire('steps',   () => sfx.whoosh({ volume: 0.2 } as any));
  if (showUrgency)    fire('urgency', () => sfx.tick({ volume: 0.15 } as any));

  const segments = Array.from({ length: 10 }, (_, i) => i);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden', fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
      <style>{fontImport}</style>

      {/* ── FLAT VIDEO BACKGROUND ── */}
      <video
        ref={videoRef}
        src="/assets/03.mp4"
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
        muted playsInline preload="auto"
      />

      {/* ── Overlay layer z:2 ── */}
      <div style={{ position: 'absolute', inset: 0, zIndex: 2, pointerEvents: 'none' }}>

        {/* ── BEAT 1: Full-Screen Takeover — "7 in 10" + segmented bar ── */}
        <AnimatePresence mode="wait">
          {showSevenInTen && (
            <motion.div
              key="takeover-7in10"
              style={overlayBg}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.5, ease: easeExpo }}
            >
              <motion.div
                style={{ textAlign: 'center', width: 560, padding: '0 20px' }}
                initial={{ opacity: 0, scale: 0.94 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, y: -20, scale: 0.96 }}
                transition={{ type: 'spring', damping: 20, stiffness: 80 }}
              >
                {/* 7 in 10 Odometer */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 100, marginBottom: 20 }}>
                  <Digit value="7" delay={0.15} />
                  <span className="apple-h1" style={{ fontSize: 56, color: '#B58450', margin: '0 18px', fontWeight: 600 }}>in</span>
                  <Digit value="1" delay={0.25} />
                  <Digit value="0" delay={0.35} />
                </div>

                {/* Segmented bar — 7 red + 3 gray */}
                <div style={{ display: 'flex', gap: 6, marginBottom: 28, justifyContent: 'center' }}>
                  {segments.map((i) => (
                    <motion.div
                      key={i}
                      style={{
                        width: 44,
                        height: 18,
                        borderRadius: 4,
                        background: i < 7 ? '#A63A3A' : 'rgba(0,0,0,0.06)',
                      }}
                      initial={{ scale: 0, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      transition={{ type: 'spring', damping: 12, stiffness: 100, delay: 0.3 + i * 0.06 }}
                    />
                  ))}
                </div>

                {/* Subtitle Word Reveal */}
                <p className="apple-h1" style={{ margin: 0, fontSize: 26, fontWeight: 700 }}>
                  {"spousal or survivor benefit cut to".split(" ").map((word, idx) => (
                    <span key={idx} style={{ display: 'inline-block', overflow: 'hidden', marginRight: '0.25em' }}>
                      <motion.span
                        style={{ display: 'inline-block' }}
                        initial={{ y: '100%', opacity: 0 }}
                        animate={{ y: 0, opacity: 1 }}
                        transition={{ type: 'spring', damping: 16, stiffness: 100, delay: 0.6 + idx * 0.08 }}
                      >
                        {word}
                      </motion.span>
                    </span>
                  ))}
                  <span style={{ display: 'inline-block', overflow: 'hidden', marginLeft: '0.1em' }}>
                    <motion.span
                      className="apple-mono"
                      style={{ display: 'inline-block', color: '#A63A3A' }}
                      initial={{ scale: 0, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      transition={{ type: 'spring', damping: 10, stiffness: 120, delay: 1.1 }}
                    >
                      $0
                    </motion.span>
                  </span>
                </p>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── BEAT 2: Side Panel — Two-step comparison ── */}
        <AnimatePresence mode="wait">
          {showSteps && (
            <motion.div
              key="panel-steps"
              style={{ ...appleCardStyle, position: 'absolute', top: '50%', right: '3%', width: 430, transform: 'translateY(-50%)' }}
              initial={{ x: 100, scale: 0.95, opacity: 0 }}
              animate={{ x: 0, scale: 1, opacity: 1 }}
              exit={{ x: 80, scale: 0.98, opacity: 0 }}
              transition={{ type: 'spring', damping: 22, stiffness: 90 }}
            >
              <motion.div
                style={{ width: 48, height: 3, borderRadius: 2, background: '#0066CC', marginBottom: 22 }}
                initial={{ scaleX: 0, originX: 0 }}
                animate={{ scaleX: 1 }}
                transition={{ duration: 0.5, delay: 0.15, ease: easeExpo }}
              />
              <p className="apple-body" style={{ margin: '0 0 20px', fontSize: 13, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#0066CC', fontWeight: 700 }}>
                Fix Is NOT Automatic
              </p>

              {/* Step A — old path */}
              <motion.div
                style={{
                  padding: '16px 18px',
                  borderRadius: 14,
                  background: 'rgba(166,58,58,0.04)',
                  border: '1px solid rgba(166,58,58,0.2)',
                  marginBottom: 14,
                }}
                initial={{ x: 30, opacity: 0 }}
                animate={{ x: 0, opacity: 1 }}
                transition={{ type: 'spring', damping: 18, stiffness: 90, delay: 0.25 }}
              >
                <p className="apple-body" style={{ margin: '0 0 10px', fontSize: 13, fontWeight: 700, color: '#A63A3A', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                  Old Path ✗
                </p>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 12px' }}>
                  {['Told $0', 'Never filed', 'No recalculation'].map((step, i) => (
                    <motion.div
                      key={step}
                      style={{ display: 'flex', alignItems: 'center', gap: 6 }}
                      initial={{ opacity: 0, scale: 0.8 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ duration: 0.4, delay: 0.35 + i * 0.1, ease: easeExpo }}
                    >
                      <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#A63A3A' }} />
                      <span className="apple-body" style={{ fontSize: 15, color: '#A63A3A', fontWeight: 600 }}>{step}</span>
                      {i < 2 && <span className="apple-body" style={{ fontSize: 13, color: '#8e8e93' }}>→</span>}
                    </motion.div>
                  ))}
                </div>
              </motion.div>

              {/* Step B — correct path */}
              <motion.div
                style={{
                  padding: '16px 18px',
                  borderRadius: 14,
                  background: 'rgba(52,112,82,0.04)',
                  border: '1px solid rgba(52,112,82,0.2)',
                }}
                initial={{ x: 30, opacity: 0 }}
                animate={{ x: 0, opacity: 1 }}
                transition={{ type: 'spring', damping: 18, stiffness: 90, delay: 0.4 }}
              >
                <p className="apple-body" style={{ margin: '0 0 10px', fontSize: 13, fontWeight: 700, color: '#347052', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                  Correct Path ✓
                </p>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 12px' }}>
                  {['Rule changed', 'You MUST file', 'Recalculation'].map((step, i) => (
                    <motion.div
                      key={step}
                      style={{ display: 'flex', alignItems: 'center', gap: 6 }}
                      initial={{ opacity: 0, scale: 0.8 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ duration: 0.4, delay: 0.5 + i * 0.1, ease: easeExpo }}
                    >
                      <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#347052' }} />
                      <span className="apple-body" style={{ fontSize: 15, color: '#347052', fontWeight: 700 }}>{step}</span>
                      {i < 2 && <span className="apple-body" style={{ fontSize: 13, color: '#8e8e93' }}>→</span>}
                    </motion.div>
                  ))}
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── BEAT 3: Lower-Third + Side Panel — Urgency ── */}
        <AnimatePresence mode="wait">
          {showUrgency && (
            <>
              {/* Lower-Third pill */}
              <motion.div
                key="lower-urgency"
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
                }}
                initial={{ y: 60, scale: 0.9, opacity: 0 }}
                animate={{ y: 0, scale: 1, opacity: 1 }}
                exit={{ y: 40, scale: 0.95, opacity: 0 }}
                transition={{ type: 'spring', damping: 16, stiffness: 100 }}
              >
                <span className="apple-body" style={{ fontSize: 18, fontWeight: 700, color: '#B58450' }}>
                  Retroactive limit: 6 months from filing date
                </span>
              </motion.div>

              {/* Side panel — timeline bar */}
              <motion.div
                key="panel-timeline"
                style={{ ...appleCardStyle, position: 'absolute', top: '16%', right: '3%', width: 430 }}
                initial={{ x: 100, scale: 0.95, opacity: 0 }}
                animate={{ x: 0, scale: 1, opacity: 1 }}
                exit={{ x: 80, scale: 0.98, opacity: 0 }}
                transition={{ type: 'spring', damping: 22, stiffness: 90 }}
              >
                <motion.div
                  style={{ width: 48, height: 3, borderRadius: 2, background: '#B58450', marginBottom: 22 }}
                  initial={{ scaleX: 0, originX: 0 }}
                  animate={{ scaleX: 1 }}
                  transition={{ duration: 0.5, delay: 0.15, ease: easeExpo }}
                />
                <p className="apple-body" style={{ margin: '0 0 22px', fontSize: 13, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#B58450', fontWeight: 700 }}>
                  Back Pay Window
                </p>

                {/* Timeline bar with track grow */}
                <div style={{ position: 'relative', marginBottom: 12 }}>
                  <div style={{ height: 8, borderRadius: 99, background: 'rgba(0,0,0,0.05)', overflow: 'hidden' }}>
                    <motion.div
                      style={{ height: '100%', borderRadius: 99, background: 'linear-gradient(90deg, #347052, #B58450 70%, #A63A3A)' }}
                      initial={{ width: '0%' }}
                      animate={{ width: '100%' }}
                      transition={{ duration: 1.0, delay: 0.35, ease: easeExpo }}
                    />
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8 }}>
                    <motion.span className="apple-mono" style={{ fontSize: 12, color: '#347052' }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.45 }}>Jan 2024</motion.span>
                    <motion.span className="apple-mono" style={{ fontSize: 12, color: '#B58450' }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.65 }}>Today</motion.span>
                    <motion.span className="apple-mono" style={{ fontSize: 12, color: '#A63A3A' }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.85 }}>6mo limit</motion.span>
                  </div>
                </div>

                <p className="apple-body" style={{ margin: '14px 0 0', fontSize: 15, lineHeight: 1.55 }}>
                  Every month you wait is a month of back pay you may never recover.
                </p>
              </motion.div>
            </>
          )}
        </AnimatePresence>

      </div>
    </div>
  );
}
