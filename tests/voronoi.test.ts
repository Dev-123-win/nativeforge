import { describe, it, expect } from 'vitest';
import { shatterBox, VORONOI_MAX_CELLS } from '../src/forge/physics/voronoi';
import type { Vec3 } from '../src/forge/core/types';

const BOX: Vec3 = [1, 0.5, 2];
const BOX_VOL = 8 * BOX[0] * BOX[1] * BOX[2];

describe('shatterBox', () => {
  it('yields exactly N non-degenerate cells', () => {
    for (const n of [2, 3, 8, 24]) {
      const cells = shatterBox(BOX, n, 42);
      expect(cells).toHaveLength(n);
      for (const c of cells) {
        expect(c.volume).toBeGreaterThan(0);
        expect(c.points.length).toBeGreaterThanOrEqual(4);
        for (const v of [...c.centroid]) expect(Number.isFinite(v)).toBe(true);
      }
    }
  });

  it('conserves volume to float precision', () => {
    for (const seed of [1, 7, 12345]) {
      const cells = shatterBox(BOX, 16, seed);
      const sum = cells.reduce((a, c) => a + c.volume, 0);
      expect(sum).toBeCloseTo(BOX_VOL, 9);
    }
  });

  it('keeps every point and centroid inside the box', () => {
    const cells = shatterBox(BOX, 20, 99);
    for (const c of cells) {
      for (const p of [...c.points, c.centroid]) {
        expect(Math.abs(p[0])).toBeLessThanOrEqual(BOX[0] + 1e-9);
        expect(Math.abs(p[1])).toBeLessThanOrEqual(BOX[1] + 1e-9);
        expect(Math.abs(p[2])).toBeLessThanOrEqual(BOX[2] + 1e-9);
      }
    }
  });

  it('is deterministic per seed and varies across seeds', () => {
    const a = shatterBox(BOX, 12, 5);
    const b = shatterBox(BOX, 12, 5);
    expect(a).toEqual(b);
    const c = shatterBox(BOX, 12, 6);
    expect(c).not.toEqual(a);
  });

  it('produces balanced shards (no sliver collapse)', () => {
    const cells = shatterBox(BOX, 24, 2024);
    const vols = cells.map((c) => c.volume).sort((x, y) => x - y);
    const mean = BOX_VOL / 24;
    // Lloyd relaxation keeps even the smallest shard substantial.
    expect(vols[0]).toBeGreaterThan(mean * 0.05);
    expect(vols[vols.length - 1]).toBeLessThan(mean * 5);
  });

  it('clamps degenerate inputs', () => {
    expect(shatterBox(BOX, 1, 1)).toHaveLength(2);
    expect(shatterBox(BOX, 500, 1)).toHaveLength(VORONOI_MAX_CELLS);
    expect(shatterBox([0, 0, 0], 8, 3)).toHaveLength(8);
  });

  it('centroids tile the volume (mean ≈ box center)', () => {
    const cells = shatterBox(BOX, 16, 11);
    const acc: Vec3 = [0, 0, 0];
    for (const c of cells) {
      acc[0] += c.centroid[0] * c.volume;
      acc[1] += c.centroid[1] * c.volume;
      acc[2] += c.centroid[2] * c.volume;
    }
    acc[0] /= BOX_VOL;
    acc[1] /= BOX_VOL;
    acc[2] /= BOX_VOL;
    expect(acc[0]).toBeCloseTo(0, 8);
    expect(acc[1]).toBeCloseTo(0, 8);
    expect(acc[2]).toBeCloseTo(0, 8);
  });
});

describe('voronoi fracture integration', () => {
  async function shatterOnce() {
    const { PhysicsRuntime } = await import('../src/forge/physics/runtime');
    const { templateProvider, OBJECT_PRESETS } = await import('../src/forge/presets');
    const { makeScene } = await import('../src/forge/core/types');
    const scene = makeScene('voronoi-shatter');
    scene.seed = 77;
    scene.objects.push(OBJECT_PRESETS['ground']());
    const panel = OBJECT_PRESETS['glass-panel']();
    panel.id = 'panel-voronoi-test'; // pinned: fracture seed uses id length
    panel.transform.position = [0, 0.7, 0];
    panel.transform.rotation = [0, 0, 0];
    panel.breakable!.mode = 'voronoi';
    panel.breakable!.fragmentCount = 12;
    scene.objects.push(panel);
    const hammer = OBJECT_PRESETS['ball-steel']();
    hammer.transform.position = [0, 8, 0];
    if (hammer.rigidBody) {
      hammer.rigidBody.massMode = 'override';
      hammer.rigidBody.mass = 20;
    }
    scene.objects.push(hammer);
    const rt = new PhysicsRuntime({ templateProvider, onEvent: () => {} });
    await rt.loadScene(scene);
    for (let f = 0; f < 300 && !rt.fracturedIds().has(panel.id); f++) {
      rt.stepFrames(1);
    }
    expect(rt.fracturedIds().has(panel.id)).toBe(true);
    const descs = rt.spawnedDescriptors();
    const transforms = rt.transforms();
    rt.dispose();
    return { descs, transforms };
  }

  it('shatters into exact convex shards that spread and settle', async () => {
    const { descs, transforms } = await shatterOnce();
    expect(descs).toHaveLength(12);
    for (const d of descs) {
      expect(d.geometry.type).toBe('convex');
      const v = d.geometry.vertices ?? [];
      expect(v.length).toBeGreaterThanOrEqual(12); // ≥4 points
      expect(v.length % 3).toBe(0);
      for (const n of v) expect(Number.isFinite(n)).toBe(true);
      expect(d.scale).toEqual([1, 1, 1]); // fragmentScale passthrough
    }
    // Shards are real simulated bodies with distinct poses.
    const pts = descs.map(
      (d) => transforms.find((t) => t.id === d.id)!,
    );
    for (const t of pts) {
      expect(t).toBeDefined();
      for (const v of [...t.p, ...t.q]) expect(Number.isFinite(v)).toBe(true);
    }
    const xs = pts.map((t) => t.p[0]);
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(0.5);
  }, 60000);

  it('is exactly deterministic end to end', async () => {
    const a = await shatterOnce();
    const b = await shatterOnce();
    expect(a.descs.map((d) => d.geometry.vertices)).toEqual(
      b.descs.map((d) => d.geometry.vertices),
    );
  }, 120000);
});
