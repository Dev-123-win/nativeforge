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

export default function Edit09() {
  const frame = useCurrentFrame();
  const videoRef = useRef<HTMLVideoElement>(null);
  useVideoSync(videoRef);
  const sfx = useSFX();

  // Active beats with clear lifecycles
  const showSummary = frame >= f(0.5)  && frame < f(12.0);
  const showRule    = frame >= f(7.5)  && frame < f(12.0);
  const showCTA     = frame >= f(12.3) && frame < f(21.0);
  const showButtons = frame >= f(16.6) && frame < f(21.0);
  const showMoney   = frame >= f(20.6) && frame < f(21.0);

  // One-shot SFX
  const fired = useRef<Record<string, boolean>>({});
  const fire = (key: string, fn: () => void) => {
    if (!fired.current[key]) { fired.current[key] = true; fn(); }
  };
  if (showSummary) fire('summary', () => sfx.whoosh({ volume: 0.2 } as any));
  if (showCTA)     fire('cta',     () => sfx.success({ volume: 0.18 } as any));

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden', fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
      <style>{fontImport}</style>

      {/* ── FLAT VIDEO BACKGROUND ── */}
      <video
        ref={videoRef}
        src="/assets/09.mp4"
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
        muted playsInline preload="auto"
      />

      {/* ── Overlay layer z:2 ── */}
      <div style={{ position: 'absolute', inset: 0, zIndex: 2, pointerEvents: 'none' }}>

        {/* ── BEAT 1: Full-Screen Takeover — Summary ── */}
        <AnimatePresence mode="wait">
          {showSummary && (
            <motion.div
              key="takeover-summary"
              style={overlayBg}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.5, ease: easeExpo }}
            >
              <div style={{ textAlign: 'center', maxWidth: 720, padding: '0 24px' }}>
                {/* Line 1 staggered */}
                <h1 className="apple-h1" style={{ fontSize: 32, lineHeight: 1.4, margin: '0 0 16px' }}>
                  {"You don't need to memorize every rule.".split(" ").map((word, idx) => (
                    <span key={idx} style={{ display: 'inline-block', overflow: 'hidden', marginRight: '0.25em' }}>
                      <motion.span
                        style={{ display: 'inline-block' }}
                        initial={{ y: '100%', opacity: 0 }}
                        animate={{ y: 0, opacity: 1 }}
                        transition={{ type: 'spring', damping: 16, stiffness: 100, delay: 0.1 + idx * 0.08 }}
                      >
                        {word}
                      </motion.span>
                    </span>
                  ))}
                </h1>

                {/* Line 2 staggered */}
                <p className="apple-body" style={{ fontSize: 24, color: '#0066CC', fontWeight: 700, margin: '0 0 36px' }}>
                  {"Just ask Social Security to check you against all of them.".split(" ").map((word, idx) => (
                    <span key={idx} style={{ display: 'inline-block', overflow: 'hidden', marginRight: '0.25em' }}>
                      <motion.span
                        style={{ display: 'inline-block' }}
                        initial={{ y: '100%', opacity: 0 }}
                        animate={{ y: 0, opacity: 1 }}
                        transition={{ type: 'spring', damping: 15, stiffness: 95, delay: 0.75 + idx * 0.08 }}
                      >
                        {word}
                      </motion.span>
                    </span>
                  ))}
                </p>

                {/* Subtitle rule */}
                <AnimatePresence>
                  {showRule && (
                    <motion.p
                      className="apple-body"
                      style={{ fontSize: 18, color: '#B58450', fontWeight: 600, margin: 0 }}
                      initial={{ opacity: 0, y: 15 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -10 }}
                      transition={{ duration: 0.5, ease: easeExpo }}
                    >
                      "SSA follows rules exactly as written — but never goes looking for you first."
                    </motion.p>
                  )}
                </AnimatePresence>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── BEAT 2: Full-Screen Takeover — CTA & End ── */}
        <AnimatePresence mode="wait">
          {showCTA && (
            <motion.div
              key="takeover-cta"
              style={overlayBg}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.5, ease: easeExpo }}
            >
              <div style={{ textAlign: 'center', maxWidth: 640 }}>
                {/* Title staggered */}
                <h1 className="apple-h1" style={{ fontSize: 44, marginBottom: 24 }}>
                  {"The asking is your job.".split(" ").map((word, idx) => (
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

                {/* Staggered buttons */}
                <div style={{ display: 'flex', gap: 16, justifyContent: 'center', height: 60, marginBottom: 36 }}>
                  <AnimatePresence>
                    {showButtons && (
                      <>
                        <motion.button
                          style={{
                            border: 'none',
                            padding: '14px 28px',
                            borderRadius: 999,
                            background: '#347052',
                            color: '#fff',
                            fontFamily: "'Plus Jakarta Sans', sans-serif",
                            fontSize: 16,
                            fontWeight: 700,
                            boxShadow: '0 8px 24px rgba(52,112,82,0.2)',
                            cursor: 'pointer',
                          }}
                          initial={{ scale: 0, opacity: 0 }}
                          animate={{ scale: 1, opacity: 1 }}
                          transition={{ type: 'spring', damping: 12, stiffness: 110, delay: 0.1 }}
                        >
                          📞 Make that call
                        </motion.button>
                        
                        <motion.button
                          style={{
                            border: 'none',
                            padding: '14px 28px',
                            borderRadius: 999,
                            background: '#0066CC',
                            color: '#fff',
                            fontFamily: "'Plus Jakarta Sans', sans-serif",
                            fontSize: 16,
                            fontWeight: 700,
                            boxShadow: '0 8px 24px rgba(0,102,204,0.2)',
                            cursor: 'pointer',
                          }}
                          initial={{ scale: 0, opacity: 0 }}
                          animate={{ scale: 1, opacity: 1 }}
                          transition={{ type: 'spring', damping: 12, stiffness: 110, delay: 0.25 }}
                        >
                          🔔 Subscribe
                        </motion.button>
                      </>
                    )}
                  </AnimatePresence>
                </div>

                {/* Final money text */}
                <div style={{ height: 50 }}>
                  <AnimatePresence>
                    {showMoney && (
                      <motion.h2
                        className="apple-mono"
                        style={{ fontSize: 32, color: '#B58450', margin: 0, letterSpacing: '-1px' }}
                        initial={{ opacity: 0, y: 15 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0 }}
                        transition={{ type: 'spring', damping: 15, stiffness: 100 }}
                      >
                        That money has your name on it.
                      </motion.h2>
                    )}
                  </AnimatePresence>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

      </div>
    </div>
  );
}
