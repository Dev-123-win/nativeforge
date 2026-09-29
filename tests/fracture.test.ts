import { describe, it, expect } from 'vitest';
import { planFracture } from '../src/forge/physics/fracture';

describe('planFracture', () => {
  it('is deterministic per seed', () => {
    const a = planFracture([1, 1, 1], 'radial', 12, 77, 3);
    const b = planFracture([1, 1, 1], 'radial', 12, 77, 3);
    expect(a).toEqual(b);
  });

  it('respects count bounds and produces finite specs', () => {
    for (const mode of ['grid', 'radial', 'random', 'voronoi-lite'] as const) {
      const specs = planFracture([0.5, 1, 0.5], mode, 16, 3, 2);
      expect(specs.length).toBe(16);
      for (const s of specs) {
        for (const v of [...s.offset, ...s.size, ...s.velocity, ...s.rotation]) {
          expect(Number.isFinite(v)).toBe(true);
        }
        expect(s.size[0]).toBeGreaterThan(0);
      }
    }
    expect(planFracture([1, 1, 1], 'grid', 1, 1, 1).length).toBe(2); // min clamp
    expect(planFracture([1, 1, 1], 'grid', 500, 1, 1).length).toBe(64); // max clamp
  });

  it('radial fragments fly outward from center', () => {
    const specs = planFracture([1, 1, 1], 'radial', 10, 9, 4);
    for (const s of specs) {
      const dot =
        s.offset[0] * s.velocity[0] +
        s.offset[2] * s.velocity[2]; // ignore lift bias on Y
      expect(dot).toBeGreaterThanOrEqual(0);
    }
  });
});
