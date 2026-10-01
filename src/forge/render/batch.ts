/**
 * Batch rendering helpers — pure functions for multi-seed content runs.
 *
 * A batch renders the same scene N times with different seeds, producing
 * N deterministic variations: `clip-seed1.mp4`, `clip-seed2.mp4`, …
 */

import type { ForgeScene } from '../core/types';

/** Clone a scene with a seed override (original untouched). */
export function applySeedOverride(scene: ForgeScene, seed: number): ForgeScene {
  const clone = structuredClone(scene) as ForgeScene;
  clone.seed = seed;
  clone.updatedAt = Date.now();
  return clone;
}

export function batchOutputName(baseName: string, seed: number): string {
  const stem = baseName.replace(/\.mp4$/i, '');
  return `${stem}-seed${seed}.mp4`;
}

/**
 * Parse `--seeds` specs: "1,2,3", "1-5", "1..5", "1-3,7,10-12".
 * Duplicates removed, order preserved.
 */
export function parseSeedList(spec: string): number[] {
  const out: number[] = [];
  const seen = new Set<number>();
  for (const part of spec.split(',')) {
    const t = part.trim();
    if (!t) continue;
    const range = t.match(/^(\d+)\s*(?:-|\.\.)\s*(\d+)$/);
    if (range) {
      const a = Number(range[1]);
      const b = Number(range[2]);
      const [lo, hi] = a <= b ? [a, b] : [b, a];
      for (let s = lo; s <= hi; s++) {
        if (!seen.has(s)) {
          seen.add(s);
          out.push(s);
        }
      }
    } else {
      const n = Number(t);
      if (!Number.isInteger(n) || n < 0) {
        throw new Error(`Invalid seed "${t}" — expected a non-negative integer or range.`);
      }
      if (!seen.has(n)) {
        seen.add(n);
        out.push(n);
      }
    }
  }
  if (out.length === 0) throw new Error('No seeds parsed — nothing to render.');
  return out;
}
