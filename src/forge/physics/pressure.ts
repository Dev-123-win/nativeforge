/**
 * Pressure subsystem (§12) — a real simulation variable, not a Rapier slider.
 *
 * Model (v1, honestly documented):
 * - Containers/balloons hold `internal` pressure (Pa) with a `volume`.
 * - Pressure leaks at `leak` Pa/s and can be pumped by events/animation.
 * - Above `releaseThreshold`, venting applies a reaction force on the
 *   container (along -ventDirection) plus a radial push on nearby bodies.
 * - Pressure values feed the event system (pressure thresholds).
 *
 * This intentionally does NOT claim CFD/fluid resolution — it is a
 * lumped-parameter pressure model that produces visible, physical effects.
 */

export interface PressureBody {
  id: string;
  position: [number, number, number];
  mass: number;
  isDynamic: boolean;
  applyImpulse(ix: number, iy: number, iz: number): void;
}

interface VesselState {
  internal: number;
  volume: number;
  leak: number;
  releaseThreshold: number;
  ventDirection: [number, number, number];
}

export class PressureSystem {
  private vessels = new Map<string, VesselState>();

  register(
    id: string,
    s: {
      internal: number;
      volume: number;
      leak: number;
      releaseThreshold: number;
      ventDirection: [number, number, number];
    },
  ): void {
    this.vessels.set(id, { ...s });
  }

  unregister(id: string): void {
    this.vessels.delete(id);
  }

  clear(): void {
    this.vessels.clear();
  }

  get(id: string): number {
    return this.vessels.get(id)?.internal ?? 0;
  }

  set(id: string, pa: number): void {
    const v = this.vessels.get(id);
    if (v) v.internal = Math.max(0, pa);
  }

  add(id: string, dpa: number): void {
    const v = this.vessels.get(id);
    if (v) v.internal = Math.max(0, v.internal + dpa);
  }

  /**
   * Advance leaks + venting. `bodies` is a live accessor for radial pushes.
   * Returns ids of vessels currently venting (for visuals/audio hooks).
   */
  step(
    dt: number,
    getBody: (id: string) => PressureBody | undefined,
    forEachBody: (cb: (b: PressureBody) => void) => void,
  ): string[] {
    const venting: string[] = [];
    for (const [id, v] of this.vessels) {
      if (v.internal <= 0) continue;
      // Leak decay.
      v.internal = Math.max(0, v.internal - v.leak * dt);
      if (v.internal < v.releaseThreshold || v.releaseThreshold <= 0) continue;

      const over = v.internal - v.releaseThreshold;
      // Vent rate proportional to over-pressure; pressure relaxes toward threshold.
      const vented = Math.min(v.internal, over * 2.5 * dt + v.internal * 0.4 * dt);
      v.internal -= vented;
      venting.push(id);

      // Reaction force on the vessel itself (rocket-like, opposite the vent).
      const self = getBody(id);
      // Impulse ~ pressure × area-proxy × dt. Area proxy from volume^(2/3).
      const area = Math.cbrt(Math.max(1e-6, v.volume)) ** 2;
      const j = vented * area * 0.02 * dt * 60;
      if (self && self.isDynamic) {
        self.applyImpulse(
          -v.ventDirection[0] * j,
          -v.ventDirection[1] * j,
          -v.ventDirection[2] * j,
        );
      }

      // Radial push on neighbours (fragments, nearby props).
      const src = self?.position;
      if (!src) continue;
      const radius = 2 + Math.cbrt(Math.max(0, vented)) * 0.15;
      forEachBody((b) => {
        if (b.id === id || !b.isDynamic) return;
        const dx = b.position[0] - src[0];
        const dy = b.position[1] - src[1];
        const dz = b.position[2] - src[2];
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (d > radius || d < 1e-4) return;
        const fall = 1 - d / radius;
        const push = (j * fall) / Math.max(0.2, b.mass);
        b.applyImpulse(
          (dx / d) * push,
          (dy / d) * push,
          (dz / d) * push,
        );
      });
    }
    return venting;
  }
}
