/**
 * Fracture planner — chunk-based runtime fracture (v1).
 *
 * Honesty note: this is NOT mesh-accurate Voronoi shattering. On break, the
 * original body is removed and replaced by N convex chunk bodies (boxes)
 * filling its bounds. Chunks are real simulated bodies with real mass and
 * velocities — visually convincing for bursts/shatters, cheap enough for
 * large scenes. Mesh-accurate Voronoi pre-fracture is roadmap (documented).
 */

import type { FractureMode, Vec3 } from '../core/types';
import { Rng } from '../core/rng';

export interface FragmentSpec {
  /** Offset from the original center (world-aligned, pre-rotation). */
  offset: Vec3;
  /** Full size of the chunk box. */
  size: Vec3;
  /** Initial velocity imparted at break. */
  velocity: Vec3;
  /** Rotation for visual variety. */
  rotation: Vec3;
}

/** Split count per axis for grid mode targeting ~count chunks. */
function gridDims(count: number): [number, number, number] {
  const n = Math.max(1, Math.round(Math.cbrt(count)));
  return [n, n, Math.max(1, Math.ceil(count / (n * n)))];
}

export function planFracture(
  halfExtents: Vec3,
  mode: FractureMode,
  count: number,
  seed: number,
  spread: number,
): FragmentSpec[] {
  const rng = new Rng(seed);
  const n = Math.max(2, Math.min(64, Math.round(count)));
  const specs: FragmentSpec[] = [];

  if (mode === 'grid' || mode === 'voronoi-lite') {
    const [nx, ny, nz] = gridDims(n);
    const jitter = mode === 'voronoi-lite' ? 0.35 : 0.06;
    for (let ix = 0; ix < nx; ix++) {
      for (let iy = 0; iy < ny; iy++) {
        for (let iz = 0; iz < nz; iz++) {
          if (specs.length >= n) break;
          const cx = -halfExtents[0] + ((ix + 0.5) / nx) * 2 * halfExtents[0];
          const cy = -halfExtents[1] + ((iy + 0.5) / ny) * 2 * halfExtents[1];
          const cz = -halfExtents[2] + ((iz + 0.5) / nz) * 2 * halfExtents[2];
          const jx = rng.range(-jitter, jitter) * halfExtents[0];
          const jy = rng.range(-jitter, jitter) * halfExtents[1];
          const jz = rng.range(-jitter, jitter) * halfExtents[2];
          const px = cx + jx;
          const py = cy + jy;
          const pz = cz + jz;
          const len = Math.sqrt(px * px + py * py + pz * pz) || 1;
          const sp = spread * rng.range(0.5, 1.5);
          specs.push({
            offset: [px, py, pz],
            size: [
              (2 * halfExtents[0]) / nx,
              (2 * halfExtents[1]) / ny,
              (2 * halfExtents[2]) / nz,
            ],
            velocity: [(px / len) * sp, (py / len) * sp + spread * 0.4, (pz / len) * sp],
            rotation: [rng.range(0, 3), rng.range(0, 3), rng.range(0, 3)],
          });
        }
      }
    }
  } else if (mode === 'radial') {
    for (let i = 0; i < n; i++) {
      const dir = rng.unitVector();
      const r = rng.range(0.3, 1);
      const px = dir[0] * halfExtents[0] * r;
      const py = dir[1] * halfExtents[1] * r;
      const pz = dir[2] * halfExtents[2] * r;
      const sp = spread * rng.range(0.8, 1.6);
      specs.push({
        offset: [px, py, pz],
        size: [
          halfExtents[0] * rng.range(0.3, 0.7),
          halfExtents[1] * rng.range(0.3, 0.7),
          halfExtents[2] * rng.range(0.3, 0.7),
        ],
        velocity: [dir[0] * sp, dir[1] * sp + spread * 0.5, dir[2] * sp],
        rotation: [rng.range(0, 3), rng.range(0, 3), rng.range(0, 3)],
      });
    }
  } else {
    // random
    for (let i = 0; i < n; i++) {
      const px = rng.range(-1, 1) * halfExtents[0];
      const py = rng.range(-1, 1) * halfExtents[1];
      const pz = rng.range(-1, 1) * halfExtents[2];
      const v = rng.unitVector();
      const sp = spread * rng.range(0.4, 1.4);
      specs.push({
        offset: [px, py, pz],
        size: [
          halfExtents[0] * rng.range(0.25, 0.8),
          halfExtents[1] * rng.range(0.25, 0.8),
          halfExtents[2] * rng.range(0.25, 0.8),
        ],
        velocity: [v[0] * sp, v[1] * sp + spread * 0.4, v[2] * sp],
        rotation: [rng.range(0, 3), rng.range(0, 3), rng.range(0, 3)],
      });
    }
  }
  return specs.slice(0, n);
}
