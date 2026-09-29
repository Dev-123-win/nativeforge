import { describe, it, expect } from 'vitest';
import {
  autoMass,
  colliderVolume,
  PHYSICAL_PRESETS,
  presetToPhysical,
  resolvePair,
} from '../src/forge/physics/materials';

describe('materials', () => {
  it('computes collider volumes and auto mass', () => {
    expect(colliderVolume('sphere', [0, 0, 0], 1, 0)).toBeCloseTo(
      (4 / 3) * Math.PI, 5,
    );
    expect(colliderVolume('box', [0.5, 0.5, 0.5], 0, 0)).toBeCloseTo(1, 5);
    expect(colliderVolume('cone', [0, 0, 0], 1, 3)).toBeCloseTo(Math.PI, 5);
    expect(autoMass(7850, 0.02)).toBeCloseTo(157, 5);
    expect(autoMass(0, 0)).toBeGreaterThan(0); // clamped, never zero
  });

  it('exposes real presets with distinct behavior', () => {
    expect(PHYSICAL_PRESETS.rubber.restitution).toBeGreaterThan(
      PHYSICAL_PRESETS.concrete.restitution,
    );
    expect(PHYSICAL_PRESETS.ice.friction).toBeLessThan(
      PHYSICAL_PRESETS.rubber.friction,
    );
    expect(presetToPhysical('steel').density).toBe(7850);
    expect(presetToPhysical('nope').preset).toBe('plastic'); // safe fallback
  });

  it('resolves pair interactions symmetrically', () => {
    const ab = resolvePair('rubber', 'concrete');
    const ba = resolvePair('concrete', 'rubber');
    expect(ab).not.toBeNull();
    expect(ab).toEqual(ba);
    expect(resolvePair('plastic', 'plastic')).toBeNull(); // pure Rapier path
  });
});
