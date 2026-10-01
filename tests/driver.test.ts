import { describe, it, expect } from 'vitest';
import { evalDriverTrack } from '../src/forge/render/director';
import { scenePhysicsHash } from '../src/forge/physics/cache';
import {
  eulerToQuat,
  PhysicsRuntime,
  quatToEuler,
} from '../src/forge/physics/runtime';
import { templateProvider } from '../src/forge/presets';
import {
  defaultCollider,
  defaultPhysical,
  defaultRigidBody,
  makeDriverTrack,
  makeObject,
  makeScene,
  type Vec3,
} from '../src/forge/core/types';

describe('evalDriverTrack', () => {
  it('returns null when disabled or keyless, else per-channel poses', () => {
    const t = makeDriverTrack('d', 'o1');
    const base = { position: [0, 0, 0] as Vec3, rotation: [0, 0, 0] as Vec3 };
    expect(evalDriverTrack(t, base, 10)).toBeNull();
    t.position.push({ frame: 0, value: [4, 0, 0], easing: 'linear' });
    t.position.push({ frame: 10, value: [14, 0, 0], easing: 'linear' });
    const mid = evalDriverTrack(t, base, 5)!;
    expect(mid.position[0]).toBeCloseTo(9, 9);
    expect(mid.rotation).toEqual([0, 0, 0]); // rotation falls back to base
    t.enabled = false;
    expect(evalDriverTrack(t, base, 5)).toBeNull();
  });
});

describe('quatToEuler', () => {
  it('round-trips eulerToQuat (rotation-preserving)', () => {
    const cases: Vec3[] = [
      [0, 0, 0],
      [0.3, -0.5, 1.2],
      [0, Math.PI / 2, 0], // gimbal edge: same rotation, repinned roll
      [Math.PI, 0.7, -2.1],
      [0, 0, Math.PI],
    ];
    for (const e of cases) {
      const q1 = eulerToQuat(e);
      const q2 = eulerToQuat(quatToEuler(q1));
      const dot = Math.abs(
        q1[0] * q2[0] + q1[1] * q2[1] + q1[2] * q2[2] + q1[3] * q2[3],
      );
      expect(dot).toBeCloseTo(1, 9);
    }
  });
});

function box(
  name: string,
  x: number, y: number, z: number,
  w = 0.5, h = 0.5, d = 0.5,
) {
  const o = makeObject(name, 'primitive');
  o.geometry = { type: 'box', params: { width: w, height: h, depth: d } };
  o.collider = defaultCollider({
    shape: 'box',
    halfExtents: [w / 2, h / 2, d / 2],
  });
  o.rigidBody = defaultRigidBody({ density: 500 });
  o.transform.position = [x, y, z];
  return o;
}

function ball(name: string, x: number, y: number, z: number, rubber = false) {
  const o = makeObject(name, 'primitive');
  o.geometry = { type: 'sphere', params: { radius: 0.25 } };
  o.collider = defaultCollider({ shape: 'sphere', radius: 0.25 });
  o.rigidBody = defaultRigidBody({ density: 500 });
  if (rubber) o.physical = defaultPhysical({ preset: 'rubber' });
  o.transform.position = [x, y, z];
  return o;
}

function paddleScene() {
  const scene = makeScene('paddle');
  scene.world.gravity = [0, 0, 0];
  const paddle = box('Paddle', -2, 0, 0, 0.4, 1.2, 1.2);
  paddle.rigidBody = defaultRigidBody({ bodyType: 'kinematic' });
  const target = ball('Target', 0, 0, 0);
  scene.objects.push(paddle, target);
  const t = makeDriverTrack('shove', paddle.id);
  t.position.push(
    { frame: 0, value: [-2, 0, 0], easing: 'linear' },
    { frame: 60, value: [2, 0, 0], easing: 'linear' },
  );
  scene.driverTracks.push(t);
  return { scene, paddleId: paddle.id, ballId: target.id };
}

describe('driver-track physics', () => {
  it('follows keyframed poses exactly', async () => {
    const { scene, paddleId } = paddleScene();
    const rt = new PhysicsRuntime({ templateProvider, onEvent: () => {} });
    await rt.loadScene(scene);
    rt.stepFrames(30);
    // Poses hold during integration: the pose rendered AT frame F is the
    // one applied for the step F-1 → F, i.e. eval(F-1) by design.
    const mid = rt.transforms().find((t) => t.id === paddleId)!;
    expect(mid.p[0]).toBeCloseTo(-2 + 4 * (29 / 60), 2);
    rt.gotoFrame(60);
    const end = rt.transforms().find((t) => t.id === paddleId)!;
    expect(end.p[0]).toBeCloseTo(-2 + 4 * (59 / 60), 2);
    rt.dispose();
  }, 60000);

  it('shoves a dynamic ball out of the way', async () => {
    const { scene, ballId } = paddleScene();
    const rt = new PhysicsRuntime({ templateProvider, onEvent: () => {} });
    await rt.loadScene(scene);
    rt.stepFrames(90);
    const b = rt.transforms().find((t) => t.id === ballId)!;
    // Paddle swept -2 → +2 through the ball's start: ball must be knocked +x.
    expect(b.p[0]).toBeGreaterThan(0.5);
    expect(b.v[0]).toBeGreaterThan(0);
    rt.dispose();
  }, 60000);

  it('carries a resting ball on a moving platform', async () => {
    const scene = makeScene('carry');
    const plat = box('Platform', 0, -0.25, 0, 4, 0.5, 2);
    plat.rigidBody = defaultRigidBody({ bodyType: 'kinematic' });
    plat.physical = defaultPhysical({ preset: 'rubber' });
    const rider = box('Rider', 0, 0.3, 0);
    rider.physical = defaultPhysical({ preset: 'rubber' });
    scene.objects.push(plat, rider);
    const t = makeDriverTrack('ride', plat.id);
    t.position.push(
      { frame: 0, value: [0, -0.25, 0], easing: 'smooth' },
      { frame: 90, value: [3, -0.25, 0], easing: 'smooth' },
    );
    scene.driverTracks.push(t);

    const rt = new PhysicsRuntime({ templateProvider, onEvent: () => {} });
    await rt.loadScene(scene);
    rt.stepFrames(120);
    const ts = new Map(rt.transforms().map((x) => [x.id, x]));
    const px = ts.get(plat.id)!.p[0];
    const bx = ts.get(rider.id)!.p[0];
    const by = ts.get(rider.id)!.p[1];
    expect(px).toBeCloseTo(3, 1);
    // Friction carries the rider along; it stays on top.
    expect(bx).toBeGreaterThan(2.0);
    expect(by).toBeGreaterThan(-0.5);
    rt.dispose();
  }, 60000);

  it('applies rotation keys and holds base position otherwise', async () => {
    const scene = makeScene('spinner');
    scene.world.gravity = [0, 0, 0];
    const spinner = box('Spinner', 1, 2, 3);
    spinner.rigidBody = defaultRigidBody({ bodyType: 'kinematic' });
    scene.objects.push(spinner);
    const t = makeDriverTrack('spin', spinner.id);
    t.rotation.push(
      { frame: 0, value: [0, 0, 0], easing: 'linear' },
      { frame: 60, value: [0, Math.PI, 0], easing: 'linear' },
    );
    scene.driverTracks.push(t);

    const rt = new PhysicsRuntime({ templateProvider, onEvent: () => {} });
    await rt.loadScene(scene);
    rt.stepFrames(90);
    const s = rt.transforms().find((x) => x.id === spinner.id)!;
    // Position channel keyless → stays at authored base.
    expect(s.p[0]).toBeCloseTo(1, 5);
    expect(s.p[1]).toBeCloseTo(2, 5);
    expect(s.p[2]).toBeCloseTo(3, 5);
    // Rotation reached π about Y (sign-agnostic quat compare).
    const want = eulerToQuat([0, Math.PI, 0]);
    const dot = Math.abs(
      s.q[0] * want[0] + s.q[1] * want[1] + s.q[2] * want[2] + s.q[3] * want[3],
    );
    expect(dot).toBeCloseTo(1, 3);
    rt.dispose();
  }, 60000);

  it('ignores tracks on dynamic bodies', async () => {
    const scene = makeScene('gated');
    const crate = box('Crate', 0, 5, 0);
    scene.objects.push(crate);
    const t = makeDriverTrack('ignored', crate.id);
    t.position.push(
      { frame: 0, value: [0, 5, 0], easing: 'linear' },
      { frame: 60, value: [10, 5, 0], easing: 'linear' },
    );
    scene.driverTracks.push(t);

    const rt = new PhysicsRuntime({ templateProvider, onEvent: () => {} });
    await rt.loadScene(scene);
    rt.stepFrames(60);
    const c = rt.transforms().find((x) => x.id === crate.id)!;
    // Dynamic: falls under gravity, x untouched by the track.
    expect(c.p[1]).toBeLessThan(4);
    expect(c.p[0]).toBeCloseTo(0, 5);
    rt.dispose();
  }, 60000);

  it('is deterministic and rewind-clean', async () => {
    const rtA = new PhysicsRuntime({ templateProvider, onEvent: () => {} });
    await rtA.loadScene(paddleScene().scene);
    rtA.stepFrames(90);
    const a = rtA.transforms().map((t) => [...t.p, ...t.q, ...t.v]);

    const rtB = new PhysicsRuntime({ templateProvider, onEvent: () => {} });
    await rtB.loadScene(paddleScene().scene);
    rtB.stepFrames(45);
    rtB.gotoFrame(20);
    rtB.stepFrames(70);
    const b = rtB.transforms().map((t) => [...t.p, ...t.q, ...t.v]);

    expect(b).toEqual(a);
    rtA.dispose();
    rtB.dispose();
  }, 60000);

  it('is covered by the physics hash', () => {
    const { scene } = paddleScene();
    const h0 = scenePhysicsHash(scene);
    scene.driverTracks[0].position[1].value = [5, 0, 0];
    expect(scenePhysicsHash(scene)).not.toBe(h0);
    scene.driverTracks[0].enabled = false;
    const h1 = scenePhysicsHash(scene);
    scene.driverTracks[0].enabled = true;
    expect(scenePhysicsHash(scene)).not.toBe(h1);
  });
});
