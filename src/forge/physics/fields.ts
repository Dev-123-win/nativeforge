/**
 * Force fields — attractor, repulsor, vortex, wind, wave, turbulence.
 *
 * Pure force computation: given a field object + a sample point + sim time,
 * returns the force vector (N). The runtime applies it to dynamic bodies.
 * Turbulence uses closed-form pseudo-noise (deterministic in time/position).
 */

import type { ForgeObject, Vec3 } from '../core/types';

export function fieldForce(
  field: ForgeObject,
  samplePos: Vec3,
  simTime: number,
): Vec3 {
  const f = field.field;
  if (!f || !f.enabled || field.kind !== 'field') return [0, 0, 0];
  const c = field.transform.position;
  const dx = samplePos[0] - c[0];
  const dy = samplePos[1] - c[1];
  const dz = samplePos[2] - c[2];
  const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (dist > f.radius) return [0, 0, 0];

  const dir: Vec3 =
    dist > 1e-6 ? [dx / dist, dy / dist, dz / dist] : [0, 1, 0];
  // Falloff: 1 at center → 0 at radius, shaped by exponent.
  const t = 1 - dist / f.radius;
  const fall = Math.pow(Math.max(0, t), f.falloff);
  const s = f.strength * fall;

  switch (f.kind) {
    case 'attractor':
      return [-dir[0] * s, -dir[1] * s, -dir[2] * s];
    case 'repulsor':
      return [dir[0] * s, dir[1] * s, dir[2] * s];
    case 'vortex': {
      // Tangential swirl around Y + slight inward pull.
      const tang: Vec3 = [-dir[2], 0, dir[0]];
      const pull = s * 0.35;
      return [
        tang[0] * s - dir[0] * pull,
        Math.sin(simTime * f.frequency + dist) * s * 0.1,
        tang[2] * s - dir[2] * pull,
      ];
    }
    case 'wind':
    case 'directional': {
      const gust =
        1 + f.turbulence * 0.5 * Math.sin(simTime * f.frequency + dx * 0.5 + dz * 0.3);
      return [
        f.direction[0] * s * gust,
        f.direction[1] * s * gust,
        f.direction[2] * s * gust,
      ];
    }
    case 'wave': {
      const w = Math.sin(dist * 1.5 - simTime * f.frequency * Math.PI * 2);
      return [dir[0] * s * w, dir[1] * s * w * 0.5, dir[2] * s * w];
    }
    case 'turbulence': {
      return [
        pseudoNoise(samplePos, simTime, 0) * s,
        pseudoNoise(samplePos, simTime, 100) * s * 0.7,
        pseudoNoise(samplePos, simTime, 200) * s,
      ];
    }
    default:
      return [0, 0, 0];
  }
}

/** Deterministic closed-form noise in [-1, 1]. */
export function pseudoNoise(p: Vec3, t: number, seed: number): number {
  return (
    Math.sin(p[0] * 1.7 + t * 2.1 + seed) *
      Math.cos(p[1] * 1.3 - t * 1.7 + seed * 0.7) *
      0.6 +
    Math.sin(p[2] * 2.3 + t * 3.1 + seed * 1.3) * 0.4
  );
}
