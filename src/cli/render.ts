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

  log(`\n  🎬 MotionFlow Native Electron Renderer`);
  log(`  Composition: ${compositionId}`);

  // ── 1. Start Vite dev server ───────────────────────────────────────────────
  let vite: ViteDevServer | null = null;
  try {
    vite = await getViteServer(port);
  } catch (e: unknown) {
    throw e;
  }

  const boundPort = vite.config.server.port ?? port;
  log(`  Dev server running on port ${boundPort}...`);

  const outputPath = options.output ?? path.join(ROOT, 'out', `${compositionId}.mp4`);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });

  // ── 2. Spawn Electron process ──────────────────────────────────────────────
  log(`  Spawning Electron native compositor process...`);

  // Locate the electron binary (usually under node_modules/.bin/electron)
  const electronBin = process.platform === 'win32'
    ? `"${path.join(ROOT, 'node_modules', '.bin', 'electron.cmd')}"`
    : path.join(ROOT, 'node_modules', '.bin', 'electron');

  const electronMain = process.platform === 'win32'
    ? `"${path.join(ROOT, 'electron', 'main.cjs')}"`
    : path.join(ROOT, 'electron', 'main.cjs');

  const childEnv = {
    ...process.env,
    COMPOSITION_ID: compositionId,
    OUTPUT_PATH: outputPath,
  };

  const electronProc = spawn(electronBin, [electronMain], {
    env: childEnv,
    stdio: 'inherit',
    shell: process.platform === 'win32'
  });

  return new Promise<string>((resolve, reject) => {
    electronProc.on('close', async (code) => {
      await vite?.close();
      if (code === 0) {
        log(`\n  🎉 Render completed successfully: ${outputPath}\n`);
        resolve(outputPath);
      } else {
        reject(new Error(`Electron process exited with code ${code}`));
      }
    });

    electronProc.on('error', async (err) => {
      await vite?.close();
      reject(err);
    });
  });
}
