import { describe, it, expect } from 'vitest';
import { bakeRope, bakeChain } from '../src/forge/physics/rope';
import { PhysicsRuntime } from '../src/forge/physics/runtime';
import { templateProvider } from '../src/forge/presets';
import { makeScene } from '../src/forge/core/types';

describe('rope builder', () => {
  it('bakes links + joints + record consistently', () => {
    const r = bakeRope({ count: 8, segLength: 0.5, pinTop: true });
    expect(r.objects).toHaveLength(9); // 8 links + anchor
    expect(r.joints).toHaveLength(8); // pin + 7 links
    expect(r.record.generatedIds).toHaveLength(9);
    expect(r.record.generatedJoints).toHaveLength(8);
    expect(r.record.generatedJoints).toEqual(r.joints.map((j) => j.id));
    // Joints form a chain: each joint's B is the next joint's A.
    for (let i = 1; i < r.joints.length; i++) {
      expect(r.joints[i].bodyA).toBe(r.joints[i - 1].bodyB);
    }
    // Links hang downward from the pin.
    const ys = r.objects
      .filter((o) => o.name.startsWith('Link'))
      .map((o) => o.transform.position[1]);
    for (let i = 1; i < ys.length; i++) {
      expect(ys[i]).toBeLessThan(ys[i - 1]);
    }
  });

  it('chains alternate ring orientation', () => {
    const r = bakeChain({ count: 4 });
    const links = r.objects.filter((o) => o.name.startsWith('Link'));
    expect(links[0].transform.rotation[1]).toBeCloseTo(0, 5);
    expect(links[1].transform.rotation[1]).toBeCloseTo(Math.PI / 2, 5);
    expect(r.record.type).toBe('chain');
  });

  it('hangs under gravity without exploding', async () => {
    const scene = makeScene('rope-hang');
    const r = bakeRope({ count: 10, segLength: 0.4, position: [0, 6, 0] });
    scene.objects.push(...r.objects);
    scene.constraints.push(...r.joints);

    const rt = new PhysicsRuntime({ templateProvider, onEvent: () => {} });
    await rt.loadScene(scene);
    expect(rt.stats().joints).toBe(10);
    rt.stepFrames(180);
    // Bottom link hangs ~4m below the pin, roughly straight down.
    const bottom = r.objects[r.objects.length - 1];
    const t = rt.transforms().find((x) => x.id === bottom.id)!;
    expect(t.p[1]).toBeLessThan(3.5);
    expect(t.p[1]).toBeGreaterThan(0.5);
    expect(Math.abs(t.p[0])).toBeLessThan(1.5);
    for (const v of t.p) expect(Number.isFinite(v)).toBe(true);
    rt.dispose();
  }, 60000);
});
