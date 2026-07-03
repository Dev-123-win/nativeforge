import { useCallback, useRef } from 'react';

// Setup module-level singleton AudioContext and master nodes to avoid duplicates
let globalCtx: AudioContext | null = null;
let globalMaster: GainNode | null = null;
let globalReverb: ConvolverNode | null = null;
let globalNoiseBuffer: AudioBuffer | null = null;
let globalMuted = false;

// Initialize the synthesizer on demand (safely skips in Node/headless build envs)
function initAudio() {
  if (typeof window === 'undefined') return;
  if (globalCtx) return;

  try {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextClass) return;

    globalCtx = new AudioContextClass();
    
    // Master bus
    globalMaster = globalCtx.createGain();
    globalMaster.gain.value = 0.8;

    // Master compressor to prevent clipping
    const comp = globalCtx.createDynamicsCompressor();
    comp.threshold.value = -12;
    comp.knee.value = 6;
    comp.ratio.value = 4;
    comp.attack.value = 0.003;
    comp.release.value = 0.15;

    globalMaster.connect(comp);
    comp.connect(globalCtx.destination);

    // Reverb impulse generator (ambient tail)
    const len = globalCtx.sampleRate * 1.4;
    const ir = globalCtx.createBuffer(2, len, globalCtx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.0); // exponential decay noise
      }
    }
    globalReverb = globalCtx.createConvolver();
    globalReverb.buffer = ir;

    const reverbGain = globalCtx.createGain();
    reverbGain.gain.value = 0.18;
    globalReverb.connect(reverbGain);
    reverbGain.connect(globalMaster);

    // Reusable noise buffer
    globalNoiseBuffer = globalCtx.createBuffer(1, globalCtx.sampleRate * 2, globalCtx.sampleRate);
    const nd = globalNoiseBuffer.getChannelData(0);
    for (let i = 0; i < nd.length; i++) {
      nd[i] = Math.random() * 2 - 1;
    }

    // Auto resume on click (autoplay workaround)
    const resume = () => {
      if (globalCtx && globalCtx.state === 'suspended') {
        globalCtx.resume();
      }
    };
    window.addEventListener('pointerdown', resume, { once: true });
    window.addEventListener('keydown', resume, { once: true });

    // Pre-mute if prefers-reduced-motion is on
    globalMuted = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch (err) {
    console.warn('[MotionFlow] Web Audio API failed to initialize:', err);
  }
}

// Micro-randomization helpers
function jitter(base: number, cents = 12) {
  return base * Math.pow(2, (Math.random() * 2 - 1) * cents / 1200);
}

function makeDistortionCurve(amount = 50) {
  const n = 256;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i * 2) / n - 1;
    curve[i] = ((Math.PI + amount) * x) / (Math.PI + amount * Math.abs(x));
  }
  return curve;
}

/**
 * useSFX hook. Synthesizes premium sound effects using Web Audio API in the browser.
 * Safe for server-side evaluation/Node environment.
 */
export function useSFX() {
  const getAudio = useCallback(() => {
    initAudio();
    if (!globalCtx || globalMuted) return null;
    if (globalCtx.state === 'suspended') {
      globalCtx.resume();
    }
    return {
      ctx: globalCtx,
      master: globalMaster!,
      reverb: globalReverb!,
      noiseBuffer: globalNoiseBuffer!
    };
  }, []);

  const click = useCallback((options?: { pan?: number }) => {
    const audio = getAudio();
    if (!audio) return;
    const { ctx, master } = audio;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    const p = ctx.createStereoPanner();

    o.type = 'sine';
    o.frequency.setValueAtTime(jitter(900, 20), t);
    o.frequency.exponentialRampToValueAtTime(jitter(300, 10), t + 0.04);
    
    g.gain.setValueAtTime(0.18, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.04);

    p.pan.value = options?.pan ?? 0;

    o.connect(g);
    g.connect(p);
    p.connect(master);

    o.start(t);
    o.stop(t + 0.045);
    o.onended = () => { o.disconnect(); g.disconnect(); p.disconnect(); };
  }, [getAudio]);

  const hover = useCallback(() => {
    const audio = getAudio();
    if (!audio) return;
    const { ctx, master } = audio;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    const g = ctx.createGain();

    o.type = 'sine';
    o.frequency.setValueAtTime(jitter(1800, 15), t);
    o.frequency.linearRampToValueAtTime(jitter(2200, 15), t + 0.06);

    g.gain.setValueAtTime(0.03, t);
    g.gain.linearRampToValueAtTime(0.06, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.06);

    o.connect(g);
    g.connect(master);

    o.start(t);
    o.stop(t + 0.065);
    o.onended = () => { o.disconnect(); g.disconnect(); };
  }, [getAudio]);

  const whoosh = useCallback((options?: { pan?: number; direction?: 'left' | 'right' | 'center'; duration?: number }) => {
    const audio = getAudio();
    if (!audio) return;
    const { ctx, master } = audio;
    const t = ctx.currentTime;
    const duration = options?.duration ?? 0.22;
    const direction = options?.direction ?? 'right';
    let panVal = options?.pan ?? 0;
    if (panVal === 0) {
      panVal = direction === 'right' ? -0.5 : direction === 'left' ? 0.5 : 0;
    }

    // Noise body
    const src = ctx.createBufferSource();
    src.buffer = audio.noiseBuffer;
    const filt = ctx.createBiquadFilter();
    filt.type = 'bandpass';
    filt.frequency.setValueAtTime(direction === 'right' ? 300 : 3000, t);
    filt.frequency.exponentialRampToValueAtTime(direction === 'right' ? 5000 : 200, t + duration);
    filt.Q.value = 1.8;

    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.35, t + duration * 0.2);
    g.gain.exponentialRampToValueAtTime(0.001, t + duration);

    const p = ctx.createStereoPanner();
    p.pan.setValueAtTime(panVal, t);
    p.pan.linearRampToValueAtTime(-panVal, t + duration);

    src.connect(filt);
    filt.connect(g);
    g.connect(p);
    p.connect(master);
    src.start(t);
    src.stop(t + duration + 0.01);

    // Sub-bass weight
    const sub = ctx.createOscillator();
    const subG = ctx.createGain();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(80, t);
    sub.frequency.exponentialRampToValueAtTime(40, t + duration);

    subG.gain.setValueAtTime(0.12, t);
    subG.gain.exponentialRampToValueAtTime(0.001, t + duration);

    sub.connect(subG);
    subG.connect(master);
    sub.start(t);
    sub.stop(t + duration + 0.01);
  }, [getAudio]);

  const impact = useCallback((options?: { pan?: number; intensity?: number }) => {
    const audio = getAudio();
    if (!audio) return;
    const { ctx, master, reverb } = audio;
    const t = ctx.currentTime;
    const intensity = options?.intensity ?? 1.0;
    const pan = options?.pan ?? 0;

    // Sub thump
    const sub = ctx.createOscillator();
    const subG = ctx.createGain();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(140 * intensity, t);
    sub.frequency.exponentialRampToValueAtTime(28, t + 0.35);

    subG.gain.setValueAtTime(0.7 * intensity, t);
    subG.gain.exponentialRampToValueAtTime(0.001, t + 0.35);

    sub.connect(subG);
    subG.connect(master);
    sub.start(t);
    sub.stop(t + 0.36);

    // Mid click transient
    const clickNode = ctx.createOscillator();
    const clickG = ctx.createGain();
    clickNode.type = 'triangle';
    clickNode.frequency.setValueAtTime(400, t);
    clickNode.frequency.exponentialRampToValueAtTime(80, t + 0.06);

    clickG.gain.setValueAtTime(0.4 * intensity, t);
    clickG.gain.exponentialRampToValueAtTime(0.001, t + 0.06);

    clickNode.connect(clickG);
    clickG.connect(master);
    clickNode.start(t);
    clickNode.stop(t + 0.065);

    // Noise splash
    const ns = ctx.createBufferSource();
    ns.buffer = audio.noiseBuffer;
    const nf = ctx.createBiquadFilter();
    nf.type = 'highpass';
    nf.frequency.value = 1200;
    
    const ng = ctx.createGain();
    const np = ctx.createStereoPanner();
    np.pan.value = pan;

    ng.gain.setValueAtTime(0.22 * intensity, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.12);

    ns.connect(nf);
    nf.connect(ng);
    ng.connect(np);
    np.connect(master);

    // Send to reverb for space
    ng.connect(reverb);

    ns.start(t);
    ns.stop(t + 0.13);
  }, [getAudio]);

  const success = useCallback(() => {
    const audio = getAudio();
    if (!audio) return;
    const { ctx, master } = audio;

    // Ascending harmonic triad
    [[523.25, 0], [659.25, 0.07], [783.99, 0.13]].forEach(([freq, delay]) => {
      const t = ctx.currentTime + delay;
      const o = ctx.createOscillator();
      const g = ctx.createGain();

      o.type = 'sine';
      o.frequency.setValueAtTime(jitter(freq, 5), t);
      o.frequency.linearRampToValueAtTime(jitter(freq * 1.003, 3), t + 0.18);

      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.22, t + 0.018);
      g.gain.setValueAtTime(0.22, t + 0.06);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.28);

      o.connect(g);
      g.connect(master);
      o.start(t);
      o.stop(t + 0.3);
      o.onended = () => { o.disconnect(); g.disconnect(); };

      // Subtle shimmer overtone
      const sh = ctx.createOscillator();
      const shG = ctx.createGain();
      sh.type = 'sine';
      sh.frequency.value = freq * 2;

      shG.gain.setValueAtTime(0.04, t + 0.018);
      shG.gain.exponentialRampToValueAtTime(0.001, t + 0.22);

      sh.connect(shG);
      shG.connect(master);
      sh.start(t + 0.018);
      sh.stop(t + 0.23);
    });
  }, [getAudio]);

  const error = useCallback(() => {
    const audio = getAudio();
    if (!audio) return;
    const { ctx, master } = audio;

    [[280, 0], [210, 0.10]].forEach(([freq, delay]) => {
      const t = ctx.currentTime + delay;
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      const ws = ctx.createWaveShaper();

      o.type = 'sawtooth';
      ws.curve = makeDistortionCurve(20);
      o.frequency.value = jitter(freq, 8);

      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.18, t + 0.01);
      g.gain.setValueAtTime(0.18, t + 0.07);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.14);

      o.connect(ws);
      ws.connect(g);
      g.connect(master);
      o.start(t);
      o.stop(t + 0.15);
    });
  }, [getAudio]);

  const tick = useCallback((options?: { pan?: number; index?: number }) => {
    const audio = getAudio();
    if (!audio) return;
    const { ctx, master } = audio;
    const t = ctx.currentTime;
    const index = options?.index ?? 0;
    const pan = options?.pan ?? 0;

    // Alternate pitch slightly per character for natural rhythm
    const freq = jitter(index % 2 === 0 ? 1100 : 980, 18);
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    const p = ctx.createStereoPanner();

    o.type = 'square';
    o.frequency.setValueAtTime(freq, t);
    o.frequency.exponentialRampToValueAtTime(freq * 0.6, t + 0.025);

    g.gain.setValueAtTime(0.06, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.025);
    p.pan.value = pan;

    o.connect(g);
    g.connect(p);
    p.connect(master);

    o.start(t);
    o.stop(t + 0.03);
    o.onended = () => { o.disconnect(); g.disconnect(); p.disconnect(); };
  }, [getAudio]);

  const scrambleTick = useCallback(() => {
    const audio = getAudio();
    if (!audio) return;
    const { ctx, master } = audio;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    const g = ctx.createGain();

    o.type = 'square';
    o.frequency.value = jitter(1400, 60);

    g.gain.setValueAtTime(0.04, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.018);

    o.connect(g);
    g.connect(master);

    o.start(t);
    o.stop(t + 0.02);
    o.onended = () => { o.disconnect(); g.disconnect(); };
  }, [getAudio]);

  const scrambleResolve = useCallback(() => {
    const audio = getAudio();
    if (!audio) return;
    const { ctx, master } = audio;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    const g = ctx.createGain();

    o.type = 'sine';
    o.frequency.setValueAtTime(jitter(2200, 10), t);
    o.frequency.exponentialRampToValueAtTime(jitter(1600, 5), t + 0.08);

    g.gain.setValueAtTime(0.12, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.1);

    o.connect(g);
    g.connect(master);

    o.start(t);
    o.stop(t + 0.11);
  }, [getAudio]);

  const numberTick = useCallback(() => {
    const audio = getAudio();
    if (!audio) return;
    const { ctx, master } = audio;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    const g = ctx.createGain();

    o.type = 'sine';
    o.frequency.setValueAtTime(jitter(520, 25), t);
    o.frequency.linearRampToValueAtTime(jitter(440, 15), t + 0.035);

    g.gain.setValueAtTime(0.07, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.04);

    o.connect(g);
    g.connect(master);

    o.start(t);
    o.stop(t + 0.045);
  }, [getAudio]);

  const numberLand = useCallback(() => {
    const audio = getAudio();
    if (!audio) return;
    const { ctx, master } = audio;
    const t = ctx.currentTime;

    [[880, 0], [1108, 0.05]].forEach(([freq, delay]) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sine';
      o.frequency.value = freq;

      g.gain.setValueAtTime(0.14, t + delay);
      g.gain.exponentialRampToValueAtTime(0.001, t + delay + 0.2);

      o.connect(g);
      g.connect(master);
      o.start(t + delay);
      o.stop(t + delay + 0.21);
    });
  }, [getAudio]);

  const strokeDraw = useCallback((options?: { pan?: number; duration?: number }) => {
    const audio = getAudio();
    if (!audio) return;
    const { ctx, master } = audio;
    const t = ctx.currentTime;
    const duration = options?.duration ?? 1.0;
    const pan = options?.pan ?? 0;

    const src = ctx.createBufferSource();
    src.buffer = audio.noiseBuffer;
    src.loop = true;

    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.setValueAtTime(3000, t);
    f.frequency.linearRampToValueAtTime(6000, t + duration);
    f.Q.value = 4;

    const g = ctx.createGain();
    const p = ctx.createStereoPanner();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.08, t + 0.05);
    g.gain.setValueAtTime(0.08, t + duration - 0.05);
    g.gain.linearRampToValueAtTime(0, t + duration);
    p.pan.value = pan;

    src.connect(f);
    f.connect(g);
    g.connect(p);
    p.connect(master);

    src.start(t);
    src.stop(t + duration + 0.01);
  }, [getAudio]);

  const strokeSnap = useCallback(() => {
    const audio = getAudio();
    if (!audio) return;
    const { ctx, master } = audio;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    const g = ctx.createGain();

    o.type = 'sine';
    o.frequency.setValueAtTime(jitter(2600, 10), t);
    o.frequency.exponentialRampToValueAtTime(800, t + 0.045);

    g.gain.setValueAtTime(0.13, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.05);

    o.connect(g);
    g.connect(master);

    o.start(t);
    o.stop(t + 0.055);
  }, [getAudio]);

  const morph = useCallback((options?: { pan?: number; duration?: number }) => {
    const audio = getAudio();
    if (!audio) return;
    const { ctx, master } = audio;
    const t = ctx.currentTime;
    const duration = options?.duration ?? 0.4;
    const pan = options?.pan ?? 0;

    const mod = ctx.createOscillator();
    const modG = ctx.createGain();
    const carrier = ctx.createOscillator();
    const g = ctx.createGain();
    const p = ctx.createStereoPanner();

    mod.frequency.setValueAtTime(4, t);
    mod.frequency.linearRampToValueAtTime(12, t + duration * 0.5);
    mod.frequency.linearRampToValueAtTime(2, t + duration);

    modG.gain.setValueAtTime(80, t);
    modG.gain.linearRampToValueAtTime(200, t + duration * 0.5);
    modG.gain.linearRampToValueAtTime(30, t + duration);

    carrier.type = 'sine';
    carrier.frequency.setValueAtTime(180, t);
    carrier.frequency.linearRampToValueAtTime(jitter(220, 10), t + duration);

    g.gain.setValueAtTime(0.12, t);
    g.gain.linearRampToValueAtTime(0.10, t + duration - 0.05);
    g.gain.exponentialRampToValueAtTime(0.001, t + duration);

    p.pan.value = pan;

    mod.connect(modG);
    modG.connect(carrier.frequency);
    carrier.connect(g);
    g.connect(p);
    p.connect(master);

    mod.start(t);
    carrier.start(t);
    mod.stop(t + duration + 0.01);
    carrier.stop(t + duration + 0.01);
  }, [getAudio]);

  const morphSettle = useCallback(() => {
    const audio = getAudio();
    if (!audio) return;
    const { ctx, master } = audio;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    const g = ctx.createGain();

    o.type = 'sine';
    o.frequency.setValueAtTime(160, t);
    o.frequency.exponentialRampToValueAtTime(60, t + 0.1);

    g.gain.setValueAtTime(0.2, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);

    o.connect(g);
    g.connect(master);

    o.start(t);
    o.stop(t + 0.13);
  }, [getAudio]);

  const modalOpen = useCallback(() => {
    const audio = getAudio();
    if (!audio) return;
    const { ctx, master, reverb } = audio;
    const t = ctx.currentTime;

    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(jitter(180, 8), t);
    o.frequency.exponentialRampToValueAtTime(jitter(540, 8), t + 0.18);

    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.18, t + 0.04);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.22);

    o.connect(g);
    g.connect(master);
    o.start(t);
    o.stop(t + 0.23);

    // Glass resonance
    const gl = ctx.createOscillator();
    const glG = ctx.createGain();
    gl.type = 'sine';
    gl.frequency.value = jitter(1320, 12);

    glG.gain.setValueAtTime(0.04, t + 0.06);
    glG.gain.exponentialRampToValueAtTime(0.001, t + 0.28);

    gl.connect(glG);
    glG.connect(reverb);
    glG.connect(master);
    gl.start(t + 0.06);
    gl.stop(t + 0.3);
  }, [getAudio]);

  const modalClose = useCallback(() => {
    const audio = getAudio();
    if (!audio) return;
    const { ctx, master } = audio;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    const g = ctx.createGain();

    o.type = 'sine';
    o.frequency.setValueAtTime(jitter(440, 8), t);
    o.frequency.exponentialRampToValueAtTime(jitter(160, 6), t + 0.15);

    g.gain.setValueAtTime(0.14, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);

    o.connect(g);
    g.connect(master);
    o.start(t);
    o.stop(t + 0.19);
  }, [getAudio]);

  const spring = useCallback((options?: { pan?: number; stiffness?: number }) => {
    const audio = getAudio();
    if (!audio) return;
    const { ctx, master } = audio;
    const t = ctx.currentTime;
    const stiffness = options?.stiffness ?? 1.0;
    const pan = options?.pan ?? 0;

    const o = ctx.createOscillator();
    const g = ctx.createGain();
    const p = ctx.createStereoPanner();

    const baseFreq = jitter(320 * stiffness, 12);
    o.type = 'sine';
    o.frequency.setValueAtTime(baseFreq * 1.6, t);
    o.frequency.setValueAtTime(baseFreq * 0.7, t + 0.06);
    o.frequency.setValueAtTime(baseFreq * 1.2, t + 0.12);
    o.frequency.setValueAtTime(baseFreq * 0.9, t + 0.18);
    o.frequency.setValueAtTime(baseFreq, t + 0.22);

    g.gain.setValueAtTime(0.16 * stiffness, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.28);
    p.pan.value = pan;

    o.connect(g);
    g.connect(p);
    p.connect(master);

    o.start(t);
    o.stop(t + 0.3);
  }, [getAudio]);

  const glitch = useCallback((options?: { pan?: number }) => {
    const audio = getAudio();
    if (!audio) return;
    const { ctx, master } = audio;
    const t = ctx.currentTime;
    const pan = options?.pan ?? 0;

    for (let i = 0; i < 6; i++) {
      const onset = t + i * jitter(0.014, 30);
      const o = ctx.createOscillator();
      const ws = ctx.createWaveShaper();
      const g = ctx.createGain();
      const p = ctx.createStereoPanner();

      o.type = i % 2 === 0 ? 'sawtooth' : 'square';
      o.frequency.value = jitter(800 + i * 300, 40);
      ws.curve = makeDistortionCurve(80);

      g.gain.setValueAtTime(0.12, onset);
      g.gain.exponentialRampToValueAtTime(0.001, onset + 0.012);
      p.pan.value = pan;

      o.connect(ws);
      ws.connect(g);
      g.connect(p);
      p.connect(master);

      o.start(onset);
      o.stop(onset + 0.014);
      o.onended = () => { o.disconnect(); ws.disconnect(); g.disconnect(); p.disconnect(); };
    }
  }, [getAudio]);

  const glitchResolve = useCallback(() => {
    const audio = getAudio();
    if (!audio) return;
    const { ctx, master } = audio;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    const g = ctx.createGain();

    o.type = 'sine';
    o.frequency.setValueAtTime(jitter(1760, 8), t);

    g.gain.setValueAtTime(0.1, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);

    o.connect(g);
    g.connect(master);

    o.start(t);
    o.stop(t + 0.13);
  }, [getAudio]);

  const particleBurst = useCallback(() => {
    const audio = getAudio();
    if (!audio) return;
    const { ctx, master } = audio;
    const t = ctx.currentTime;

    const src = ctx.createBufferSource();
    src.buffer = audio.noiseBuffer;
    const f = ctx.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = 3500;

    const g = ctx.createGain();
    g.gain.setValueAtTime(0.28, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.09);

    src.connect(f);
    f.connect(g);
    g.connect(master);
    src.start(t);
    src.stop(t + 0.1);

    [0, 0.03, 0.06, 0.09].forEach((delay, i) => {
      const o = ctx.createOscillator();
      const og = ctx.createGain();
      o.type = 'sine';
      o.frequency.value = jitter(2200 + i * 400, 30);

      og.gain.setValueAtTime(0.06, t + delay);
      og.gain.exponentialRampToValueAtTime(0.001, t + delay + 0.12);

      o.connect(og);
      og.connect(master);
      o.start(t + delay);
      o.stop(t + delay + 0.13);
    });
  }, [getAudio]);

  const scaleUp = useCallback((options?: { pan?: number; magnitude?: number }) => {
    const audio = getAudio();
    if (!audio) return;
    const { ctx, master } = audio;
    const t = ctx.currentTime;
    const magnitude = options?.magnitude ?? 1.0;
    const pan = options?.pan ?? 0;

    const o = ctx.createOscillator();
    const g = ctx.createGain();
    const p = ctx.createStereoPanner();

    o.type = 'sine';
    o.frequency.setValueAtTime(jitter(200, 8), t);
    o.frequency.exponentialRampToValueAtTime(jitter(200 + 400 * magnitude, 8), t + 0.16 * magnitude);

    g.gain.setValueAtTime(0.08 * magnitude, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.18 * magnitude);
    p.pan.value = pan;

    o.connect(g);
    g.connect(p);
    p.connect(master);

    o.start(t);
    o.stop(t + 0.2 * magnitude);
  }, [getAudio]);

  const scaleDown = useCallback((options?: { pan?: number; magnitude?: number }) => {
    const audio = getAudio();
    if (!audio) return;
    const { ctx, master } = audio;
    const t = ctx.currentTime;
    const magnitude = options?.magnitude ?? 1.0;
    const pan = options?.pan ?? 0;

    const o = ctx.createOscillator();
    const g = ctx.createGain();
    const p = ctx.createStereoPanner();

    o.type = 'sine';
    o.frequency.setValueAtTime(jitter(500 + 200 * magnitude, 8), t);
    o.frequency.exponentialRampToValueAtTime(jitter(180, 6), t + 0.14 * magnitude);

    g.gain.setValueAtTime(0.08 * magnitude, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.16 * magnitude);
    p.pan.value = pan;

    o.connect(g);
    g.connect(p);
    p.connect(master);

    o.start(t);
    o.stop(t + 0.18 * magnitude);
  }, [getAudio]);

  const cardFlip = useCallback(() => {
    const audio = getAudio();
    if (!audio) return;
    const { ctx, master } = audio;
    const t = ctx.currentTime;

    const src = ctx.createBufferSource();
    src.buffer = audio.noiseBuffer;
    
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.setValueAtTime(600, t);
    f.frequency.linearRampToValueAtTime(1800, t + 0.05);
    f.frequency.linearRampToValueAtTime(600, t + 0.1);
    f.Q.value = 3;

    const g = ctx.createGain();
    g.gain.setValueAtTime(0.14, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);

    src.connect(f);
    f.connect(g);
    g.connect(master);
    src.start(t);
    src.stop(t + 0.13);
  }, [getAudio]);

  const focusPull = useCallback((options?: { duration?: number }) => {
    const audio = getAudio();
    if (!audio) return;
    const { ctx, master } = audio;
    const t = ctx.currentTime;
    const duration = options?.duration ?? 0.3;

    const o = ctx.createOscillator();
    const g = ctx.createGain();
    const f = ctx.createBiquadFilter();

    f.type = 'lowpass';
    f.frequency.setValueAtTime(200, t);
    f.frequency.linearRampToValueAtTime(4000, t + duration);

    o.type = 'sine';
    o.frequency.value = jitter(60, 5);

    g.gain.setValueAtTime(0.06, t);
    g.gain.setValueAtTime(0.06, t + duration - 0.04);
    g.gain.exponentialRampToValueAtTime(0.001, t + duration);

    o.connect(f);
    f.connect(g);
    g.connect(master);

    o.start(t);
    o.stop(t + duration + 0.01);
  }, [getAudio]);

  const loadingPulse = useCallback((options?: { bpm?: number }) => {
    const audio = getAudio();
    if (!audio) return () => {};
    const { ctx, master } = audio;
    const bpm = options?.bpm ?? 120;
    
    let running = true;
    const interval = (60 / bpm) * 1000;
    const tickCall = () => {
      if (!running) return;
      const t = ctx.currentTime;
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sine';
      o.frequency.value = jitter(440, 5);
      g.gain.setValueAtTime(0.04, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
      o.connect(g);
      g.connect(master);
      o.start(t);
      o.stop(t + 0.09);
      setTimeout(tickCall, interval);
    };
    tickCall();
    return () => { running = false; };
  }, [getAudio]);

  const ambient = useCallback((options?: { rootFreq?: number }) => {
    const audio = getAudio();
    if (!audio) return () => {};
    const { ctx, master } = audio;
    const rootFreq = options?.rootFreq ?? 60;

    const drones = [1, 1.5, 2, 2.67].map(ratio => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      const lfo = ctx.createOscillator();
      const lfoG = ctx.createGain();

      o.type = 'sine';
      o.frequency.value = jitter(rootFreq * ratio, 2);
      lfo.frequency.value = jitter(0.1 + ratio * 0.05, 20);
      lfoG.gain.value = jitter(2, 30);
      g.gain.value = 0;

      lfo.connect(lfoG);
      lfoG.connect(o.frequency);
      o.connect(g);
      g.connect(master);

      o.start();
      lfo.start();
      const t = ctx.currentTime;
      g.gain.linearRampToValueAtTime(0.025 / ratio, t + 2.5);
      return { o, g, lfo };
    });

    return () => {
      const t = ctx.currentTime;
      drones.forEach(({ o, g, lfo }) => {
        g.gain.linearRampToValueAtTime(0, t + 1.5);
        o.stop(t + 1.6);
        lfo.stop(t + 1.6);
      });
    };
  }, [getAudio]);

  const reveal = useCallback(() => {
    const audio = getAudio();
    if (!audio) return;
    const { ctx, master, reverb } = audio;

    whoosh({ direction: 'center', duration: 0.3 });
    
    setTimeout(() => {
      impact({ intensity: 0.7 });
    }, 120);

    setTimeout(() => {
      const t = ctx.currentTime;
      const o = ctx.createOscillator();
      const g = ctx.createGain();

      o.type = 'sine';
      o.frequency.setValueAtTime(jitter(1320, 6), t);
      g.gain.setValueAtTime(0.08, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.6);

      o.connect(g);
      g.connect(reverb);
      g.connect(master);
      o.start(t);
      o.stop(t + 0.65);
    }, 180);
  }, [getAudio, whoosh, impact]);

  const celebration = useCallback((options?: { pan?: number }) => {
    const audio = getAudio();
    if (!audio) return;
    const { ctx, master } = audio;
    const pan = options?.pan ?? 0;

    particleBurst();
    
    setTimeout(() => {
      success();
    }, 80);

    [200, 340, 480].forEach(delay => {
      setTimeout(() => {
        const t = ctx.currentTime;
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        const p = ctx.createStereoPanner();

        o.type = 'sine';
        o.frequency.value = jitter(1760 + delay * 2, 20);
        g.gain.setValueAtTime(0.08, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
        p.pan.value = pan;

        o.connect(g);
        g.connect(p);
        p.connect(master);

        o.start(t);
        o.stop(t + 0.16);
      }, delay);
    });
  }, [getAudio, particleBurst, success]);

  const iconMorph = useCallback(() => {
    const audio = getAudio();
    if (!audio) return;
    const { ctx, master } = audio;
    const t = ctx.currentTime;

    const mod = ctx.createOscillator();
    const modGain = ctx.createGain();
    const carrier = ctx.createOscillator();
    const g = ctx.createGain();

    mod.frequency.value = jitter(6, 20);
    modGain.gain.value = 100;
    carrier.frequency.value = jitter(320, 10);
    g.gain.setValueAtTime(0.09, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.1);

    mod.connect(modGain);
    modGain.connect(carrier.frequency);
    carrier.connect(g);
    g.connect(master);

    mod.start(t);
    carrier.start(t);
    mod.stop(t + 0.11);
    carrier.stop(t + 0.11);
  }, [getAudio]);

  const wordReveal = useCallback((options?: { pan?: number; wordIndex?: number }) => {
    const audio = getAudio();
    if (!audio) return;
    const { ctx, master } = audio;
    const t = ctx.currentTime;
    const wordIndex = options?.wordIndex ?? 0;
    const pan = options?.pan ?? 0;

    const src = ctx.createBufferSource();
    src.buffer = audio.noiseBuffer;

    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = jitter(1200 + wordIndex * 80, 15);
    f.Q.value = 5;

    const g = ctx.createGain();
    const p = ctx.createStereoPanner();

    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.055, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
    p.pan.value = pan;

    src.connect(f);
    f.connect(g);
    g.connect(p);
    p.connect(master);

    src.start(t);
    src.stop(t + 0.11);
  }, [getAudio]);

  return {
    click,
    hover,
    whoosh,
    impact,
    success,
    error,
    tick,
    scrambleTick,
    scrambleResolve,
    numberTick,
    numberLand,
    strokeDraw,
    strokeSnap,
    morph,
    morphSettle,
    modalOpen,
    modalClose,
    spring,
    glitch,
    glitchResolve,
    particleBurst,
    scaleUp,
    scaleDown,
    cardFlip,
    focusPull,
    loadingPulse,
    ambient,
    reveal,
    celebration,
    iconMorph,
    wordReveal,
  };
}

export type SFXEngine = ReturnType<typeof useSFX>;
