import { describe, it, expect } from 'vitest';
import {
  applySeedOverride,
  batchOutputName,
  parseSeedList,
} from '../src/forge/render/batch';
import { makeScene } from '../src/forge/core/types';

describe('batch helpers', () => {
  it('overrides seed without touching the original', () => {
    const s = makeScene('clip');
    s.seed = 1;
    const v = applySeedOverride(s, 42);
    expect(v.seed).toBe(42);
    expect(s.seed).toBe(1);
    expect(v.sceneId).toBe(s.sceneId);
  });

  it('names batch outputs per seed', () => {
    expect(batchOutputName('out/clip.mp4', 7)).toBe('out/clip-seed7.mp4');
    expect(batchOutputName('clip', 7)).toBe('clip-seed7.mp4');
  });

  it('parses seed lists and ranges', () => {
    expect(parseSeedList('1,2,3')).toEqual([1, 2, 3]);
    expect(parseSeedList('1-3')).toEqual([1, 2, 3]);
    expect(parseSeedList('5..7')).toEqual([5, 6, 7]);
    expect(parseSeedList('1-3,7,7,10-11')).toEqual([1, 2, 3, 7, 10, 11]);
    expect(() => parseSeedList('abc')).toThrow();
    expect(() => parseSeedList('')).toThrow();
  });
});
