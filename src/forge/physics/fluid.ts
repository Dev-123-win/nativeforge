/**
 * SPH-lite fluid system (Slice 8 — Fluids v1).
 *
 * A small, deterministic, dependency-free smoothed-particle hydrodynamics
 * solver for *contained* water-like volumes (tanks, pools). Design goals:
 *
 * - Deterministic: fixed iteration order, seeded jitter, no wall-clock use.
 *   Identical scene + seed + frames ⇒ bit-identical particle states.
 * - Scrub-safe: particle state (positions/velocities/count) snapshots into
 *   the runtime AuxState channel next to emitters/fracture; rewind restores.
 * - Coupled: analytic box/sphere collider push-out moves particles, and
 *   submerged rigid bodies get particle-count buoyancy + quadratic drag.
 *
 * Documented v1 limits:
 * - Momentum coupling is one-way for dynamics (fluid pushes bodies via
 *   buoyancy/drag; bodies displace particles via collider push-out, but
 *   particle momentum does not feed back into body velocity).
 * - Colliders are approximated as analytic boxes/spheres (capsules,
 *   cylinders, cones and convex use their bounding sphere for the fluid).
 * - Volumes are static oriented boxes (transform edits reseed particles).
 * - Global particle cap (see FLUID_MAX_PARTICLES); overflow is dropped
 *   deterministically in seed order.
 */

import { Rng } from '../core/rng';
import type { ColliderData, Vec3 } from '../core/types';
import { colliderVolume } from './materials';

/** Hard cap on live particles across all volumes. */
export const FLUID_MAX_PARTICLES = 6000;
/** Internal SPH substeps per physics frame (stability for stiff water). */
export const FLUID_SUBSTEPS = 6;
/** XSPH velocity-smoothing factor (fixed constant). */
const XSPH_EPSILON = 0.15;
/** Maps artistic viscosity (0..5) to SPH dynamic-viscosity scale. */
const VISCOSITY_SCALE = 0.01;
/** Safety clamp on per-particle acceleration (m/s²). */
const ACCEL_MAX = 20000;
/**
 * Monaghan artificial viscosity (α: bulk, β: von Neumann-Richtmyer shock).
 * Damps approaching particle pairs — without it, pressure waves ratchet
 * through the p>=0 clamp (compressive half-cycle pushes, rarefaction pulls
 * nothing back) and tear the fluid apart within frames for k ≳ 30. Acts on
 * relative approach only, so bulk flow and settling are unaffected.
 */
const ART_VISC_ALPHA = 1.0;
// No β (von Neumann-Richtmyer) term: β·μ² quadratic blows up on fast close
// pairs with stiff water (k=200) under explicit Euler. α alone stabilizes;
// our impacts are subsonic (Mach ≲ 0.5) where β is unnecessary.
const ART_VISC_BETA = 0;

/**
 * Akinci-style cohesion coefficient γ (surface tension + void healing).
 * Pairwise force F = −γ·m²·C(r)·r̂ with C the Akinci (2013) spline:
 * repulsive below 0.27·h, attractive above. Heals cavitation voids (any
 * splash/drop impact cavitates the tension-free SPH fluid, and without
 * cohesion the voids freeze permanently into a nugget foam) and doubles as
 * surface tension (beading droplets, no curvature term in v1). Bulk forces
 * cancel by symmetry; the residual capillary compression is ~2%.
 */
// Cohesion disabled (γ = 0): at healing-effective strengths it beads the
// pool into nuggets (dewetting). Revisit if impact cavitation needs it.
const COHESION_GAMMA = 0;
/**
 * Mild global velocity damping (1/s). Models air drag plus the unresolved
 * turbulent cascade that stills real tanks; without it, the (nearly
 * inviscid) bulk solver would slosh undamped for minutes.
 */
const GLOBAL_DRAG = 0.4;
// Boosted while the ramp is active: critically-damped loading lands the
// seed lattice without impact (see gravity-ramp note in step()).
const RAMP_DRAG = 2.0;
/** Particles below this height are culled (escaped the world). */
const KILL_Y = -60;

export interface FluidVolumeSeed {
  id: string;
  center: Vec3;
  /** World orientation quaternion [x, y, z, w]. */
  quat: [number, number, number, number];
  /** Local half extents of the box region. */
  half: Vec3;
  spacing: number;
  viscosity: number;
  stiffness: number;
  density: number;
  color: [number, number, number];
  fill: number;
  maxParticles: number;
  openTop: boolean;
}

export interface FluidCollider {
  kind: 'box' | 'sphere';
  center: Vec3;
  /** World orientation quaternion (boxes; identity for spheres). */
  quat: [number, number, number, number];
  halfExtents: Vec3;
  radius: number;
  /** Body linear velocity (push-out inherits a fraction of it). */
  velocity: Vec3;
  /** Tangential damping applied on contact (0..1). */
  friction: number;
}

export interface SubmersionSample {
  count: number;
  /** Mean particle volume (m³) in the sample. */
  pVol: number;
  /** Mean rest density (kg/m³) in the sample. */
  density: number;
  /** Mean particle velocity (world). */
  vel: Vec3;
}

export interface FluidSnapshot {
  count: number;
  pos: Float32Array;
  vel: Float32Array;
  /** Frames since seeding (gravity-ramp clock) at snapshot time. */
  age: number;
}

interface VolumeRuntime {
  center: Vec3;
  /** Conjugated (inverse) orientation for world→local. */
  invQuat: [number, number, number, number];
  half: Vec3;
  margin: number;
  openTop: boolean;
  /** Rest density target used by mass calibration. */
  density: number;
}

function quatConjugate(q: [number, number, number, number]): [number, number, number, number] {
  return [-q[0], -q[1], -q[2], q[3]];
}

/** Rotate vector v by unit quaternion q. */
export function quatRotate(
  q: [number, number, number, number],
  v: Vec3,
): Vec3 {
  const qx = q[0]; const qy = q[1]; const qz = q[2]; const qw = q[3];
  // t = 2 * cross(q.xyz, v)
  const tx = 2 * (qy * v[2] - qz * v[1]);
  const ty = 2 * (qz * v[0] - qx * v[2]);
  const tz = 2 * (qx * v[1] - qy * v[0]);
  // v + qw * t + cross(q.xyz, t)
  return [
    v[0] + qw * tx + (qy * tz - qz * ty),
    v[1] + qw * ty + (qz * tx - qx * tz),
    v[2] + qw * tz + (qx * ty - qy * tx),
  ];
}

/** ZYX euler (radians) → unit quaternion. Matches the three.js runtime. */
export function eulerToQuatFluid(e: Vec3): [number, number, number, number] {
  const cx = Math.cos(e[0] / 2); const sx = Math.sin(e[0] / 2);
  const cy = Math.cos(e[1] / 2); const sy = Math.sin(e[1] / 2);
  const cz = Math.cos(e[2] / 2); const sz = Math.sin(e[2] / 2);
  return [
    sx * cy * cz + cx * sy * sz,
    cx * sy * cz - sx * cy * sz,
    cx * cy * sz + sx * sy * cz,
    cx * cy * cz - sx * sy * sz,
  ];
}

export function hexToRgbFluid(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return [0.18, 0.5, 1];
  const v = parseInt(m[1], 16);
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
}

/**
 * Approximate a collider as a volume + bounding-sphere radius, plus a WIDER
 * buoyancy sample radius. The sample sphere feeds the count→submerged-fraction
 * estimate, and it must be wider than the body: collider push-out clears a
 * body-sized void of particles, so sampling at the body scale would count an
 * empty void and report zero buoyancy. The caller corrects for the void via
 * frac = count·pVol / (V_sample − V_body), which is exact at full submersion
 * and at the free surface for a uniform particle field. Convex/trimesh
 * colliders fall back to a scale-based bound (documented approximation).
 */
export function bodyVolumeAndRadius(
  collider: ColliderData,
  scale: Vec3,
): { volume: number; radius: number; sample: number } {
  const volume = Math.max(
    1e-6,
    colliderVolume(
      collider.shape,
      collider.halfExtents,
      collider.radius,
      collider.height,
    ) *
      Math.abs(scale[0] * scale[1] * scale[2]),
  );
  let radius: number;
  if (collider.shape === 'sphere') {
    radius = collider.radius * Math.max(scale[0], scale[1], scale[2]);
  } else if (collider.shape === 'box') {
    const hx = collider.halfExtents[0] * scale[0];
    const hy = collider.halfExtents[1] * scale[1];
    const hz = collider.halfExtents[2] * scale[2];
    radius = Math.sqrt(hx * hx + hy * hy + hz * hz);
  } else if (
    collider.shape === 'capsule' ||
    collider.shape === 'cylinder' ||
    collider.shape === 'cone'
  ) {
    const r = collider.radius * Math.max(scale[0], scale[2]);
    const hy = (collider.height / 2) * scale[1];
    radius = Math.sqrt(r * r + hy * hy);
  } else {
    const m = Math.max(Math.abs(scale[0]), Math.abs(scale[1]), Math.abs(scale[2]));
    radius = 0.9 * m;
  }
  radius = Math.max(1e-3, radius);
  // Sample shell comfortably outside the push-out void (body + margin).
  const sample = radius * 1.4 + 0.15;
  return { volume, radius, sample };
}

/** Kernel support radius as a multiple of particle spacing (h = 1.5·s). */
const SUPPORT_RATIO = 1.5;

/**
 * Ideal-lattice kernel sum ΣW·s³ for a cubic lattice at h = 1.5·s, computed
 * in s = 1 units (≈ 0.9494, scale-free). Particle mass m = ρ0·s³/ΣW·s³ makes
 * the seeded lattice sample to exactly rest density — no measurement, no
 * outlier risk (measuring the max over a jittered lattice under-masses by
 * ~30% from jitter clumps and collapses the column).
 */
function latticeKernelSum(): number {
  const h = SUPPORT_RATIO;
  const e = Math.ceil(h);
  let sum = 0;
  for (let ix = -e; ix <= e; ix++) {
    for (let iy = -e; iy <= e; iy++) {
      for (let iz = -e; iz <= e; iz++) {
        const r2 = ix * ix + iy * iy + iz * iz;
        if (r2 >= h * h) continue;
        sum += poly6(r2, h);
      }
    }
  }
  return sum;
}

/** Poly6 kernel W(r, h). */
function poly6(r2: number, h: number): number {
  const h2 = h * h;
  const d = h2 - r2;
  if (d <= 0) return 0;
  const c = 315 / (64 * Math.PI * Math.pow(h, 9));
  return c * d * d * d;
}

/** Spiky gradient magnitude factor: ∇W = -spikyGrad(r,h) * r_vec. */
function spikyGrad(r: number, h: number): number {
  const d = h - r;
  if (d <= 0 || r <= 1e-9) return 0;
  const c = 45 / (Math.PI * Math.pow(h, 6));
  return (c * d * d) / r;
}

/** Viscosity laplacian ∇²W(r, h). */
function viscLap(r: number, h: number): number {
  const d = h - r;
  if (d <= 0) return 0;
  const c = 45 / (Math.PI * Math.pow(h, 6));
  return c * d;
}



export class FluidSystem {

  private pos = new Float32Array(FLUID_MAX_PARTICLES * 3);
  private vel = new Float32Array(FLUID_MAX_PARTICLES * 3);
  private col = new Float32Array(FLUID_MAX_PARTICLES * 3);
  private h = new Float32Array(FLUID_MAX_PARTICLES);
  private mass = new Float32Array(FLUID_MAX_PARTICLES);
  private restRho = new Float32Array(FLUID_MAX_PARTICLES);
  private pressK = new Float32Array(FLUID_MAX_PARTICLES);
  private visc = new Float32Array(FLUID_MAX_PARTICLES);
  private pVol = new Float32Array(FLUID_MAX_PARTICLES);
  private volOf = new Uint16Array(FLUID_MAX_PARTICLES);
  private rho = new Float32Array(FLUID_MAX_PARTICLES);
  private press = new Float32Array(FLUID_MAX_PARTICLES);
  private snd = new Float32Array(FLUID_MAX_PARTICLES);
  private acc = new Float32Array(FLUID_MAX_PARTICLES * 3);
  /** Ghost (wall-mirror) scratch: up to 6 mirrors per live particle. */
  private gPos = new Float32Array(FLUID_MAX_PARTICLES * 6 * 3);
  private gSrc = new Int32Array(FLUID_MAX_PARTICLES * 6);
  private gPress = new Float32Array(FLUID_MAX_PARTICLES * 6);
  private gRho = new Float32Array(FLUID_MAX_PARTICLES * 6);
  /** Signed support-scale depth of the mirrored wall (see ghostPressures). */
  private gWall = new Float32Array(FLUID_MAX_PARTICLES * 6);
  private gCount = 0;
  private volumes: VolumeRuntime[] = [];
  private n = 0;
  /** Frames since seeding — drives the gravity ramp (quasi-static settle). */
  private ageFrames = 0;

  get count(): number {
    return this.n;
  }

  get volumeCount(): number {
    return this.volumes.length;
  }

  /** Bounding spheres of live volumes (broadphase for collider gathering). */
  volumeBounds(): Array<{ center: Vec3; radius: number }> {
    return this.volumes.map((v) => ({
      center: v.center,
      radius:
        Math.sqrt(
          v.half[0] * v.half[0] + v.half[1] * v.half[1] + v.half[2] * v.half[2],
        ) + v.margin,
    }));
  }

  /** Live position view for the renderer (first count*3 floats valid). */
  positions(): Float32Array {
    return this.pos.subarray(0, this.n * 3);
  }

  /** Live color view for the renderer (first count*3 floats valid). */
  colors(): Float32Array {
    return this.col.subarray(0, this.n * 3);
  }

  /** Mean particle radius for rendering (max support / 4). */
  renderRadius(): number {
    let maxH = 0;
    for (let i = 0; i < this.n; i++) {
      if (this.h[i] > maxH) maxH = this.h[i];
    }
    return maxH > 0 ? maxH / 4 : 0.1;
  }

  clear(): void {
    this.n = 0;
    this.volumes = [];
    this.gCount = 0;
    this.ageFrames = 0;
  }

  /**
   * Seed particles on a jittered lattice inside each volume's fill region.
   * Deterministic in (rootSeed, volume defs) — same input, same lattice.
   */
  seedVolumes(rootSeed: string | number, defs: FluidVolumeSeed[]): void {
    this.clear();
    const kernelSum = latticeKernelSum();
    defs.forEach((def, vi) => {
      const rng = new Rng(`${String(rootSeed)}:fluid:${def.id}:${vi}`);
      const spacing = Math.min(2, Math.max(0.03, def.spacing));
      const support = spacing * SUPPORT_RATIO;
      const margin = spacing * 0.55;
      this.volumes.push({
        center: [...def.center] as Vec3,
        invQuat: quatConjugate(def.quat),
        half: [...def.half] as Vec3,
        margin,
        openTop: def.openTop,
        density: def.density,
      });
      const fillH = Math.min(1, Math.max(0, def.fill)) * 2 * def.half[1];
      // Lattice counts per axis (at least 1 so tiny volumes get a particle).
      const nx = Math.max(1, Math.floor((2 * def.half[0] - margin) / spacing));
      const ny = Math.max(1, Math.floor((fillH - margin) / spacing));
      const nz = Math.max(1, Math.floor((2 * def.half[2] - margin) / spacing));
      const budget = Math.min(
        Math.max(1, Math.floor(def.maxParticles)),
        FLUID_MAX_PARTICLES - this.n,
      );
      // Analytic mass: the ideal lattice samples to exactly rest density.
      const m =
        (def.density * spacing * spacing * spacing) / kernelSum;
      const pvol = spacing * spacing * spacing;
      let placed = 0;
      outer: for (let iy = 0; iy < ny; iy++) {
        for (let ix = 0; ix < nx; ix++) {
          for (let iz = 0; iz < nz; iz++) {
            if (placed >= budget || this.n >= FLUID_MAX_PARTICLES) break outer;
            const lx =
              -def.half[0] + margin + (ix + 0.5) * spacing +
              rng.range(-0.005, 0.005) * spacing;
            // Bottom layer seeds almost touching the floor rest plane so the
            // lattice starts settled (no drop-and-slam transient).
            const ly =
              -def.half[1] + margin + (iy + 0.1) * spacing +
              rng.range(-0.005, 0.005) * spacing;
            const lz =
              -def.half[2] + margin + (iz + 0.5) * spacing +
              rng.range(-0.005, 0.005) * spacing;
            const w = quatRotate(def.quat, [lx, ly, lz]);
            const i = this.n++;
            this.pos[i * 3] = def.center[0] + w[0];
            this.pos[i * 3 + 1] = def.center[1] + w[1];
            this.pos[i * 3 + 2] = def.center[2] + w[2];
            this.vel[i * 3] = 0;
            this.vel[i * 3 + 1] = 0;
            this.vel[i * 3 + 2] = 0;
            this.col[i * 3] = def.color[0];
            this.col[i * 3 + 1] = def.color[1];
            this.col[i * 3 + 2] = def.color[2];
            this.h[i] = support;
            this.mass[i] = m;
            this.restRho[i] = def.density;
            this.pressK[i] = Math.max(1, def.stiffness);
            this.visc[i] = Math.min(8, Math.max(0, def.viscosity));
            this.pVol[i] = pvol;
            this.volOf[i] = vi;
            placed++;
          }
        }
      }
    });
  }

  /** Deep-copy snapshot for the AuxState channel (positions+velocities). */
  snapshot(): FluidSnapshot {
    return {
      count: this.n,
      pos: this.pos.slice(0, this.n * 3),
      vel: this.vel.slice(0, this.n * 3),
      age: this.ageFrames,
    };
  }

  /**
   * Restore a snapshot. Static per-particle data (h/mass/color/volume) is
   * NOT stored — restores are only valid between reseeds, which the runtime
   * guarantees by clearing aux snapshots on any fluid signature change.
   */
  restore(s: FluidSnapshot): void {
    const n = Math.min(s.count, FLUID_MAX_PARTICLES);
    this.n = n;
    this.ageFrames = s.age;
    this.pos.set(s.pos.subarray(0, n * 3), 0);
    this.vel.set(s.vel.subarray(0, n * 3), 0);
  }

  /**
   * Advance the fluid by one physics frame (FLUID_SUBSTEPS internal substeps).
   * Colliders are analytic boxes/spheres moved/animated by the caller.
   */
  step(dt: number, gravity: Vec3, colliders: FluidCollider[]): void {
    if (this.n === 0 || dt <= 0) return;
    // Gravity ramp: quasi-static loading over 150 frames. The settle slump
    // otherwise slams the floor (ρ·c·v spike > local hydrostatic) and the
    // transient energy both sloshes the pool and deepens coupled-body plunge.
    // (A 60f ramp was tried: hotter settle, deeper wood plunge, viscosity
    // contrast lost.) Re-arms on every reseed.
    const ramp = Math.min(1, this.ageFrames / 150);
    this.ageFrames++;
    const g: Vec3 = [gravity[0] * ramp, gravity[1] * ramp, gravity[2] * ramp];
    const sub = FLUID_SUBSTEPS;
    const h = dt / sub;
    for (let s = 0; s < sub; s++) {
      this.substep(h, g, colliders);
      this.cullEscaped();
    }
  }

  /**
   * Count particles inside a sphere — the buoyancy/drag sampler for rigid
   * bodies. Brute force over live particles (6000 max): simple, exact,
   * deterministic.
   */
  sampleSubmersion(center: Vec3, radius: number): SubmersionSample {
    const out: SubmersionSample = { count: 0, pVol: 0, density: 0, vel: [0, 0, 0] };
    if (this.n === 0 || radius <= 0) return out;
    const r2 = radius * radius;
    let svx = 0; let svy = 0; let svz = 0;
    let spv = 0; let srho = 0;
    for (let i = 0; i < this.n; i++) {
      const dx = this.pos[i * 3] - center[0];
      const dy = this.pos[i * 3 + 1] - center[1];
      const dz = this.pos[i * 3 + 2] - center[2];
      if (dx * dx + dy * dy + dz * dz > r2) continue;
      out.count++;
      spv += this.pVol[i];
      srho += this.restRho[i];
      svx += this.vel[i * 3];
      svy += this.vel[i * 3 + 1];
      svz += this.vel[i * 3 + 2];
    }
    if (out.count > 0) {
      out.pVol = spv / out.count;
      out.density = srho / out.count;
      out.vel = [svx / out.count, svy / out.count, svz / out.count];
    }
    return out;
  }

  // ── internals ────────────────────────────────────────────────────────────

  /**
   * Uniform grid: cell = max support so neighbors share a neighborhood.
   * Ghosts (wall mirrors) are indexed n..n+gCount-1; neighbor loops resolve
   * their properties from the source particle (see ghostProp).
   */
  private buildGrid(): { grid: Map<number, number[]>; inv: number; cell: number } {
    const n = this.n;
    let cell = 0.01;
    for (let i = 0; i < n; i++) {
      if (this.h[i] > cell) cell = this.h[i];
    }
    const inv = 1 / cell;
    const grid = new Map<number, number[]>();
    const insert = (idx: number, x: number, y: number, z: number) => {
      const cx = Math.floor(x * inv);
      const cy = Math.floor(y * inv);
      const cz = Math.floor(z * inv);
      const key = (cx * 73856093) ^ (cy * 19349663) ^ (cz * 83492791);
      let bucket = grid.get(key);
      if (!bucket) {
        bucket = [];
        grid.set(key, bucket);
      }
      bucket.push(idx);
    };
    for (let i = 0; i < n; i++) {
      insert(i, this.pos[i * 3], this.pos[i * 3 + 1], this.pos[i * 3 + 2]);
    }
    for (let g = 0; g < this.gCount; g++) {
      insert(n + g, this.gPos[g * 3], this.gPos[g * 3 + 1], this.gPos[g * 3 + 2]);
    }
    return { grid, inv, cell };
  }

  /**
   * Mirror near-wall particles across their volume's solid walls (Morris
   * et al. 1997 ghost boundaries). Ghosts carry the source's mass, support,
   * velocity, density and pressure, restoring the full SPH neighborhood at
   * walls so both density AND the symmetric pressure force are correct
   * there. Open-top ceilings cast no ghosts (free surface). Fixed wall
   * order ⇒ deterministic ghost order.
   */
  private buildGhosts(gravity: Vec3): void {
    this.gCount = 0;
    const cap = FLUID_MAX_PARTICLES * 6;
    // Down direction (unit): wall normals dotted against this set the sign
    // of the hydrostatic ghost head (floor +, sides 0, ceiling −).
    const gmag = Math.sqrt(
      gravity[0] * gravity[0] + gravity[1] * gravity[1] + gravity[2] * gravity[2],
    );
    const down: Vec3 =
      gmag > 1e-6
        ? [gravity[0] / gmag, gravity[1] / gmag, gravity[2] / gmag]
        : [0, -1, 0];
    for (let i = 0; i < this.n; i++) {
      const v = this.volumes[this.volOf[i]];
      if (!v) continue;
      const hs = this.h[i];
      const lx =
        this.pos[i * 3] - v.center[0];
      const ly =
        this.pos[i * 3 + 1] - v.center[1];
      const lz =
        this.pos[i * 3 + 2] - v.center[2];
      const local = quatRotate(v.invQuat, [lx, ly, lz]);
      for (let axis = 0; axis < 3; axis++) {
        const c = local[axis];
        const half = v.half[axis];
        // Wall outward normals in world space (low/high per axis).
        const fwd = quatConjugate(v.invQuat);
        const axVec: Vec3 =
          axis === 0 ? [1, 0, 0] : axis === 1 ? [0, 1, 0] : [0, 0, 1];
        const nLo = quatRotate(fwd, [-axVec[0], -axVec[1], -axVec[2]]);
        const nHi = quatRotate(fwd, axVec);
        // Low wall.
        if (c + half < hs && this.gCount < cap) {
          const m: Vec3 = [local[0], local[1], local[2]];
          m[axis] = -2 * half - c;
          const w = quatRotate(fwd, m);
          const g = this.gCount++;
          this.gPos[g * 3] = v.center[0] + w[0];
          this.gPos[g * 3 + 1] = v.center[1] + w[1];
          this.gPos[g * 3 + 2] = v.center[2] + w[2];
          this.gSrc[g] = i;
          this.gWall[g] =
            hs * (nLo[0] * down[0] + nLo[1] * down[1] + nLo[2] * down[2]);
        }
        // High wall (skipped for open-top ceilings).
        if (v.openTop && axis === 1) continue;
        if (half - c < hs && this.gCount < cap) {
          const m: Vec3 = [local[0], local[1], local[2]];
          m[axis] = 2 * half - c;
          const w = quatRotate(fwd, m);
          const g = this.gCount++;
          this.gPos[g * 3] = v.center[0] + w[0];
          this.gPos[g * 3 + 1] = v.center[1] + w[1];
          this.gPos[g * 3 + 2] = v.center[2] + w[2];
          this.gSrc[g] = i;
          this.gWall[g] =
            hs * (nHi[0] * down[0] + nHi[1] * down[1] + nHi[2] * down[2]);
        }
      }
    }
  }

  /**
   * Adami-style ghost pressure extrapolation. A mirror carrying the
   * source's own pressure under-supports the fluid (the mirror sits
   * farther than the lattice site it replaces, so it loses the kernel
   * weight contest and the column over-compresses). Extrapolating a
   * support-scale hydrostatic head — p_ghost = p_src + ρ0·|g|·wallDepth —
   * restores the missing wall support: floor ghosts pressurize, side-wall
   * ghosts match (normal ⊥ g), ceiling ghosts de-pressurize, and zero-g
   * collapses to p_src. Crucially the head is CONSTANT per wall (one
   * support radius): a particle-distance head (ρ·g·2d) is anti-restoring
   * (force grows as the particle leaves) and fountains particles off the
   * floor. Ghost density follows from the equation of state.
   */
  private ghostPressures(gravity: Vec3): void {
    const gmag = Math.sqrt(
      gravity[0] * gravity[0] + gravity[1] * gravity[1] + gravity[2] * gravity[2],
    );
    for (let g = 0; g < this.gCount; g++) {
      const s = this.gSrc[g];
      const head = this.restRho[s] * gmag * this.gWall[g];
      // Ghosts keep a non-negative pressure (the wall pushes, never pulls).
      const p = Math.max(0, this.press[s] + head);
      this.gPress[g] = p;
      this.gRho[g] = this.restRho[s] + p / Math.max(1, this.pressK[s]);
    }
  }

  private substep(dt: number, gravity: Vec3, colliders: FluidCollider[]): void {
    const n = this.n;
    if (n === 0) return;
    this.buildGhosts(gravity);
    const { grid, inv, cell } = this.buildGrid();

    // Density + pressure pass.
    for (let i = 0; i < n; i++) {
      const px = this.pos[i * 3];
      const py = this.pos[i * 3 + 1];
      const pz = this.pos[i * 3 + 2];
      const hi = this.h[i];
      const cx = Math.floor(px * inv);
      const cy = Math.floor(py * inv);
      const cz = Math.floor(pz * inv);
      let rho = 0;
      for (let ox = -1; ox <= 1; ox++) {
        for (let oy = -1; oy <= 1; oy++) {
          for (let oz = -1; oz <= 1; oz++) {
            const key =
              ((cx + ox) * 73856093) ^ ((cy + oy) * 19349663) ^ ((cz + oz) * 83492791);
            const bucket = grid.get(key);
            if (!bucket) continue;
            for (let b = 0; b < bucket.length; b++) {
              const j = bucket[b];
              // Ghosts (j >= n) resolve position + properties via the source.
              const gj = j >= n ? j - n : -1;
              const s = gj >= 0 ? this.gSrc[gj] : j;
              const jx = gj >= 0 ? this.gPos[gj * 3] : this.pos[j * 3];
              const jy =
                gj >= 0 ? this.gPos[gj * 3 + 1] : this.pos[j * 3 + 1];
              const jz =
                gj >= 0 ? this.gPos[gj * 3 + 2] : this.pos[j * 3 + 2];
              const dx = px - jx;
              const dy = py - jy;
              const dz = pz - jz;
              const r2 = dx * dx + dy * dy + dz * dz;
              const hij = (hi + this.h[s]) / 2;
              if (r2 >= hij * hij) continue;
              rho += this.mass[s] * poly6(r2, hij);
            }
          }
        }
      }
      // Ghost particles (mirrored across solid walls) fill the truncated
      // half of near-wall neighborhoods, so raw SPH density is correct at
      // boundaries with no renormalization. The free surface (and openTop
      // ceilings, which cast no ghosts) intentionally reads low density.
      this.rho[i] = rho;
      const over = rho - this.restRho[i];
      // Linear EOS with tensile clamp. (Unclamped Tait γ=7/γ=2 tried: γ=7
      // explodes under explicit integration; γ=2 scatters. Void control
      // comes from δ-density-diffusion below instead.)
      this.press[i] = over > 0 ? this.pressK[i] * over : 0;
    }
    // Extrapolate ghost pressures for the force pass (Adami-style).
    this.ghostPressures(gravity);
    // Sound speeds for the artificial viscosity (linear EOS: c² = k).
    for (let i = 0; i < n; i++) this.snd[i] = Math.sqrt(this.pressK[i]);

    // Force pass: symmetric pressure + laplacian viscosity + gravity.
    const gx = gravity[0]; const gy = gravity[1]; const gz = gravity[2];
    const xsphE = XSPH_EPSILON;
    const alphaE = ART_VISC_ALPHA;
    for (let i = 0; i < n; i++) {
      const px = this.pos[i * 3];
      const py = this.pos[i * 3 + 1];
      const pz = this.pos[i * 3 + 2];
      const vx = this.vel[i * 3];
      const vy = this.vel[i * 3 + 1];
      const vz = this.vel[i * 3 + 2];
      const hi = this.h[i];
      const rhoi = Math.max(1, this.rho[i]);
      const piTerm = this.press[i] / (rhoi * rhoi);
      const mu = this.visc[i] * VISCOSITY_SCALE;
      let ax = gx; let ay = gy; let az = gz;
      // XSPH accumulator (velocity-delta form).
      let xsx = 0; let xsy = 0; let xsz = 0;
      const cx = Math.floor(px * inv);
      const cy = Math.floor(py * inv);
      const cz = Math.floor(pz * inv);
      for (let ox = -1; ox <= 1; ox++) {
        for (let oy = -1; oy <= 1; oy++) {
          for (let oz = -1; oz <= 1; oz++) {
            const key =
              ((cx + ox) * 73856093) ^ ((cy + oy) * 19349663) ^ ((cz + oz) * 83492791);
            const bucket = grid.get(key);
            if (!bucket) continue;
            for (let b = 0; b < bucket.length; b++) {
              const j = bucket[b];
              if (j === i) continue;
              // Ghosts (j >= n) carry the source particle's properties.
              const gj = j >= n ? j - n : -1;
              const s = gj >= 0 ? this.gSrc[gj] : j;
              const jx = gj >= 0 ? this.gPos[gj * 3] : this.pos[j * 3];
              const jy =
                gj >= 0 ? this.gPos[gj * 3 + 1] : this.pos[j * 3 + 1];
              const jz =
                gj >= 0 ? this.gPos[gj * 3 + 2] : this.pos[j * 3 + 2];
              const dx = px - jx;
              const dy = py - jy;
              const dz = pz - jz;
              const r2 = dx * dx + dy * dy + dz * dz;
              const hij = (hi + this.h[s]) / 2;
              if (r2 >= hij * hij) continue;
              const r = Math.sqrt(r2);
              const mj = this.mass[s];
              const rhoj = Math.max(
                1,
                gj >= 0 ? this.gRho[gj] : this.rho[s],
              );
              // Symmetric pressure gradient: a_i = −Σ m·pterm·∇W, and
              // ∇W points from j to i with a negative radial slope, so the
              // net force pushes i AWAY from j (repulsive pressure).
              const pj = gj >= 0 ? this.gPress[gj] : this.press[s];
              let pterm = piTerm + pj / (rhoj * rhoj);
              // Monaghan artificial viscosity on approaching pairs.
              // Convention: (v_i − v_j)·(x_i − x_j) < 0 ⇔ approaching.
              const avx = vx - this.vel[s * 3];
              const avy = vy - this.vel[s * 3 + 1];
              const avz = vz - this.vel[s * 3 + 2];
              const vdotx = avx * dx + avy * dy + avz * dz;
              if (vdotx < 0) {
                const cbar = (this.snd[i] + this.snd[s]) / 2;
                // Clamp the approach rate: pathological close-pair spikes
                // must not dwarf the physical pressure.
                const mu = Math.max(
                  (hij * vdotx) / (r2 + 0.01 * hij * hij),
                  -5 * cbar,
                );
                const rhobar = (rhoi + rhoj) / 2;
                pterm +=
                  (-alphaE * cbar * mu + ART_VISC_BETA * mu * mu) /
                  rhobar;
              }
              const g = spikyGrad(r, hij) * pterm * mj;
              ax += g * dx;
              ay += g * dy;
              az += g * dz;
              // Short-range viscoelastic contact: pairs closer than 1.0x spacing
              // repel (spring 6000/h, critically damped). The smoothed-density
              // pressure has a near-nullspace on the layer-interleaving mode
              // (neighbor-count deficit cancels closeness surplus, so SPH reads
              // ~rest density while true density hits 1.7x), letting the lattice
              // sediment into a pile + hollow. Dormant at rest spacing.
              if (r > 1e-9) {
                const sep = hij / SUPPORT_RATIO;
                if (r < sep) {
                  const stiff = 6000 / hij;
                  const damp = 2 * Math.sqrt(stiff * mj);
                  const overlap = sep - r;
                  const nx = dx / r; const ny = dy / r; const nz = dz / r;
                  const rvx = vx - this.vel[s * 3];
                  const rvy = vy - this.vel[s * 3 + 1];
                  const rvz = vz - this.vel[s * 3 + 2];
                  const vn = rvx * nx + rvy * ny + rvz * nz;
                  const f = (stiff * overlap - (damp / mj) * vn) / r;
                  ax += f * dx;
                  ay += f * dy;
                  az += f * dz;
                }
              }
              // Cohesion (Akinci 2013 spline): pairs closer than 0.27·h
              // repel, the rest attract. Ghosts are excluded — the wall
              // must not glue the fluid to itself.
              if (gj < 0 && r > 1e-9) {
                const hr = hij - r;
                const hr3 = hr * hr * hr;
                const r3 = r * r * r;
                let k = hr3 * r3;
                if (r <= hij / 2) {
                  const h6 =
                    hij * hij * hij * hij * hij * hij;
                  k = 2 * k - h6 / 64;
                }
                const h9 =
                  hij * hij * hij * hij * hij * hij * hij * hij * hij;
                const c = ((32 / (Math.PI * h9)) * k) / r;
                const coh = COHESION_GAMMA * mj * c;
                ax -= coh * dx;
                ay -= coh * dy;
                az -= coh * dz;
              }
              // Ghosts mirror the source velocity (free-slip wall).
              const jvx = this.vel[s * 3];
              const jvy = this.vel[s * 3 + 1];
              const jvz = this.vel[s * 3 + 2];
              // Viscosity (laplacian form damps relative velocity).
              if (mu > 0) {
                const lap = viscLap(r, hij) * (mu * mj / rhoj);
                ax += lap * (jvx - vx);
                ay += lap * (jvy - vy);
                az += lap * (jvz - vz);
              }
              // XSPH smoothing kernel weight.
              const w = (mj / ((rhoi + rhoj) / 2)) * poly6(r2, hij);
              xsx += w * (jvx - vx);
              xsy += w * (jvy - vy);
              xsz += w * (jvz - vz);
            }
          }
        }
      }
      // Clamp before integration (stability guard for stiff stacks).
      const a2 = ax * ax + ay * ay + az * az;
      if (a2 > ACCEL_MAX * ACCEL_MAX) {
        const s = ACCEL_MAX / Math.sqrt(a2);
        ax *= s; ay *= s; az *= s;
      }
      const dragK = this.ageFrames < 150 ? RAMP_DRAG : GLOBAL_DRAG;
      const drag = Math.max(0, 1 - dragK * dt);
      let nvx = (vx + ax * dt + xsphE * xsx) * drag;
      let nvy = (vy + ay * dt + xsphE * xsy) * drag;
      let nvz = (vz + az * dt + xsphE * xsz) * drag;
      // Velocity clamp: nothing outruns 2 cells per substep.
      const vmax = (2 * cell) / dt;
      const v2 = nvx * nvx + nvy * nvy + nvz * nvz;
      if (v2 > vmax * vmax) {
        const s = vmax / Math.sqrt(v2);
        nvx *= s; nvy *= s; nvz *= s;
      }
      this.acc[i * 3] = nvx;
      this.acc[i * 3 + 1] = nvy;
      this.acc[i * 3 + 2] = nvz;
    }
    // Commit: velocities then positions, then boundaries/colliders.
    for (let i = 0; i < n; i++) {
      this.vel[i * 3] = this.acc[i * 3];
      this.vel[i * 3 + 1] = this.acc[i * 3 + 1];
      this.vel[i * 3 + 2] = this.acc[i * 3 + 2];
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
    }
    this.solveWalls();
    if (colliders.length > 0) this.solveColliders(colliders);
  }

  /** Clamp particles into their own volume's box walls (OBB-aware). */
  private solveWalls(): void {
    for (let i = 0; i < this.n; i++) {
      const v = this.volumes[this.volOf[i]];
      if (!v) continue;
      const rel: Vec3 = [
        this.pos[i * 3] - v.center[0],
        this.pos[i * 3 + 1] - v.center[1],
        this.pos[i * 3 + 2] - v.center[2],
      ];
      const local = quatRotate(v.invQuat, rel);
      const m = v.margin;
      let hit = false;
      for (let axis = 0; axis < 3; axis++) {
        const lim = v.half[axis] - m;
        if (lim < 0) continue;
        // Open-top volumes have no ceiling: splashes may escape upward.
        if (v.openTop && axis === 1 && local[axis] > 0) continue;
        if (local[axis] < -lim) {
          local[axis] = -lim;
          hit = true;
        } else if (local[axis] > lim) {
          local[axis] = lim;
          hit = true;
        }
      }
      if (!hit) continue;
      const w = quatRotate(quatConjugate(v.invQuat), local);
      this.pos[i * 3] = v.center[0] + w[0];
      this.pos[i * 3 + 1] = v.center[1] + w[1];
      this.pos[i * 3 + 2] = v.center[2] + w[2];
      // Kill inward velocity at the wall + slight tangential friction.
      const vw = quatRotate(v.invQuat, [
        this.vel[i * 3],
        this.vel[i * 3 + 1],
        this.vel[i * 3 + 2],
      ]);
      for (let axis = 0; axis < 3; axis++) {
        const lim = v.half[axis] - m;
        if (lim < 0) continue;
        if (v.openTop && axis === 1 && local[axis] >= 0) {
          vw[axis] *= 1;
          continue;
        }
        if (Math.abs(Math.abs(local[axis]) - lim) < 1e-6) {
          const inward =
            (local[axis] < 0 && vw[axis] < 0) ||
            (local[axis] > 0 && vw[axis] > 0);
          if (inward) vw[axis] = 0;
          else vw[axis] *= 0.995;
        }
      }
      const back = quatRotate(quatConjugate(v.invQuat), vw);
      this.vel[i * 3] = back[0];
      this.vel[i * 3 + 1] = back[1];
      this.vel[i * 3 + 2] = back[2];
    }
  }

  /** Push particles out of analytic box/sphere colliders. */
  private solveColliders(colliders: FluidCollider[]): void {
    for (let i = 0; i < this.n; i++) {
      const rp = this.h[i] / 4;
      for (let c = 0; c < colliders.length; c++) {
        const col = colliders[c];
        if (col.kind === 'sphere') {
          const dx = this.pos[i * 3] - col.center[0];
          const dy = this.pos[i * 3 + 1] - col.center[1];
          const dz = this.pos[i * 3 + 2] - col.center[2];
          const rr = col.radius + rp;
          const d2 = dx * dx + dy * dy + dz * dz;
          if (d2 >= rr * rr || d2 < 1e-12) continue;
          const d = Math.sqrt(d2);
          const nx = dx / d; const ny = dy / d; const nz = dz / d;
          const push = rr - d;
          this.pos[i * 3] += nx * push;
          this.pos[i * 3 + 1] += ny * push;
          this.pos[i * 3 + 2] += nz * push;
          this.collideVelocity(i, [nx, ny, nz], col);
        } else {
          // World → box local.
          const rel: Vec3 = [
            this.pos[i * 3] - col.center[0],
            this.pos[i * 3 + 1] - col.center[1],
            this.pos[i * 3 + 2] - col.center[2],
          ];
          const local = quatRotate(quatConjugate(col.quat), rel);
          const qx = Math.max(-col.halfExtents[0], Math.min(col.halfExtents[0], local[0]));
          const qy = Math.max(-col.halfExtents[1], Math.min(col.halfExtents[1], local[1]));
          const qz = Math.max(-col.halfExtents[2], Math.min(col.halfExtents[2], local[2]));
          let nx = local[0] - qx;
          let ny = local[1] - qy;
          let nz = local[2] - qz;
          const d2 = nx * nx + ny * ny + nz * nz;
          if (d2 >= rp * rp) continue;
          if (d2 < 1e-12) {
            // Deep inside: push along the least-penetration axis.
            const px = col.halfExtents[0] - Math.abs(local[0]);
            const py = col.halfExtents[1] - Math.abs(local[1]);
            const pz = col.halfExtents[2] - Math.abs(local[2]);
            if (px <= py && px <= pz) {
              nx = local[0] >= 0 ? 1 : -1; ny = 0; nz = 0;
            } else if (py <= pz) {
              nx = 0; ny = local[1] >= 0 ? 1 : -1; nz = 0;
            } else {
              nx = 0; ny = 0; nz = local[2] >= 0 ? 1 : -1;
            }
            const wn = quatRotate(col.quat, [nx, ny, nz] as Vec3);
            const dist =
              px <= py && px <= pz ? px : py <= pz ? py : pz;
            this.pos[i * 3] += wn[0] * (dist + rp);
            this.pos[i * 3 + 1] += wn[1] * (dist + rp);
            this.pos[i * 3 + 2] += wn[2] * (dist + rp);
            this.collideVelocity(i, wn, col);
          } else {
            const d = Math.sqrt(d2);
            const wn = quatRotate(col.quat, [nx / d, ny / d, nz / d] as Vec3);
            const push = rp - d;
            this.pos[i * 3] += wn[0] * push;
            this.pos[i * 3 + 1] += wn[1] * push;
            this.pos[i * 3 + 2] += wn[2] * push;
            this.collideVelocity(i, wn, col);
          }
        }
      }
    }
  }

  /** Reflect relative velocity at a contact normal (restitution 0.1). */
  private collideVelocity(i: number, n: Vec3, col: FluidCollider): void {
    const rvx = this.vel[i * 3] - col.velocity[0];
    const rvy = this.vel[i * 3 + 1] - col.velocity[1];
    const rvz = this.vel[i * 3 + 2] - col.velocity[2];
    const vn = rvx * n[0] + rvy * n[1] + rvz * n[2];
    if (vn < 0) {
      const e = 0.1;
      const j = -(1 + e) * vn;
      this.vel[i * 3] += j * n[0];
      this.vel[i * 3 + 1] += j * n[1];
      this.vel[i * 3 + 2] += j * n[2];
    }
    // Tangential friction pulls the particle toward the body velocity.
    const f = Math.min(1, Math.max(0, col.friction)) * 0.25;
    if (f > 0) {
      this.vel[i * 3] += (col.velocity[0] - this.vel[i * 3]) * f;
      this.vel[i * 3 + 1] += (col.velocity[1] - this.vel[i * 3 + 1]) * f;
      this.vel[i * 3 + 2] += (col.velocity[2] - this.vel[i * 3 + 2]) * f;
    }
  }

  /** Swap-remove particles that escaped the world or went NaN. */
  private cullEscaped(): void {
    for (let i = this.n - 1; i >= 0; i--) {
      const x = this.pos[i * 3];
      const y = this.pos[i * 3 + 1];
      const z = this.pos[i * 3 + 2];
      const bad =
        !Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z) || y < KILL_Y;
      if (!bad) continue;
      const last = --this.n;
      if (i === last) continue;
      this.pos[i * 3] = this.pos[last * 3];
      this.pos[i * 3 + 1] = this.pos[last * 3 + 1];
      this.pos[i * 3 + 2] = this.pos[last * 3 + 2];
      this.vel[i * 3] = this.vel[last * 3];
      this.vel[i * 3 + 1] = this.vel[last * 3 + 1];
      this.vel[i * 3 + 2] = this.vel[last * 3 + 2];
      this.col[i * 3] = this.col[last * 3];
      this.col[i * 3 + 1] = this.col[last * 3 + 1];
      this.col[i * 3 + 2] = this.col[last * 3 + 2];
      this.h[i] = this.h[last];
      this.mass[i] = this.mass[last];
      this.restRho[i] = this.restRho[last];
      this.pressK[i] = this.pressK[last];
      this.visc[i] = this.visc[last];
      this.pVol[i] = this.pVol[last];
      this.volOf[i] = this.volOf[last];
    }
  }
}
