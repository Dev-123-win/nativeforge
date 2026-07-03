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

const easeOutBack = [0.34, 1.56, 0.64, 1] as const;
const easeExpo = [0.16, 1, 0.3, 1] as const;
const f = (s: number) => Math.round(s * 25);

// ─── Component: Digit Scroller Odometer ───────────────────────────────────────
function Digit({ value, delay, color = '#B58450' }: { value: string; delay: number; color?: string }) {
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

export default function Edit07() {
  const frame = useCurrentFrame();
  const videoRef = useRef<HTMLVideoElement>(null);
  useVideoSync(videoRef);
  const sfx = useSFX();

  // Active beats with clear lifecycles
  const showAnalogy = frame >= f(13.5) && frame < f(26.9);
  const showBoth    = frame >= f(27.0) && frame < f(40.0);
  const showRecord  = frame >= f(40.6) && frame < f(75.0);
  const showSSA     = frame >= f(68.8) && frame < f(75.0);

  // One-shot SFX
  const fired = useRef<Record<string, boolean>>({});
  const fire = (key: string, fn: () => void) => {
    if (!fired.current[key]) { fired.current[key] = true; fn(); }
  };
  if (showAnalogy) fire('analogy', () => sfx.tick({ volume: 0.15 } as any));
  if (showBoth)    fire('both',    () => sfx.whoosh({ volume: 0.2 } as any));
  if (showRecord)  fire('record',  () => sfx.numberLand({ volume: 0.2 } as any));
  if (showSSA)     fire('ssa',     () => sfx.success({ volume: 0.18 } as any));

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden', fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
      <style>{fontImport}</style>

      {/* ── FLAT VIDEO BACKGROUND ── */}
      <video
        ref={videoRef}
        src="/assets/07.mp4"
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
        muted playsInline preload="auto"
      />

      {/* ── Overlay layer z:2 ── */}
      <div style={{ position: 'absolute', inset: 0, zIndex: 2, pointerEvents: 'none' }}>

        {/* ── BEAT 1: Lower-Third — Savings analogy quote ── */}
        <AnimatePresence mode="wait">
          {showAnalogy && (
            <motion.div
              key="lower-analogy"
              style={{
                position: 'absolute',
                bottom: '6%',
                left: '3%',
                right: '3%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'rgba(255, 255, 255, 0.95)',
                border: '1px solid rgba(0,0,0,0.06)',
                borderRadius: 16,
                padding: '18px 28px',
                textAlign: 'center',
                boxShadow: '0 12px 36px rgba(0,0,0,0.04)',
              }}
              initial={{ y: 60, scale: 0.9, opacity: 0 }}
              animate={{ y: 0, scale: 1, opacity: 1 }}
              exit={{ y: 40, scale: 0.95, opacity: 0 }}
              transition={{ type: 'spring', damping: 18, stiffness: 90 }}
            >
              <span className="apple-body" style={{ fontSize: 16, color: '#1D1D1F', fontWeight: 500, fontStyle: 'italic', lineHeight: 1.55 }}>
                "Withdrawing from the smaller account instead of letting the bigger one grow. The years you missed are already gone."
              </span>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── BEAT 2: Full-Screen Takeover — Ask for both numbers ── */}
        <AnimatePresence mode="wait">
          {showBoth && (
            <motion.div
              key="takeover-both"
              style={overlayBg}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.5, ease: easeExpo }}
            >
              <motion.div
                style={{ width: 640, textAlign: 'center' }}
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, y: -20 }}
                transition={{ type: 'spring', damping: 20, stiffness: 85 }}
              >
                <h1 className="apple-h1" style={{ fontSize: 32, marginBottom: 40 }}>
                  What You Should Do
                </h1>

                <div style={{ display: 'flex', alignItems: 'stretch', gap: 24, position: 'relative' }}>
                  {/* Left Column — Mistakes */}
                  <motion.div
                    style={{
                      flex: 1,
                      padding: '24px',
                      borderRadius: 18,
                      background: 'rgba(166,58,58,0.04)',
                      border: '1px solid rgba(166,58,58,0.15)',
                    }}
                    initial={{ x: -20, opacity: 0 }}
                    animate={{ x: 0, opacity: 1 }}
                    transition={{ type: 'spring', damping: 18, stiffness: 90, delay: 0.25 }}
                  >
                    <p className="apple-body" style={{ fontSize: 13, fontWeight: 700, color: '#A63A3A', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 12 }}>
                      Common Mistake
                    </p>
                    <p className="apple-h2" style={{ fontSize: 20, color: '#A63A3A', margin: 0 }}>
                      Take first option offered by the agent
                    </p>
                  </motion.div>

                  {/* Vertical Divider */}
                  <motion.div
                    style={{ width: 1, background: 'rgba(0,0,0,0.1)' }}
                    initial={{ scaleY: 0 }}
                    animate={{ scaleY: 1 }}
                    transition={{ duration: 0.6, delay: 0.4 }}
                  />

                  {/* Right Column — Solution */}
                  <motion.div
                    style={{
                      flex: 1,
                      padding: '24px',
                      borderRadius: 18,
                      background: 'rgba(52,112,82,0.04)',
                      border: '1px solid rgba(52,112,82,0.2)',
                    }}
                    initial={{ x: 20, opacity: 0 }}
                    animate={{ x: 0, opacity: 1 }}
                    transition={{ type: 'spring', damping: 18, stiffness: 90, delay: 0.35 }}
                  >
                    <p className="apple-body" style={{ fontSize: 13, fontWeight: 700, color: '#347052', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 12 }}>
                      Best Practice
                    </p>
                    <p className="apple-h2" style={{ fontSize: 20, color: '#347052', margin: 0 }}>
                      Ask for BOTH numbers at every start age
                    </p>
                  </motion.div>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── BEAT 3: Side Panel — Earnings record + 35 years counter ── */}
        <AnimatePresence mode="wait">
          {showRecord && (
            <motion.div
              key="panel-record"
              style={{ ...appleCardStyle, position: 'absolute', top: '50%', right: '3%', width: 440, transform: 'translateY(-50%)' }}
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
              <p className="apple-body" style={{ margin: '0 0 16px', fontSize: 13, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#B58450', fontWeight: 700 }}>
                Your Earnings Record
              </p>

              {/* Odometer scroller for 35 */}
              <div style={{ display: 'flex', alignItems: 'center', height: 80, marginBottom: 16 }}>
                <Digit value="3" delay={0.2} />
                <Digit value="5" delay={0.3} />
                <span className="apple-body" style={{ fontSize: 18, color: '#1D1D1F', fontWeight: 700, marginLeft: 16 }}>
                  highest-earning years used
                </span>
              </div>

              {/* Horizontal Bar Chart — 5 sample years, 1 red missing */}
              <div style={{ marginBottom: 16 }}>
                {[
                  { yr: '1995', w: '78%', ok: true },
                  { yr: '1998', w: '82%', ok: true },
                  { yr: '2001', w: '0%', ok: false, label: 'Missing Year! ($0)' },
                  { yr: '2005', w: '88%', ok: true },
                  { yr: '2010', w: '92%', ok: true },
                ].map((item, i) => (
                  <div key={item.yr} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                    <span className="apple-mono" style={{ fontSize: 13, color: '#6E6E73', width: 38 }}>{item.yr}</span>
                    <div style={{ flex: 1, height: 16, borderRadius: 4, background: 'rgba(0,0,0,0.04)', overflow: 'hidden', position: 'relative' }}>
                      <motion.div
                        style={{
                          height: '100%',
                          borderRadius: 4,
                          background: item.ok ? '#347052' : '#A63A3A',
                        }}
                        initial={{ width: 0 }}
                        animate={{ width: item.ok ? item.w : '35%' }}
                        transition={{ duration: 0.7, delay: 0.35 + i * 0.1, ease: easeOutBack }}
                      />
                      {!item.ok && (
                        <motion.span
                          className="apple-body"
                          style={{ position: 'absolute', left: 8, top: 0, fontSize: 10, color: '#fff', fontWeight: 700, lineHeight: '16px' }}
                          initial={{ opacity: 0 }}
                          animate={{ opacity: [0, 1, 0, 1] }}
                          transition={{ delay: 1.0, duration: 1.0 }}
                        >
                          {item.label}
                        </motion.span>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {/* SSA.gov nested card */}
              <AnimatePresence>
                {showSSA && (
                  <motion.div
                    style={{
                      padding: '14px 16px',
                      borderRadius: 14,
                      background: 'rgba(0,102,204,0.06)',
                      border: '1px solid rgba(0,102,204,0.2)',
                      textAlign: 'center',
                    }}
                    initial={{ y: 20, opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                    exit={{ y: 15, opacity: 0 }}
                    transition={{ type: 'spring', damping: 15, stiffness: 100 }}
                  >
                    <span className="apple-body" style={{ fontSize: 15, color: '#0066CC', fontWeight: 700 }}>
                      Check yours on: <span className="apple-mono" style={{ fontSize: 16 }}>ssa.gov → My Account</span>
                    </span>
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
