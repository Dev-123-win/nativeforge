import { describe, it, expect } from 'vitest';
import { BalloonSystem } from '../src/forge/physics/balloon';

function system() {
  const s = new BalloonSystem();
  s.register({
    id: 'b1', pressure: 110000, maxPressure: 160000,
    skinThickness: 0.002, fragmentCount: 12, radius: 0.5,
  });
  return s;
}

describe('BalloonSystem', () => {
  it('pops on sharp tip touch inside the skin', () => {
    const s = system();
    const hit = s.checkTouch('b1', [0, 2, 0], [
      { objectId: 'cone', sharpness: 1, tip: [0, 1.9, 0] },
    ]);
    expect(hit).toEqual([0, 1.9, 0]);
  });

  it('ignores dull objects and distant tips', () => {
    const s = system();
    expect(
      s.checkTouch('b1', [0, 2, 0], [
        { objectId: 'cone', sharpness: 0.2, tip: [0, 1.9, 0] },
      ]),
    ).toBeNull();
    expect(
      s.checkTouch('b1', [0, 2, 0], [
        { objectId: 'cone', sharpness: 1, tip: [0, 0, 0] },
      ]),
    ).toBeNull();
  });

  it('pops on violent sharp impacts only', () => {
    const s = system();
    expect(s.checkImpact('b1', 1, 8)).toBe(true);
    expect(s.checkImpact('b1', 1, 2)).toBe(false);
    expect(s.checkImpact('b1', 0, 20)).toBe(false);
  });

  it('bursts on overpressure and never double-pops', () => {
    const s = system();
    expect(s.checkOverpressure('b1', 170000)).toBe(true);
    expect(s.checkOverpressure('b1', 100000)).toBe(false);
    const r = s.pop('b1', [0, 1, 0], 110000);
    expect(r.balloonId).toBe('b1');
    expect(r.power).toBeGreaterThan(1);
    expect(s.isPopped('b1')).toBe(true);
    expect(s.checkTouch('b1', [0, 0, 0], [
      { objectId: 'x', sharpness: 1, tip: [0, 0, 0] },
    ])).toBeNull();
    s.reset();
    expect(s.isPopped('b1')).toBe(false);
  });
});
