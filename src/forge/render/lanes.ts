/**
 * lanes — pure helpers for the Timeline's keyframe lanes.
 *
 * No DOM, no store: lane derivation, frame↔pixel mapping, and key
 * move/delete transforms. The Timeline component applies these through
 * the store's track upserts.
 */
import type {
  CameraTrack,
  DriverTrack,
  ForgeScene,
  MotorTrack,
} from '../core/types';

export type LaneKind = 'camera' | 'motor' | 'driver';

export interface KeyLane {
  /** Track id. */
  id: string;
  kind: LaneKind;
  label: string;
  enabled: boolean;
  /** Sorted unique keyframes across all channels. */
  frames: number[];
}

export function buildLanes(scene: ForgeScene): KeyLane[] {
  const lanes: KeyLane[] = [];
  for (const t of scene.cameraTracks ?? []) {
    const set = new Set<number>();
    for (const k of t.position) set.add(k.frame);
    for (const k of t.target) set.add(k.frame);
    for (const k of t.fov) set.add(k.frame);
    lanes.push({
      id: t.id,
      kind: 'camera',
      label: t.name,
      enabled: t.enabled,
      frames: [...set].sort((a, b) => a - b),
    });
  }
  for (const t of scene.motorTracks ?? []) {
    lanes.push({
      id: t.id,
      kind: 'motor',
      label: t.name,
      enabled: t.enabled,
      frames: [...new Set(t.keys.map((k) => k.frame))].sort((a, b) => a - b),
    });
  }
  for (const t of scene.driverTracks ?? []) {
    const set = new Set<number>();
    for (const k of t.position) set.add(k.frame);
    for (const k of t.rotation) set.add(k.frame);
    lanes.push({
      id: t.id,
      kind: 'driver',
      label: t.name,
      enabled: t.enabled,
      frames: [...set].sort((a, b) => a - b),
    });
  }
  return lanes;
}

/** Frame → percent offset (0..100) for absolute positioning. */
export function frameToPct(frame: number, max: number): number {
  if (max <= 0) return 0;
  return (Math.max(0, Math.min(max, frame)) / max) * 100;
}

/** Pointer fraction (0..1 across the lane) → quantized frame. */
export function fracToFrame(frac: number, max: number): number {
  return Math.max(0, Math.min(max, Math.round(frac * max)));
}

export type LaneChannel = 'position' | 'target' | 'fov' | 'rotation' | 'keys';

export function laneChannels(kind: LaneKind): LaneChannel[] {
  if (kind === 'camera') return ['position', 'target', 'fov'];
  if (kind === 'motor') return ['keys'];
  return ['position', 'rotation'];
}

/**
 * Move keys at `from` to `to`, merging over (replacing) any keys already
 * at `to`. Values and easings ride along. Result stays frame-sorted.
 */
export function moveKeys<K extends { frame: number }>(
  keys: readonly K[],
  from: number,
  to: number,
): K[] {
  const moving = keys.filter((k) => k.frame === from);
  if (moving.length === 0 || from === to) return [...keys];
  const rest = keys.filter((k) => k.frame !== from && k.frame !== to);
  return [...rest, ...moving.map((k) => ({ ...k, frame: to }))].sort(
    (a, b) => a.frame - b.frame,
  );
}

/** Delete keys at a frame. */
export function deleteKeys<K extends { frame: number }>(
  keys: readonly K[],
  at: number,
): K[] {
  return keys.filter((k) => k.frame !== at);
}

export type AnyTrack = CameraTrack | MotorTrack | DriverTrack;

/** Sorted unique keyframes across a track's channels. */
export function trackFrames(kind: LaneKind, track: AnyTrack): number[] {
  const set = new Set<number>();
  const src = track as unknown as Record<string, Array<{ frame: number }>>;
  for (const ch of laneChannels(kind)) {
    for (const k of src[ch] ?? []) set.add(k.frame);
  }
  return [...set].sort((a, b) => a - b);
}

/** Apply moveKeys to every channel of a track. */
export function moveTrackKeys<T extends AnyTrack>(
  kind: LaneKind,
  track: T,
  from: number,
  to: number,
): T {
  const next = { ...track } as unknown as Record<string, unknown>;
  const src = track as unknown as Record<string, Array<{ frame: number }>>;
  for (const ch of laneChannels(kind)) {
    next[ch] = moveKeys(src[ch] ?? [], from, to);
  }
  return next as T;
}

/** Apply deleteKeys to every channel of a track. */
export function deleteTrackKeys<T extends AnyTrack>(
  kind: LaneKind,
  track: T,
  at: number,
): T {
  const next = { ...track } as unknown as Record<string, unknown>;
  const src = track as unknown as Record<string, Array<{ frame: number }>>;
  for (const ch of laneChannels(kind)) {
    next[ch] = deleteKeys(src[ch] ?? [], at);
  }
  return next as T;
}
