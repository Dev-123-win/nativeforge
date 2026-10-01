/**
 * Bottom timeline — simulation transport, scrubbing, record range, markers,
 * and keyframe lanes for every Director track (camera / motor / driver).
 * Scrubbing is deterministic: the runtime restores the exact frame state.
 *
 * Lane interactions: click a key to jump, drag it to move (occupied frames
 * block the drag so keys are never merged away), double-click to delete,
 * click empty lane to seek, click the lane dot to enable/disable.
 */
import React from 'react';
import { useForge } from '../core/store';
import type {
  CameraTrack,
  DriverTrack,
  MotorTrack,
} from '../core/types';
import {
  buildLanes,
  deleteTrackKeys,
  fracToFrame,
  frameToPct,
  moveTrackKeys,
  trackFrames,
  type AnyTrack,
  type KeyLane,
  type LaneKind,
} from '../render/lanes';

function timecode(frame: number, fps: number): string {
  const s = frame / fps;
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  const fr = frame % fps;
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}.${String(fr).padStart(2, '0')}`;
}

const LANE_COLORS: Record<LaneKind, string> = {
  camera: '#4f8ff7',
  motor: '#ffc247',
  driver: '#51ff7a',
};

function findTrack(kind: LaneKind, id: string): AnyTrack | undefined {
  const sc = useForge.getState().activeScene;
  if (!sc) return undefined;
  if (kind === 'camera') return sc.cameraTracks.find((t) => t.id === id);
  if (kind === 'motor') return sc.motorTracks.find((t) => t.id === id);
  return sc.driverTracks.find((t) => t.id === id);
}

function upsertLaneTrack(kind: LaneKind, track: AnyTrack): void {
  const st = useForge.getState();
  if (kind === 'camera') st.upsertCameraTrack(track as CameraTrack);
  else if (kind === 'motor') st.upsertMotorTrack(track as MotorTrack);
  else st.upsertDriverTrack(track as DriverTrack);
}

function LaneRow({
  lane,
  max,
  frame,
  jump,
}: {
  lane: KeyLane;
  max: number;
  frame: number;
  jump: (f: number) => void;
}) {
  const areaRef = React.useRef<HTMLDivElement>(null);
  const dragRef = React.useRef<{
    from: number;
    startX: number;
    moved: boolean;
  } | null>(null);

  const frameAt = (clientX: number): number => {
    const el = areaRef.current;
    if (!el) return 0;
    const r = el.getBoundingClientRect();
    if (r.width <= 0) return 0;
    return fracToFrame((clientX - r.left) / r.width, max);
  };

  const toggleEnabled = () => {
    const track = findTrack(lane.kind, lane.id);
    if (!track) return;
    upsertLaneTrack(lane.kind, { ...track, enabled: !track.enabled });
  };

  return (
    <div className={`forge-lane${lane.enabled ? '' : ' disabled'}`}>
      <button
        type="button"
        className="forge-lane-label"
        onClick={toggleEnabled}
        title={`${lane.label} — click to ${lane.enabled ? 'disable' : 'enable'}`}
      >
        <span
          className="forge-lane-dot"
          style={{ background: LANE_COLORS[lane.kind] }}
        />
        <span className="forge-lane-name">{lane.label}</span>
        <span className="forge-lane-count">{lane.frames.length}</span>
      </button>
      <div
        ref={areaRef}
        className="forge-lane-area"
        onClick={(e) => jump(frameAt(e.clientX))}
      >
        <div
          className="forge-lane-playhead"
          style={{ left: `${frameToPct(frame, max)}%` }}
        />
        {lane.frames.map((f) => (
          <button
            key={f}
            type="button"
            className="forge-key"
            style={
              {
                left: `${frameToPct(f, max)}%`,
                '--lane': LANE_COLORS[lane.kind],
              } as React.CSSProperties
            }
            title={`f${f} — click: jump · drag: move · double-click: delete`}
            onClick={(e) => e.stopPropagation()}
            onDoubleClick={(e) => {
              e.stopPropagation();
              const track = findTrack(lane.kind, lane.id);
              if (!track) return;
              upsertLaneTrack(lane.kind, deleteTrackKeys(lane.kind, track, f));
            }}
            onPointerDown={(e) => {
              e.stopPropagation();
              (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
              dragRef.current = { from: f, startX: e.clientX, moved: false };
            }}
            onPointerMove={(e) => {
              const d = dragRef.current;
              if (!d) return;
              if (!d.moved && Math.abs(e.clientX - d.startX) <= 3) return;
              if (!d.moved) {
                d.moved = true;
                useForge.getState().setPlayback({ playing: false });
              }
              const to = frameAt(e.clientX);
              if (to === d.from) return;
              const track = findTrack(lane.kind, lane.id);
              if (!track) return;
              // Occupied frames block the drag — passing over a key must
              // never silently merge it away.
              if (trackFrames(lane.kind, track).includes(to)) return;
              upsertLaneTrack(
                lane.kind,
                moveTrackKeys(lane.kind, track, d.from, to),
              );
              d.from = to;
            }}
            onPointerUp={() => {
              const d = dragRef.current;
              dragRef.current = null;
              if (d && !d.moved) jump(f);
            }}
            onPointerCancel={() => {
              dragRef.current = null;
            }}
          />
        ))}
      </div>
    </div>
  );
}

export function Timeline({ cacheSize }: { cacheSize: number }) {
  const scene = useForge((s) => s.activeScene);
  const playback = useForge((s) => s.playback);
  const setPlayback = useForge((s) => s.setPlayback);
  const clearDynamicState = useForge((s) => s.clearDynamicState);
  const [lanesOpen, setLanesOpen] = React.useState(true);
  if (!scene) return null;

  const duration = Math.max(1, scene.render.durationFrames);
  const max = duration - 1;
  const r0 = (scene.render.recordStart / duration) * 100;
  const r1 = (scene.render.recordEnd / duration) * 100;
  const timeEvents = scene.events.filter((e) => e.trigger.type === 'time');
  const lanes = buildLanes(scene);
  const keyCount = lanes.reduce((n, l) => n + l.frames.length, 0);

  const go = (f: number) =>
    setPlayback({ frame: Math.max(0, Math.min(max, Math.round(f))) });
  const jump = (f: number) => {
    setPlayback({ playing: false });
    go(f);
  };

  return (
    <div className="forge-timeline">
      <div className="forge-timeline-row">
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

      {lanes.length === 0 ? (
        <div className="forge-lanes-empty">
          No keyframes — capture camera, motor, and driver keys in the
          Director tab.
        </div>
      ) : (
        <div className="forge-lanes">
          <div className="forge-lanes-head">
            <button
              type="button"
              className="forge-lanes-toggle"
              onClick={() => setLanesOpen(!lanesOpen)}
              aria-expanded={lanesOpen}
            >
              {lanesOpen ? '▾' : '▸'} Keyframes ({keyCount})
            </button>
            {lanesOpen && (
              <span className="forge-lanes-hint">
                key click: jump · drag: move · double-click: delete ·
                lane click: seek · dot: enable
              </span>
            )}
          </div>
          {lanesOpen &&
            lanes.map((lane) => (
              <LaneRow
                key={lane.id}
                lane={lane}
                max={max}
                frame={playback.frame}
                jump={jump}
              />
            ))}
        </div>
      )}
    </div>
  );
}
