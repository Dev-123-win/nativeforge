/**
 * Bottom timeline — simulation transport, scrubbing, record range, markers.
 * Scrubbing is deterministic: the runtime restores the exact frame state.
 */
import React from 'react';
import { useForge } from '../core/store';

function timecode(frame: number, fps: number): string {
  const s = frame / fps;
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  const fr = frame % fps;
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}.${String(fr).padStart(2, '0')}`;
}

export function Timeline({ cacheSize }: { cacheSize: number }) {
  const scene = useForge((s) => s.activeScene);
  const playback = useForge((s) => s.playback);
  const setPlayback = useForge((s) => s.setPlayback);
  const clearDynamicState = useForge((s) => s.clearDynamicState);
  if (!scene) return null;

  const duration = Math.max(1, scene.render.durationFrames);
  const max = duration - 1;
  const r0 = (scene.render.recordStart / duration) * 100;
  const r1 = (scene.render.recordEnd / duration) * 100;
  const timeEvents = scene.events.filter((e) => e.trigger.type === 'time');

  const go = (f: number) => setPlayback({ frame: Math.max(0, Math.min(max, Math.round(f))) });

  return (
    <div className="forge-timeline">
      <div className="forge-transport">
        <button type="button" className="forge-btn small" title="Skip to start (Home)"
          onClick={() => { setPlayback({ playing: false }); go(0); }}>
          ⏮
        </button>
        <button type="button" className="forge-btn small" title="Step back (←)"
          onClick={() => { setPlayback({ playing: false }); go(playback.frame - 1); }}>
          ◀
        </button>
        <button
          type="button"
          className={`forge-btn play ${playback.playing ? 'is-playing' : ''}`}
          title="Play / pause (Space)"
          onClick={() => {
            if (!playback.playing && playback.frame >= max) go(0);
            setPlayback({ playing: !playback.playing });
          }}
        >
          {playback.playing ? '⏸' : '▶'}
        </button>
        <button type="button" className="forge-btn small" title="Step forward (→)"
          onClick={() => { setPlayback({ playing: false }); go(playback.frame + 1); }}>
          ▶
        </button>
        <button type="button" className="forge-btn small" title="Skip to end (End)"
          onClick={() => { setPlayback({ playing: false }); go(max); }}>
          ⏭
        </button>
        <button type="button" className="forge-btn small" title="Reset dynamics + rewind"
          onClick={() => clearDynamicState()}>
          ⟲
        </button>
        <select
          className="forge-select tiny"
          value={playback.speed}
          title="Playback speed"
          onChange={(e) => setPlayback({ speed: Number(e.target.value) })}
        >
          {[0.25, 0.5, 1, 2, 4].map((s) => (
            <option key={s} value={s}>
              {s}×
            </option>
          ))}
        </select>
      </div>

      <div className="forge-scrub-wrap">
        <div
          className="forge-record-band"
          style={{ left: `${r0}%`, width: `${Math.max(0, r1 - r0)}%` }}
          title="Record range"
        />
        {timeEvents.map((e) => (
          <div
            key={e.id}
            className="forge-marker"
            style={{ left: `${(e.trigger.time * scene.render.fps / duration) * 100}%` }}
            title={e.name}
          />
        ))}
        <input
          type="range"
          className="forge-scrub"
          min={0}
          max={max}
          step={1}
          value={playback.frame}
          onChange={(e) => {
            setPlayback({ playing: false });
            go(Number(e.target.value));
          }}
          aria-label="Simulation frame"
        />
      </div>

      <div className="forge-timeline-info">
        <code>
          f{playback.frame}/{max} · {timecode(playback.frame, scene.render.fps)}
        </code>
        <span className="forge-cache-badge" title="Cached simulation keyframes">
          cache {cacheSize}
        </span>
      </div>
    </div>
  );
}
