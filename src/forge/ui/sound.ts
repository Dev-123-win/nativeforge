/**
 * Tiny WebAudio synth for event sounds — real audible feedback with zero
 * assets. Throttled by the caller; safe to call before user gesture
 * (context resumes lazily and calls no-op until then).
 */

let ctx: AudioContext | null = null;
let lastPlay = 0;

function ac(): AudioContext | null {
  try {
    if (!ctx) {
      const AC = window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
    }
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx.state === 'running' ? ctx : null;
  } catch {
    return null;
  }
}

function noiseBuffer(c: AudioContext, seconds: number): AudioBuffer {
  const buf = c.createBuffer(1, Math.ceil(c.sampleRate * seconds), c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

export type SynthName = 'pop' | 'impact' | 'crash' | 'blip' | 'click' | 'whoosh';

export function playSynth(name: string, intensity = 1): void {
  const now = performance.now();
  if (now - lastPlay < 45) return; // global throttle
  lastPlay = now;
  const c = ac();
  if (!c) return;
  const t = c.currentTime;
  const vol = Math.max(0.05, Math.min(1, intensity));

  if (name === 'pop') {
    // Balloon pop: short noise burst + pitch drop.
    const src = c.createBufferSource();
    src.buffer = noiseBuffer(c, 0.12);
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(6000, t);
    f.frequency.exponentialRampToValueAtTime(400, t + 0.1);
    const g = c.createGain();
    g.gain.setValueAtTime(0.9 * vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    src.connect(f).connect(g).connect(c.destination);
    src.start(t);
    const osc = c.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(420, t);
    osc.frequency.exponentialRampToValueAtTime(60, t + 0.12);
    const g2 = c.createGain();
    g2.gain.setValueAtTime(0.5 * vol, t);
    g2.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
    osc.connect(g2).connect(c.destination);
    osc.start(t);
    osc.stop(t + 0.15);
  } else if (name === 'impact') {
    const osc = c.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(180 + vol * 120, t);
    osc.frequency.exponentialRampToValueAtTime(50, t + 0.09);
    const g = c.createGain();
    g.gain.setValueAtTime(0.4 * vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
    osc.connect(g).connect(c.destination);
    osc.start(t);
    osc.stop(t + 0.11);
  } else if (name === 'crash') {
    const src = c.createBufferSource();
    src.buffer = noiseBuffer(c, 0.4);
    const f = c.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.setValueAtTime(1200, t);
    f.Q.value = 0.8;
    const g = c.createGain();
    g.gain.setValueAtTime(0.7 * vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.38);
    src.connect(f).connect(g).connect(c.destination);
    src.start(t);
  } else if (name === 'whoosh') {
    const src = c.createBufferSource();
    src.buffer = noiseBuffer(c, 0.5);
    const f = c.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.setValueAtTime(300, t);
    f.frequency.exponentialRampToValueAtTime(2500, t + 0.25);
    f.frequency.exponentialRampToValueAtTime(400, t + 0.5);
    const g = c.createGain();
    g.gain.setValueAtTime(0.001, t);
    g.gain.exponentialRampToValueAtTime(0.4 * vol, t + 0.2);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
    src.connect(f).connect(g).connect(c.destination);
    src.start(t);
  } else {
    // blip / click / default
    const osc = c.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(name === 'click' ? 900 : 620, t);
    const g = c.createGain();
    g.gain.setValueAtTime(0.25 * vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
    osc.connect(g).connect(c.destination);
    osc.start(t);
    osc.stop(t + 0.09);
  }
}
