/**
 * sfx — offline render of the editor's synth SFX to a WAV buffer.
 *
 * Sample-level port of the WebAudio recipes in `../ui/sound.ts`, with
 * seeded noise so the same (events, seed) always renders byte-identical
 * audio. The export pipeline muxes this track into the MP4; the editor
 * keeps using the live WebAudio version.
 *
 * Mirrors of live behavior (deliberate, not coincidental):
 * - intensity clamped to 0.05..1, unknown names render as blips
 * - 45ms global min-gap throttle (the editor drops oversaturated hits)
 * - absolute gains like the live mix; a limiter only ever attenuates
 */
export const SFX_SAMPLE_RATE = 44100;
export const SFX_MIN_GAP_SEC = 0.045;

export interface SfxEvent {
  /** Simulation frame the event fired on. */
  frame: number;
  name: string;
  intensity: number;
}

export interface SfxRenderOptions {
  fps: number;
  recordStart: number;
  durationFrames: number;
  seed: number;
  /** Post-mix gain before limiting. Default 1. */
  volume?: number;
}

/** Deterministic PRNG stream for noise. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** WebAudio exponentialRampToValueAtTime equivalent (a, b > 0). */
function expRamp(a: number, b: number, t: number, dur: number): number {
  if (t <= 0) return a;
  if (t >= dur) return b;
  return a * Math.pow(b / a, t / dur);
}

type BiquadKind = 'lowpass' | 'highpass' | 'bandpass';

/** RBJ biquad with per-sample cutoff updates for filter sweeps. */
class SweepFilter {
  private x1 = 0;
  private x2 = 0;
  private y1 = 0;
  private y2 = 0;

  constructor(
    private kind: BiquadKind,
    private q: number,
    private sr: number,
  ) {}

  next(x0: number, freq: number): number {
    const f = Math.max(10, Math.min(this.sr * 0.45, freq));
    const w0 = (2 * Math.PI * f) / this.sr;
    const cosW = Math.cos(w0);
    const sinW = Math.sin(w0);
    const alpha = sinW / (2 * this.q);
    let b0: number;
    let b1: number;
    let b2: number;
    if (this.kind === 'lowpass') {
      b0 = (1 - cosW) / 2;
      b1 = 1 - cosW;
      b2 = (1 - cosW) / 2;
    } else if (this.kind === 'highpass') {
      b0 = (1 + cosW) / 2;
      b1 = -(1 + cosW);
      b2 = (1 + cosW) / 2;
    } else {
      b0 = alpha;
      b1 = 0;
      b2 = -alpha;
    }
    const a0 = 1 + alpha;
    const a1 = -2 * cosW;
    const a2 = 1 - alpha;
    const y0 =
      (b0 * x0 + b1 * this.x1 + b2 * this.x2 - a1 * this.y1 - a2 * this.y2) / a0;
    this.x2 = this.x1;
    this.x1 = x0;
    this.y2 = this.y1;
    this.y1 = y0;
    return y0;
  }
}

function tri(phase: number): number {
  return (2 / Math.PI) * Math.asin(Math.sin(phase));
}

interface VoiceCtx {
  dst: Float32Array;
  at: number;
  sr: number;
  vol: number;
  rand: () => number;
}

/** Add a buffer, truncating at the mix end. */
function addAt(dst: Float32Array, at: number, samples: Float32Array): void {
  const n = Math.min(samples.length, dst.length - at);
  for (let i = 0; i < n; i++) dst[at + i] += samples[i];
}

function voicePop(c: VoiceCtx): void {
  const { sr, vol, rand } = c;
  // Noise burst through a closing lowpass.
  const nLen = Math.ceil(sr * 0.12);
  const noise = new Float32Array(nLen);
  const lp = new SweepFilter('lowpass', 1, sr);
  for (let i = 0; i < nLen; i++) {
    const t = i / sr;
    const cutoff = expRamp(6000, 400, t, 0.1);
    noise[i] =
      lp.next(rand() * 2 - 1, cutoff) * expRamp(0.9 * vol, 0.001, t, 0.12);
  }
  addAt(c.dst, c.at, noise);
  // Pitch-drop body.
  const oLen = Math.ceil(sr * 0.14);
  const osc = new Float32Array(oLen);
  let phase = 0;
  for (let i = 0; i < oLen; i++) {
    const t = i / sr;
    phase += ((2 * Math.PI) / sr) * expRamp(420, 60, t, 0.12);
    osc[i] = Math.sin(phase) * expRamp(0.5 * vol, 0.001, t, 0.14);
  }
  addAt(c.dst, c.at, osc);
}

function voiceImpact(c: VoiceCtx): void {
  const { sr, vol } = c;
  const len = Math.ceil(sr * 0.1);
  const out = new Float32Array(len);
  let phase = 0;
  for (let i = 0; i < len; i++) {
    const t = i / sr;
    phase += ((2 * Math.PI) / sr) * expRamp(180 + vol * 120, 50, t, 0.09);
    out[i] = tri(phase) * expRamp(0.4 * vol, 0.001, t, 0.1);
  }
  addAt(c.dst, c.at, out);
}

function voiceCrash(c: VoiceCtx): void {
  const { sr, vol, rand } = c;
  const len = Math.ceil(sr * 0.38);
  const out = new Float32Array(len);
  const bp = new SweepFilter('bandpass', 0.8, sr);
  for (let i = 0; i < len; i++) {
    const t = i / sr;
    out[i] =
      bp.next(rand() * 2 - 1, 1200) * expRamp(0.7 * vol, 0.001, t, 0.38);
  }
  addAt(c.dst, c.at, out);
}

function voiceWhoosh(c: VoiceCtx): void {
  const { sr, vol, rand } = c;
  const len = Math.ceil(sr * 0.5);
  const out = new Float32Array(len);
  const bp = new SweepFilter('bandpass', 1, sr);
  for (let i = 0; i < len; i++) {
    const t = i / sr;
    const cutoff =
      t < 0.25
        ? expRamp(300, 2500, t, 0.25)
        : expRamp(2500, 400, t - 0.25, 0.25);
    const gain =
      t < 0.2
        ? expRamp(0.001, 0.4 * vol, t, 0.2)
        : expRamp(0.4 * vol, 0.001, t - 0.2, 0.3);
    out[i] = bp.next(rand() * 2 - 1, cutoff) * gain;
  }
  addAt(c.dst, c.at, out);
}

function voiceSnap(c: VoiceCtx): void {
  const { sr, vol, rand } = c;
  // Bright click.
  const nLen = Math.ceil(sr * 0.05);
  const noise = new Float32Array(nLen);
  const hp = new SweepFilter('highpass', 1, sr);
  for (let i = 0; i < nLen; i++) {
    const t = i / sr;
    noise[i] =
      hp.next(rand() * 2 - 1, 2500) * expRamp(0.6 * vol, 0.001, t, 0.05);
  }
  addAt(c.dst, c.at, noise);
  // Downward twang.
  const oLen = Math.ceil(sr * 0.1);
  const osc = new Float32Array(oLen);
  let phase = 0;
  for (let i = 0; i < oLen; i++) {
    const t = i / sr;
    phase += ((2 * Math.PI) / sr) * expRamp(900, 180, t, 0.09);
    osc[i] = tri(phase) * expRamp(0.35 * vol, 0.001, t, 0.1);
  }
  addAt(c.dst, c.at, osc);
}

function voiceBlip(c: VoiceCtx, freq: number): void {
  const { sr, vol } = c;
  const len = Math.ceil(sr * 0.08);
  const out = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    const t = i / sr;
    out[i] =
      Math.sin(((2 * Math.PI * freq) / sr) * i) *
      expRamp(0.25 * vol, 0.001, t, 0.08);
  }
  addAt(c.dst, c.at, out);
}

function renderVoice(name: string, c: VoiceCtx): void {
  // NOTE: compares raw strings (no import from ../ui/sound) so the node CLI
  // typecheck never pulls DOM-typed WebAudio code into its program.
  if (name === 'pop') voicePop(c);
  else if (name === 'impact') voiceImpact(c);
  else if (name === 'crash') voiceCrash(c);
  else if (name === 'whoosh') voiceWhoosh(c);
  else if (name === 'snap') voiceSnap(c);
  else if (name === 'click') voiceBlip(c, 900);
  else voiceBlip(c, 620); // blip + unknown names, like the live synth
}

/**
 * Schedule events onto the export timeline: frame → seconds, pre-roll
 * dropped, 45ms throttle mirror. Returns start-sample offsets.
 */
export function scheduleSfx(
  events: readonly SfxEvent[],
  opts: SfxRenderOptions,
): Array<{ at: number; name: string; vol: number }> {
  const fps = Math.max(1, opts.fps);
  const indexed = events.map((e, i) => ({ e, i }));
  indexed.sort((a, b) => a.e.frame - b.e.frame || a.i - b.i);
  const out: Array<{ at: number; name: string; vol: number }> = [];
  let lastStart = -Infinity;
  for (const { e } of indexed) {
    if (!Number.isFinite(e.frame)) continue;
    const t = (e.frame - opts.recordStart) / fps;
    if (t < 0) continue;
    if (t - lastStart < SFX_MIN_GAP_SEC) continue;
    lastStart = t;
    const intensity = Number.isFinite(e.intensity) ? e.intensity : 1;
    out.push({
      at: Math.round(t * SFX_SAMPLE_RATE),
      name: typeof e.name === 'string' ? e.name : 'blip',
      vol: Math.max(0.05, Math.min(1, intensity)),
    });
  }
  return out;
}

/** Mix scheduled voices, apply volume, attenuate-only limit. */
export function mixSfx(
  scheduled: ReadonlyArray<{ at: number; name: string; vol: number }>,
  totalSamples: number,
  seed: number,
  volume: number,
): Float32Array {
  const dst = new Float32Array(Math.max(1, totalSamples));
  const rand = mulberry32(seed);
  for (const s of scheduled) {
    if (s.at >= dst.length) continue;
    renderVoice(s.name, { dst, at: s.at, sr: SFX_SAMPLE_RATE, vol: s.vol, rand });
  }
  if (volume !== 1) {
    for (let i = 0; i < dst.length; i++) dst[i] *= volume;
  }
  let peak = 0;
  for (let i = 0; i < dst.length; i++) {
    const a = Math.abs(dst[i]);
    if (a > peak) peak = a;
  }
  // Limiter only attenuates: quiet mixes keep live-synth levels.
  if (peak > 1) {
    const g = 0.89 / peak;
    for (let i = 0; i < dst.length; i++) dst[i] *= g;
  }
  return dst;
}

/** Encode mono 16-bit PCM WAV. */
export function encodeWav(samples: Float32Array, sampleRate: number): Uint8Array {
  const n = samples.length;
  const buf = new Uint8Array(44 + n * 2);
  const v = new DataView(buf.buffer);
  const ascii = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i));
  };
  ascii(0, 'RIFF');
  v.setUint32(4, 36 + n * 2, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true); // byte rate
  v.setUint16(32, 2, true); // block align
  v.setUint16(34, 16, true); // bits
  ascii(36, 'data');
  v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(44 + i * 2, Math.round(s * 32767), true);
  }
  return buf;
}

/**
 * Render the full SFX track: schedule → mix → WAV bytes.
 * Deterministic in (events, seed, options).
 */
export function renderSfxWav(
  events: readonly SfxEvent[],
  opts: SfxRenderOptions,
): Uint8Array {
  const fps = Math.max(1, opts.fps);
  const videoDur = Math.max(0, opts.durationFrames / fps);
  const scheduled = scheduleSfx(events, opts);
  let totalDur = videoDur;
  for (const s of scheduled) {
    totalDur = Math.max(totalDur, s.at / SFX_SAMPLE_RATE + 0.6);
  }
  const totalSamples = Math.max(1, Math.ceil(totalDur * SFX_SAMPLE_RATE));
  const volume = Number.isFinite(opts.volume ?? 1) ? (opts.volume ?? 1) : 1;
  const mix = mixSfx(scheduled, totalSamples, opts.seed >>> 0, volume);
  return encodeWav(mix, SFX_SAMPLE_RATE);
}

/** FFmpeg second-pass mux args (mirrors the main pipe's conventions). */
export function buildMuxArgs(
  videoPath: string,
  wavPath: string,
  outPath: string,
): string[] {
  return [
    '-y',
    '-hide_banner',
    '-loglevel',
    'error',
    '-i',
    videoPath,
    '-i',
    wavPath,
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
    outPath,
  ];
}
