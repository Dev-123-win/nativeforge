/**
 * voronoi — exact 3D Voronoi shattering of boxes for runtime fracture.
 *
 * Each cell is the box clipped by bisector half-planes vs every other
 * seed (Sutherland–Hodgman in 3D + cap stitching), with Lloyd relaxation
 * for shard quality. N seeds always yield exactly N full-dimensional
 * cells: each seed is strictly interior to its own cell, so no degenerate
 * output and volume is conserved to float precision.
 *
 * Pure + deterministic: same (bounds, count, seed) → identical cells.
 * Volumes/centroids integrate tetrahedra from the (interior) seed with
 * absolute determinants, so face winding can never corrupt mass.
 */
import { Rng } from '../core/rng';
import type { Vec3 } from '../core/types';

export const VORONOI_MAX_CELLS = 48;
const LLOYD_ITERATIONS = 2;

export interface VoronoiCell {
  /** Cell vertices in box-local coords (deduped). */
  points: Vec3[];
  centroid: Vec3;
  volume: number;
}

interface Poly {
  verts: Vec3[];
  /** Faces as cyclic vertex loops (orientation-free). */
  faces: number[][];
}

function boxPoly(h: Vec3): Poly {
  const [hx, hy, hz] = h;
  return {
    verts: [
      [-hx, -hy, -hz],
      [hx, -hy, -hz],
      [hx, hy, -hz],
      [-hx, hy, -hz],
      [-hx, -hy, hz],
      [hx, -hy, hz],
      [hx, hy, hz],
      [-hx, hy, hz],
    ],
    faces: [
      [0, 1, 2, 3], // -z
      [4, 5, 6, 7], // +z
      [0, 4, 5, 1], // -y
      [3, 2, 6, 7], // +y
      [0, 3, 7, 4], // -x
      [1, 5, 6, 2], // +x
    ],
  };
}

function dedupPoints(pts: Vec3[], tol: number): Vec3[] {
  const seen = new Set<string>();
  const out: Vec3[] = [];
  for (const p of pts) {
    const k = `${Math.round(p[0] / tol)},${Math.round(p[1] / tol)},${Math.round(p[2] / tol)}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(p);
  }
  return out;
}

/** Order coplanar points into a cyclic loop around their centroid. */
function orderCap(pts: Vec3[], n: Vec3): number[] {
  const c: Vec3 = [0, 0, 0];
  for (const p of pts) {
    c[0] += p[0];
    c[1] += p[1];
    c[2] += p[2];
  }
  c[0] /= pts.length;
  c[1] /= pts.length;
  c[2] /= pts.length;
  // Basis spanning the plane: u ⊥ n, v = n × u.
  const ax = Math.abs(n[0]);
  const ay = Math.abs(n[1]);
  const az = Math.abs(n[2]);
  let u: Vec3;
  if (ax <= ay && ax <= az) u = [0, -n[2], n[1]];
  else if (ay <= ax && ay <= az) u = [-n[2], 0, n[0]];
  else u = [-n[1], n[0], 0];
  const ul = Math.hypot(u[0], u[1], u[2]) || 1;
  u = [u[0] / ul, u[1] / ul, u[2] / ul];
  const v: Vec3 = [
    n[1] * u[2] - n[2] * u[1],
    n[2] * u[0] - n[0] * u[2],
    n[0] * u[1] - n[1] * u[0],
  ];
  return pts
    .map((p, i) => ({
      i,
      a: Math.atan2(
        (p[0] - c[0]) * v[0] + (p[1] - c[1]) * v[1] + (p[2] - c[2]) * v[2],
        (p[0] - c[0]) * u[0] + (p[1] - c[1]) * u[1] + (p[2] - c[2]) * u[2],
      ),
    }))
    .sort((p, q) => p.a - q.a)
    .map((e) => e.i);
}

/**
 * Clip a convex polyhedron, keeping {x : n·x + d ≤ 0}. Faces stay cyclic
 * loops; the cut is sealed with an angle-sorted cap face.
 */
function clipPoly(poly: Poly, n: Vec3, d: number, eps: number): Poly {
  const dist = poly.verts.map(
    (v) => n[0] * v[0] + n[1] * v[1] + n[2] * v[2] + d,
  );
  const newVerts: Vec3[] = [];
  const newFaces: number[][] = [];
  const capPts: Vec3[] = [];
  const kept = new Map<number, number>();
  const keepIdx = (old: number): number => {
    let ni = kept.get(old);
    if (ni === undefined) {
      ni = newVerts.length;
      kept.set(old, ni);
      newVerts.push(poly.verts[old]);
    }
    return ni;
  };

  for (const face of poly.faces) {
    const loop: number[] = [];
    const m = face.length;
    for (let i = 0; i < m; i++) {
      const a = face[i];
      const b = face[(i + 1) % m];
      const da = dist[a];
      const db = dist[b];
      const inA = da <= eps;
      const inB = db <= eps;
      if (inA) loop.push(keepIdx(a));
      if (inA !== inB) {
        const t = da / (da - db);
        const va = poly.verts[a];
        const vb = poly.verts[b];
        const p: Vec3 = [
          va[0] + (vb[0] - va[0]) * t,
          va[1] + (vb[1] - va[1]) * t,
          va[2] + (vb[2] - va[2]) * t,
        ];
        newVerts.push(p);
        loop.push(newVerts.length - 1);
        capPts.push(p);
      }
    }
    // Drop consecutive duplicates and degenerate loops.
    const clean: number[] = [];
    for (const idx of loop) {
      if (clean.length === 0 || clean[clean.length - 1] !== idx) clean.push(idx);
    }
    if (clean.length > 1 && clean[0] === clean[clean.length - 1]) clean.pop();
    if (new Set(clean).size >= 3) newFaces.push(clean);
  }

  if (capPts.length >= 3) {
    const uniq = dedupPoints(capPts, eps * 10);
    if (uniq.length >= 3) {
      const order = orderCap(uniq, n);
      const base = newVerts.length;
      for (const p of uniq) newVerts.push(p);
      newFaces.push(order.map((i) => base + i));
    }
  }
  return { verts: newVerts, faces: newFaces };
}

function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

/**
 * Volume + centroid by fanning tetrahedra from a strictly interior point
 * (the seed). Absolute determinants → winding-independent.
 */
function volumeAndCentroid(
  poly: Poly,
  interior: Vec3,
): { volume: number; centroid: Vec3 } {
  let vol = 0;
  const c: Vec3 = [0, 0, 0];
  for (const face of poly.faces) {
    const v0 = poly.verts[face[0]];
    for (let i = 1; i + 1 < face.length; i++) {
      const v1 = poly.verts[face[i]];
      const v2 = poly.verts[face[i + 1]];
      const t = Math.abs(dot(sub(v0, interior), cross(sub(v1, interior), sub(v2, interior)))) / 6;
      if (t === 0) continue;
      vol += t;
      c[0] += (t * (interior[0] + v0[0] + v1[0] + v2[0])) / 4;
      c[1] += (t * (interior[1] + v0[1] + v1[1] + v2[1])) / 4;
      c[2] += (t * (interior[2] + v0[2] + v1[2] + v2[2])) / 4;
    }
  }
  if (vol > 0) {
    c[0] /= vol;
    c[1] /= vol;
    c[2] /= vol;
  }
  return { volume: vol, centroid: c };
}

/** Clip one Voronoi cell: box ∩ half-planes closer to seed i. */
function clipCell(
  h: Vec3,
  seeds: Vec3[],
  i: number,
  eps: number,
): { poly: Poly; volume: number; centroid: Vec3 } {
  let poly = boxPoly(h);
  const si = seeds[i];
  for (let j = 0; j < seeds.length; j++) {
    if (j === i) continue;
    const sj = seeds[j];
    const dx = sj[0] - si[0];
    const dy = sj[1] - si[1];
    const dz = sj[2] - si[2];
    if (dx * dx + dy * dy + dz * dz < eps * eps) continue; // coincident seeds
    // Keep 2(sj-si)·x + (|si|²-|sj|²) ≤ 0.
    const n: Vec3 = [2 * dx, 2 * dy, 2 * dz];
    const d =
      si[0] * si[0] + si[1] * si[1] + si[2] * si[2] -
      (sj[0] * sj[0] + sj[1] * sj[1] + sj[2] * sj[2]);
    poly = clipPoly(poly, n, d, eps);
    if (poly.faces.length === 0) break;
  }
  const { volume, centroid } = volumeAndCentroid(poly, si);
  return { poly, volume, centroid };
}

/**
 * Shatter a box (centered at origin) into `count` Voronoi cells.
 * Seeds start uniform-random and relax via Lloyd iterations.
 */
export function shatterBox(
  halfExtents: Vec3,
  count: number,
  seed: number,
): VoronoiCell[] {
  const n = Math.max(2, Math.min(VORONOI_MAX_CELLS, Math.round(count)));
  const h: Vec3 = [
    Math.max(1e-6, halfExtents[0]),
    Math.max(1e-6, halfExtents[1]),
    Math.max(1e-6, halfExtents[2]),
  ];
  const extent = Math.max(h[0], h[1], h[2]);
  const eps = 1e-9 * extent;
  const rng = new Rng(seed);
  let seeds: Vec3[] = [];
  for (let i = 0; i < n; i++) {
    seeds.push([
      rng.range(-0.95, 0.95) * h[0],
      rng.range(-0.95, 0.95) * h[1],
      rng.range(-0.95, 0.95) * h[2],
    ]);
  }
  for (let iter = 0; iter < LLOYD_ITERATIONS; iter++) {
    const next: Vec3[] = [];
    for (let i = 0; i < n; i++) {
      const { volume, centroid } = clipCell(h, seeds, i, eps);
      // Centroid of a full-dimensional cell is interior; fall back to the
      // seed on any numerical pathology (never observed, but total).
      next.push(volume > 0 ? centroid : seeds[i]);
    }
    seeds = next;
  }
  const cells: VoronoiCell[] = [];
  for (let i = 0; i < n; i++) {
    const { poly, volume, centroid } = clipCell(h, seeds, i, eps);
    const used = new Set<number>();
    for (const f of poly.faces) for (const v of f) used.add(v);
    const points = dedupPoints(
      [...used].map((v) => poly.verts[v]),
      eps * 10,
    );
    cells.push({ points, centroid, volume });
  }
  return cells;
}
