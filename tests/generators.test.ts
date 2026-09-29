import { describe, it, expect } from 'vitest';
import { makeObject } from '../src/forge/core/types';
import {
  DEFAULT_GENERATOR_PARAMS,
  bakeCircle,
  bakeGrid,
  bakePile,
  bakeSpiral,
  bakeTower,
} from '../src/forge/physics/generators';

function template() {
  const t = makeObject('Ball', 'primitive');
  t.geometry = { type: 'sphere', params: { radius: 0.25 } };
  return t;
}

describe('generators', () => {
  it('grid bakes rows×cols×layers with shared instance key', () => {
    const r = bakeGrid(template(), {
      ...DEFAULT_GENERATOR_PARAMS,
      rows: 3, cols: 4, layers: 2, spacing: 1, jitter: 0,
    });
    expect(r.objects).toHaveLength(24);
    expect(r.record.generatedIds).toHaveLength(24);
    const keys = new Set(r.objects.map((o) => o.instanceKey));
    expect(keys.size).toBe(1);
    expect(r.objects.map((o) => o.id)).toEqual(r.record.generatedIds);
  });

  it('is deterministic for the same seed', () => {
    const opts = {
      ...DEFAULT_GENERATOR_PARAMS,
      seed: 4242, count: 50, area: 6, height: 3, dropHeight: 4,
    };
    const a = bakePile(template(), opts);
    const b = bakePile(template(), opts);
    expect(a.objects.map((o) => o.transform)).toEqual(
      b.objects.map((o) => o.transform),
    );
    expect(a.objects.map((o) => o.visual.baseColor)).toEqual(
      b.objects.map((o) => o.visual.baseColor),
    );
  });

  it('varies with different seeds', () => {
    const base = {
      ...DEFAULT_GENERATOR_PARAMS,
      count: 30, area: 6, height: 3, dropHeight: 4,
    };
    const a = bakePile(template(), { ...base, seed: 1 });
    const b = bakePile(template(), { ...base, seed: 2 });
    const pa = JSON.stringify(a.objects.map((o) => o.transform.position));
    const pb = JSON.stringify(b.objects.map((o) => o.transform.position));
    expect(pa).not.toBe(pb);
  });

  it('circle/spiral/tower produce exact counts on their curves', () => {
    const c = bakeCircle(template(), {
      ...DEFAULT_GENERATOR_PARAMS, count: 12, radius: 5, height: 2,
      startAngle: 0, endAngle: Math.PI * 2,
    });
    expect(c.objects).toHaveLength(12);
    for (const o of c.objects) {
      const [x, , z] = o.transform.position;
      expect(Math.hypot(x, z)).toBeCloseTo(5, 5);
    }
    const s = bakeSpiral(template(), {
      ...DEFAULT_GENERATOR_PARAMS, count: 20, turns: 2,
      radiusStart: 1, radiusEnd: 3, heightStep: 0.5,
    });
    expect(s.objects).toHaveLength(20);
    expect(s.objects[19].transform.position[1]).toBeCloseTo(9.5, 5);
    const t = bakeTower(template(), {
      ...DEFAULT_GENERATOR_PARAMS, rows: 2, cols: 2, levels: 5,
      spacing: 1, alternate: true,
    });
    expect(t.objects).toHaveLength(20);
  });

  it('uses distinct instance keys across bakes', () => {
    const a = bakePile(template(), {
      ...DEFAULT_GENERATOR_PARAMS, count: 5, area: 2, height: 1, dropHeight: 2,
    });
    const b = bakePile(template(), {
      ...DEFAULT_GENERATOR_PARAMS, count: 5, area: 2, height: 1, dropHeight: 2,
    });
    expect(a.objects[0].instanceKey).not.toBe(b.objects[0].instanceKey);
  });
});
