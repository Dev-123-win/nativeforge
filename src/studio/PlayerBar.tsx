import React, { useEffect, useRef, useCallback } from 'react';

interface PlayerBarProps {
  frame: number;
  durationInFrames: number;
  fps: number;
  playing: boolean;
  onFrameChange: (frame: number) => void;
  onPlayPause: () => void;
  onSkipStart: () => void;
  onSkipEnd: () => void;
}

function formatTimecode(frame: number, fps: number): string {
  const totalSeconds = frame / fps;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.floor(totalSeconds % 60);
  const frames = frame % fps;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}:${String(frames).padStart(2, '0')}`;
}

export function PlayerBar({
  frame,
  durationInFrames,
  fps,
  playing,
  onFrameChange,
  onPlayPause,
  onSkipStart,
  onSkipEnd,
}: PlayerBarProps) {
  const fillRef = useRef<HTMLDivElement>(null);
  const progress = durationInFrames > 0 ? frame / (durationInFrames - 1) : 0;

  // Update fill bar without re-rendering (perf optimisation)
  useEffect(() => {
    if (fillRef.current) {
      fillRef.current.style.width = `${progress * 100}%`;
    }
  }, [progress]);

  const handleScrub = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      onFrameChange(Number(e.target.value));
    },
    [onFrameChange]
  );

  // Skip back / forward one frame
  const stepBack = () => onFrameChange(Math.max(0, frame - 1));
  const stepForward = () => onFrameChange(Math.min(durationInFrames - 1, frame + 1));

  return (
    <div className="player-bar">
      {/* Skip to start */}
      <button className="player-btn" onClick={onSkipStart} title="Skip to start (Home)">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <rect x="1" y="1" width="2" height="12" rx="1" fill="currentColor"/>
          <path d="M13 2L5 7l8 5V2z" fill="currentColor"/>
        </svg>
      </button>

      {/* Step back */}
      <button className="player-btn" onClick={stepBack} title="Previous frame (←)">
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
          <path d="M9 1L3 6l6 5V1z" fill="currentColor"/>
        </svg>
      </button>

      {/* Play / Pause */}
      <button
        className={`player-btn play-pause ${playing ? 'is-playing' : ''}`}
        onClick={onPlayPause}
        title={playing ? 'Pause (Space)' : 'Play (Space)'}
      >
        {playing ? (
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <rect x="2" y="2" width="4" height="10" rx="1.5" fill="currentColor"/>
            <rect x="8" y="2" width="4" height="10" rx="1.5" fill="currentColor"/>
          </svg>
        ) : (
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M3 1.5l9 5.5-9 5.5V1.5z" fill="currentColor"/>
          </svg>
        )}
      </button>

      {/* Step forward */}
      <button className="player-btn" onClick={stepForward} title="Next frame (→)">
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
          <path d="M3 1l6 5-6 5V1z" fill="currentColor"/>
        </svg>
      </button>

      {/* Skip to end */}
      <button className="player-btn" onClick={onSkipEnd} title="Skip to end (End)">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <rect x="11" y="1" width="2" height="12" rx="1" fill="currentColor"/>
          <path d="M1 2l8 5-8 5V2z" fill="currentColor"/>
        </svg>
      </button>

      <div className="player-divider" />

      {/* Scrubber */}
      <div className="scrubber-wrapper">
        <div className="scrubber-track">
          <div className="scrubber-fill" ref={fillRef} />
          <input
            type="range"
            className="scrubber"
            min={0}
            max={Math.max(0, durationInFrames - 1)}
            step={1}
            value={frame}
            onChange={handleScrub}
            aria-label="Timeline scrubber"
          />
        </div>
      </div>

      <div className="player-divider" />

      {/* Info */}
      <div className="player-info">
        <span className="player-timecode" aria-label="Current timecode">
          {formatTimecode(frame, fps)}
        </span>
        <span className="player-fps-badge">{fps} fps</span>
      </div>
    </div>
  );
}
