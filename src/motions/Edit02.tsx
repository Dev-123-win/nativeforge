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
function Digit({ value, delay, color = '#A63A3A' }: { value: string; delay: number; color?: string }) {
  const num = parseInt(value, 10);
  if (isNaN(num)) {
    return <span className="apple-mono" style={{ fontSize: 100, color }}>{value}</span>;
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
          <span key={n} className="apple-mono" style={{ fontSize: 100, height: 110, display: 'block', lineHeight: '110px', color }}>
            {n}
          </span>
        ))}
      </motion.div>
    </div>
  );
}

export default function Edit02() {
  const frame = useCurrentFrame();
  const videoRef = useRef<HTMLVideoElement>(null);
  useVideoSync(videoRef);
  const sfx = useSFX();

  // Active beats with clear entry, hold, and exit lifecycles
  const showJobs   = frame >= f(9.8)  && frame < f(22.0);
  const showCut    = frame >= f(23.0) && frame < f(34.5);
  const showAct    = frame >= f(35.3) && frame < f(45.0);
  const showCheck  = frame >= f(63.0) && frame < f(90.0);

  // One-shot SFX
  const fired = useRef<Record<string, boolean>>({});
  const fire = (key: string, fn: () => void) => {
    if (!fired.current[key]) { fired.current[key] = true; fn(); }
  };
  if (showJobs)  fire('jobs',  () => sfx.tick({ volume: 0.15 } as any));
  if (showCut)   fire('cut',   () => sfx.numberLand({ volume: 0.2 } as any));
  if (showAct)   fire('act',   () => sfx.success({ volume: 0.18 } as any));
  if (showCheck) fire('check', () => sfx.whoosh({ volume: 0.2 } as any));

  const jobs = ['Teachers', 'Police Officers', 'Firefighters', 'Federal Employees'];

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden', fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
      <style>{fontImport}</style>

      {/* ── FLAT VIDEO BACKGROUND ── */}
      <video
        ref={videoRef}
        src="/assets/02.mp4"
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
        muted playsInline preload="auto"
      />

      {/* ── Overlay layer z:2 ── */}
      <div style={{ position: 'absolute', inset: 0, zIndex: 2, pointerEvents: 'none' }}>

        {/* ── BEAT 1: Lower-Third — Staggered Job Pills ── */}
        <AnimatePresence mode="wait">
          {showJobs && (
            <motion.div
              key="lower-jobs"
              style={{
                position: 'absolute',
                bottom: '6%',
                left: 0,
                right: 0,
                display: 'flex',
                justifyContent: 'center',
                gap: 14,
                padding: '0 24px',
              }}
              initial={{ y: 50, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 30, opacity: 0 }}
              transition={{ duration: 0.5, ease: easeExpo }}
            >
              {jobs.map((job, i) => (
                <motion.span
                  key={job}
                  className="apple-body"
                  style={{
                    fontSize: 16,
                    fontWeight: 700,
                    padding: '12px 24px',
                    borderRadius: 999,
                    background: 'rgba(255, 255, 255, 0.95)',
                    border: '1px solid rgba(166,58,58,0.25)',
                    color: '#A63A3A',
                    boxShadow: '0 8px 24px rgba(0,0,0,0.04)',
                    whiteSpace: 'nowrap',
                  }}
                  initial={{ opacity: 0, scale: 0.8, y: 15 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  transition={{ type: 'spring', damping: 14, stiffness: 110, delay: i * 0.1 }}
                >
                  {job}
                </motion.span>
              ))}
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── BEAT 2: Full-Screen Takeover — -$480 Odometer Scroller ── */}
        <AnimatePresence mode="wait">
          {showCut && (
            <motion.div
              key="takeover-cut"
              style={overlayBg}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.5, ease: easeExpo }}
            >
              <motion.div
                style={{ textAlign: 'center' }}
                initial={{ opacity: 0, scale: 0.94 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, y: -20, scale: 0.96 }}
                transition={{ type: 'spring', damping: 20, stiffness: 80 }}
              >
                {/* Odometer scroller */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 110 }}>
                  <motion.span
                    className="apple-mono"
                    style={{ fontSize: 100, color: '#A63A3A', lineHeight: '110px' }}
                    initial={{ y: 30, opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                    transition={{ duration: 0.4, delay: 0.1, ease: easeExpo }}
                  >
                    -$
                  </motion.span>
                  <Digit value="4" delay={0.2} color="#A63A3A" />
                  <Digit value="8" delay={0.3} color="#A63A3A" />
                  <Digit value="0" delay={0.4} color="#A63A3A" />
                </div>

                {/* Staggered subtitle */}
                <p className="apple-h1" style={{ margin: '24px 0 0', fontSize: 36, fontWeight: 700 }}>
                  {"Average monthly cut — for life".split(" ").map((word, idx) => (
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

                <motion.p
                  className="apple-body"
                  style={{ margin: '16px 0 0', fontSize: 18, color: '#6E6E73' }}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.5, delay: 1.1, ease: easeExpo }}
                >
                  Due to the Windfall Elimination Provision (WEP) &amp; GPO rules
                </motion.p>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── BEAT 3: Side Panel — Fairness Act ── */}
        <AnimatePresence mode="wait">
          {showAct && (
            <motion.div
              key="panel-act"
              style={{ ...appleCardStyle, position: 'absolute', top: '50%', right: '3%', width: 430, transform: 'translateY(-50%)' }}
              initial={{ x: 100, scale: 0.95, opacity: 0 }}
              animate={{ x: 0, scale: 1, opacity: 1 }}
              exit={{ x: 80, scale: 0.98, opacity: 0 }}
              transition={{ type: 'spring', damping: 22, stiffness: 90 }}
            >
              <motion.div
                style={{ height: 3, borderRadius: 2, background: '#347052', marginBottom: 24 }}
                initial={{ scaleX: 0, originX: 0 }}
                animate={{ scaleX: 1 }}
                transition={{ duration: 0.5, delay: 0.15, ease: easeExpo }}
              />

              <div style={{ overflow: 'hidden', marginBottom: 14 }}>
                <motion.h2
                  className="apple-h2"
                  style={{ margin: 0, fontSize: 26, lineHeight: 1.35 }}
                  initial={{ y: '100%' }}
                  animate={{ y: 0 }}
                  transition={{ duration: 0.5, delay: 0.25, ease: easeExpo }}
                >
                  Social Security Fairness Act
                </motion.h2>
              </div>

              <div style={{ overflow: 'hidden', marginBottom: 24 }}>
                <motion.p
                  className="apple-body"
                  style={{ margin: 0, fontSize: 18, color: '#6E6E73', lineHeight: 1.5 }}
                  initial={{ y: '100%', opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  transition={{ duration: 0.5, delay: 0.35, ease: easeExpo }}
                >
                  WEP &amp; GPO — fully repealed
                </motion.p>
              </div>

              <motion.div
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 8,
                  background: 'rgba(52,112,82,0.1)',
                  border: '1px solid rgba(52,112,82,0.3)',
                  borderRadius: 999,
                  padding: '8px 18px',
                }}
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ type: 'spring', damping: 15, stiffness: 100, delay: 0.5 }}
              >
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#347052' }} />
                <span className="apple-body" style={{ fontSize: 15, fontWeight: 700, color: '#347052' }}>
                  ✓ Signed Jan 2025
                </span>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── BEAT 4: Side Panel — Check Bank Statements ── */}
        <AnimatePresence mode="wait">
          {showCheck && (
            <motion.div
              key="panel-check"
              style={{ ...appleCardStyle, position: 'absolute', top: '50%', right: '3%', width: 430, transform: 'translateY(-50%)' }}
              initial={{ x: 100, scale: 0.95, opacity: 0 }}
              animate={{ x: 0, scale: 1, opacity: 1 }}
              exit={{ x: 80, scale: 0.98, opacity: 0 }}
              transition={{ type: 'spring', damping: 22, stiffness: 90 }}
            >
              <motion.div
                style={{ height: 3, borderRadius: 2, background: '#B58450', marginBottom: 22 }}
                initial={{ scaleX: 0, originX: 0 }}
                animate={{ scaleX: 1 }}
                transition={{ duration: 0.5, delay: 0.15, ease: easeExpo }}
              />

              <div style={{ overflow: 'hidden', marginBottom: 22 }}>
                <motion.p
                  className="apple-body"
                  style={{ margin: 0, fontSize: 13, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#B58450', fontWeight: 700 }}
                  initial={{ y: '100%' }}
                  animate={{ y: 0 }}
                  transition={{ duration: 0.5, delay: 0.25, ease: easeExpo }}
                >
                  Action Checklist
                </motion.p>
              </div>

              {/* Row 1 */}
              <motion.div
                style={{
                  padding: '18px 20px',
                  borderRadius: 14,
                  background: 'rgba(0,0,0,0.02)',
                  border: '1px solid rgba(0,0,0,0.05)',
                  marginBottom: 14,
                }}
                initial={{ x: 30, opacity: 0 }}
                animate={{ x: 0, opacity: 1 }}
                transition={{ type: 'spring', damping: 18, stiffness: 100, delay: 0.35 }}
              >
                <p className="apple-body" style={{ margin: '0 0 6px', fontSize: 16, color: '#1D1D1F', fontWeight: 700 }}>
                  Check Bank Statements
                </p>
                <p className="apple-body" style={{ margin: 0, fontSize: 15, lineHeight: 1.5 }}>
                  Look for unexpected deposits in{' '}
                  <span className="apple-mono" style={{ color: '#B58450', fontSize: 16 }}>March &amp; April 2025</span>
                </p>
              </motion.div>

              {/* Row 2 */}
              <motion.div
                style={{
                  padding: '18px 20px',
                  borderRadius: 14,
                  background: 'rgba(0,0,0,0.02)',
                  border: '1px solid rgba(0,0,0,0.05)',
                }}
                initial={{ x: 30, opacity: 0 }}
                animate={{ x: 0, opacity: 1 }}
                transition={{ type: 'spring', damping: 18, stiffness: 100, delay: 0.5 }}
              >
                <p className="apple-body" style={{ margin: '0 0 6px', fontSize: 16, color: '#1D1D1F', fontWeight: 700 }}>
                  Check Your Mail
                </p>
                <p className="apple-body" style={{ margin: 0, fontSize: 15, lineHeight: 1.5 }}>
                  Recalculation letters sent out by SSA explaining your new amount
                </p>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

      </div>
    </div>
  );
}
