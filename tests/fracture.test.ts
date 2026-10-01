import { describe, it, expect } from 'vitest';
import { planFracture } from '../src/forge/physics/fracture';

describe('planFracture', () => {
  it('is deterministic per seed', () => {
    const a = planFracture([1, 1, 1], 'radial', 12, 77, 3);
    const b = planFracture([1, 1, 1], 'radial', 12, 77, 3);
    expect(a).toEqual(b);
  });

  it('respects count bounds and produces finite specs', () => {
    for (const mode of ['grid', 'radial', 'random', 'voronoi-lite', 'voronoi'] as const) {
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

  it('voronoi specs carry centroid-relative convex shards', () => {
    const specs = planFracture([1, 0.5, 1], 'voronoi', 10, 21, 3);
    expect(specs).toHaveLength(10);
    for (const s of specs) {
      expect(s.alignToParent).toBe(true);
      expect(s.convex).toBeDefined();
      expect(s.convex!.length).toBeGreaterThanOrEqual(4);
      // Offsets (centroids) stay inside the bounds.
      expect(Math.abs(s.offset[0])).toBeLessThanOrEqual(1 + 1e-9);
      expect(Math.abs(s.offset[1])).toBeLessThanOrEqual(0.5 + 1e-9);
      expect(Math.abs(s.offset[2])).toBeLessThanOrEqual(1 + 1e-9);
      // Points are centroid-relative: their mean is ~origin.
      const mean = [0, 0, 0];
      for (const p of s.convex!) {
        mean[0] += p[0];
        mean[1] += p[1];
        mean[2] += p[2];
        for (const v of p) expect(Number.isFinite(v)).toBe(true);
      }
      mean[0] /= s.convex!.length;
      mean[1] /= s.convex!.length;
      mean[2] /= s.convex!.length;
      // Vertex mean ≈ centroid only for symmetric cells; just require sane bounds.
      expect(Math.abs(mean[0])).toBeLessThan(1);
      expect(Math.abs(mean[1])).toBeLessThan(0.5);
      expect(Math.abs(mean[2])).toBeLessThan(1);
    }
    // Voronoi caps at its own cell limit, not the chunk limit.
    expect(planFracture([1, 1, 1], 'voronoi', 500, 1, 1).length).toBe(48);
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
