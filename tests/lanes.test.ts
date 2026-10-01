import { describe, it, expect } from 'vitest';
import {
  buildLanes,
  deleteKeys,
  deleteTrackKeys,
  fracToFrame,
  frameToPct,
  laneChannels,
  moveKeys,
  moveTrackKeys,
  trackFrames,
} from '../src/forge/render/lanes';
import {
  makeCameraTrack,
  makeDriverTrack,
  makeMotorTrack,
  makeScene,
} from '../src/forge/core/types';

describe('buildLanes', () => {
  it('derives one lane per track with unioned sorted frames', () => {
    const s = makeScene('lanes');
    const cam = makeCameraTrack('move', s.cameras[0].id);
    cam.position.push(
      { frame: 20, value: [0, 0, 0], easing: 'linear' },
      { frame: 0, value: [1, 1, 1], easing: 'linear' },
    );
    cam.fov.push({ frame: 10, value: 50, easing: 'hold' });
    const m = makeMotorTrack('swing', 'j1');
    m.keys.push({ frame: 5, value: 1, easing: 'smooth' });
    const d = makeDriverTrack('ride', 'o1');
    s.cameraTracks.push(cam);
    s.motorTracks.push(m);
    s.driverTracks.push(d);
    const lanes = buildLanes(s);
    expect(lanes).toHaveLength(3);
    expect(lanes[0]).toMatchObject({
      kind: 'camera',
      label: 'move',
      enabled: true,
      frames: [0, 10, 20],
    });
    expect(lanes[1].frames).toEqual([5]);
    expect(lanes[2].frames).toEqual([]);
  });

  it('returns no lanes for a trackless scene', () => {
    expect(buildLanes(makeScene('empty'))).toEqual([]);
  });
});

describe('frame mapping', () => {
  it('maps frames to percents with clamping', () => {
    expect(frameToPct(0, 100)).toBe(0);
    expect(frameToPct(50, 100)).toBe(50);
    expect(frameToPct(100, 100)).toBe(100);
    expect(frameToPct(-5, 100)).toBe(0);
    expect(frameToPct(500, 100)).toBe(100);
    expect(frameToPct(5, 0)).toBe(0);
  });

  it('quantizes pointer fractions to frames', () => {
    expect(fracToFrame(0, 100)).toBe(0);
    expect(fracToFrame(0.5, 100)).toBe(50);
    expect(fracToFrame(0.504, 100)).toBe(50);
    expect(fracToFrame(1, 100)).toBe(100);
    expect(fracToFrame(-0.2, 100)).toBe(0);
    expect(fracToFrame(1.5, 100)).toBe(100);
  });
});

describe('laneChannels', () => {
  it('lists channels per kind', () => {
    expect(laneChannels('camera')).toEqual(['position', 'target', 'fov']);
    expect(laneChannels('motor')).toEqual(['keys']);
    expect(laneChannels('driver')).toEqual(['position', 'rotation']);
  });
});

describe('moveKeys', () => {
  const k = (frame: number, value: number) => ({ frame, value, easing: 'linear' as const });

  it('moves keys preserving values and sort order', () => {
    const out = moveKeys([k(0, 1), k(10, 2), k(20, 3)], 0, 15);
    expect(out.map((x) => [x.frame, x.value])).toEqual([
      [10, 2],
      [15, 1],
      [20, 3],
    ]);
  });

  it('merges over keys already at the destination', () => {
    const out = moveKeys([k(0, 1), k(10, 2)], 0, 10);
    expect(out.map((x) => [x.frame, x.value])).toEqual([[10, 1]]);
  });

  it('is a no-op for missing or identical frames', () => {
    expect(moveKeys([k(5, 1)], 99, 10)).toEqual([k(5, 1)]);
    const src = [k(5, 1)];
    expect(moveKeys(src, 5, 5)).toEqual(src);
  });

  it('does not mutate the input', () => {
    const src = [k(0, 1), k(10, 2)];
    moveKeys(src, 0, 10);
    expect(src.map((x) => x.frame)).toEqual([0, 10]);
  });
});

describe('deleteKeys', () => {
  it('removes only the target frame', () => {
    const k = (frame: number) => ({ frame });
    expect(deleteKeys([k(0), k(5), k(10)], 5)).toEqual([k(0), k(10)]);
    expect(deleteKeys([k(0)], 99)).toEqual([k(0)]);
  });
});

describe('trackFrames', () => {
  it('unions channels sorted', () => {
    const s = makeScene('t');
    const d = makeDriverTrack('d', 'o');
    d.position.push({ frame: 30, value: [0, 0, 0], easing: 'linear' });
    d.rotation.push({ frame: 10, value: [0, 0, 0], easing: 'linear' });
    expect(trackFrames('driver', d)).toEqual([10, 30]);
    void s;
  });
});

describe('track transforms', () => {
  it('moves and deletes across every channel', () => {
    const s = makeScene('t');
    const cam = makeCameraTrack('c', s.cameras[0].id);
    cam.position.push({ frame: 0, value: [0, 0, 0], easing: 'linear' });
    cam.target.push({ frame: 0, value: [1, 1, 1], easing: 'smooth' });
    cam.fov.push({ frame: 10, value: 40, easing: 'linear' });
    const moved = moveTrackKeys('camera', cam, 0, 10);
    // f0 keys moved to f10, merging over the fov key there.
    expect(moved.position.map((k) => k.frame)).toEqual([10]);
    expect(moved.target.map((k) => k.frame)).toEqual([10]);
    expect(moved.target[0].easing).toBe('smooth');
    expect(moved.fov.map((k) => k.frame)).toEqual([10]);
    const cleared = deleteTrackKeys('camera', moved, 10);
    expect(cleared.position).toEqual([]);
    expect(cleared.target).toEqual([]);
    expect(cleared.fov).toEqual([]);
    // Input untouched.
    expect(cam.position[0].frame).toBe(0);
  });
});
