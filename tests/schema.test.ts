import { describe, it, expect } from 'vitest';
import { migrateScene, makeScene, FORGE_SCHEMA_VERSION } from '../src/forge/core/types';

describe('migrateScene', () => {
  it('fills missing arrays for forward compatibility', () => {
    const s = migrateScene({
      sceneId: 'x',
      schemaVersion: FORGE_SCHEMA_VERSION,
      name: 'old',
    });
    expect(s.constraints).toEqual([]);
    expect(s.cameraTracks).toEqual([]);
    expect(s.motorTracks).toEqual([]);
    expect(s.objects).toEqual([]);
    expect(s.events).toEqual([]);
  });

  it('fills missing generatedJoints on generator records', () => {
    const s = makeScene('g');
    const raw = JSON.parse(JSON.stringify(s)) as Record<string, unknown>;
    raw['generators'] = [
      { id: 'gen-1', type: 'pile', generatedIds: [] },
    ];
    const m = migrateScene(raw);
    expect(m.generators[0].generatedJoints).toEqual([]);
  });

  it('fills missing track channels and flags', () => {
    const m = migrateScene({
      sceneId: 'x',
      schemaVersion: FORGE_SCHEMA_VERSION,
      cameraTracks: [{ id: 'ct' }],
      motorTracks: [{ id: 'mt', keys: [{ frame: 0, value: 1 }] }],
    });
    expect(m.cameraTracks[0].enabled).toBe(true);
    expect(m.cameraTracks[0].position).toEqual([]);
    expect(m.cameraTracks[0].target).toEqual([]);
    expect(m.cameraTracks[0].fov).toEqual([]);
    expect(m.motorTracks[0].enabled).toBe(true);
    expect(m.motorTracks[0].keys).toHaveLength(1);
  });

  it('rejects missing or newer schemas', () => {
    expect(() => migrateScene({})).toThrow(/schemaVersion/);
    expect(() =>
      migrateScene({ sceneId: 'x', schemaVersion: 9999 }),
    ).toThrow(/newer/);
  });
});
