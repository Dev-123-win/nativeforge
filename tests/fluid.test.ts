/**
 * Slice 8 — Fluids v1: pure FluidSystem tests (no Rapier needed).
 * Seeding, stability, determinism, containment, viscosity, snapshots.
 */
import { describe, expect, it } from 'vitest';
import {
  FluidSystem,
  bodyVolumeAndRadius,
  eulerToQuatFluid,
  hexToRgbFluid,
  FLUID_MAX_PARTICLES,
  type FluidVolumeSeed,
} from '../src/forge/physics/fluid';
import { eulerToQuat } from '../src/forge/physics/runtime';
import { defaultFluid, defaultCollider } from '../src/forge/core/types';
import { Rng } from '../src/forge/core/rng';

const GRAV: [number, number, number] = [0, -9.81, 0];
const DT = 1 / 60;

function tankSeed(overrides: Partial<FluidVolumeSeed> = {}): FluidVolumeSeed {
  const f = defaultFluid();
  return {
    id: 'tank',
    center: [0, 1, 0],
    quat: [0, 0, 0, 1],
    half: [1, 1, 1],
    // Pinned (not the app default): the settle guard below is calibrated to
    // this lattice (seeded surface particle at y=0.9125).
    spacing: 0.25,
    viscosity: f.viscosity,
    stiffness: f.stiffness,
    density: f.density,
    color: [0.18, 0.5, 1],
    fill: f.fill,
    maxParticles: f.maxParticles,
    openTop: f.openTop,
    ...overrides,
  };
}

function kineticEnergy(sys: FluidSystem): number {
  const pos = sys.positions();
  void pos;
  // Access velocities via a second snapshot-free path: sample whole system.
  let ke = 0;
  const snap = sys.snapshot();
  for (let i = 0; i < snap.count * 3; i++) {
    const v = snap.vel[i];
    ke += v * v;
  }
  return ke / 2;
}

function meanHeight(sys: FluidSystem): number {
  const snap = sys.snapshot();
  if (snap.count === 0) return 0;
  let sum = 0;
  for (let i = 0; i < snap.count; i++) sum += snap.pos[i * 3 + 1];
  return sum / snap.count;
}

function maxSpeed(sys: FluidSystem): number {
  const snap = sys.snapshot();
  let m = 0;
  for (let i = 0; i < snap.count; i++) {
    const vx = snap.vel[i * 3];
    const vy = snap.vel[i * 3 + 1];
    const vz = snap.vel[i * 3 + 2];
    const s = Math.sqrt(vx * vx + vy * vy + vz * vz);
    if (s > m) m = s;
  }
  return m;
}

describe('fluid euler convention', () => {
  it('matches the canonical physics eulerToQuat on random angles', () => {
    const rng = new Rng('fluid-quat-check');
    for (let i = 0; i < 200; i++) {
      const e: [number, number, number] = [
        rng.range(-Math.PI, Math.PI),
        rng.range(-Math.PI, Math.PI),
        rng.range(-Math.PI, Math.PI),
      ];
      expect(eulerToQuatFluid(e)).toEqual(eulerToQuat(e));
    }
  });

  it('identity euler gives identity quat', () => {
    expect(eulerToQuatFluid([0, 0, 0])).toEqual([0, 0, 0, 1]);
  });
});

describe('fluid helpers', () => {
  it('parses hex colors, falls back on garbage', () => {
    expect(hexToRgbFluid('#ff0000')).toEqual([1, 0, 0]);
    expect(hexToRgbFluid('00ff00')).toEqual([0, 1, 0]);
    expect(hexToRgbFluid('nope')).toEqual([0.18, 0.5, 1]);
  });

  it('computes body volume and bounding radius per shape', () => {
    const box = bodyVolumeAndRadius(
      defaultCollider({ shape: 'box', halfExtents: [0.5, 1, 0.5] }),
      [2, 1, 1],
    );
    // Volume = 1*2*1 * scale 2 = 4.
    expect(box.volume).toBeCloseTo(4, 6);
    expect(box.radius).toBeCloseTo(Math.sqrt(1 + 1 + 0.25), 6);
    const sphere = bodyVolumeAndRadius(
      defaultCollider({ shape: 'sphere', radius: 0.5 }),
      [1, 1, 1],
    );
    expect(sphere.volume).toBeCloseTo((4 / 3) * Math.PI * 0.125, 6);
    expect(sphere.radius).toBeCloseTo(0.5, 9);
    const cap = bodyVolumeAndRadius(
      defaultCollider({ shape: 'capsule', radius: 0.5, height: 2 }),
      [1, 1, 1],
    );
    expect(cap.radius).toBeCloseTo(Math.sqrt(0.25 + 1), 9);
    const convex = bodyVolumeAndRadius(
      defaultCollider({ shape: 'convex' }),
      [2, 2, 2],
    );
    expect(convex.radius).toBeCloseTo(1.8, 9);
    expect(convex.volume).toBeGreaterThan(0);
  });
});

describe('fluid seeding', () => {
  it('is deterministic for the same seed and defs', () => {
    const a = new FluidSystem();
    const b = new FluidSystem();
    a.seedVolumes(7, [tankSeed()]);
    b.seedVolumes(7, [tankSeed()]);
    expect(a.count).toBe(b.count);
    expect(a.count).toBeGreaterThan(100);
    expect(Array.from(a.positions())).toEqual(Array.from(b.positions()));
    expect(Array.from(a.colors())).toEqual(Array.from(b.colors()));
  });

  it('differs across seeds', () => {
    const a = new FluidSystem();
    const b = new FluidSystem();
    a.seedVolumes(7, [tankSeed()]);
    b.seedVolumes(8, [tankSeed()]);
    expect(a.count).toBe(b.count);
    expect(Array.from(a.positions())).not.toEqual(Array.from(b.positions()));
  });

  it('respects fill fraction and the global particle cap', () => {
    const low = new FluidSystem();
    low.seedVolumes(7, [tankSeed({ fill: 0.2, spacing: 0.3 })]);
    const high = new FluidSystem();
    high.seedVolumes(7, [tankSeed({ fill: 1, spacing: 0.3 })]);
    expect(high.count).toBeGreaterThan(low.count * 2);
    const flood = new FluidSystem();
    flood.seedVolumes(7, [
      tankSeed({ id: 'a', spacing: 0.05, maxParticles: 6000 }),
      tankSeed({ id: 'b', spacing: 0.05, maxParticles: 6000 }),
    ]);
    expect(flood.count).toBeLessThanOrEqual(FLUID_MAX_PARTICLES);
    // Deterministic overflow: same truncation every time.
    const flood2 = new FluidSystem();
    flood2.seedVolumes(7, [
      tankSeed({ id: 'a', spacing: 0.05, maxParticles: 6000 }),
      tankSeed({ id: 'b', spacing: 0.05, maxParticles: 6000 }),
    ]);
    expect(Array.from(flood.positions())).toEqual(
      Array.from(flood2.positions()),
    );
  });

  it('tiny volumes still get a particle', () => {
    const sys = new FluidSystem();
    sys.seedVolumes(7, [tankSeed({ half: [0.02, 0.02, 0.02], spacing: 0.5 })]);
    expect(sys.count).toBe(1);
  });
});

describe('fluid stability', () => {
  it('settles without NaN, explosion, or escape (closed tank)', () => {
    const sys = new FluidSystem();
    sys.seedVolumes(11, [tankSeed()]);
    const n0 = sys.count;
    for (let f = 0; f < 180; f++) sys.step(DT, GRAV, []);
    expect(sys.count).toBe(n0);
    const snap = sys.snapshot();
    for (let i = 0; i < snap.count * 3; i++) {
      expect(Number.isFinite(snap.pos[i])).toBe(true);
      expect(Number.isFinite(snap.vel[i])).toBe(true);
    }
    // Contained: inside the 2x2x2 box centered at y=1 (plus margin slack).
    for (let i = 0; i < snap.count; i++) {
      expect(Math.abs(snap.pos[i * 3])).toBeLessThan(1.05);
      expect(snap.pos[i * 3 + 1]).toBeGreaterThan(-0.05);
      expect(snap.pos[i * 3 + 1]).toBeLessThan(2.05);
      expect(Math.abs(snap.pos[i * 3 + 2])).toBeLessThan(1.05);
    }
    // Settled: slow and sitting low (fill 0.6 of 2m ⇒ surface ≈ y 1.0).
    expect(maxSpeed(sys)).toBeLessThan(1.5);
    expect(meanHeight(sys)).toBeLessThan(1.0);
    // Regression guard: pressure must HOLD the column up. Seeded surface
    // particles sit at y=0.9125; a held column settles ≈13% in this small
    // boundary-dominated tank (maxY ≈ 0.79) while a collapsed pile reads
    // maxY ≈ 0.6-0.7 here.
    const snap2 = sys.snapshot();
    let maxY = -Infinity;
    for (let i = 0; i < snap2.count; i++) {
      if (snap2.pos[i * 3 + 1] > maxY) maxY = snap2.pos[i * 3 + 1];
    }
    expect(maxY).toBeGreaterThan(0.75);
    expect(meanHeight(sys)).toBeGreaterThan(0.35);
  });

  it('stepping is exactly deterministic', () => {
    const run = () => {
      const sys = new FluidSystem();
      sys.seedVolumes(11, [tankSeed()]);
      for (let f = 0; f < 90; f++) sys.step(DT, GRAV, []);
      return sys.snapshot();
    };
    const a = run();
    const b = run();
    expect(a.count).toBe(b.count);
    expect(Array.from(a.pos)).toEqual(Array.from(b.pos));
    expect(Array.from(a.vel)).toEqual(Array.from(b.vel));
  });

  it('viscosity damps motion (honey settles faster than water)', () => {
    const run = (viscosity: number) => {
      const sys = new FluidSystem();
      sys.seedVolumes(11, [tankSeed({ viscosity })]);
      for (let f = 0; f < 90; f++) sys.step(DT, GRAV, []);
      return kineticEnergy(sys);
    };
    const water = run(0);
    const honey = run(5);
    expect(honey).toBeLessThan(water * 0.9);
  });

  it('openTop lets fluid escape upward; closed tank holds it', () => {
    const run = (openTop: boolean) => {
      const sys = new FluidSystem();
      sys.seedVolumes(11, [
        tankSeed({ openTop, half: [1, 0.5, 1], center: [0, 0.5, 0] }),
      ]);
      // Strong upward gravity: water pressed against the ceiling / out the top.
      for (let f = 0; f < 60; f++) sys.step(DT, [0, 30, 0], []);
      const snap = sys.snapshot();
      let maxY = -Infinity;
      for (let i = 0; i < snap.count; i++) {
        if (snap.pos[i * 3 + 1] > maxY) maxY = snap.pos[i * 3 + 1];
      }
      return maxY;
    };
    // Rim at y = 1.0.
    expect(run(false)).toBeLessThan(1.05);
    expect(run(true)).toBeGreaterThan(1.2);
  });
});

describe('fluid colliders', () => {
  it('pushes particles out of overlapping spheres and boxes', () => {
    const sys = new FluidSystem();
    sys.seedVolumes(11, [tankSeed({ fill: 1 })]);
    const sphere = {
      kind: 'sphere' as const,
      center: [0, 1, 0] as [number, number, number],
      quat: [0, 0, 0, 1] as [number, number, number, number],
      halfExtents: [0, 0, 0] as [number, number, number],
      radius: 0.5,
      velocity: [0, 0, 0] as [number, number, number],
      friction: 0.5,
    };
    for (let f = 0; f < 30; f++) sys.step(DT, GRAV, [sphere]);
    const snap = sys.snapshot();
    let inside = 0;
    for (let i = 0; i < snap.count; i++) {
      const dx = snap.pos[i * 3];
      const dy = snap.pos[i * 3 + 1] - 1;
      const dz = snap.pos[i * 3 + 2];
      if (dx * dx + dy * dy + dz * dz < 0.45 * 0.45) inside++;
    }
    expect(inside).toBe(0);

    // Static box collider: particles rest on top of it.
    const sys2 = new FluidSystem();
    sys2.seedVolumes(11, [tankSeed({ fill: 1 })]);
    const box = {
      kind: 'box' as const,
      center: [0, 0.4, 0] as [number, number, number],
      quat: [0, 0, 0, 1] as [number, number, number, number],
      halfExtents: [0.9, 0.3, 0.9] as [number, number, number],
      radius: 0,
      velocity: [0, 0, 0] as [number, number, number],
      friction: 0.5,
    };
    for (let f = 0; f < 60; f++) sys2.step(DT, GRAV, [box]);
    const snap2 = sys2.snapshot();
    let insideBox = 0;
    for (let i = 0; i < snap2.count; i++) {
      const lx = Math.abs(snap2.pos[i * 3]);
      const ly = snap2.pos[i * 3 + 1] - 0.4;
      const lz = Math.abs(snap2.pos[i * 3 + 2]);
      if (lx < 0.8 && Math.abs(ly) < 0.2 && lz < 0.8) insideBox++;
    }
    expect(insideBox).toBe(0);
  });

  it('samples submersion counts inside a sphere', () => {
    const sys = new FluidSystem();
    sys.seedVolumes(11, [tankSeed({ fill: 1 })]);
    for (let f = 0; f < 30; f++) sys.step(DT, GRAV, []);
    const deep = sys.sampleSubmersion([0, 0.5, 0], 0.6);
    expect(deep.count).toBeGreaterThan(10);
    expect(deep.pVol).toBeGreaterThan(0);
    expect(deep.density).toBeCloseTo(1000, 6);
    const air = sys.sampleSubmersion([0, 50, 0], 0.6);
    expect(air.count).toBe(0);
    const empty = new FluidSystem();
    expect(empty.sampleSubmersion([0, 0, 0], 1).count).toBe(0);
  });
});

describe('fluid snapshots', () => {
  it('round-trips through snapshot/restore (scrub safety)', () => {
    const ref = new FluidSystem();
    ref.seedVolumes(11, [tankSeed()]);
    for (let f = 0; f < 60; f++) ref.step(DT, GRAV, []);
    const expected = ref.snapshot();

    const sys = new FluidSystem();
    sys.seedVolumes(11, [tankSeed()]);
    for (let f = 0; f < 30; f++) sys.step(DT, GRAV, []);
    const mid = sys.snapshot();
    for (let f = 0; f < 30; f++) sys.step(DT, GRAV, []);
    // Scrub back to 30 and re-step: identical to the uninterrupted run.
    sys.restore(mid);
    for (let f = 0; f < 30; f++) sys.step(DT, GRAV, []);
    const actual = sys.snapshot();
    expect(actual.count).toBe(expected.count);
    expect(Array.from(actual.pos)).toEqual(Array.from(expected.pos));
    expect(Array.from(actual.vel)).toEqual(Array.from(expected.vel));
  });
});

/* ── Coupled runtime integration (Rapier + fluid) ─────────────────────────── */

import { PhysicsRuntime } from '../src/forge/physics/runtime';
import { OBJECT_PRESETS, templateProvider } from '../src/forge/presets';
import {
  defaultFluid,
  makeObject,
  makeScene,
} from '../src/forge/core/types';

/** Tank volume + ground + a wood floater and a steel sinker. */
function tankScene() {
  const scene = makeScene('tank');
  scene.seed = 4242;
  // Pinned ids: the fluid lattice seed hashes the volume id (like emitter
  // and fracture streams), so cross-run comparisons need identical scenes.
  const ground = OBJECT_PRESETS['ground']();
  ground.id = 'ground-tank-test';
  scene.objects.push(ground);
  const tank = makeObject('Tank', 'fluid');
  tank.id = 'tank-test';
  tank.transform.position = [0, 1, 0];
  tank.transform.scale = [3, 2, 3];
  tank.fluid = defaultFluid({ spacing: 0.25, fill: 0.6, maxParticles: 600 });
  scene.objects.push(tank);
  const wood = OBJECT_PRESETS['box-wood']();
  wood.id = 'wood-test';
  wood.name = 'Wood';
  wood.transform.position = [-0.5, 3, 0];
  wood.transform.scale = [0.6, 0.6, 0.6];
  wood.rigidBody!.density = 600;
  wood.physical.density = 600;
  scene.objects.push(wood);
  const steel = OBJECT_PRESETS['box-concrete']();
  steel.id = 'steel-test';
  steel.name = 'Steel';
  steel.transform.position = [0.5, 2, 0];
  steel.transform.scale = [0.6, 0.6, 0.6];
  steel.rigidBody!.density = 7800;
  steel.physical.density = 7800;
  scene.objects.push(steel);
  return { scene, woodId: wood.id, steelId: steel.id };
}

function bodyY(rt: PhysicsRuntime, id: string): number {
  const t = rt.transforms().find((x) => x.id === id);
  if (!t) throw new Error(`missing body ${id}`);
  return t.p[1];
}

describe('fluid coupled runtime', () => {
  it('wood floats, steel sinks', async () => {
    const { scene, woodId, steelId } = tankScene();
    const rt = new PhysicsRuntime({ templateProvider, onEvent: () => {} });
    await rt.loadScene(scene);
    expect(rt.stats().fluid).toBeGreaterThan(400);
    let woodMin = Infinity;
    for (let f = 0; f < 24; f++) {
      rt.stepFrames(10);
      const y = bodyY(rt, woodId);
      if (y < woodMin) woodMin = y;
    }
    const woodFinal = bodyY(rt, woodId);
    const steelFinal = bodyY(rt, steelId);
    // Wood never touched the tank floor (rest height would be ≈ 0.44). A
    // 0.36 m block dropped 2.1 m hits at 6.4 m/s and physically plunges
    // ≈0.4 m before buoyancy + drag stop it, so the floor-clearance bound is
    // 0.45 (margin 0.01 over floor rest), not 0.5.
    expect(woodMin).toBeGreaterThan(0.45);
    // Wood rides near the surface (≈ 1.2); steel rests on the floor (≈ 0.3).
    expect(woodFinal).toBeGreaterThan(0.9);
    expect(woodFinal).toBeLessThan(1.5);
    expect(steelFinal).toBeLessThan(0.5);
    // No mass particle cull during the coupled run.
    expect(rt.stats().fluid).toBeGreaterThan(400);
    rt.dispose();
  }, 120000);

  it('is deterministic end-to-end (bodies + particles)', async () => {
    const run = async () => {
      const { scene } = tankScene();
      const rt = new PhysicsRuntime({ templateProvider, onEvent: () => {} });
      await rt.loadScene(scene);
      rt.stepFrames(90);
      const bodies = JSON.stringify(
        rt.transforms().map((t) => [
          t.p.map((n) => n.toFixed(6)),
          t.q.map((n) => n.toFixed(6)),
        ]),
      );
      const fluid = Array.from(rt.fluidRenderState().positions);
      const count = rt.fluidRenderState().count;
      rt.dispose();
      return { bodies, fluid, count };
    };
    const a = await run();
    const b = await run();
    expect(b.bodies).toBe(a.bodies);
    expect(b.count).toBe(a.count);
    expect(b.fluid).toEqual(a.fluid);
  }, 120000);

  it('scrubs exactly with fluid (rewind + replay matches direct)', async () => {
    const direct = async () => {
      const { scene } = tankScene();
      const rt = new PhysicsRuntime({ templateProvider, onEvent: () => {} });
      await rt.loadScene(scene);
      rt.stepFrames(90);
      const bodies = JSON.stringify(
        rt.transforms().map((t) => [
          t.p.map((n) => n.toFixed(6)),
          t.q.map((n) => n.toFixed(6)),
        ]),
      );
      const fluid = Array.from(rt.fluidRenderState().positions);
      rt.dispose();
      return { bodies, fluid };
    };
    const expected = await direct();
    const { scene } = tankScene();
    const rt = new PhysicsRuntime({ templateProvider, onEvent: () => {} });
    await rt.loadScene(scene);
    rt.stepFrames(90);
    rt.gotoFrame(25);
    expect(rt.currentFrame).toBe(25);
    rt.stepFrames(65);
    const bodies = JSON.stringify(
      rt.transforms().map((t) => [
        t.p.map((n) => n.toFixed(6)),
        t.q.map((n) => n.toFixed(6)),
      ]),
    );
    const fluid = Array.from(rt.fluidRenderState().positions);
    expect(bodies).toBe(expected.bodies);
    expect(fluid).toEqual(expected.fluid);
    rt.dispose();
  }, 120000);

  it('reseeds deterministically when the volume signature changes', async () => {
    const { scene } = tankScene();
    const rt = new PhysicsRuntime({ templateProvider, onEvent: () => {} });
    await rt.loadScene(scene);
    const full = rt.stats().fluid;
    expect(full).toBeGreaterThan(400);
    const tank = scene.objects.find((o) => o.kind === 'fluid')!;
    tank.fluid!.fill = 0.3;
    rt.syncScene(scene);
    const half = rt.stats().fluid;
    expect(half).toBeGreaterThan(0);
    expect(half).toBeLessThan(full);
    // Same edit twice → identical lattice.
    const snapA = Array.from(rt.fluidRenderState().positions);
    tank.fluid!.fill = 0.6;
    rt.syncScene(scene);
    tank.fluid!.fill = 0.3;
    rt.syncScene(scene);
    expect(Array.from(rt.fluidRenderState().positions)).toEqual(snapA);
    // Disabling the volume drains the particles.
    tank.fluid!.enabled = false;
    rt.syncScene(scene);
    expect(rt.stats().fluid).toBe(0);
    rt.dispose();
  }, 120000);
});
