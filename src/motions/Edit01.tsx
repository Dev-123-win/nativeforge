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

// ─── Component: Digit Scroller Odometer ───────────────────────────────────────
function Digit({ value, delay }: { value: string; delay: number }) {
  const num = parseInt(value, 10);
  if (isNaN(num)) {
    return <span className="apple-mono" style={{ fontSize: 100, color: '#B58450' }}>{value}</span>;
  }
  return (
    <div style={{ height: 110, overflow: 'hidden', display: 'inline-block', position: 'relative' }}>
      <motion.div
        initial={{ y: 0 }}
        animate={{ y: -num * 110 }}
        transition={{ type: 'spring', damping: 15, stiffness: 60, delay }}
        style={{ display: 'flex', flexDirection: 'column' }}
      >
        {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
          <span key={n} className="apple-mono" style={{ fontSize: 100, height: 110, display: 'block', lineHeight: '110px', color: '#B58450' }}>
            {n}
          </span>
        ))}
      </motion.div>
    </div>
  );
}

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

export default function Edit01() {
  const frame = useCurrentFrame();
  const videoRef = useRef<HTMLVideoElement>(null);
  useVideoSync(videoRef);
  const sfx = useSFX();

  // Active beats with clear entry, hold, and exit lifecycles
  const show400       = frame >= f(0.5)  && frame < f(6.5);
  const showMillions  = frame >= f(7.9)  && frame < f(20.0);
  const showReasons   = frame >= f(41.1) && frame < f(46.5);
  const showChart     = frame >= f(47.4) && frame < f(59.5);
  const showCTA       = frame >= f(61.4) && frame < f(67.0);

  // One-shot SFX
  const fired = useRef<Record<string, boolean>>({});
  const fire = (key: string, fn: () => void) => {
    if (!fired.current[key]) { fired.current[key] = true; fn(); }
  };
  if (show400)      fire('400',    () => sfx.whoosh({ volume: 0.2 } as any));
  if (showMillions) fire('mill',   () => sfx.tick({ volume: 0.15 } as any));
  if (showReasons)  fire('reason', () => sfx.whoosh({ volume: 0.2 } as any));
  if (showChart)    fire('chart',  () => sfx.numberLand({ volume: 0.2 } as any));
  if (showCTA)      fire('cta',    () => sfx.success({ volume: 0.18 } as any));

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden', fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
      <style>{fontImport}</style>

      {/* ── FLAT VIDEO BACKGROUND ── */}
      <video
        ref={videoRef}
        src="/assets/01.mp4"
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
        muted playsInline preload="auto"
      />

      {/* ── Overlay layer z:2 ── */}
      <div style={{ position: 'absolute', inset: 0, zIndex: 2, pointerEvents: 'none' }}>

        {/* ── BEAT 1: Full-Screen Takeover — $400 scroller ── */}
        <AnimatePresence mode="wait">
          {show400 && (
            <motion.div
              key="takeover-400"
              style={overlayBg}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.5, ease: easeExpo }}
            >
              <motion.div
                initial={{ opacity: 0, scale: 0.94 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, y: -20, scale: 0.96 }}
                transition={{ type: 'spring', damping: 20, stiffness: 80 }}
                style={{ textAlign: 'center' }}
              >
                {/* Odometer +$400 */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 110 }}>
                  <motion.span
                    className="apple-mono"
                    style={{ fontSize: 100, color: '#B58450', lineHeight: '110px' }}
                    initial={{ y: 30, opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                    transition={{ duration: 0.4, delay: 0.1, ease: easeExpo }}
                  >
                    +$
                  </motion.span>
                  <Digit value="4" delay={0.2} />
                  <Digit value="0" delay={0.3} />
                  <Digit value="0" delay={0.4} />
                </div>

                {/* Staggered Word Reveal */}
                <p className="apple-h1" style={{ margin: '28px 0 0', fontSize: 36, fontWeight: 700 }}>
                  {"hiding in your check every month".split(" ").map((word, idx) => (
                    <span key={idx} style={{ display: 'inline-block', overflow: 'hidden', marginRight: '0.25em' }}>
                      <motion.span
                        style={{ display: 'inline-block' }}
                        initial={{ y: '100%', opacity: 0 }}
                        animate={{ y: 0, opacity: 1 }}
                        transition={{ type: 'spring', damping: 16, stiffness: 100, delay: 0.55 + idx * 0.08 }}
                      >
                        {word}
                      </motion.span>
                    </span>
                  ))}
                </p>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── BEAT 2: Lower-Third — Millions pill badge with check drawing ── */}
        <AnimatePresence mode="wait">
          {showMillions && (
            <motion.div
              key="lower-millions"
              style={{
                position: 'absolute',
                bottom: '6%',
                left: '3%',
                display: 'flex',
                alignItems: 'center',
                gap: 14,
                background: 'rgba(255, 255, 255, 0.95)',
                border: '1px solid rgba(52,112,82,0.3)',
                borderRadius: 999,
                padding: '16px 32px',
                boxShadow: '0 15px 45px rgba(0,0,0,0.06)',
              }}
              initial={{ y: 60, scale: 0.9, opacity: 0 }}
              animate={{ y: 0, scale: 1, opacity: 1 }}
              exit={{ y: 40, scale: 0.95, opacity: 0 }}
              transition={{ type: 'spring', damping: 16, stiffness: 100 }}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }}>
                <motion.path
                  d="M20 6L9 17L4 12"
                  stroke="#347052"
                  strokeWidth="3.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  initial={{ pathLength: 0 }}
                  animate={{ pathLength: 1 }}
                  transition={{ duration: 0.5, delay: 0.35, ease: 'easeOut' }}
                />
              </svg>
              <span className="apple-body" style={{ fontSize: 17, color: '#347052', fontWeight: 700 }}>
                Millions of retirees — already fixed
              </span>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── BEAT 3: Side Panel — 3 Reasons ── */}
        <AnimatePresence mode="wait">
          {showReasons && (
            <motion.div
              key="panel-reasons"
              style={{ ...appleCardStyle, position: 'absolute', top: '50%', right: '3%', width: 430, transform: 'translateY(-50%)' }}
              initial={{ x: 100, scale: 0.95, opacity: 0 }}
              animate={{ x: 0, scale: 1, opacity: 1 }}
              exit={{ x: 80, scale: 0.98, opacity: 0 }}
              transition={{ type: 'spring', damping: 22, stiffness: 90 }}
            >
              <motion.div
                style={{ width: 48, height: 3, borderRadius: 2, background: '#B58450', marginBottom: 22 }}
                initial={{ scaleX: 0, originX: 0 }}
                animate={{ scaleX: 1 }}
                transition={{ duration: 0.5, delay: 0.2, ease: easeExpo }}
              />
              <p className="apple-body" style={{ margin: '0 0 24px', fontSize: 13, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#B58450', fontWeight: 700 }}>
                3 Reasons Your Check May Be Short
              </p>
              {[
                { n: '01', label: 'New 2025 Law', color: '#0066CC' },
                { n: '02', label: 'Spousal & Divorce Rules', color: '#A78BFA' },
                { n: '03', label: 'Earnings Records', color: '#347052' },
              ].map((item, i) => (
                <div key={item.n} style={{ display: 'flex', alignItems: 'center', gap: 18, marginBottom: i < 2 ? 20 : 0 }}>
                  <motion.span
                    className="apple-mono"
                    style={{ fontSize: 24, color: item.color, minWidth: 38 }}
                    initial={{ scale: 0, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ type: 'spring', damping: 15, stiffness: 120, delay: 0.25 + i * 0.15 }}
                  >
                    {item.n}
                  </motion.span>
                  <div style={{ overflow: 'hidden' }}>
                    <motion.span
                      className="apple-body"
                      style={{ fontSize: 18, color: '#1D1D1F', fontWeight: 600, display: 'block' }}
                      initial={{ y: '100%' }}
                      animate={{ y: 0 }}
                      transition={{ duration: 0.5, delay: 0.35 + i * 0.15, ease: easeExpo }}
                    >
                      {item.label}
                    </motion.span>
                  </div>
                </div>
              ))}
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── BEAT 4: Full-Screen Takeover — Before/After bar chart ── */}
        <AnimatePresence mode="wait">
          {showChart && (
            <motion.div
              key="takeover-chart"
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
                <p className="apple-body" style={{ margin: '0 0 32px', fontSize: 14, letterSpacing: '0.12em', textTransform: 'uppercase', fontWeight: 700, textAlign: 'center' }}>
                  Benefit Comparison
                </p>

                {/* BEFORE bar */}
                <div style={{ marginBottom: 28 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                    <span className="apple-body" style={{ fontSize: 16, color: '#6E6E73', fontWeight: 600 }}>Before Fairness Act</span>
                    <span className="apple-mono" style={{ fontSize: 22, color: '#A63A3A' }}>
                      $<CountingNumber value={1240} delay={0.2} />
                    </span>
                  </div>
                  <div style={{ height: 28, borderRadius: 99, background: 'rgba(0,0,0,0.05)', overflow: 'hidden' }}>
                    <motion.div
                      style={{ height: '100%', borderRadius: 99, background: '#A63A3A' }}
                      initial={{ width: '0%' }}
                      animate={{ width: '52%' }}
                      transition={{ duration: 0.8, delay: 0.25, ease: easeOutBack }}
                    />
                  </div>
                </div>

                {/* AFTER bar */}
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                    <span className="apple-body" style={{ fontSize: 16, color: '#1D1D1F', fontWeight: 600 }}>After Jan 2025</span>
                    <span className="apple-mono" style={{ fontSize: 22, color: '#347052' }}>
                      $<CountingNumber value={1640} delay={0.4} />
                    </span>
                  </div>
                  <div style={{ height: 28, borderRadius: 99, background: 'rgba(0,0,0,0.05)', overflow: 'hidden' }}>
                    <motion.div
                      style={{ height: '100%', borderRadius: 99, background: '#347052' }}
                      initial={{ width: '0%' }}
                      animate={{ width: '76%' }}
                      transition={{ duration: 0.8, delay: 0.45, ease: easeOutBack }}
                    />
                  </div>
                </div>

                <motion.p
                  className="apple-h2"
                  style={{ margin: '36px 0 0', textAlign: 'center', fontSize: 22, color: '#B58450' }}
                  initial={{ opacity: 0, y: 15 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.5, delay: 1.1, ease: easeExpo }}
                >
                  +$360 to +$400 a month — restored
                </motion.p>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── BEAT 5: Side Panel — Coming Up CTA with staggered internals ── */}
        <AnimatePresence mode="wait">
          {showCTA && (
            <motion.div
              key="panel-cta"
              style={{ ...appleCardStyle, position: 'absolute', top: '50%', right: '3%', width: 430, transform: 'translateY(-50%)' }}
              initial={{ x: 100, scale: 0.95, opacity: 0 }}
              animate={{ x: 0, scale: 1, opacity: 1 }}
              exit={{ x: 80, scale: 0.98, opacity: 0 }}
              transition={{ type: 'spring', damping: 22, stiffness: 90 }}
            >
              {/* Draw gold line */}
              <motion.div
                style={{ height: 3, borderRadius: 2, background: '#B58450', marginBottom: 22 }}
                initial={{ width: 0 }}
                animate={{ width: 48 }}
                transition={{ duration: 0.6, delay: 0.15, ease: easeExpo }}
              />

              {/* Stagger label */}
              <div style={{ overflow: 'hidden', marginBottom: 14 }}>
                <motion.p
                  className="apple-body"
                  style={{ margin: 0, fontSize: 13, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#0066CC', fontWeight: 700 }}
                  initial={{ y: '100%' }}
                  animate={{ y: 0 }}
                  transition={{ duration: 0.5, delay: 0.25, ease: easeExpo }}
                >
                  Coming Up →
                </motion.p>
              </div>

              {/* Stagger title */}
              <div style={{ overflow: 'hidden' }}>
                <motion.h2
                  className="apple-h2"
                  style={{ margin: 0, fontSize: 24, lineHeight: 1.4 }}
                  initial={{ y: '100%' }}
                  animate={{ y: 0 }}
                  transition={{ duration: 0.6, delay: 0.35, ease: easeExpo }}
                >
                  Exact words to say when you call
                </motion.h2>
              </div>

              {/* Stagger body */}
              <div style={{ overflow: 'hidden', marginTop: 16 }}>
                <motion.p
                  className="apple-body"
                  style={{ margin: 0, fontSize: 17, lineHeight: 1.6 }}
                  initial={{ y: '100%', opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  transition={{ duration: 0.6, delay: 0.5, ease: easeExpo }}
                >
                  Every dollar that's actually yours — step by step.
                </motion.p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

      </div>
    </div>
  );
}
