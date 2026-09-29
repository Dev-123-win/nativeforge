/**
 * Emitter stepping — deterministic spawn schedules with pooling.
 *
 * Emitters spawn template objects within [startTime, endTime] at `rate`/s
 * (+`burst` at window start). Spawned bodies are pooled: when `maxAlive` is
 * reached the oldest is recycled, so 10k-ball scenes don't churn the WASM
 * heap. Lifetime expiry despawns (removes) bodies.
 */

import type { EmitterData, Vec3 } from '../core/types';
import { Rng, streamSeed } from '../core/rng';

export interface SpawnSpec {
  emitterId: string;
  templateId: string;
  position: Vec3;
  rotation: Vec3;
  velocity: Vec3;
  scale: number;
  color: string | null;
  mass: number; // 0 = template default
}

export interface EmitterState {
  def: EmitterData;
  emitterId: string;
  acc: number;
  spawned: number;
  burstDone: boolean;
  rng: Rng;
  /** Live spawned body ids in spawn order (for pooling). */
  alive: string[];
  ages: Map<string, number>;
}

export function createEmitterState(
  emitterId: string,
  def: EmitterData,
  sceneSeed: number,
): EmitterState {
  return {
    def,
    emitterId,
    acc: 0,
    spawned: 0,
    burstDone: false,
    rng: new Rng(streamSeed(sceneSeed, 'emitter', emitterId)),
    alive: [],
    ages: new Map(),
  };
}

function sampleOffset(
  st: EmitterState,
  origin: Vec3,
  scale: number,
): Vec3 {
  const rng = st.rng;
  const s = scale;
  switch (st.def.shape) {
    case 'point':
      return [...origin] as Vec3;
    case 'line':
      return [origin[0] + rng.range(-s, s), origin[1], origin[2]];
    case 'circle': {
      const a = rng.range(0, Math.PI * 2);
      return [origin[0] + Math.cos(a) * s, origin[1], origin[2] + Math.sin(a) * s];
    }
    case 'rectangle':
      return [
        origin[0] + rng.range(-s, s),
        origin[1],
        origin[2] + rng.range(-s, s),
      ];
    case 'sphere': {
      const v = rng.unitVector();
      const r = Math.cbrt(rng.next()) * s;
      return [origin[0] + v[0] * r, origin[1] + v[1] * r, origin[2] + v[2] * r];
    }
    case 'box':
      return [
        origin[0] + rng.range(-s, s),
        origin[1] + rng.range(-s, s),
        origin[2] + rng.range(-s, s),
      ];
    case 'cone': {
      const a = rng.range(0, Math.PI * 2);
      const r = rng.next() * s;
      return [
        origin[0] + Math.cos(a) * r,
        origin[1] - rng.next() * s,
        origin[2] + Math.sin(a) * r,
      ];
    }
    default:
      return [...origin] as Vec3;
  }
}

export interface EmitterCallbacks {
  spawn: (spec: SpawnSpec) => string; // returns body id
  recycle: (id: string, spec: SpawnSpec) => void;
  despawn: (id: string) => void;
}

export function stepEmitter(
  st: EmitterState,
  simTime: number,
  dt: number,
  origin: Vec3,
  originScale: number,
  cb: EmitterCallbacks,
): void {
  const def = st.def;
  if (!def.enabled) return;

  // Age + expire live bodies.
  if (def.lifetime > 0) {
    const expired: string[] = [];
    for (const id of st.alive) {
      const age = (st.ages.get(id) ?? 0) + dt;
      st.ages.set(id, age);
      if (age >= def.lifetime) expired.push(id);
    }
    for (const id of expired) {
      cb.despawn(id);
      st.ages.delete(id);
      st.alive = st.alive.filter((x) => x !== id);
    }
  }

  const inWindow = simTime >= def.startTime && simTime <= def.endTime;
  if (!inWindow) return;

  const wantTotal =
    def.count > 0 ? Math.min(def.count, def.count) : Number.MAX_SAFE_INTEGER;

  const emit = (): void => {
    if (st.spawned >= wantTotal) return;
    const pos = sampleOffset(st, origin, Math.max(0.05, originScale));
    const spread = def.spread;
    const v: Vec3 = [
      def.initialVelocity[0] + st.rng.range(-spread, spread) * 5,
      def.initialVelocity[1] + st.rng.range(-spread, spread) * 2,
      def.initialVelocity[2] + st.rng.range(-spread, spread) * 5,
    ];
    const speedJitter = 1 + st.rng.range(-def.speedRandom, def.speedRandom);
    const spec: SpawnSpec = {
      emitterId: st.emitterId,
      templateId: def.templateId,
      position: pos,
      rotation: [
        st.rng.range(0, Math.PI * 2),
        st.rng.range(0, Math.PI * 2),
        st.rng.range(0, Math.PI * 2),
      ],
      velocity: [v[0] * speedJitter, v[1] * speedJitter, v[2] * speedJitter],
      scale: st.rng.range(def.scaleMin, def.scaleMax),
      color: null,
      mass: 0,
    };
    if (st.alive.length >= def.maxAlive && st.alive.length > 0) {
      const oldest = st.alive.shift()!;
      cb.recycle(oldest, spec);
      st.alive.push(oldest);
      st.ages.set(oldest, 0);
    } else {
      const id = cb.spawn(spec);
      st.alive.push(id);
      st.ages.set(id, 0);
    }
    st.spawned += 1;
  };

  if (!st.burstDone) {
    st.burstDone = true;
    for (let i = 0; i < def.burst; i++) emit();
  }

  st.acc += def.rate * dt;
  while (st.acc >= 1) {
    st.acc -= 1;
    emit();
  }
}

export function resetEmitter(st: EmitterState, sceneSeed: number): void {
  st.acc = 0;
  st.spawned = 0;
  st.burstDone = false;
  st.rng = new Rng(streamSeed(sceneSeed, 'emitter', st.emitterId));
  st.alive = [];
  st.ages.clear();
}
