/**
 * Event engine — triggers → actions (§28, §34 in master prompt).
 *
 * Pure evaluation over an EventContext supplied by the runtime. All actions
 * route through runtime callbacks so this module stays engine-agnostic and
 * unit-testable. Events are one-shot per run (reset on rewind to frame 0).
 */

import type { ForgeEvent, Vec3 } from '../core/types';
import type { Rng } from '../core/rng';

export interface CollisionRecord {
  a: string;
  b: string;
  point: Vec3;
  impulse: number;
  speed: number;
}

export interface EventActions {
  spawn: (presetId: string, position: Vec3 | null) => void;
  delete: (id: string) => void;
  impulse: (id: string, vec: Vec3) => void;
  setPressure: (id: string, pa: number) => void;
  break: (id: string) => void;
  pop: (id: string) => void;
  setGravity: (vec: Vec3) => void;
  setCamera: (id: string) => void;
  sound: (name: string, intensity: number) => void;
  particles: (point: Vec3, scalar: number) => void;
  toggle: (id: string) => void;
  motor: (id: string, enabled: boolean) => void;
}

export interface EventQueries {
  simTime: number;
  dt: number;
  positionOf: (id: string) => Vec3 | null;
  speedOf: (id: string) => number;
  pressureOf: (id: string) => number;
  collisions: CollisionRecord[];
  rng: Rng;
}

function matchPair(
  rec: CollisionRecord,
  a: string | null,
  b: string | null,
): boolean {
  if (a && b) {
    return (rec.a === a && rec.b === b) || (rec.a === b && rec.b === a);
  }
  if (a) return rec.a === a || rec.b === a;
  return true;
}

export function evaluateEvents(
  events: ForgeEvent[],
  q: EventQueries,
  actions: EventActions,
): string[] {
  const fired: string[] = [];
  for (const ev of events) {
    if (!ev.enabled || ev.fired) continue;
    const t = ev.trigger;
    let hit = false;
    let hitPoint: Vec3 | null = null;

    switch (t.type) {
      case 'time':
        hit = q.simTime >= t.time;
        break;
      case 'collision': {
        const rec = q.collisions.find((c) => matchPair(c, t.objectA, t.objectB));
        if (rec) {
          hit = true;
          hitPoint = rec.point;
        }
        break;
      }
      case 'impact': {
        const rec = q.collisions.find(
          (c) => matchPair(c, t.objectA, t.objectB) && c.impulse >= t.threshold,
        );
        if (rec) {
          hit = true;
          hitPoint = rec.point;
        }
        break;
      }
      case 'velocity': {
        if (t.objectA) hit = q.speedOf(t.objectA) >= t.threshold;
        break;
      }
      case 'height': {
        if (t.objectA) {
          const p = q.positionOf(t.objectA);
          hit = !!p && p[1] >= t.threshold;
          if (p) hitPoint = p;
        }
        break;
      }
      case 'pressure': {
        if (t.objectA) hit = q.pressureOf(t.objectA) >= t.threshold;
        break;
      }
      case 'distance': {
        if (t.objectA && t.objectB) {
          const pa = q.positionOf(t.objectA);
          const pb = q.positionOf(t.objectB);
          if (pa && pb) {
            const d = Math.sqrt(
              (pa[0] - pb[0]) ** 2 + (pa[1] - pb[1]) ** 2 + (pa[2] - pb[2]) ** 2,
            );
            hit = d <= t.threshold;
          }
        }
        break;
      }
      case 'random':
        hit = q.rng.next() < t.probability * q.dt;
        break;
      default:
        break;
    }

    if (!hit) continue;
    ev.fired = true;
    fired.push(ev.id);

    const a = ev.action;
    const targetPos = a.targetId ? q.positionOf(a.targetId) : null;
    const at = hitPoint ?? targetPos ?? [0, 1, 0];
    switch (a.type) {
      case 'spawn':
        if (a.presetId) actions.spawn(a.presetId, targetPos);
        break;
      case 'delete':
        if (a.targetId) actions.delete(a.targetId);
        break;
      case 'impulse':
        if (a.targetId) actions.impulse(a.targetId, a.vector);
        break;
      case 'force':
        // Sustained force is applied as repeated impulses upstream; here one kick.
        if (a.targetId) actions.impulse(a.targetId, a.vector);
        break;
      case 'setPressure':
        if (a.targetId) actions.setPressure(a.targetId, a.scalar);
        break;
      case 'break':
        if (a.targetId) actions.break(a.targetId);
        break;
      case 'pop':
        if (a.targetId) actions.pop(a.targetId);
        break;
      case 'setGravity':
        actions.setGravity(a.vector);
        break;
      case 'setCamera':
        if (a.targetId) actions.setCamera(a.targetId);
        break;
      case 'sound':
        actions.sound(a.presetId ?? 'blip', a.scalar || 1);
        break;
      case 'particles':
        actions.particles(at as Vec3, a.scalar || 1);
        break;
      case 'toggle':
        if (a.targetId) actions.toggle(a.targetId);
        break;
      case 'motor':
        if (a.targetId) actions.motor(a.targetId, a.scalar >= 0.5);
        break;
      default:
        break;
    }
  }
  return fired;
}
