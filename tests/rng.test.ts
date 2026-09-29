import { describe, it, expect } from 'vitest';
import { Rng, streamSeed, hashSeed } from '../src/forge/core/rng';

describe('Rng', () => {
  it('produces identical sequences for identical seeds', () => {
    const a = new Rng(12345);
    const b = new Rng(12345);
    const sa = Array.from({ length: 100 }, () => a.next());
    const sb = Array.from({ length: 100 }, () => b.next());
    expect(sa).toEqual(sb);
  });

  it('accepts string seeds deterministically', () => {
    const a = new Rng('scene:42');
    const b = new Rng('scene:42');
    expect(a.next()).toBe(b.next());
    expect(hashSeed('scene:42')).toBe(hashSeed('scene:42'));
  });

  it('forks independent deterministic streams', () => {
    const a = new Rng(7).fork('emitter', 'e1');
    const b = new Rng(7).fork('emitter', 'e1');
    const c = new Rng(7).fork('emitter', 'e2');
    expect(a.next()).toBe(b.next());
    expect(a.next()).not.toBe(c.next());
    expect(streamSeed(7, 'x')).toBe(streamSeed(7, 'x'));
  });

  it('snapshot/restore reproduces the stream (cache keyframes)', () => {
    const a = new Rng(99);
    a.next();
    a.next();
    const snap = a.snapshot();
    const tail1 = [a.next(), a.gaussian(), a.next()];
    a.restore(snap);
    const tail2 = [a.next(), a.gaussian(), a.next()];
    expect(tail1).toEqual(tail2);
  });

  it('gaussian/range/int stay in bounds and deterministic', () => {
    const a = new Rng(5);
    const b = new Rng(5);
    for (let i = 0; i < 50; i++) {
      expect(a.gaussian(10, 2)).toBe(b.gaussian(10, 2));
      const va = a.range(-3, 3);
      const vb = b.range(-3, 3);
      expect(va).toBe(vb);
      expect(va).toBeGreaterThanOrEqual(-3);
      expect(va).toBeLessThan(3);
      expect(a.int(1, 6)).toBe(b.int(1, 6));
    }
    expect(new Rng(5).shuffle([1, 2, 3, 4, 5])).toEqual(
      new Rng(5).shuffle([1, 2, 3, 4, 5]),
    );
  });
});
