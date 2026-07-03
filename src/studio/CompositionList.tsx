import React from 'react';
import type { CompositionConfig } from '../core/Composition';

interface CompositionListProps {
  compositions: CompositionConfig[];
  onSelect: (id: string) => void;
}

function formatDuration(frames: number, fps: number): string {
  const secs = frames / fps;
  return secs < 60 ? `${secs.toFixed(1)}s` : `${Math.floor(secs / 60)}m ${(secs % 60).toFixed(0)}s`;
}

export function CompositionList({ compositions, onSelect }: CompositionListProps) {
  if (compositions.length === 0) {
    return (
      <div className="comp-list-page">
        <div className="comp-list-hero fade-in-up">
          <h1 className="comp-list-hero-title">MotionFlow Studio</h1>
          <p className="comp-list-hero-sub">Framer Motion-native video engine</p>
        </div>
        <div className="empty-state fade-in-up">
          <div className="empty-state-icon">🎬</div>
          <div className="empty-state-title">No compositions registered</div>
          <div className="empty-state-body">
            Add a <code>&lt;Composition&gt;</code> to your <code>Root.tsx</code> to get started.
            <br /><br />
            Example:
            <br />
            <code>{'<Composition id="Intro" component={Intro} durationInFrames={150} fps={30} width={1920} height={1080} defaultProps={{ title: "Hello World" }} />'}</code>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="comp-list-page">
      <div className="comp-list-hero fade-in-up">
        <h1 className="comp-list-hero-title">MotionFlow Studio</h1>
        <p className="comp-list-hero-sub">
          {compositions.length} composition{compositions.length !== 1 ? 's' : ''} registered
        </p>
      </div>

      <div className="comp-list-grid">
        {compositions.map((comp, i) => (
          <div
            key={comp.id}
            className="comp-card fade-in-up"
            style={{ animationDelay: `${i * 60}ms` }}
            onClick={() => onSelect(comp.id)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => e.key === 'Enter' && onSelect(comp.id)}
            aria-label={`Open composition: ${comp.id}`}
          >
            <div className="comp-card-thumb">
              <div className="comp-card-thumb-glow" />
              <div className="comp-card-thumb-icon">🎬</div>
            </div>
            <div className="comp-card-info">
              <div className="comp-card-title">{comp.id}</div>
              <div className="comp-card-meta">
                <span className="comp-meta-badge">{comp.width}×{comp.height}</span>
                <span className="comp-meta-badge">{comp.fps} fps</span>
                <span className="comp-meta-badge">{formatDuration(comp.durationInFrames, comp.fps)}</span>
                <span className="comp-meta-badge">{comp.durationInFrames}f</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
