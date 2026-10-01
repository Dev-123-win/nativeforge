import { describe, it, expect } from 'vitest';
import {
  buildMuxArgs,
  encodeWav,
  mixSfx,
  renderSfxWav,
  scheduleSfx,
  SFX_SAMPLE_RATE,
} from '../src/forge/audio/sfx';

const OPTS = { fps: 30, recordStart: 0, durationFrames: 90, seed: 1234 };

function decodeSamples(wav: Uint8Array): Int16Array {
  const v = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
  const n = v.getUint32(40, true) / 2;
  const out = new Int16Array(n);
  for (let i = 0; i < n; i++) out[i] = v.getInt16(44 + i * 2, true);
  return out;
}

function energy(samples: Int16Array, fromSec: number, toSec: number): number {
  const a = Math.floor(fromSec * SFX_SAMPLE_RATE);
  const b = Math.min(samples.length, Math.ceil(toSec * SFX_SAMPLE_RATE));
  let sum = 0;
  for (let i = a; i < b; i++) sum += Math.abs(samples[i]);
  return sum;
}

describe('encodeWav', () => {
  it('writes a valid mono 16-bit WAV header', () => {
    const wav = encodeWav(new Float32Array(SFX_SAMPLE_RATE), SFX_SAMPLE_RATE);
    const v = new DataView(wav.buffer);
    const ascii = (off: number, len: number) =>
      String.fromCharCode(...wav.slice(off, off + len));
    expect(ascii(0, 4)).toBe('RIFF');
    expect(ascii(8, 4)).toBe('WAVE');
    expect(ascii(12, 4)).toBe('fmt ');
    expect(v.getUint16(20, true)).toBe(1);
    expect(v.getUint16(22, true)).toBe(1);
    expect(v.getUint32(24, true)).toBe(SFX_SAMPLE_RATE);
    expect(v.getUint16(34, true)).toBe(16);
    expect(ascii(36, 4)).toBe('data');
    expect(v.getUint32(40, true)).toBe(SFX_SAMPLE_RATE * 2);
    expect(wav.length).toBe(44 + SFX_SAMPLE_RATE * 2);
  });

  it('clips out-of-range samples instead of wrapping', () => {
    const wav = encodeWav(new Float32Array([2, -2, 0.5]), 8000);
    expect(decodeSamples(wav)).toEqual(new Int16Array([32767, -32767, 16384]));
  });
});

describe('renderSfxWav', () => {
  it('is byte-deterministic and seed-sensitive', () => {
    const events = [
      { frame: 5, name: 'pop', intensity: 1 },
      { frame: 40, name: 'crash', intensity: 0.8 },
      { frame: 41, name: 'snap', intensity: 0.5 },
    ];
    const a = renderSfxWav(events, OPTS);
    const b = renderSfxWav(events, OPTS);
    expect(a).toEqual(b);
    const c = renderSfxWav(events, { ...OPTS, seed: 999 });
    expect(c).not.toEqual(a);
  });

  it('starts events at frame time and stays silent before', () => {
    const wav = renderSfxWav([{ frame: 30, name: 'pop', intensity: 1 }], OPTS);
    const s = decodeSamples(wav);
    expect(energy(s, 0, 0.9)).toBe(0);
    expect(energy(s, 1.0, 1.2)).toBeGreaterThan(0);
  });

  it('offsets by recordStart and drops pre-roll', () => {
    const wav = renderSfxWav(
      [
        { frame: 95, name: 'pop', intensity: 1 }, // pre-roll: dropped
        { frame: 110, name: 'pop', intensity: 1 },
      ],
      { fps: 30, recordStart: 100, durationFrames: 60, seed: 7 },
    );
    const s = decodeSamples(wav);
    expect(energy(s, 0, 0.3)).toBe(0);
    expect(energy(s, 1 / 3, 0.6)).toBeGreaterThan(0);
  });

  it('renders every voice without NaN or overflow', () => {
    const events = ['pop', 'impact', 'crash', 'whoosh', 'snap', 'blip', 'click', 'nope']
      .map((name, i) => ({ frame: i * 20, name, intensity: 1 }));
    const wav = renderSfxWav(events, { ...OPTS, durationFrames: 200 });
    const s = decodeSamples(wav);
    let peak = 0;
    for (const v of s) {
      expect(Number.isFinite(v)).toBe(true);
      peak = Math.max(peak, Math.abs(v));
    }
    expect(peak).toBeGreaterThan(1000);
    expect(peak).toBeLessThanOrEqual(32767);
  });

  it('renders silence for empty events at exact video length', () => {
    const wav = renderSfxWav([], OPTS);
    const s = decodeSamples(wav);
    expect(s.length).toBe(3 * SFX_SAMPLE_RATE);
    expect(energy(s, 0, 3)).toBe(0);
  });

  it('scales with volume and limits pile-ups', () => {
    const one = [{ frame: 10, name: 'blip', intensity: 1 }];
    const loud = decodeSamples(renderSfxWav(one, OPTS));
    const soft = decodeSamples(renderSfxWav(one, { ...OPTS, volume: 0.5 }));
    const peak = (s: Int16Array) => {
      let p = 0;
      for (const v of s) p = Math.max(p, Math.abs(v));
      return p;
    };
    expect(peak(soft) / peak(loud)).toBeCloseTo(0.5, 1);
    // 60 simultaneous crashes: limited, never clipped.
    const pile = Array.from({ length: 60 }, (_, i) => ({
      frame: i * 2,
      name: 'crash',
      intensity: 1,
    }));
    const p = decodeSamples(renderSfxWav(pile, { ...OPTS, durationFrames: 200 }));
    expect(peak(p)).toBeLessThanOrEqual(Math.ceil(32767 * 0.9));
  });

  it('decays all voices to silence (no DC leaks)', () => {
    const wav = renderSfxWav(
      [{ frame: 0, name: 'whoosh', intensity: 1 }],
      { ...OPTS, durationFrames: 200 },
    );
    const s = decodeSamples(wav);
    // Whoosh is 0.5s; the last second must be near-silent.
    expect(energy(s, 5.5, 6.6)).toBeLessThan(energy(s, 0, 0.5) * 0.001 + 1);
  });
});

describe('scheduleSfx', () => {
  it('throttles to a 45ms min gap like the live synth', () => {
    const sched = scheduleSfx(
      [0, 1, 2, 3].map((frame) => ({ frame, name: 'crash', intensity: 1 })),
      OPTS, // 30fps → 33ms apart
    );
    // Keeps f0, drops f1 (33ms), keeps f2 (66ms), drops f3.
    expect(sched.map((s) => s.at)).toHaveLength(2);
  });

  it('sorts by frame and clamps intensity', () => {
    const sched = scheduleSfx(
      [
        { frame: 60, name: 'pop', intensity: 99 },
        { frame: 30, name: 'pop', intensity: -5 },
      ],
      OPTS,
    );
    expect(sched[0].at).toBeLessThan(sched[1].at);
    expect(sched[0].vol).toBe(0.05);
    expect(sched[1].vol).toBe(1);
  });

  it('throttle keeps loud mixes smaller (observable energy)', () => {
    const dense = [0, 1, 2].map((frame) => ({ frame, name: 'crash', intensity: 1 }));
    const sparse = [0, 2, 4].map((frame) => ({ frame, name: 'crash', intensity: 1 }));
    const e = (evts: typeof dense) => {
      const s = decodeSamples(renderSfxWav(evts, OPTS));
      let sum = 0;
      for (const v of s) sum += Math.abs(v);
      return sum;
    };
    // Dense drops a hit (2 kept), sparse keeps all 3.
    expect(e(sparse)).toBeGreaterThan(e(dense) * 1.2);
  });
});

describe('mixSfx', () => {
  it('never boosts quiet mixes', () => {
    const mix = mixSfx(
      [{ at: 0, name: 'blip', vol: 0.05 }],
      SFX_SAMPLE_RATE,
      1,
      1,
    );
    let peak = 0;
    for (const v of mix) peak = Math.max(peak, Math.abs(v));
    // Live blip peaks at 0.25 * 0.05 = 0.0125 — limiting must not raise it.
    expect(peak).toBeLessThan(0.02);
  });
});

describe('buildMuxArgs', () => {
  it('copies video, encodes AAC, keeps faststart', () => {
    expect(buildMuxArgs('v.mp4', 's.wav', 'o.mp4')).toEqual([
      '-y',
      '-hide_banner',
      '-loglevel',
      'error',
      '-i',
      'v.mp4',
      '-i',
      's.wav',
      '-map',
      '0:v',
      '-map',
      '1:a',
      '-c:v',
      'copy',
      '-c:a',
      'aac',
      '-movflags',
      '+faststart',
      '-shortest',
      'o.mp4',
    ]);
  });
});

describe('physics → sfx integration', () => {
  it('turns a real joint snap into audible WAV energy', async () => {
    const { PhysicsRuntime } = await import('../src/forge/physics/runtime');
    const { templateProvider } = await import('../src/forge/presets');
    const {
      defaultCollider,
      defaultRigidBody,
      makeConstraint,
      makeObject,
      makeScene,
    } = await import('../src/forge/core/types');

    const scene = makeScene('snap-sfx');
    scene.world.gravity = [0, 0, 0];
    const mk = (name: string, x: number, vx: number) => {
      const o = makeObject(name, 'primitive');
      o.geometry = { type: 'box', params: { width: 0.5, height: 0.5, depth: 0.5 } };
      o.collider = defaultCollider({ shape: 'box', halfExtents: [0.25, 0.25, 0.25] });
      o.rigidBody = defaultRigidBody({ density: 500 });
      o.rigidBody!.linvel = [vx, 0, 0];
      o.transform.position = [x, 0, 0];
      return o;
    };
    const a = mk('A', -1, -30);
    const b = mk('B', 1, 30);
    scene.objects.push(a, b);
    const j = makeConstraint('fuse', 'distance', a.id, b.id);
    j.restLength = 2;
    j.breakForce = 500;
    scene.constraints.push(j);

    // Collector mirrors forgeEntry's mapping exactly.
    const collected: Array<{ frame: number; name: string; intensity: number }> = [];
    const rt = new PhysicsRuntime({
      templateProvider,
      onEvent: (e) => {
        const f = rt.currentFrame;
        if (e.type === 'pop') collected.push({ frame: f, name: 'pop', intensity: 1 });
        else if (e.type === 'fracture') {
          collected.push({ frame: f, name: 'crash', intensity: e.intensity ?? 0.9 });
        } else if (e.type === 'sound') {
          collected.push({ frame: f, name: e.name ?? 'blip', intensity: e.intensity ?? 1 });
        }
      },
    });
    await rt.loadScene(scene);
    rt.stepFrames(60);
    rt.dispose();

    expect(collected.some((c) => c.name === 'snap')).toBe(true);
    const wav = renderSfxWav(collected, {
      fps: 60,
      recordStart: 0,
      durationFrames: 60,
      seed: scene.seed,
    });
    const s = decodeSamples(wav);
    expect(energy(s, 0, 1)).toBeGreaterThan(0);
  }, 60000);
});
