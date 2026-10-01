import { describe, it, expect } from 'vitest';
import {
  activeCameraTrack,
  applyEasing,
  evalCameraTrack,
  evalMotorTrack,
  evalNumKeys,
  evalVec3Keys,
} from '../src/forge/render/director';
import { scenePhysicsHash } from '../src/forge/physics/cache';
import { PhysicsRuntime } from '../src/forge/physics/runtime';
import { templateProvider } from '../src/forge/presets';
import {
  defaultCollider,
  defaultRigidBody,
  makeCameraTrack,
  makeConstraint,
  makeMotorTrack,
  makeObject,
  makeScene,
} from '../src/forge/core/types';

describe('easing', () => {
  it('shapes segments correctly', () => {
    expect(applyEasing('linear', 0.3)).toBeCloseTo(0.3, 9);
    expect(applyEasing('hold', 0.9)).toBe(0);
    expect(applyEasing('smooth', 0)).toBe(0);
    expect(applyEasing('smooth', 1)).toBe(1);
    expect(applyEasing('smooth', 0.5)).toBeCloseTo(0.5, 9);
    expect(applyEasing('ease-in', 0.5)).toBeLessThan(0.5);
    expect(applyEasing('ease-out', 0.5)).toBeGreaterThan(0.5);
    // Out-of-range time clamps.
    expect(applyEasing('linear', -2)).toBe(0);
    expect(applyEasing('linear', 5)).toBe(1);
  });
});

describe('evalNumKeys', () => {
  const lin = (frame: number, value: number) =>
    ({ frame, value, easing: 'linear' as const });

  it('handles empty / single-key channels', () => {
    expect(evalNumKeys([], 10)).toBeNull();
    expect(evalNumKeys([lin(5, 7)], 0)).toBe(7);
    expect(evalNumKeys([lin(5, 7)], 99)).toBe(7);
  });

  it('clamps outside the key range and interpolates inside', () => {
    const keys = [lin(10, 0), lin(20, 10)];
    expect(evalNumKeys(keys, 0)).toBe(0);
    expect(evalNumKeys(keys, 10)).toBe(0);
    expect(evalNumKeys(keys, 15)).toBeCloseTo(5, 9);
    expect(evalNumKeys(keys, 20)).toBe(10);
    expect(evalNumKeys(keys, 999)).toBe(10);
  });

  it('hold steps at the next key', () => {
    const keys = [
      { frame: 0, value: 3, easing: 'hold' as const },
      { frame: 10, value: 9, easing: 'linear' as const },
    ];
    expect(evalNumKeys(keys, 9)).toBe(3);
    expect(evalNumKeys(keys, 10)).toBe(9);
  });

  it('tolerates unsorted keys', () => {
    const keys = [lin(20, 10), lin(0, 0), lin(10, 5)];
    expect(evalNumKeys(keys, 5)).toBeCloseTo(2.5, 9);
    expect(evalNumKeys(keys, 15)).toBeCloseTo(7.5, 9);
  });
});

describe('evalVec3Keys', () => {
  it('interpolates per component and returns copies', () => {
    const keys = [
      { frame: 0, value: [0, 0, 0] as [number, number, number], easing: 'linear' as const },
      { frame: 10, value: [10, 20, 30] as [number, number, number], easing: 'linear' as const },
    ];
    expect(evalVec3Keys([], 5)).toBeNull();
    const mid = evalVec3Keys(keys, 5)!;
    expect(mid[0]).toBeCloseTo(5, 9);
    expect(mid[1]).toBeCloseTo(10, 9);
    expect(mid[2]).toBeCloseTo(15, 9);
    mid[0] = 999;
    expect(keys[0].value[0]).toBe(0);
  });
});

describe('camera tracks', () => {
  it('selects the active-camera track only', () => {
    const s = makeScene('dir');
    const cam = s.cameras[0];
    const other = makeCameraTrack('other', 'cam-x');
    const t = makeCameraTrack('move', cam.id);
    s.cameraTracks.push(other, t);
    expect(activeCameraTrack(s)).toBe(t);
    t.enabled = false;
    expect(activeCameraTrack(s)).toBeNull();
  });

  it('falls back to base per channel', () => {
    const s = makeScene('dir');
    const cam = s.cameras[0];
    const t = makeCameraTrack('move', cam.id);
    expect(evalCameraTrack(t, cam, 10)).toBeNull(); // keyless
    t.position.push({
      frame: 0,
      value: [1, 2, 3],
      easing: 'linear',
    });
    const pose = evalCameraTrack(t, cam, 50)!;
    expect(pose.position).toEqual([1, 2, 3]);
    expect(pose.target).toEqual(cam.target);
    expect(pose.fov).toBe(cam.fov);
    t.enabled = false;
    expect(evalCameraTrack(t, cam, 50)).toBeNull();
  });
});

describe('motor tracks', () => {
  it('evaluates null when disabled or keyless', () => {
    const t = makeMotorTrack('m', 'j');
    expect(evalMotorTrack(t, 5)).toBeNull();
    t.keys.push({ frame: 0, value: 2, easing: 'linear' });
    expect(evalMotorTrack(t, 5)).toBe(2);
    t.enabled = false;
    expect(evalMotorTrack(t, 5)).toBeNull();
  });

  it('is covered by the physics hash; camera tracks are not', () => {
    const s = makeScene('hash');
    const h0 = scenePhysicsHash(s);
    const mt = makeMotorTrack('m', 'j1');
    mt.keys.push({ frame: 0, value: 1, easing: 'linear' });
    s.motorTracks.push(mt);
    const h1 = scenePhysicsHash(s);
    expect(h1).not.toBe(h0);
    mt.keys[0].value = 2;
    expect(scenePhysicsHash(s)).not.toBe(h1);
    // Camera moves never invalidate the sim cache.
    const ct = makeCameraTrack('c', s.cameras[0].id);
    ct.position.push({ frame: 0, value: [9, 9, 9], easing: 'linear' });
    s.cameraTracks.push(ct);
    expect(scenePhysicsHash(s)).toBe(scenePhysicsHash(s));
    const h2 = scenePhysicsHash(s);
    s.cameraTracks.length = 0;
    expect(scenePhysicsHash(s)).toBe(h2);
  });
});

function box(name: string, x: number, y: number, z: number) {
  const o = makeObject(name, 'primitive');
  o.geometry = { type: 'box', params: { width: 0.5, height: 0.5, depth: 0.5 } };
  o.collider = defaultCollider({ shape: 'box', halfExtents: [0.25, 0.25, 0.25] });
  o.rigidBody = defaultRigidBody({ density: 500 });
  o.transform.position = [x, y, z];
  return o;
}

function trackedScene(): { scene: ReturnType<typeof makeScene>; armId: string } {
  const scene = makeScene('motor-track');
  scene.world.gravity = [0, 0, 0];
  const anchor = box('Anchor', 0, 5, 0);
  anchor.rigidBody = defaultRigidBody({ bodyType: 'static' });
  const arm = box('Arm', 1.2, 5, 0);
  scene.objects.push(anchor, arm);
  const j = makeConstraint('hinge', 'hinge', anchor.id, arm.id);
  j.anchorA = [0, 0, 0];
  j.anchorB = [-1.2, 0, 0];
  j.axis = [0, 0, 1];
  j.motorEnabled = true;
  j.motorMode = 'position';
  j.motorForce = 5000;
  scene.constraints.push(j);
  const t = makeMotorTrack('swing', j.id);
  t.keys.push(
    { frame: 0, value: 0, easing: 'smooth' },
    { frame: 90, value: 1.5, easing: 'smooth' },
  );
  scene.motorTracks.push(t);
  return { scene, armId: arm.id };
}

describe('motor-track physics', () => {
  it('swings the arm along the keyframed target', async () => {
    const { scene, armId } = trackedScene();
    const rt = new PhysicsRuntime({ templateProvider, onEvent: () => {} });
    await rt.loadScene(scene);
    const start = rt.transforms().find((t) => t.id === armId)!.p.slice();
    rt.stepFrames(120);
    const end = rt.transforms().find((t) => t.id === armId)!.p;
    const moved = Math.sqrt(
      (end[0] - start[0]) ** 2 +
        (end[1] - start[1]) ** 2 +
        (end[2] - start[2]) ** 2,
    );
    // 1.2m arm rotating ~1.5 rad must travel well over half a meter.
    expect(moved).toBeGreaterThan(0.5);
    for (const v of end) expect(Number.isFinite(v)).toBe(true);
    rt.dispose();
  }, 60000);

  it('is deterministic and rewind-clean', async () => {
    const runA = trackedScene().scene;
    const rtA = new PhysicsRuntime({ templateProvider, onEvent: () => {} });
    await rtA.loadScene(runA);
    rtA.stepFrames(120);
    const a = rtA.transforms().map((t) => [...t.p, ...t.q]);

    // Same scene, with a mid-run rewind: must converge exactly.
    const runB = trackedScene().scene;
    const rtB = new PhysicsRuntime({ templateProvider, onEvent: () => {} });
    await rtB.loadScene(runB);
    rtB.stepFrames(60);
    rtB.gotoFrame(30);
    rtB.stepFrames(90);
    const b = rtB.transforms().map((t) => [...t.p, ...t.q]);

    expect(b).toEqual(a);
    rtA.dispose();
    rtB.dispose();
  }, 60000);
});
