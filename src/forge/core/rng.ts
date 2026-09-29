/**
 * Deterministic RNG — mulberry32 with hashed string seeds.
 *
 * Rule: identical (scene seed + stream name + call order) MUST reproduce
 * identical values. Every procedural system (generators, emitters, events,
 * fracture) derives its own stream so adding a new system never perturbs
 * existing ones.
 */

export function hashSeed(input: string | number): number {
  if (typeof input === 'number') return input >>> 0;
  let h = 2166136261 >>> 0;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Derive an independent stream seed from a root seed + namespaced label. */
export function streamSeed(root: number, ...labels: string[]): number {
  return hashSeed(`${root >>> 0}:${labels.join(':')}`);
}

export class Rng {
  private state: number;
  private gaussianSpare: number | null = null;

  constructor(seed: string | number) {
    this.state = hashSeed(seed);
  }

  /** Fork an independent child stream. */
  fork(...labels: string[]): Rng {
    return new Rng(streamSeed(this.state, ...labels));
  }

  nextUint32(): number {
    this.state |= 0;
    this.state = (this.state + 0x6d2b79f5) | 0;
    let t = Math.imul(this.state ^ (this.state >>> 15), 1 | this.state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Uniform [0, 1). */
  next(): number {
    return this.nextUint32();
  }

  /** Uniform [min, max). */
  range(min: number, max: number): number {
    return min + (max - min) * this.next();
  }

  /** Uniform integer [min, max] inclusive. */
  int(min: number, max: number): number {
    return Math.floor(this.range(min, max + 1));
  }

  /** Standard normal via Box–Muller (deterministic per call order). */
  gaussian(mean = 0, std = 1): number {
    if (this.gaussianSpare !== null) {
      const v = this.gaussianSpare;
      this.gaussianSpare = null;
      return mean + std * v;
    }
    let u = 0;
    let v = 0;
    while (u === 0) u = this.next();
    while (v === 0) v = this.next();
    const mag = Math.sqrt(-2.0 * Math.log(u));
    this.gaussianSpare = mag * Math.sin(2.0 * Math.PI * v);
    return mean + std * mag * Math.cos(2.0 * Math.PI * v);
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error('Rng.pick on empty array');
    return items[Math.floor(this.next() * items.length)];
  }

  /** Fisher–Yates shuffle (returns new array). */
  shuffle<T>(items: readonly T[]): T[] {
    const a = [...items];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  /** Serialize state for simulation-cache keyframes. */
  snapshot(): [number, number | null] {
    return [this.state, this.gaussianSpare];
  }

  restore(s: [number, number | null]): void {
    this.state = s[0] | 0;
    this.gaussianSpare = s[1];
  }

  /** Random unit vector (uniform on sphere). */
  unitVector(): [number, number, number] {
    const z = this.range(-1, 1);
    const a = this.range(0, Math.PI * 2);
    const r = Math.sqrt(Math.max(0, 1 - z * z));
    return [r * Math.cos(a), r * Math.sin(a), z];
  }

  /** Random hex color from a pleasing palette-biased HSL space. */
  color(saturation = 0.65, lightness = 0.55): string {
    const h = Math.floor(this.next() * 360);
    const s = Math.floor(saturation * 100);
    const l = Math.floor(lightness * 100);
    return hslToHex(h, s, l);
  }
}

export function hslToHex(h: number, s: number, l: number): string {
  s /= 100;
  l /= 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) =>
    l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const to = (x: number) =>
    Math.round(255 * x)
      .toString(16)
      .padStart(2, '0');
  return `#${to(f(0))}${to(f(8))}${to(f(4))}`;
}
