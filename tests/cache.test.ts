import { describe, it, expect } from 'vitest';
import { SimCache, scenePhysicsHash } from '../src/forge/physics/cache';
import { makeScene, makeObject } from '../src/forge/core/types';

describe('scenePhysicsHash', () => {
  it('is stable and sensitive to physics edits only', () => {
    const s = makeScene('t');
    s.seed = 42;
    const h1 = scenePhysicsHash(s);
    expect(scenePhysicsHash(s)).toBe(h1);
    s.name = 'renamed';
    s.thumbnail = 'data:...';
    expect(scenePhysicsHash(s)).toBe(h1); // cosmetic → same hash
    s.world.gravity = [0, -1.62, 0];
    expect(scenePhysicsHash(s)).not.toBe(h1);
  });

  it('changes on object add/remove/edit', () => {
    const s = makeScene('t');
    const h1 = scenePhysicsHash(s);
    const o = makeObject('box', 'primitive');
    s.objects.push(o);
    const h2 = scenePhysicsHash(s);
    expect(h2).not.toBe(h1);
    o.transform.position = [1, 2, 3];
    o.rev += 1;
    expect(scenePhysicsHash(s)).not.toBe(h2);
  });
});

describe('SimCache', () => {
  it('snapshots on stride and restores nearest keyframe', () => {
    const c = new SimCache(10, 5);
    expect(c.shouldSnapshot(0)).toBe(true);
    expect(c.shouldSnapshot(7)).toBe(false);
    expect(c.shouldSnapshot(20)).toBe(true);
    c.set(0, new Uint8Array([1]));
    c.set(10, new Uint8Array([2]));
    c.set(20, new Uint8Array([3]));
    expect(c.nearestAtOrBefore(15)).toBe(10);
    expect(c.nearestAtOrBefore(20)).toBe(20);
    expect(c.nearestAtOrBefore(5)).toBe(0);
    expect(c.get(10)).toEqual(new Uint8Array([2]));
  });

  it('invalidates everything on hash change (no stale renders)', () => {
    const c = new SimCache(10, 5);
    c.validate('hash-a');
    c.set(0, new Uint8Array([1]));
    expect(c.validate('hash-a')).toBe(true);
    expect(c.get(0)).not.toBeNull();
    expect(c.validate('hash-b')).toBe(false);
    expect(c.get(0)).toBeNull();
    expect(c.size).toBe(0);
  });

  it('evicts oldest but keeps frame 0', () => {
    const c = new SimCache(10, 3);
    c.set(0, new Uint8Array([0]));
    c.set(10, new Uint8Array([1]));
    c.set(20, new Uint8Array([2]));
    c.set(30, new Uint8Array([3]));
    expect(c.size).toBe(3);
    expect(c.get(0)).not.toBeNull();
    expect(c.get(10)).toBeNull();
  });
});
