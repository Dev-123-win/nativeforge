/**
 * Balloon system — specialized inflatable + puncture detection.
 *
 * A balloon is a rigid body (for motion/collision) wrapped with:
 * - pressure state (internal Pa, fed by PressureSystem too)
 * - puncture detector: sharp collider tips touching the skin, or violent
 *   impacts on sharp objects, trigger a pop at the contact point
 * - pop sequence: body removed, latex chunk fragments spawned, radial
 *   pressure-release impulse applied to neighbours, sound/particles hooks
 *
 * The same puncture/rupture pathway is reused for generic breakables via
 * events (break/pop actions), so this is not a hard-coded one-off.
 */

import type { Vec3 } from '../core/types';

export interface BalloonDef {
  id: string;
  pressure: number;
  maxPressure: number;
  skinThickness: number;
  fragmentCount: number;
  radius: number;
}

export interface SharpCollider {
  objectId: string;
  sharpness: number;
  /** World-space tip position (apex for cones, edge point otherwise). */
  tip: Vec3;
}

export interface PopResult {
  balloonId: string;
  point: Vec3;
  /** Impulse magnitude scale for the pressure release. */
  power: number;
}

const TOUCH_POP_SHARPNESS = 0.5;
const IMPACT_POP_SPEED = 6;

export class BalloonSystem {
  private balloons = new Map<string, BalloonDef>();
  private popped = new Set<string>();

  register(def: BalloonDef): void {
    this.balloons.set(def.id, def);
  }

  unregister(id: string): void {
    this.balloons.delete(id);
    this.popped.delete(id);
  }

  clear(): void {
    this.balloons.clear();
    this.popped.clear();
  }

  isPopped(id: string): boolean {
    return this.popped.has(id);
  }

  get(id: string): BalloonDef | undefined {
    return this.balloons.get(id);
  }

  /**
   * Touch test: any sharp tip inside the balloon skin pops it instantly.
   * Called every step for live balloons (cheap: balloons × sharp objects).
   */
  checkTouch(
    balloonId: string,
    center: Vec3,
    sharps: SharpCollider[],
  ): Vec3 | null {
    if (this.popped.has(balloonId)) return null;
    const def = this.balloons.get(balloonId);
    if (!def) return null;
    for (const s of sharps) {
      if (s.sharpness < TOUCH_POP_SHARPNESS) continue;
      const dx = s.tip[0] - center[0];
      const dy = s.tip[1] - center[1];
      const dz = s.tip[2] - center[2];
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      // Contact pops: resting contact sits at exactly `radius`, so the
      // threshold includes a small contact slop instead of requiring
      // penetration (solver penetration is transient and unreliable).
      if (d < def.radius + 0.08) return [...s.tip] as Vec3;
    }
    return null;
  }

  /**
   * Impact test: violent collision against a sharp object pops even on
   * non-tip contact (edge slash).
   */
  checkImpact(
    balloonId: string,
    otherSharpness: number,
    impactSpeed: number,
  ): boolean {
    if (this.popped.has(balloonId)) return false;
    if (!this.balloons.has(balloonId)) return false;
    return (
      otherSharpness >= TOUCH_POP_SHARPNESS && impactSpeed >= IMPACT_POP_SPEED
    );
  }

  /** Over-pressure test (pumped past maxPressure → burst at weakest point). */
  checkOverpressure(balloonId: string, pressure: number): boolean {
    if (this.popped.has(balloonId)) return false;
    const def = this.balloons.get(balloonId);
    if (!def) return false;
    return pressure >= def.maxPressure;
  }

  pop(balloonId: string, point: Vec3, pressure: number): PopResult {
    this.popped.add(balloonId);
    const power = 1 + Math.max(0, pressure) / 50000;
    return { balloonId, point, power };
  }

  reset(): void {
    this.popped.clear();
  }
}
