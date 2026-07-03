import React, { useState, useEffect, useRef, useCallback } from 'react';
import { getAllCompositions } from '../core/registry';
import type { CompositionConfig } from '../core/Composition';
import { Viewport } from './Viewport';
import { PlayerBar } from './PlayerBar';
import { CompositionList } from './CompositionList';
import Root from '../Root';

// Call Root() directly (not via JSX) to synchronously fire all Composition()
// calls at module evaluation time. Composition() registers into the global
// registry synchronously, so getAllCompositions() works immediately after.
Root();


export function App() {
  const [compositions, setCompositions] = useState<CompositionConfig[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [frame, setFrame] = useState(0);
  const [playing, setPlaying] = useState(false);

  const rafRef = useRef<number>(0);
  const lastTimeRef = useRef<number>(0);
  const frameRef = useRef(frame);
  frameRef.current = frame;

  // Read compositions from registry (populated synchronously by Root.tsx import)
  useEffect(() => {
    setCompositions(getAllCompositions());
  }, []);

  const selectedComp = compositions.find((c) => c.id === selectedId);

  // Playback loop using time-relative calculation based on performance.now()
  const startPlayback = useCallback(() => {
    if (!selectedComp) return;
    const fps = selectedComp.fps;
    const duration = selectedComp.durationInFrames;
    const startVal = performance.now();
    const elapsedAtStart = (frameRef.current / fps) * 1000;
    const startTime = startVal - elapsedAtStart;

    const tick = (now: number) => {
      const elapsedMs = now - startTime;
      const targetFrame = Math.floor((elapsedMs / 1000) * fps);

      if (targetFrame >= duration) {
        setFrame(duration - 1);
        setPlaying(false);
        return;
      }

      setFrame(targetFrame);
      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
  }, [selectedComp]);

  const stopPlayback = useCallback(() => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    }
  }, []);

  useEffect(() => {
    if (playing) {
      startPlayback();
    } else {
      stopPlayback();
    }
    return () => stopPlayback();
  }, [playing, startPlayback, stopPlayback]);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!selectedComp) return;
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;

      switch (e.key) {
        case ' ':
          e.preventDefault();
          setPlaying((p) => !p);
          break;
        case 'ArrowLeft':
          e.preventDefault();
          setPlaying(false);
          setFrame((f) => Math.max(0, f - 1));
          break;
        case 'ArrowRight':
          e.preventDefault();
          setPlaying(false);
          setFrame((f) => Math.min(selectedComp.durationInFrames - 1, f + 1));
          break;
        case 'Home':
          e.preventDefault();
          setPlaying(false);
          setFrame(0);
          break;
        case 'End':
          e.preventDefault();
          setPlaying(false);
          setFrame(selectedComp.durationInFrames - 1);
          break;
        case 'Escape':
          setSelectedId(null);
          setPlaying(false);
          setFrame(0);
          break;
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [selectedComp]);

  const handleSelect = (id: string) => {
    setSelectedId(id);
    setFrame(0);
    setPlaying(false);
  };

  const handleBack = () => {
    setSelectedId(null);
    setPlaying(false);
    setFrame(0);
  };

  return (
    <div className="app">
      {/* Header */}
      <header className="header">
        <div className="header-logo">
          <div className="header-logo-icon">⚡</div>
          <span className="header-logo-text">MotionFlow</span>
          <span className="header-logo-badge">Studio</span>
        </div>

        {selectedComp && (
          <>
            <div className="header-divider" />
            <span className="header-composition-name">{selectedComp.id}</span>
          </>
        )}

        <div className="header-spacer" />

        {selectedId && (
          <button className="header-back-btn" onClick={handleBack}>
            ← All Compositions
          </button>
        )}
      </header>

      {/* Main content */}
      <div className="main">
        {selectedComp ? (
          <>
            <Viewport
              compositionId={selectedComp.id}
              frame={frame}
              playing={playing}
              width={selectedComp.width}
              height={selectedComp.height}
            />
            <PlayerBar
              frame={frame}
              durationInFrames={selectedComp.durationInFrames}
              fps={selectedComp.fps}
              playing={playing}
              onFrameChange={(f) => { setPlaying(false); setFrame(f); }}
              onPlayPause={() => setPlaying((p) => !p)}
              onSkipStart={() => { setPlaying(false); setFrame(0); }}
              onSkipEnd={() => { setPlaying(false); setFrame(selectedComp.durationInFrames - 1); }}
            />
          </>
        ) : (
          <CompositionList compositions={compositions} onSelect={handleSelect} />
        )}
      </div>
    </div>
  );
}
