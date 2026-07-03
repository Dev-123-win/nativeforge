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

export default function Edit05() {
  const frame = useCurrentFrame();
  const videoRef = useRef<HTMLVideoElement>(null);
  useVideoSync(videoRef);
  const sfx = useSFX();

  // Active beats with clear lifecycles
  const showSplit   = frame >= f(0.5)  && frame < f(15.0);
  const showAnalogy = frame >= f(15.8) && frame < f(34.0);
  const showNobody  = frame >= f(36.1) && frame < f(44.0);
  const showDivorce = frame >= f(44.8) && frame < f(63.2);

  // One-shot SFX
  const fired = useRef<Record<string, boolean>>({});
  const fire = (key: string, fn: () => void) => {
    if (!fired.current[key]) { fired.current[key] = true; fn(); }
  };
  if (showSplit)   fire('split',   () => sfx.whoosh({ volume: 0.2 } as any));
  if (showAnalogy) fire('analogy', () => sfx.tick({ volume: 0.15 } as any));
  if (showNobody)  fire('nobody',  () => sfx.numberLand({ volume: 0.2 } as any));
  if (showDivorce) fire('divorce', () => sfx.success({ volume: 0.18 } as any));

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden', fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
      <style>{fontImport}</style>

      {/* ── FLAT VIDEO BACKGROUND ── */}
      <video
        ref={videoRef}
        src="/assets/05.mp4"
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
        muted playsInline preload="auto"
      />

      {/* ── Overlay layer z:2 ── */}
      <div style={{ position: 'absolute', inset: 0, zIndex: 2, pointerEvents: 'none' }}>

        {/* ── BEAT 1: Side Panel — Husband/Wife comparison ── */}
        <AnimatePresence mode="wait">
          {showSplit && (
            <motion.div
              key="panel-split"
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
                Benefit Disconnect
              </p>

              {/* Husband row */}
              <motion.div
                style={{
                  padding: '16px 18px',
                  borderRadius: 14,
                  background: 'rgba(52,112,82,0.04)',
                  border: '1px solid rgba(52,112,82,0.2)',
                  marginBottom: 14,
                }}
                initial={{ x: 30, opacity: 0 }}
                animate={{ x: 0, opacity: 1 }}
                transition={{ type: 'spring', damping: 18, stiffness: 100, delay: 0.25 }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                  <span className="apple-body" style={{ fontSize: 16, color: '#1D1D1F', fontWeight: 700 }}>Husband</span>
                  <motion.span
                    className="apple-mono"
                    style={{ fontSize: 20, color: '#347052' }}
                    initial={{ scale: 0.8 }}
                    animate={{ scale: 1 }}
                    transition={{ type: 'spring', damping: 12, stiffness: 110, delay: 0.4 }}
                  >
                    +$400/mo
                  </motion.span>
                </div>
                <p className="apple-body" style={{ margin: 0, fontSize: 14 }}>Fairness Act raise applied</p>
              </motion.div>

              {/* Wife row */}
              <motion.div
                style={{
                  padding: '16px 18px',
                  borderRadius: 14,
                  background: 'rgba(166,58,58,0.04)',
                  border: '1px solid rgba(166,58,58,0.2)',
                }}
                initial={{ x: 30, opacity: 0 }}
                animate={{ x: 0, opacity: 1 }}
                transition={{ type: 'spring', damping: 18, stiffness: 100, delay: 0.45 }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                  <span className="apple-body" style={{ fontSize: 16, color: '#1D1D1F', fontWeight: 700 }}>Wife</span>
                  <motion.span
                    className="apple-body"
                    style={{ fontSize: 16, color: '#A63A3A', fontWeight: 700 }}
                    initial={{ scale: 0.8 }}
                    animate={{ scale: 1 }}
                    transition={{ type: 'spring', damping: 12, stiffness: 110, delay: 0.6 }}
                  >
                    No Change
                  </motion.span>
                </div>
                <p className="apple-body" style={{ margin: 0, fontSize: 14 }}>Still receiving old spousal benefit</p>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── BEAT 2: Lower-Third — Analogy quote ── */}
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
                padding: '16px 28px',
                textAlign: 'center',
                boxShadow: '0 12px 36px rgba(0,0,0,0.04)',
              }}
              initial={{ y: 60, scale: 0.9, opacity: 0 }}
              animate={{ y: 0, scale: 1, opacity: 1 }}
              exit={{ y: 40, scale: 0.95, opacity: 0 }}
              transition={{ type: 'spring', damping: 18, stiffness: 90 }}
            >
              <span className="apple-body" style={{ fontSize: 17, color: '#1D1D1F', fontWeight: 500, fontStyle: 'italic', lineHeight: 1.5 }}>
                "Like a thermostat connected to a furnace that got replaced — somebody still has to flip the switch."
              </span>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── BEAT 3: Full-Screen Takeover — Staggered text ── */}
        <AnimatePresence mode="wait">
          {showNobody && (
            <motion.div
              key="takeover-nobody"
              style={overlayBg}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.5, ease: easeExpo }}
            >
              <motion.div
                style={{ textAlign: 'center', maxWidth: 640, padding: '0 24px' }}
                initial={{ opacity: 0, scale: 0.94 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, y: -20, scale: 0.96 }}
                transition={{ type: 'spring', damping: 20, stiffness: 80 }}
              >
                <h1 className="apple-h1" style={{ fontSize: 32, lineHeight: 1.45, marginBottom: 20 }}>
                  {"Nobody at Social Security will connect those numbers for you.".split(" ").map((word, idx) => (
                    <span key={idx} style={{ display: 'inline-block', overflow: 'hidden', marginRight: '0.25em' }}>
                      <motion.span
                        style={{ display: 'inline-block' }}
                        initial={{ y: '100%', opacity: 0 }}
                        animate={{ y: 0, opacity: 1 }}
                        transition={{ type: 'spring', damping: 16, stiffness: 100, delay: 0.15 + idx * 0.08 }}
                      >
                        {word}
                      </motion.span>
                    </span>
                  ))}
                </h1>
                
                <p className="apple-body" style={{ fontSize: 20, color: '#B58450', fontWeight: 700 }}>
                  {"You have to be the one who asks.".split(" ").map((word, idx) => (
                    <span key={idx} style={{ display: 'inline-block', overflow: 'hidden', marginRight: '0.25em' }}>
                      <motion.span
                        style={{ display: 'inline-block' }}
                        initial={{ y: '100%', opacity: 0 }}
                        animate={{ y: 0, opacity: 1 }}
                        transition={{ type: 'spring', damping: 15, stiffness: 90, delay: 0.95 + idx * 0.08 }}
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

        {/* ── BEAT 4: Side Panel — Divorced checklist ── */}
        <AnimatePresence mode="wait">
          {showDivorce && (
            <motion.div
              key="panel-divorce"
              style={{ ...appleCardStyle, position: 'absolute', top: '50%', right: '3%', width: 440, transform: 'translateY(-50%)' }}
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
              <p className="apple-body" style={{ margin: '0 0 20px', fontSize: 13, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#A78BFA', fontWeight: 700 }}>
                Divorced? You May Still Qualify
              </p>

              {/* Checklist */}
              <div style={{ marginBottom: 24 }}>
                {[
                  'Marriage lasted 10+ years',
                  "You haven't remarried",
                  "Doesn't cost your ex a cent",
                  "SS won't notify your ex",
                ].map((item, i) => (
                  <div key={item} style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
                    <motion.span
                      style={{ color: '#A78BFA', fontWeight: 900 }}
                      initial={{ scale: 0 }}
                      animate={{ scale: 1 }}
                      transition={{ type: 'spring', damping: 10, stiffness: 120, delay: 0.2 + i * 0.12 }}
                    >
                      ✓
                    </motion.span>
                    <div style={{ overflow: 'hidden' }}>
                      <motion.span
                        className="apple-body"
                        style={{ fontSize: 16, color: '#1D1D1F', fontWeight: 600, display: 'block' }}
                        initial={{ y: '100%' }}
                        animate={{ y: 0 }}
                        transition={{ duration: 0.4, delay: 0.25 + i * 0.12, ease: easeExpo }}
                      >
                        {item}
                      </motion.span>
                    </div>
                  </div>
                ))}
              </div>

              {/* Badge */}
              <motion.div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 16,
                  padding: '16px 18px',
                  borderRadius: 14,
                  background: 'rgba(181,132,80,0.06)',
                  border: '1px solid rgba(181,132,80,0.2)',
                }}
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ type: 'spring', damping: 15, stiffness: 100, delay: 0.7 }}
              >
                <span className="apple-mono" style={{ fontSize: 44, color: '#B58450', lineHeight: 1 }}>
                  10
                </span>
                <div>
                  <p className="apple-body" style={{ margin: 0, fontWeight: 700, color: '#1D1D1F' }}>Years Married</p>
                  <p className="apple-body" style={{ margin: '2px 0 0', fontSize: 14 }}>The only number that matters</p>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

      </div>
    </div>
  );
}
