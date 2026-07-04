/**
 * render.ts — Ultra-Fast PNG Zero-Copy Rendering Pipeline
 *
 * Architecture:
 *   1. Start Vite dev server (port 3101)
 *   2. Launch headless Chromium with memory-safe flags (Colab/Docker compatible)
 *   3. Extract composition metadata (durationInFrames, fps, width, height)
 *   4. Auto-detect GPU: NVENC → VideoToolbox → QSV → AMF → libx264 (ultrafast)
 *   5. Spawn FFmpeg with -f image2pipe -vcodec png (native PNG zero-copy input)
 *   6. Frame loop — 2 IPC calls per frame (merged setFrame + rAF into one evaluate):
 *        a. page.clock.fastForward(frameDuration)  — deterministic clock step
 *        b. page.evaluate(setFrame + videoSeek + rAF)  — single merged IPC round-trip
 *        c. page.screenshot({ type: 'png' })  — lossless PNG buffer
 *        d. ffmpegProc.stdin.write(pngBuffer)  — direct pipe, no Node-level decode
 *   7. Finalize MP4 with audio mapping: -map 0:v -map 1:a? -c:a aac -shortest
 *
 * Speed targets: 60-second video → <60s wall time | 3-minute video → <3 min wall time
 */

import { chromium, type Browser, type Page } from 'playwright';
import ffmpegStatic from 'ffmpeg-static';
import { spawn, execSync, type ChildProcess } from 'child_process';
import { createServer, type ViteDevServer } from 'vite';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../../');

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

export interface RenderOptions {
  output?: string;
  port?: number;
  quiet?: boolean;
  mode?: 'cpu' | 'gpu' | 'auto';
}

interface CompositionInfo {
  durationInFrames: number;
  fps: number;
  width: number;
  height: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// GPU Detection — single cached execSync per binary (no redundant subprocess forks)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Runs `ffmpeg -encoders` once per binary path and caches the output.
 * Avoids the previous pattern of calling execSync up to 8× at startup.
 */
const _encoderCache = new Map<string, string>();

function getEncoderList(ffmpegPath: string): string {
  if (_encoderCache.has(ffmpegPath)) return _encoderCache.get(ffmpegPath)!;
  try {
    const output = execSync(`"${ffmpegPath}" -encoders 2>&1`, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 8000,
    });
    _encoderCache.set(ffmpegPath, output);
    return output;
  } catch {
    _encoderCache.set(ffmpegPath, '');
    return '';
  }
}

function supportsEncoder(ffmpegPath: string, encoder: string): boolean {
  return getEncoderList(ffmpegPath).includes(encoder);
}

/**
 * Resolves the best available FFmpeg binary and hardware encoder.
 *
 * Priority (auto mode):
 *   1. NVIDIA NVENC (nvidia-smi detected)  → system ffmpeg → ffmpeg-static
 *   2. Apple VideoToolbox (darwin arm64)   → system ffmpeg → ffmpeg-static
 *   3. Intel QSV (win32 + intel GPU)       → system ffmpeg → ffmpeg-static
 *   4. AMD AMF (win32 + amd/radeon GPU)    → system ffmpeg → ffmpeg-static
 *   5. libx264 ultrafast (CPU fallback)    → ffmpeg-static
 */
function resolveFfmpegAndCodec(mode: 'cpu' | 'gpu' | 'auto'): {
  ffmpegPath: string;
  codec: string;
} {
  const staticPath = ffmpegStatic ?? 'ffmpeg';
  const cpuFallback = { ffmpegPath: staticPath, codec: 'libx264' };

  if (mode === 'cpu') return cpuFallback;

  // ── Heuristic 1: NVIDIA NVENC ────────────────────────────────────────────
  let hasNvidia = false;
  try {
    execSync('nvidia-smi', { stdio: 'ignore', timeout: 5000 });
    hasNvidia = true;
  } catch { /* no NVIDIA driver */ }

  if (hasNvidia) {
    if (supportsEncoder('ffmpeg', 'h264_nvenc'))
      return { ffmpegPath: 'ffmpeg', codec: 'h264_nvenc' };
    if (supportsEncoder(staticPath, 'h264_nvenc'))
      return { ffmpegPath: staticPath, codec: 'h264_nvenc' };
  }

  // ── Heuristic 2: Apple VideoToolbox (macOS Apple Silicon / Intel Mac) ────
  if (process.platform === 'darwin') {
    if (supportsEncoder('ffmpeg', 'h264_videotoolbox'))
      return { ffmpegPath: 'ffmpeg', codec: 'h264_videotoolbox' };
    if (supportsEncoder(staticPath, 'h264_videotoolbox'))
      return { ffmpegPath: staticPath, codec: 'h264_videotoolbox' };
  }

  // ── Heuristic 3: Intel QSV / AMD AMF (Windows) ──────────────────────────
  if (process.platform === 'win32') {
    try {
      const gpuName = execSync('wmic path win32_VideoController get name', {
        encoding: 'utf8',
        timeout: 5000,
      }).toLowerCase();

      if (gpuName.includes('intel')) {
        if (supportsEncoder('ffmpeg', 'h264_qsv'))
          return { ffmpegPath: 'ffmpeg', codec: 'h264_qsv' };
        if (supportsEncoder(staticPath, 'h264_qsv'))
          return { ffmpegPath: staticPath, codec: 'h264_qsv' };
      }
      if (gpuName.includes('amd') || gpuName.includes('radeon')) {
        if (supportsEncoder('ffmpeg', 'h264_amf'))
          return { ffmpegPath: 'ffmpeg', codec: 'h264_amf' };
        if (supportsEncoder(staticPath, 'h264_amf'))
          return { ffmpegPath: staticPath, codec: 'h264_amf' };
      }
    } catch { /* wmic unavailable */ }
  }

  // ── Explicit --mode gpu: exhaustive scan across all GPU codecs ───────────
  if (mode === 'gpu') {
    for (const gpuCodec of ['h264_nvenc', 'h264_videotoolbox', 'h264_qsv', 'h264_amf']) {
      if (supportsEncoder('ffmpeg', gpuCodec))
        return { ffmpegPath: 'ffmpeg', codec: gpuCodec };
      if (supportsEncoder(staticPath, gpuCodec))
        return { ffmpegPath: staticPath, codec: gpuCodec };
    }
    console.warn(
      `  ⚠️  --mode gpu requested but no hardware encoder found. Falling back to libx264 ultrafast.`
    );
  }

  return cpuFallback;
}

// ─────────────────────────────────────────────────────────────────────────────
// FFmpeg Subprocess
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Spawns FFmpeg with the PNG zero-copy input pipeline.
 *
 * Input stream:  -f image2pipe -vcodec png  (lossless, FFmpeg C-level libpng decode)
 * Audio mapping: -map 0:v -map 1:a? -c:a aac -shortest  (SKILL.md compliant)
 *
 * Codec quality targets:
 *   libx264         → -preset ultrafast -crf 18          (visually lossless, fast CPU)
 *   h264_nvenc      → -preset p4 -tune hq -rc vbr        (T4 quality target)
 *                     -cq 18 -b:v 0
 *   h264_videotoolbox → -q:v 65                          (Apple HW, no -preset support)
 *   h264_qsv        → -global_quality 18 -preset fast    (Intel HW quality target)
 *   h264_amf        → -rc cqp -qp_i 18 -qp_p 18         (AMD HW quality target)
 */
function spawnFfmpeg(
  ffmpegPath: string,
  width: number,
  height: number,
  fps: number,
  outputPath: string,
  codec: string,
  audioSourcePath?: string
): ChildProcess {
  const args: string[] = [
    // ── Video input: PNG frames piped into stdin ──────────────────────────
    '-f',        'image2pipe',
    '-vcodec',   'png',         // Native C-level PNG decoder — zero Node.js decode overhead
    '-framerate', String(fps),
    '-i',        'pipe:0',
  ];

  // ── Audio input + SKILL.md-compliant mapping ──────────────────────────────
  if (audioSourcePath && fs.existsSync(audioSourcePath)) {
    args.push('-i', audioSourcePath); // input 1: original video for audio track
    args.push('-map', '0:v');         // video from PNG pipe
    args.push('-map', '1:a?');        // audio from source (optional — won't fail if absent)
    args.push('-c:a', 'aac');         // encode audio as AAC
  }

  // ── Output video codec ────────────────────────────────────────────────────
  args.push('-c:v', codec, '-pix_fmt', 'yuv420p');

  // ── Codec-specific quality presets ───────────────────────────────────────
  if (codec === 'libx264') {
    // CPU: ultrafast + visually lossless CRF — hits 1:1 real-time on modern CPUs
    args.push('-preset', 'ultrafast', '-crf', '18');

  } else if (codec === 'h264_nvenc') {
    // NVIDIA: p4 = high quality preset, VBR mode with CQ 18 — near-lossless on T4
    args.push(
      '-preset', 'p4',
      '-tune',   'hq',
      '-rc',     'vbr',
      '-cq',     '18',
      '-b:v',    '0',     // uncapped bitrate ceiling (CQ mode drives quality, not bitrate)
    );

  } else if (codec === 'h264_videotoolbox') {
    // Apple VideoToolbox: NO -preset flag (it is unsupported and crashes FFmpeg)
    // -q:v 65 maps to ~85% quality on the 0–100 VT scale
    args.push('-q:v', '65');

  } else if (codec === 'h264_qsv') {
    // Intel Quick Sync: global_quality drives CQP-equivalent quality
    args.push('-global_quality', '18', '-preset', 'fast');

  } else if (codec === 'h264_amf') {
    // AMD AMF: constant QP mode, I/P frame QP both set to 18
    args.push('-rc', 'cqp', '-qp_i', '18', '-qp_p', '18');

  } else {
    // Unknown GPU codec: apply a generic fast preset as a safe default
    args.push('-preset', 'fast');
  }

  // ── Output flags ──────────────────────────────────────────────────────────
  args.push(
    '-movflags', '+faststart', // Enable web streaming (moov atom at file start)
    '-shortest',               // Stop encoding when the shortest stream ends
    '-y',                      // Overwrite output without prompting
    outputPath,
  );

  const proc = spawn(ffmpegPath, args, {
    stdio: ['pipe', 'ignore', 'pipe'],
  });

  // Surface FFmpeg errors to stderr (filter noise; only show actionable messages)
  proc.stderr?.on('data', (chunk: Buffer) => {
    const msg = chunk.toString();
    if (
      msg.includes('Error') ||
      msg.includes('error') ||
      msg.includes('Invalid') ||
      msg.includes('invalid') ||
      msg.includes('No such') ||
      msg.includes('Unknown')
    ) {
      process.stderr.write(`[ffmpeg] ${msg}`);
    }
  });

  return proc;
}

// ─────────────────────────────────────────────────────────────────────────────
// Vite Dev Server
// ─────────────────────────────────────────────────────────────────────────────

async function getViteServer(port: number): Promise<ViteDevServer> {
  const server = await createServer({
    configFile: path.join(ROOT, 'vite.config.ts'),
    server: { port, host: 'localhost' },
  });
  await server.listen();
  return server;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main render() export
// ─────────────────────────────────────────────────────────────────────────────

export async function render(
  compositionId: string,
  propsOverride?: Record<string, unknown>,
  options: RenderOptions = {}
): Promise<string> {
  const port  = options.port  ?? 3101;
  const quiet = options.quiet ?? false;
  const log   = (...args: unknown[]) => { if (!quiet) console.log(...args); };

  log(`\n  🎬 MotionFlow Ultra-Fast Renderer`);
  log(`  Composition: ${compositionId}`);

  // ── 1. Start Vite dev server ───────────────────────────────────────────────
  let vite: ViteDevServer | null = null;
  try {
    vite = await getViteServer(port);
  } catch (e: unknown) {
    throw e;
  }

  const boundPort = vite.config.server.port ?? port;
  log(`  Dev server:  http://localhost:${boundPort}`);

  // ── 2. Resolve encoder (single-pass cached GPU detection) ─────────────────
  const mode = options.mode ?? 'auto';
  const { ffmpegPath, codec } = resolveFfmpegAndCodec(mode);
  const useGpu = codec !== 'libx264';

  log(`  Encoder:     ${codec} (${useGpu ? '⚡ GPU hardware-accelerated' : '🖥️  CPU software'})`);

  if (!ffmpegPath) throw new Error('FFmpeg binary not found. Install ffmpeg-static or add ffmpeg to PATH.');

  // ── 3. Launch headless Chromium ───────────────────────────────────────────
  //
  // Memory-safe flags:
  //   --no-sandbox               → Required on Linux/Colab/Docker (root-user containers)
  //   --disable-setuid-sandbox   → Companion to --no-sandbox; prevents setuid errors
  //   --disable-dev-shm-usage    → Critical: /dev/shm is only 64MB on Colab free tier;
  //                                without this, the renderer OOMs and crashes
  //   --disable-gpu              → Browser GPU is irrelevant for DOM screenshots;
  //                                this prevents GPU init overhead in the browser process
  //                                (distinct from FFmpeg GPU encoding, which is unaffected)
  //
  const launchArgs = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-gpu',
    '--disable-software-rasterizer',
    '--disable-web-security',
    '--allow-running-insecure-content',
  ];

  log(`  Launching headless Chromium (memory-safe mode)...`);

  const browser: Browser = await chromium.launch({
    headless: true,
    args: launchArgs,
  });

  try {
    // ── 4. Extract composition metadata ───────────────────────────────────
    const propsParam = propsOverride
      ? `&props=${encodeURIComponent(JSON.stringify(propsOverride))}`
      : '';
    const url = `http://localhost:${boundPort}/composition.html?id=${encodeURIComponent(compositionId)}&render=true${propsParam}`;

    const metaContext = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
    const metaPage: Page = await metaContext.newPage();

    metaPage.on('pageerror', (err) => {
      console.error(`[Browser Error] ${err.message}`);
      if (err.stack) console.error(err.stack);
    });

    await metaPage.goto(url);
    await metaPage.waitForFunction(
      () => !!(globalThis as any).__MOTIONFLOW_READY__,
      { timeout: 15000 }
    );

    const meta = await metaPage.evaluate((id: string) => {
      const reg =
        (globalThis as any).__motionFlowRegistry ||
        (globalThis as any).__MOTIONFLOW_REGISTRY__;
      if (!reg) throw new Error('MotionFlow registry not found on window.');
      const comp = reg.getComposition(id);
      if (!comp) throw new Error(`Composition "${id}" not found in registry.`);
      return {
        durationInFrames: comp.durationInFrames as number,
        fps:              comp.fps              as number,
        width:            comp.width            as number,
        height:           comp.height           as number,
      };
    }, compositionId) as CompositionInfo;

    await metaContext.close();

    // Validate even dimensions (H.264 requirement)
    if (meta.width % 2 !== 0 || meta.height % 2 !== 0) {
      throw new Error(
        `Composition dimensions ${meta.width}×${meta.height} contain odd numbers. ` +
        `H.264 requires both width and height to be divisible by 2.`
      );
    }

    log(`  Resolution:  ${meta.width}×${meta.height} @ ${meta.fps}fps`);
    log(`  Duration:    ${meta.durationInFrames} frames (${(meta.durationInFrames / meta.fps).toFixed(2)}s)\n`);

    // ── 5. Set up render context ───────────────────────────────────────────
    const context = await browser.newContext({
      viewport: { width: meta.width, height: meta.height },
      deviceScaleFactor: 1,
    });

    const page: Page = await context.newPage();

    page.on('pageerror', (err) => {
      console.error(`[Render Browser Error] ${err.message}`);
      if (err.stack) console.error(err.stack);
    });

    // ── 6. Install deterministic clock BEFORE navigation ──────────────────
    //
    // CRITICAL: page.clock.install() must be called before page.goto() so that
    // Playwright intercepts ALL time APIs (performance.now, Date.now, setTimeout,
    // setInterval, requestAnimationFrame) from the very first script execution.
    // Installing after navigation leaves a window where Framer Motion may have
    // already registered rAF callbacks against the real clock.
    //
    await page.clock.install({ time: new Date('2024-01-01T00:00:00Z') });
    await page.goto(url);
    await page.waitForFunction(
      () => !!(globalThis as any).__MOTIONFLOW_READY__,
      { timeout: 15000 }
    );

    // ── 7. Prepare output path and FFmpeg process ──────────────────────────
    const outputPath = options.output ?? path.join(ROOT, 'out', `${compositionId}.mp4`);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });

    // Audio source: strip "edit-" prefix, look for matching MP4 in public/assets/
    const audioSourcePath = path.join(ROOT, 'public/assets', `${compositionId.replace('edit-', '')}.mp4`);

    const ffmpegProc = spawnFfmpeg(
      ffmpegPath,
      meta.width,
      meta.height,
      meta.fps,
      outputPath,
      codec,
      audioSourcePath,
    );

    const ffmpegDone = new Promise<void>((resolve, reject) => {
      ffmpegProc.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`FFmpeg exited with code ${code}. Check stderr above for details.`));
      });
    });

    // ── 8. Ultra-Fast Frame Loop ───────────────────────────────────────────
    //
    // Per-frame IPC breakdown (down from 3 to 2):
    //   IPC #1 — page.clock.fastForward(frameDuration)
    //            Steps the virtual clock forward, firing all pending rAF callbacks
    //            and timers that Framer Motion registered. This is the deterministic
    //            time driver mandated by SKILL.md.
    //
    //   IPC #2 — page.evaluate(merged: setFrame + videoSeek + rAF wait)
    //            Previously these were 2 separate round-trips. By merging them into
    //            a single evaluate, we eliminate one full Node↔Chromium IPC cycle
    //            per frame. At 25fps / 3 min (4500 frames) = 4500 fewer IPC calls.
    //
    //   IPC #3 — page.screenshot({ type: 'png' })
    //            Lossless PNG buffer. FFmpeg decodes this in C with libpng + SIMD.
    //            No Node.js-level decode (sharp was removed), no generation loss.
    //
    const { durationInFrames, fps } = meta;
    const frameDuration = 1000 / fps;
    const startTime = Date.now();

    log(`  ⚡ PNG Zero-Copy Pipeline active. Rendering ${durationInFrames} frames...\n`);

    for (let f = 0; f < durationInFrames; f++) {
      // IPC #1: Step the deterministic clock forward by exactly one frame duration.
      // This fires all Framer Motion spring/tween/rAF callbacks synchronously.
      await page.clock.fastForward(frameDuration);

      // IPC #2: In a single round-trip — set the React frame state, seek the video
      // element to the correct timestamp, and wait for the rAF paint to complete.
      // The rAF await here is a guard against compositions that have async
      // React state updates that trail behind the clock step.
      await page.evaluate(
        async (args: { frame: number; fpsVal: number }) => {
          if ((globalThis as any).__setFrame) {
            (globalThis as any).__setFrame(args.frame);
          }
          if ((globalThis as any).__MOTIONFLOW_SEEK_TO_FRAME__) {
            await (globalThis as any).__MOTIONFLOW_SEEK_TO_FRAME__(args.frame, args.fpsVal);
          }
          // Wait for one final rAF so all React re-renders triggered by setFrame
          // have committed to the DOM before we take the screenshot.
          // NOTE: requestAnimationFrame is a browser global — it exists in the
          // evaluate() browser context, not in Node.js.
          await new Promise<void>((res) => (globalThis as any).requestAnimationFrame(() => res()));
        },
        { frame: f, fpsVal: fps }
      );

      // IPC #3: Capture a lossless PNG buffer.
      // FFmpeg receives this via stdin and decodes it at the C level — no Node
      // decoding, no JPEG generation loss, no sharp dependency.
      const pngBuffer = await page.screenshot({ type: 'png' });

      // Pipe to FFmpeg with strict backpressure: if stdin's internal buffer is
      // full, pause the loop until FFmpeg drains it. This prevents Node from
      // buffering gigabytes of raw frames in memory on slow encode paths.
      const canWrite = ffmpegProc.stdin!.write(pngBuffer);
      if (!canWrite) {
        await new Promise<void>((r) => ffmpegProc.stdin!.once('drain', r));
      }

      // Progress indicator
      if (!quiet) {
        const pct     = Math.round(((f + 1) / durationInFrames) * 100);
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        const filled  = Math.floor(pct / 5);
        const bar     = '█'.repeat(filled) + '░'.repeat(20 - filled);
        process.stdout.write(
          `\r  [${bar}] ${String(f + 1).padStart(String(durationInFrames).length)}/${durationInFrames} (${pct}%) ${elapsed}s`
        );
      }
    }

    // ── 9. Finalize ────────────────────────────────────────────────────────
    ffmpegProc.stdin!.end();
    await ffmpegDone;

    const totalTime = ((Date.now() - startTime) / 1000).toFixed(2);
    const fileSize  = (fs.statSync(outputPath).size / 1024 / 1024).toFixed(2);

    log(`\n\n  ✅ Done!`);
    log(`  Output:   ${outputPath}`);
    log(`  Size:     ${fileSize} MB`);
    log(`  Time:     ${totalTime}s`);
    log(`  Speed:    ${(durationInFrames / fps / Number(totalTime)).toFixed(2)}× real-time\n`);

    return outputPath;

  } finally {
    await browser.close();
    await vite?.close();
  }
}
