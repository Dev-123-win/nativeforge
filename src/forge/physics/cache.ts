/**
 * Simulation cache (§43) — keyframed Rapier snapshots for scrubbing.
 *
 * Stale-cache safety: every entry is tagged with a physics hash of the
 * scene. Any physics-relevant edit changes the hash and the whole cache is
 * dropped — a stale cache can NEVER silently produce a wrong render.
 */

import type { ForgeScene } from '../core/types';

/** FNV-1a over the physics-relevant subset of a scene + seed. */
export function scenePhysicsHash(scene: ForgeScene): string {
  const w = scene.world;
  let s = `${scene.seed}|${w.gravity.join(',')}|${w.simFps}|${w.substeps}|${w.solverIterations}|${w.timeScale}|${w.airDensity}|${w.vacuum}|${w.wind.join(',')}|${w.turbulence}|`;
  const objs = [...scene.objects].sort((a, b) => (a.id < b.id ? -1 : 1));
  for (const o of objs) {
    s += `${o.id},${o.kind},${o.rev},${JSON.stringify(o.transform)},${JSON.stringify(o.rigidBody)},${JSON.stringify(o.collider)},${JSON.stringify(o.constantForce)},${JSON.stringify(o.constantTorque)},${JSON.stringify(o.field)},${JSON.stringify(o.emitter)},${JSON.stringify(o.machine)},${JSON.stringify(o.pressure)},${JSON.stringify(o.balloon?.pressure)},${JSON.stringify(o.breakable?.enabled)};`;
  }
  for (const e of scene.events) {
    s += `${e.id}${e.enabled ? 1 : 0}${JSON.stringify(e.trigger)}${JSON.stringify(e.action)};`;
  }
  for (const t of scene.motorTracks ?? []) {
    s += `${t.id}${t.enabled ? 1 : 0}${t.jointId}${JSON.stringify(t.keys)};`;
  }
  for (const j of scene.constraints ?? []) {
    s += `${j.id}${j.rev}${j.enabled ? 1 : 0}${j.type}${j.bodyA}${j.bodyB}${JSON.stringify(j.anchorA)}${JSON.stringify(j.anchorB)}${JSON.stringify(j.axis)}${j.restLength},${j.stiffness},${j.damping},${j.motorSpeed},${j.motorForce},${j.breakForce};`;
  }
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h.toString(16);
}

interface CacheEntry {
  frame: number;
  bytes: Uint8Array;
}

export class SimCache {
  private hash = '';
  private entries = new Map<number, CacheEntry>();
  private order: number[] = [];

  constructor(
    private stride = 10,
    private maxEntries = 120,
  ) {}

  get key(): string {
    return this.hash;
  }

  get size(): number {
    return this.entries.size;
  }

  shouldSnapshot(frame: number): boolean {
    return frame % this.stride === 0;
  }

  /** Drop everything if the scene hash changed. Returns true if kept. */
  validate(hash: string): boolean {
    if (this.hash !== hash) {
      this.hash = hash;
      this.entries.clear();
      this.order = [];
      return false;
    }
    return true;
  }

  invalidate(): void {
    this.entries.clear();
    this.order = [];
  }

  get(frame: number): Uint8Array | null {
    return this.entries.get(frame)?.bytes ?? null;
  }

  /** Nearest cached keyframe at or before `frame`. */
  nearestAtOrBefore(frame: number): number | null {
    let best: number | null = null;
    for (const f of this.order) {
      if (f <= frame && (best === null || f > best)) best = f;
    }
    return best;
  }

  set(frame: number, bytes: Uint8Array): void {
    if (this.entries.has(frame)) return;
    this.entries.set(frame, { frame, bytes });
    this.order.push(frame);
    if (this.order.length > this.maxEntries) {
      // Evict oldest non-zero keyframe (keep frame 0 as the base).
      const idx = this.order.findIndex((f) => f !== 0);
      if (idx >= 0) {
        const [evicted] = this.order.splice(idx, 1);
        this.entries.delete(evicted);
      }
    }
  }
}
