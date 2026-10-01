/**
 * director — pure keyframe evaluation for camera moves + motor choreography.
 *
 * No I/O, no time source: every function is a pure function of (track, frame),
 * so scrubbing, replays, and headless export all evaluate identically.
 * Key arrays need not be sorted; bracketing scans tolerate any order.
 */
import type {
  CameraData,
  CameraTrack,
  EasingName,
  ForgeScene,
  MotorTrack,
  NumKey,
  Vec3,
  Vec3Key,
} from '../core/types';

export function applyEasing(name: EasingName, t: number): number {
  const x = Math.max(0, Math.min(1, t));
  switch (name) {
    case 'hold':
      return 0;
    case 'linear':
      return x;
    case 'smooth':
    case 'ease-in-out':
      return x * x * (3 - 2 * x);
    case 'ease-in':
      return x * x * x;
    case 'ease-out':
      return 1 - (1 - x) * (1 - x) * (1 - x);
    default:
      return x;
  }
}

interface Bracket<K> {
  before: K | null;
  after: K | null;
}

/** Latest key at/before frame + earliest key strictly after frame. */
function bracket<K extends { frame: number }>(
  keys: readonly K[],
  frame: number,
): Bracket<K> {
  let before: K | null = null;
  let after: K | null = null;
  for (const k of keys) {
    if (k.frame <= frame) {
      if (!before || k.frame >= before.frame) before = k;
    } else {
      if (!after || k.frame < after.frame) after = k;
    }
  }
  return { before, after };
}

/** Interpolated scalar, or null when the channel has no keys. */
export function evalNumKeys(
  keys: readonly NumKey[],
  frame: number,
): number | null {
  if (keys.length === 0) return null;
  const { before, after } = bracket(keys, frame);
  if (!before) return after!.value; // before first key: clamp
  if (!after || after.frame === before.frame) return before.value;
  const t = (frame - before.frame) / (after.frame - before.frame);
  const e = applyEasing(before.easing, t);
  return before.value + (after.value - before.value) * e;
}

/** Interpolated Vec3, or null when the channel has no keys. */
export function evalVec3Keys(
  keys: readonly Vec3Key[],
  frame: number,
): Vec3 | null {
  if (keys.length === 0) return null;
  const { before, after } = bracket(keys, frame);
  if (!before) return [...after!.value] as Vec3;
  if (!after || after.frame === before.frame) return [...before.value] as Vec3;
  const t = (frame - before.frame) / (after.frame - before.frame);
  const e = applyEasing(before.easing, t);
  return [
    before.value[0] + (after.value[0] - before.value[0]) * e,
    before.value[1] + (after.value[1] - before.value[1]) * e,
    before.value[2] + (after.value[2] - before.value[2]) * e,
  ];
}

export interface CameraPose {
  position: Vec3;
  target: Vec3;
  fov: number;
}

/**
 * Full camera pose at a frame. Channels without keys fall back to the
 * base camera. Null when the track is disabled or entirely keyless.
 */
export function evalCameraTrack(
  track: CameraTrack,
  base: CameraData,
  frame: number,
): CameraPose | null {
  if (!track.enabled) return null;
  if (
    track.position.length === 0 &&
    track.target.length === 0 &&
    track.fov.length === 0
  ) {
    return null;
  }
  return {
    position: evalVec3Keys(track.position, frame) ?? [...base.position] as Vec3,
    target: evalVec3Keys(track.target, frame) ?? [...base.target] as Vec3,
    fov: evalNumKeys(track.fov, frame) ?? base.fov,
  };
}

/** First enabled track bound to the scene's active camera, if any. */
export function activeCameraTrack(scene: ForgeScene): CameraTrack | null {
  return (
    scene.cameraTracks.find(
      (t) => t.enabled && t.cameraId === scene.activeCameraId,
    ) ?? null
  );
}

/** Motor target/speed at a frame, or null when disabled/keyless. */
export function evalMotorTrack(
  track: MotorTrack,
  frame: number,
): number | null {
  if (!track.enabled || track.keys.length === 0) return null;
  return evalNumKeys(track.keys, frame);
}
