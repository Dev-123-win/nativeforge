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
    return <span className="apple-mono" style={{ fontSize: 120, color }}>{value}</span>;
  }
  return (
    <div style={{ height: 130, overflow: 'hidden', display: 'inline-block', position: 'relative' }}>
      <motion.div
        initial={{ y: 0 }}
        animate={{ y: -num * 130 }}
        transition={{ type: 'spring', damping: 15, stiffness: 60, delay }}
        style={{ display: 'flex', flexDirection: 'column' }}
      >
        {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
          <span key={n} className="apple-mono" style={{ fontSize: 120, height: 130, display: 'block', lineHeight: '130px', color }}>
            {n}
          </span>
        ))}
      </motion.div>
    </div>
  );
}

export default function Edit06() {
  const frame = useCurrentFrame();
  const videoRef = useRef<HTMLVideoElement>(null);
  useVideoSync(videoRef);
  const sfx = useSFX();

  // Active beats with clear lifecycles
  const showStory   = frame >= f(0.5)  && frame < f(25.0);
  const showTen     = frame >= f(25.8) && frame < f(41.0);
  const showTwoPots = frame >= f(41.2) && frame < f(59.5);
  const showAges    = frame >= f(60.0) && frame < f(81.5);

  // One-shot SFX
  const fired = useRef<Record<string, boolean>>({});
  const fire = (key: string, fn: () => void) => {
    if (!fired.current[key]) { fired.current[key] = true; fn(); }
  };
  if (showStory)   fire('story',   () => sfx.whoosh({ volume: 0.2 } as any));
  if (showTen)     fire('ten',     () => sfx.numberLand({ volume: 0.2 } as any));
  if (showTwoPots) fire('twopots', () => sfx.whoosh({ volume: 0.2 } as any));
  if (showAges)    fire('ages',    () => sfx.success({ volume: 0.18 } as any));

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden', fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
      <style>{fontImport}</style>

      {/* ── FLAT VIDEO BACKGROUND ── */}
      <video
        ref={videoRef}
        src="/assets/06.mp4"
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
        muted playsInline preload="auto"
      />

      {/* ── Overlay layer z:2 ── */}
      <div style={{ position: 'absolute', inset: 0, zIndex: 2, pointerEvents: 'none' }}>

        {/* ── BEAT 1: Side Panel — Real story ── */}
        <AnimatePresence mode="wait">
          {showStory && (
            <motion.div
              key="panel-story"
              style={{ ...appleCardStyle, position: 'absolute', top: '50%', right: '3%', width: 430, transform: 'translateY(-50%)' }}
              initial={{ x: 100, scale: 0.95, opacity: 0 }}
              animate={{ x: 0, scale: 1, opacity: 1 }}
              exit={{ x: 80, scale: 0.98, opacity: 0 }}
              transition={{ type: 'spring', damping: 22, stiffness: 90 }}
            >
              <motion.div
                style={{ width: 48, height: 3, borderRadius: 2, background: '#A78BFA', marginBottom: 22 }}
                initial={{ scaleX: 0, originX: 0 }}
                animate={{ scaleX: 1 }}
                transition={{ duration: 0.5, delay: 0.15, ease: easeExpo }}
              />
              <p className="apple-body" style={{ margin: '0 0 16px', fontSize: 13, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#A78BFA', fontWeight: 700 }}>
                Real Story
              </p>

              {/* Title stagger */}
              <div style={{ overflow: 'hidden', marginBottom: 24 }}>
                <motion.p
                  className="apple-body"
                  style={{ margin: 0, fontSize: 18, color: '#1D1D1F', fontWeight: 500, lineHeight: 1.55 }}
                  initial={{ y: '100%' }}
                  animate={{ y: 0 }}
                  transition={{ duration: 0.6, delay: 0.25, ease: easeExpo }}
                >
                  Divorced at 40 after a long marriage. Filed at 62 for her own benefit — nobody asked about her marital history.
                </motion.p>
              </div>

              {/* Warning box */}
              <motion.div
                style={{
                  padding: '16px 18px',
                  borderRadius: 14,
                  background: 'rgba(166,58,58,0.04)',
                  border: '1px solid rgba(166,58,58,0.25)',
                }}
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ type: 'spring', damping: 16, stiffness: 90, delay: 0.45 }}
              >
                <p className="apple-body" style={{ margin: 0, fontSize: 16, color: '#A63A3A', fontWeight: 600, lineHeight: 1.5 }}>
                  A larger ex-spouse benefit was left on the table — for the rest of her life.
                </p>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── BEAT 2: Full-Screen Takeover — 10 years rule scroller ── */}
        <AnimatePresence mode="wait">
          {showTen && (
            <motion.div
              key="takeover-ten"
              style={overlayBg}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.5, ease: easeExpo }}
            >
              <motion.div
                style={{ textAlign: 'center', maxWidth: 640 }}
                initial={{ opacity: 0, scale: 0.94 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, y: -20, scale: 0.96 }}
                transition={{ type: 'spring', damping: 20, stiffness: 80 }}
              >
                {/* Odometer scroller */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 130, marginBottom: 16 }}>
                  <Digit value="1" delay={0.15} />
                  <Digit value="0" delay={0.25} />
                </div>

                {/* Title staggered */}
                <h2 className="apple-h2" style={{ margin: '0 0 32px', fontSize: 28, fontWeight: 700 }}>
                  {"Years Married — the only number that matters".split(" ").map((word, idx) => (
                    <span key={idx} style={{ display: 'inline-block', overflow: 'hidden', marginRight: '0.25em' }}>
                      <motion.span
                        style={{ display: 'inline-block' }}
                        initial={{ y: '100%', opacity: 0 }}
                        animate={{ y: 0, opacity: 1 }}
                        transition={{ type: 'spring', damping: 16, stiffness: 100, delay: 0.45 + idx * 0.08 }}
                      >
                        {word}
                      </motion.span>
                    </span>
                  ))}
                </h2>

                <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
                  {['Ended long ago', 'Ex remarried', 'Unknown income'].map((pill, i) => (
                    <motion.span
                      key={pill}
                      className="apple-body"
                      style={{
                        fontSize: 15,
                        fontWeight: 700,
                        padding: '10px 18px',
                        borderRadius: 999,
                        background: 'rgba(255, 255, 255, 0.95)',
                        border: '1px solid rgba(0,0,0,0.06)',
                        color: '#6E6E73',
                        boxShadow: '0 8px 20px rgba(0,0,0,0.02)',
                      }}
                      initial={{ opacity: 0, scale: 0.8 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ type: 'spring', damping: 14, stiffness: 110, delay: 0.95 + i * 0.12 }}
                    >
                      {pill}
                    </motion.span>
                  ))}
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── BEAT 3: Side Panel — Two pots comparison ── */}
        <AnimatePresence mode="wait">
          {showTwoPots && (
            <motion.div
              key="panel-twopots"
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
              <p className="apple-body" style={{ margin: '0 0 20px', fontSize: 13, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#0066CC', fontWeight: 700 }}>
                Two Separate Benefit Options
              </p>

              <div style={{ display: 'flex', gap: 14 }}>
                {/* Column 1 */}
                <motion.div
                  style={{
                    flex: 1,
                    padding: '16px',
                    borderRadius: 14,
                    background: 'rgba(0,0,0,0.02)',
                    border: '1px solid rgba(0,90,190,0.15)',
                  }}
                  initial={{ y: 20, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  transition={{ type: 'spring', damping: 16, stiffness: 100, delay: 0.25 }}
                >
                  <p className="apple-body" style={{ margin: '0 0 6px', fontSize: 15, fontWeight: 700, color: '#0066CC' }}>
                    Own Record
                  </p>
                  <p className="apple-body" style={{ margin: 0, fontSize: 14, lineHeight: 1.45 }}>
                    Retirement benefit grows until age 70.
                  </p>
                </motion.div>

                {/* Column 2 */}
                <motion.div
                  style={{
                    flex: 1,
                    padding: '16px',
                    borderRadius: 14,
                    background: 'rgba(0,0,0,0.02)',
                    border: '1px solid rgba(167,139,250,0.15)',
                  }}
                  initial={{ y: 20, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  transition={{ type: 'spring', damping: 16, stiffness: 100, delay: 0.35 }}
                >
                  <p className="apple-body" style={{ margin: '0 0 6px', fontSize: 15, fontWeight: 700, color: '#A78BFA' }}>
                    Survivor Pot
                  </p>
                  <p className="apple-body" style={{ margin: 0, fontSize: 14, lineHeight: 1.45 }}>
                    Based on late spouse. Starts at 60.
                  </p>
                </motion.div>
              </div>

              <motion.div
                style={{
                  marginTop: 20,
                  padding: '12px 16px',
                  borderRadius: 12,
                  background: 'rgba(52,112,82,0.06)',
                  border: '1px solid rgba(52,112,82,0.15)',
                  textAlign: 'center',
                }}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.5, delay: 0.6, ease: easeExpo }}
              >
                <span className="apple-body" style={{ fontSize: 15, color: '#347052', fontWeight: 700 }}>
                  Strategy: claim one first → switch to the other later.
                </span>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── BEAT 4: Lower-Third — Age milestones timeline bar ── */}
        <AnimatePresence mode="wait">
          {showAges && (
            <motion.div
              key="lower-ages"
              style={{
                position: 'absolute',
                bottom: '6%',
                left: '3%',
                right: '3%',
                background: 'rgba(255, 255, 255, 0.95)',
                border: '1px solid rgba(0,0,0,0.06)',
                borderRadius: 16,
                padding: '24px 32px',
                boxShadow: '0 15px 45px rgba(0,0,0,0.04)',
              }}
              initial={{ y: 60, scale: 0.9, opacity: 0 }}
              animate={{ y: 0, scale: 1, opacity: 1 }}
              exit={{ y: 40, scale: 0.95, opacity: 0 }}
              transition={{ type: 'spring', damping: 16, stiffness: 100 }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                <span className="apple-body" style={{ fontSize: 16, fontWeight: 700, color: '#1D1D1F' }}>Switching Strategy Timeline</span>
                <span className="apple-body" style={{ fontSize: 15, color: '#347052', fontWeight: 700 }}>✓ Maximizes lifetime benefit</span>
              </div>

              {/* Timeline bar with 3 dots */}
              <div style={{ position: 'relative', height: 8, background: 'rgba(0,0,0,0.05)', borderRadius: 4, display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 20px' }}>
                <motion.div
                  style={{
                    position: 'absolute',
                    left: 20,
                    height: '100%',
                    background: 'linear-gradient(90deg, #A78BFA, #0066CC 60%, #347052)',
                    borderRadius: 4,
                  }}
                  initial={{ width: '0%' }}
                  animate={{ width: 'calc(100% - 40px)' }}
                  transition={{ duration: 1.0, delay: 0.25, ease: easeExpo }}
                />

                {[
                  { age: '60', text: 'Survivor starts', color: '#A78BFA' },
                  { age: '67', text: 'Full Retirement', color: '#0066CC' },
                  { age: '70', text: 'Own benefit peaks', color: '#347052' },
                ].map((item, idx) => (
                  <div key={item.age} style={{ position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                    <motion.div
                      style={{
                        width: 14,
                        height: 14,
                        borderRadius: '50%',
                        background: item.color,
                        border: '3px solid #F5F5F7',
                        zIndex: 2,
                      }}
                      initial={{ scale: 0 }}
                      animate={{ scale: 1 }}
                      transition={{ type: 'spring', damping: 12, stiffness: 100, delay: 0.2 + idx * 0.3 }}
                    />
                    <div style={{ position: 'absolute', top: 20, textAlign: 'center', whiteSpace: 'nowrap', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                      <motion.span className="apple-mono" style={{ fontSize: 16, color: item.color }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.35 + idx * 0.3 }}>
                        Age {item.age}
                      </motion.span>
                      <motion.span className="apple-body" style={{ fontSize: 13, marginTop: 2 }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.45 + idx * 0.3 }}>
                        {item.text}
                      </motion.span>
                    </div>
                  </div>
                ))}
              </div>
              <div style={{ height: 32 }} />
            </motion.div>
          )}
        </AnimatePresence>

      </div>
    </div>
  );
}
