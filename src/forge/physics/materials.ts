/**
 * Physical materials — presets + pair-interaction matrix.
 *
 * Honesty note: Rapier solves contact friction/restitution per-collider with
 * combine rules (average/min/max/multiply) — those are exposed directly and
 * are 100% real. The pair matrix below is a v1 approximation: for registered
 * pairs the runtime applies small corrective normal/tangent impulses on top
 * of the solved contact (see runtime.applyPairResponse). It produces a real,
 * visible effect; full per-pair solver integration is future work.
 */

import type { CombineRule, PhysicalMaterialData } from '../core/types';

export interface PhysicalPreset {
  key: string;
  label: string;
  density: number;
  friction: number;
  restitution: number;
  elasticity: number;
  hardness: number;
  adhesion: number;
  frictionCombine: CombineRule;
  restitutionCombine: CombineRule;
  blurb: string;
}

export const PHYSICAL_PRESETS: Record<string, PhysicalPreset> = {
  rubber: {
    key: 'rubber', label: 'Rubber', density: 1100, friction: 1.2,
    restitution: 0.85, elasticity: 0.9, hardness: 0.25, adhesion: 0.05,
    frictionCombine: 'max', restitutionCombine: 'max',
    blurb: 'Grippy, very bouncy. Balls, tires, bouncy toys.',
  },
  steel: {
    key: 'steel', label: 'Steel', density: 7850, friction: 0.55,
    restitution: 0.35, elasticity: 0.1, hardness: 0.95, adhesion: 0,
    frictionCombine: 'average', restitutionCombine: 'average',
    blurb: 'Heavy, hard, moderate bounce. Machines, weights.',
  },
  ice: {
    key: 'ice', label: 'Ice', density: 917, friction: 0.05,
    restitution: 0.15, elasticity: 0.05, hardness: 0.6, adhesion: 0,
    frictionCombine: 'min', restitutionCombine: 'average',
    blurb: 'Near-frictionless sliding.',
  },
  glass: {
    key: 'glass', label: 'Glass', density: 2500, friction: 0.4,
    restitution: 0.45, elasticity: 0.05, hardness: 0.8, adhesion: 0,
    frictionCombine: 'average', restitutionCombine: 'average',
    blurb: 'Hard and springy. Pair with breakable for shatter.',
  },
  wood: {
    key: 'wood', label: 'Wood', density: 700, friction: 0.6,
    restitution: 0.25, elasticity: 0.15, hardness: 0.5, adhesion: 0,
    frictionCombine: 'average', restitutionCombine: 'average',
    blurb: 'Light, warm, medium grip. Dominoes, crates.',
  },
  concrete: {
    key: 'concrete', label: 'Concrete', density: 2400, friction: 0.9,
    restitution: 0.08, elasticity: 0.02, hardness: 0.9, adhesion: 0,
    frictionCombine: 'max', restitutionCombine: 'min',
    blurb: 'Dead, grippy. Floors, walls, static course pieces.',
  },
  plastic: {
    key: 'plastic', label: 'Plastic', density: 1000, friction: 0.55,
    restitution: 0.35, elasticity: 0.3, hardness: 0.45, adhesion: 0,
    frictionCombine: 'average', restitutionCombine: 'average',
    blurb: 'Balanced default for toys and props.',
  },
  foam: {
    key: 'foam', label: 'Foam', density: 120, friction: 0.9,
    restitution: 0.25, elasticity: 0.7, hardness: 0.1, adhesion: 0.05,
    frictionCombine: 'max', restitutionCombine: 'min',
    blurb: 'Ultra-light, soft landing. Pits, padding.',
  },
  jelly: {
    key: 'jelly', label: 'Jelly', density: 1050, friction: 0.35,
    restitution: 0.6, elasticity: 1.0, hardness: 0.05, adhesion: 0.25,
    frictionCombine: 'average', restitutionCombine: 'max',
    blurb: 'Wobbly and sticky. Best with high elasticity squash.',
  },
  mud: {
    key: 'mud', label: 'Mud / Slime', density: 1600, friction: 1.4,
    restitution: 0.02, elasticity: 0.1, hardness: 0.05, adhesion: 0.8,
    frictionCombine: 'max', restitutionCombine: 'min',
    blurb: 'Sticky and dead. Slows and grabs contacts.',
  },
  sand: {
    key: 'sand', label: 'Sand', density: 1600, friction: 1.0,
    restitution: 0.02, elasticity: 0, hardness: 0.2, adhesion: 0.1,
    frictionCombine: 'max', restitutionCombine: 'min',
    blurb: 'Dead piles and pits.',
  },
  latex: {
    key: 'latex', label: 'Latex (balloon skin)', density: 950, friction: 0.8,
    restitution: 0.7, elasticity: 1.0, hardness: 0.05, adhesion: 0.1,
    frictionCombine: 'average', restitutionCombine: 'max',
    blurb: 'Balloon skin and fragments.',
  },
};

export function presetToPhysical(key: string): PhysicalMaterialData {
  const p = PHYSICAL_PRESETS[key] ?? PHYSICAL_PRESETS.plastic;
  return {
    preset: p.key,
    density: p.density,
    friction: p.friction,
    restitution: p.restitution,
    elasticity: p.elasticity,
    hardness: p.hardness,
    adhesion: p.adhesion,
  };
}

/* ─── Pair interaction matrix ────────────────────────────────────────────── */

export interface PairResponse {
  /** Extra normal bounce velocity (m/s) added on qualifying impacts. */
  bounceBoost: number;
  /** Tangential velocity retained per step while in contact (0..1). */
  tangentRetain: number;
  /** Min impact speed (m/s) before the pair rule engages. */
  minImpact: number;
}

function pairKey(a: string, b: string): string {
  return [a, b].sort().join('|');
}

/** Sparse overrides — unlisted pairs use pure Rapier combine rules. */
const PAIR_MATRIX = new Map<string, PairResponse>([
  [pairKey('rubber', 'concrete'), { bounceBoost: 0.6, tangentRetain: 0.995, minImpact: 0.5 }],
  [pairKey('rubber', 'ice'), { bounceBoost: 0.3, tangentRetain: 1.0, minImpact: 0.5 }],
  [pairKey('steel', 'steel'), { bounceBoost: 0.35, tangentRetain: 0.999, minImpact: 1.0 }],
  [pairKey('steel', 'concrete'), { bounceBoost: 0, tangentRetain: 0.99, minImpact: 1.0 }],
  [pairKey('glass', 'concrete'), { bounceBoost: 0.15, tangentRetain: 0.995, minImpact: 0.8 }],
  [pairKey('wood', 'concrete'), { bounceBoost: 0, tangentRetain: 0.985, minImpact: 0.5 }],
  [pairKey('mud', 'concrete'), { bounceBoost: 0, tangentRetain: 0.9, minImpact: 0.2 }],
  [pairKey('jelly', 'concrete'), { bounceBoost: 0.45, tangentRetain: 0.99, minImpact: 0.4 }],
  [pairKey('ice', 'ice'), { bounceBoost: 0, tangentRetain: 1.0, minImpact: 0.5 }],
]);

export function resolvePair(a: string, b: string): PairResponse | null {
  return PAIR_MATRIX.get(pairKey(a, b)) ?? null;
}

export function setPair(a: string, b: string, r: PairResponse): void {
  PAIR_MATRIX.set(pairKey(a, b), r);
}

export function listPairs(): Array<{ a: string; b: string; r: PairResponse }> {
  return [...PAIR_MATRIX.entries()].map(([k, r]) => {
    const [a, b] = k.split('|');
    return { a, b, r };
  });
}

/** Collider volume (m³) for auto mass — matches Rapier shape formulas. */
export function colliderVolume(
  shape: string,
  halfExtents: [number, number, number],
  radius: number,
  height: number,
): number {
  switch (shape) {
    case 'sphere':
      return (4 / 3) * Math.PI * radius ** 3;
    case 'box':
      return 8 * halfExtents[0] * halfExtents[1] * halfExtents[2];
    case 'capsule': {
      const r = radius;
      const h = Math.max(0, height - 2 * r);
      return Math.PI * r * r * h + (4 / 3) * Math.PI * r ** 3;
    }
    case 'cylinder':
      return Math.PI * radius * radius * height;
    case 'cone':
      return (Math.PI * radius * radius * height) / 3;
    default:
      return 8 * halfExtents[0] * halfExtents[1] * halfExtents[2];
  }
}

export function autoMass(density: number, volume: number): number {
  return Math.max(0.001, density * volume);
}
