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

const easeOutBack = [0.34, 1.56, 0.64, 1] as const;
const easeExpo = [0.16, 1, 0.3, 1] as const;
const f = (s: number) => Math.round(s * 25);

// ─── Component: Digit Scroller Odometer ───────────────────────────────────────
function Digit({ value, delay, color = '#0066CC' }: { value: string; delay: number; color?: string }) {
  const num = parseInt(value, 10);
  if (isNaN(num)) {
    return <span className="apple-mono" style={{ fontSize: 72, color }}>{value}</span>;
  }
  return (
    <div style={{ height: 80, overflow: 'hidden', display: 'inline-block', position: 'relative' }}>
      <motion.div
        initial={{ y: 0 }}
        animate={{ y: -num * 80 }}
        transition={{ type: 'spring', damping: 15, stiffness: 60, delay }}
        style={{ display: 'flex', flexDirection: 'column' }}
      >
        {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
          <span key={n} className="apple-mono" style={{ fontSize: 72, height: 80, display: 'block', lineHeight: '80px', color }}>
            {n}
          </span>
        ))}
      </motion.div>
    </div>
  );
}

export default function Edit08() {
  const frame = useCurrentFrame();
  const videoRef = useRef<HTMLVideoElement>(null);
  useVideoSync(videoRef);
  const sfx = useSFX();

  // Active beats with clear lifecycles
  const showMissing      = frame >= f(0.5)  && frame < f(34.0);
  const showStep1        = frame >= f(34.1) && frame < f(49.2);
  const showSteps23      = frame >= f(49.3) && frame < f(88.0);
  const showStep3Script  = frame >= f(57.7) && frame < f(88.0);

  // One-shot SFX
  const fired = useRef<Record<string, boolean>>({});
  const fire = (key: string, fn: () => void) => {
    if (!fired.current[key]) { fired.current[key] = true; fn(); }
  };
  if (showMissing) fire('missing', () => sfx.numberLand({ volume: 0.2 } as any));
  if (showStep1)   fire('step1',   () => sfx.whoosh({ volume: 0.2 } as any));
  if (showSteps23) fire('steps23', () => sfx.success({ volume: 0.18 } as any));

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden', fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
      <style>{fontImport}</style>

      {/* ── FLAT VIDEO BACKGROUND ── */}
      <video
        ref={videoRef}
        src="/assets/08.mp4"
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
        muted playsInline preload="auto"
      />

      {/* ── Overlay layer z:2 ── */}
      <div style={{ position: 'absolute', inset: 0, zIndex: 2, pointerEvents: 'none' }}>

        {/* ── BEAT 1: Full-Screen Takeover — Missing year problem ── */}
        <AnimatePresence mode="wait">
          {showMissing && (
            <motion.div
              key="takeover-missing"
              style={overlayBg}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.5, ease: easeExpo }}
            >
              <motion.div
                style={{ width: 560, padding: '0 20px', textAlign: 'center' }}
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, y: -20 }}
                transition={{ type: 'spring', damping: 20, stiffness: 85 }}
              >
                <h1 className="apple-h1" style={{ fontSize: 30, color: '#A63A3A', marginBottom: 32 }}>
                  The Missing Year Problem
                </h1>

                {/* 5-bar work years chart */}
                <div style={{ display: 'flex', gap: 14, height: 160, alignItems: 'end', justifyContent: 'center', marginBottom: 32 }}>
                  {[
                    { yr: "'90", h: 90, ok: true },
                    { yr: "'95", h: 110, ok: true },
                    { yr: "'00", h: 10, ok: false, label: '$0' },
                    { yr: "'05", h: 120, ok: true },
                    { yr: "'10", h: 130, ok: true },
                  ].map((bar, i) => (
                    <div key={bar.yr} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: 64 }}>
                      <motion.div
                        style={{
                          width: '100%',
                          borderRadius: '8px 8px 0 0',
                          background: bar.ok ? '#347052' : '#A63A3A',
                          position: 'relative',
                        }}
                        initial={{ height: 0 }}
                        animate={{ height: bar.h }}
                        transition={{ duration: 0.8, delay: 0.2 + i * 0.1, ease: easeOutBack }}
                      >
                        {!bar.ok && (
                          <motion.span
                            className="apple-mono"
                            style={{ position: 'absolute', top: -24, left: 0, right: 0, fontSize: 13, color: '#A63A3A', fontWeight: 700 }}
                            initial={{ scale: 0 }}
                            animate={{ scale: [0, 1.2, 1] }}
                            transition={{ delay: 1.0, duration: 0.4 }}
                          >
                            {bar.label}
                          </motion.span>
                        )}
                      </motion.div>
                      <span className="apple-mono" style={{ fontSize: 12, color: '#6E6E73', marginTop: 8 }}>{bar.yr}</span>
                    </div>
                  ))}
                </div>

                <p className="apple-body" style={{ fontSize: 18, color: '#1D1D1F', fontWeight: 600, margin: 0 }}>
                  {"1 missing year × 30 years of payments = significant reduction".split(" ").map((word, idx) => (
                    <span key={idx} style={{ display: 'inline-block', overflow: 'hidden', marginRight: '0.25em' }}>
                      <motion.span
                        style={{ display: 'inline-block' }}
                        initial={{ y: '100%', opacity: 0 }}
                        animate={{ y: 0, opacity: 1 }}
                        transition={{ type: 'spring', damping: 16, stiffness: 100, delay: 0.85 + idx * 0.08 }}
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

        {/* ── BEAT 2: Side Panel — Step 1 ssa.gov ── */}
        <AnimatePresence mode="wait">
          {showStep1 && (
            <motion.div
              key="panel-step1"
              style={{ ...appleCardStyle, position: 'absolute', top: '50%', right: '3%', width: 440, transform: 'translateY(-50%)' }}
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

              {/* Step 01 odometer */}
              <div style={{ display: 'flex', alignItems: 'center', height: 80, marginBottom: 18 }}>
                <Digit value="0" delay={0.2} color="#0066CC" />
                <Digit value="1" delay={0.3} color="#0066CC" />
                <div style={{ marginLeft: 18 }}>
                  <p className="apple-body" style={{ margin: 0, fontSize: 13, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#0066CC', fontWeight: 700 }}>Step One</p>
                  <p className="apple-h2" style={{ margin: 0, fontSize: 22 }}>Open ssa.gov</p>
                </div>
              </div>

              <p className="apple-body" style={{ margin: '0 0 20px', fontSize: 16, color: '#1D1D1F', fontWeight: 600 }}>
                Pull your benefit letter and earnings record.
              </p>

              {/* Checklist */}
              <div>
                {[
                  'Pension that didn\'t pay SS taxes',
                  'Marriage lasting 10+ years',
                  'Any earnings year that looks wrong',
                ].map((item, i) => (
                  <div key={item} style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 10 }}>
                    <motion.span
                      style={{ color: '#0066CC', fontWeight: 900, fontSize: 16 }}
                      initial={{ scale: 0 }}
                      animate={{ scale: 1 }}
                      transition={{ type: 'spring', damping: 10, stiffness: 120, delay: 0.35 + i * 0.12 }}
                    >
                      •
                    </motion.span>
                    <div style={{ overflow: 'hidden' }}>
                      <motion.span
                        className="apple-body"
                        style={{ fontSize: 15, color: '#6E6E73', display: 'block', lineHeight: 1.4 }}
                        initial={{ y: '100%' }}
                        animate={{ y: 0 }}
                        transition={{ duration: 0.4, delay: 0.4 + i * 0.12, ease: easeExpo }}
                      >
                        {item}
                      </motion.span>
                    </div>
                  </div>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── BEAT 3: Side Panel — Steps 2 & 3 phone + script ── */}
        <AnimatePresence mode="wait">
          {showSteps23 && (
            <motion.div
              key="panel-steps23"
              style={{ ...appleCardStyle, position: 'absolute', top: '50%', right: '3%', width: 440, transform: 'translateY(-50%)' }}
              initial={{ x: 100, scale: 0.95, opacity: 0 }}
              animate={{ x: 0, scale: 1, opacity: 1 }}
              exit={{ x: 80, scale: 0.98, opacity: 0 }}
              transition={{ type: 'spring', damping: 22, stiffness: 90 }}
            >
              {/* Step 02 block */}
              <div style={{ marginBottom: 24 }}>
                <div style={{ display: 'flex', alignItems: 'center', height: 40, marginBottom: 8 }}>
                  <span className="apple-mono" style={{ fontSize: 24, color: '#B58450', width: 38 }}>02</span>
                  <span className="apple-h2" style={{ fontSize: 18, color: '#1D1D1F' }}>Call Social Security</span>
                </div>
                <motion.p
                  className="apple-mono"
                  style={{ margin: '4px 0', fontSize: 28, color: '#B58450', letterSpacing: '-0.5px' }}
                  initial={{ scale: 0.9, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ type: 'spring', damping: 14, stiffness: 100, delay: 0.2 }}
                >
                  1-800-772-1213
                </motion.p>
                <p className="apple-body" style={{ margin: 0, fontSize: 14 }}>Mon–Fri 8am–7pm</p>
              </div>

              {/* Step 03 block with conditional script */}
              <AnimatePresence>
                {showStep3Script && (
                  <motion.div
                    key="step3-box"
                    style={{
                      borderTop: '1px solid rgba(0,0,0,0.08)',
                      paddingTop: 20,
                    }}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ type: 'spring', damping: 18, stiffness: 90 }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', height: 40, marginBottom: 10 }}>
                      <span className="apple-mono" style={{ fontSize: 24, color: '#347052', width: 38 }}>03</span>
                      <span className="apple-h2" style={{ fontSize: 18, color: '#1D1D1F' }}>Say These Exact Words</span>
                    </div>

                    <motion.div
                      style={{
                        padding: '16px',
                        borderRadius: 14,
                        background: 'rgba(52,112,82,0.04)',
                        border: '1px solid rgba(52,112,82,0.2)',
                        marginBottom: 14,
                      }}
                      initial={{ scale: 0.96 }}
                      animate={{ scale: 1 }}
                      transition={{ type: 'spring', damping: 12, stiffness: 100 }}
                    >
                      <p className="apple-body" style={{ margin: 0, fontSize: 15, fontStyle: 'italic', color: '#347052', lineHeight: 1.5, fontWeight: 600 }}>
                        "I want to apply for benefits affected by the Social Security Fairness Act"
                      </p>
                      <p className="apple-body" style={{ margin: '10px 0 0', fontSize: 13, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#6E6E73', textAlign: 'center' }}>
                        — or —
                      </p>
                      <p className="apple-body" style={{ margin: '10px 0 0', fontSize: 15, fontStyle: 'italic', color: '#347052', lineHeight: 1.5, fontWeight: 600 }}>
                        "I want my spousal and survivor benefits reviewed"
                      </p>
                    </motion.div>

                    <p className="apple-body" style={{ margin: 0, fontSize: 14, color: '#6E6E73' }}>
                      ✓ Write down the rep's name and today's date.
                    </p>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          )}
        </AnimatePresence>

      </div>
    </div>
  );
}
