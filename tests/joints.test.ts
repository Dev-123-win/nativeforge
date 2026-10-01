import { describe, it, expect } from 'vitest';
import { PhysicsRuntime } from '../src/forge/physics/runtime';
import { templateProvider } from '../src/forge/presets';
import {
  makeConstraint,
  makeObject,
  makeScene,
  defaultCollider,
  defaultRigidBody,
} from '../src/forge/core/types';

function box(name: string, x: number, y: number, z: number) {
  const o = makeObject(name, 'primitive');
  o.geometry = { type: 'box', params: { width: 0.5, height: 0.5, depth: 0.5 } };
  o.collider = defaultCollider({ shape: 'box', halfExtents: [0.25, 0.25, 0.25] });
  o.rigidBody = defaultRigidBody({ density: 500 });
  o.transform.position = [x, y, z];
  return o;
}

function dist(
  rt: PhysicsRuntime,
  a: string,
  b: string,
): number {
  const ts = new Map(rt.transforms().map((t) => [t.id, t]));
  const pa = ts.get(a)!.p;
  const pb = ts.get(b)!.p;
  return Math.sqrt(
    (pa[0] - pb[0]) ** 2 + (pa[1] - pb[1]) ** 2 + (pa[2] - pb[2]) ** 2,
  );
}

describe('joints', () => {
  it('distance joint holds two bodies at rest length', async () => {
    const scene = makeScene('joint-dist');
    const a = box('A', -1, 3, 0);
    const b = box('B', 1, 3, 0);
    scene.objects.push(a, b);
    const j = makeConstraint('link', 'distance', a.id, b.id);
    j.restLength = 2;
    scene.constraints.push(j);

    const rt = new PhysicsRuntime({ templateProvider, onEvent: () => {} });
    await rt.loadScene(scene);
    expect(rt.stats().joints).toBe(1);
    rt.stepFrames(120);
    // Bodies fell together but the joint holds ~2m apart.
    expect(dist(rt, a.id, b.id)).toBeCloseTo(2, 0);
    rt.dispose();
  }, 60000);

  it('hinge joint makes a pendulum that swings', async () => {
    const scene = makeScene('pendulum');
    const anchor = box('Anchor', 0, 5, 0);
    anchor.rigidBody = defaultRigidBody({ bodyType: 'static' });
    const arm = box('Arm', 0.8, 4, 0);
    scene.objects.push(anchor, arm);
    const j = makeConstraint('hinge', 'hinge', anchor.id, arm.id);
    j.anchorA = [0, 0, 0];
    j.anchorB = [-0.8, 1, 0];
    j.axis = [0, 0, 1];
    scene.constraints.push(j);

    const rt = new PhysicsRuntime({ templateProvider, onEvent: () => {} });
    await rt.loadScene(scene);
    const swing: number[] = [];
    for (let i = 0; i < 120; i++) {
      rt.stepFrames(1);
      const t = rt.transforms().find((x) => x.id === arm.id)!;
      swing.push(t.p[0]);
    }
    // Pendulum released off-center must oscillate through x≈0.
    expect(Math.min(...swing)).toBeLessThan(0.2);
    expect(Math.max(...swing)).toBeGreaterThan(0.5);
    rt.dispose();
  }, 60000);

  it('hinge motor spins the joint', async () => {
    const scene = makeScene('motor');
    scene.world.gravity = [0, 0, 0];
    const anchor = box('Anchor', 0, 0, 0);
    anchor.rigidBody = defaultRigidBody({ bodyType: 'static' });
    const arm = box('Arm', 1, 0, 0);
    scene.objects.push(anchor, arm);
    const j = makeConstraint('motor', 'hinge', anchor.id, arm.id);
    j.anchorA = [0, 0, 0];
    j.anchorB = [-1, 0, 0];
    j.axis = [0, 0, 1];
    j.motorEnabled = true;
    j.motorMode = 'velocity';
    j.motorSpeed = 6;
    j.motorForce = 1000;
    scene.constraints.push(j);

    const rt = new PhysicsRuntime({ templateProvider, onEvent: () => {} });
    await rt.loadScene(scene);
    rt.stepFrames(60);
    const t = rt.transforms().find((x) => x.id === arm.id)!;
    // After 1s at 6 rad/s the arm has swung far from +X.
    expect(Math.abs(t.p[1])).toBeGreaterThan(0.3);
    rt.dispose();
  }, 60000);

  it('breakable joints snap above their stress threshold only', async () => {
    const scene = makeScene('break');
    scene.world.gravity = [0, 0, 0];
    const a = box('A', -1, 0, 0);
    const b = box('B', 1, 0, 0);
    // Fling apart fast.
    a.rigidBody!.linvel = [-30, 0, 0];
    b.rigidBody!.linvel = [30, 0, 0];
    scene.objects.push(a, b);
    const j = makeConstraint('fuse', 'distance', a.id, b.id);
    j.restLength = 2;
    j.breakForce = 500;
    scene.constraints.push(j);

    const kinds: string[] = [];
    const rt = new PhysicsRuntime({
      templateProvider,
      onEvent: (e) => kinds.push(e.type),
    });
    await rt.loadScene(scene);
    rt.stepFrames(30);
    expect(rt.brokenJointIds().has(j.id)).toBe(true);
    expect(rt.stats().joints).toBe(0);
    rt.dispose();

    // Same setup, unbreakable → holds (bodies yanked back together).
    const scene2 = makeScene('unbreakable');
    scene2.world.gravity = [0, 0, 0];
    const a2 = box('A', -1, 0, 0);
    const b2 = box('B', 1, 0, 0);
    a2.rigidBody!.linvel = [-30, 0, 0];
    b2.rigidBody!.linvel = [30, 0, 0];
    scene2.objects.push(a2, b2);
    const j2 = makeConstraint('link', 'distance', a2.id, b2.id);
    j2.restLength = 2;
    j2.breakForce = 0;
    scene2.constraints.push(j2);
    const rt2 = new PhysicsRuntime({ templateProvider, onEvent: () => {} });
    await rt2.loadScene(scene2);
    rt2.stepFrames(30);
    expect(rt2.brokenJointIds().has(j2.id)).toBe(false);
    expect(rt2.stats().joints).toBe(1);
    rt2.dispose();
  }, 60000);

  it('spring joints pull displaced bodies back', async () => {
    const scene = makeScene('spring');
    scene.world.gravity = [0, 0, 0];
    const anchor = box('Anchor', 0, 0, 0);
    anchor.rigidBody = defaultRigidBody({ bodyType: 'static' });
    const bob = box('Bob', 3, 0, 0);
    scene.objects.push(anchor, bob);
    const j = makeConstraint('spring', 'spring', anchor.id, bob.id);
    j.restLength = 1;
    j.stiffness = 200;
    j.damping = 2;
    scene.constraints.push(j);

    const rt = new PhysicsRuntime({ templateProvider, onEvent: () => {} });
    await rt.loadScene(scene);
    rt.stepFrames(90);
    // Spring (rest 1m, from 3m out) must have pulled the bob inward.
    expect(dist(rt, anchor.id, bob.id)).toBeLessThan(2.2);
    rt.dispose();
  }, 60000);
});
