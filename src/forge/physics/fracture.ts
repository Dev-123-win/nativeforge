/**
 * Fracture planner — chunk-based runtime fracture + exact 3D Voronoi.
 *
 * Chunk modes (grid/radial/random/voronoi-lite) replace the body with N
 * box bodies filling its bounds — cheap and convincing. Mode 'voronoi'
 * shatters the bounds into exact convex Voronoi cells (see voronoi.ts):
 * volume-conserving, deterministic, real mass per shard.
 *
 * Honesty note: voronoi cells tile the object's axis-aligned bounds, not
 * curved surfaces — exact for boxes, an AABB approximation for spheres
 * and other curved inputs (documented in FORGE.md).
 */

import type { FractureMode, Vec3 } from '../core/types';
import { Rng } from '../core/rng';
import { shatterBox, VORONOI_MAX_CELLS } from './voronoi';

export interface FragmentSpec {
  /** Offset from the original center (world-aligned, pre-rotation). */
  offset: Vec3;
  /** Full size of the chunk box (cell AABB for voronoi). */
  size: Vec3;
  /** Initial velocity imparted at break. */
  velocity: Vec3;
  /** Rotation for visual variety (ignored when alignToParent). */
  rotation: Vec3;
  /**
   * Exact convex shard vertices, centroid-relative, for voronoi mode.
   * The runtime builds a convex-hull collider + mesh from these.
   */
  convex?: Vec3[];
  /** When true the fragment inherits the parent orientation exactly. */
  alignToParent?: boolean;
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
  const cap = mode === 'voronoi' ? VORONOI_MAX_CELLS : 64;
  const n = Math.max(2, Math.min(cap, Math.round(count)));
  const specs: FragmentSpec[] = [];

  if (mode === 'voronoi') {
    const cells = shatterBox(halfExtents, n, seed);
    for (const cell of cells) {
      const [cx, cy, cz] = cell.centroid;
      // Cell AABB for the size channel (collider/mesh use convex points).
      let mnx = Infinity;
      let mny = Infinity;
      let mnz = Infinity;
      let mxx = -Infinity;
      let mxy = -Infinity;
      let mxz = -Infinity;
      for (const p of cell.points) {
        if (p[0] < mnx) mnx = p[0];
        if (p[1] < mny) mny = p[1];
        if (p[2] < mnz) mnz = p[2];
        if (p[0] > mxx) mxx = p[0];
        if (p[1] > mxy) mxy = p[1];
        if (p[2] > mxz) mxz = p[2];
      }
      const len = Math.sqrt(cx * cx + cy * cy + cz * cz) || 1;
      const sp = spread * rng.range(0.5, 1.5);
      specs.push({
        offset: [cx, cy, cz],
        size: [
          Math.max(0.02, mxx - mnx),
          Math.max(0.02, mxy - mny),
          Math.max(0.02, mxz - mnz),
        ],
        velocity: [(cx / len) * sp, (cy / len) * sp + spread * 0.4, (cz / len) * sp],
        rotation: [0, 0, 0],
        convex: cell.points.map(
          (p): Vec3 => [p[0] - cx, p[1] - cy, p[2] - cz],
        ),
        alignToParent: true,
      });
    }
    return specs.slice(0, n);
  }

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
