/**
 * render.ts — Headless renderer
 *
 * Pipeline:
 *   1. Start Vite dev server
 *   2. Launch Playwright (headless Chromium)
 *   3. Install page.clock (deterministic time control)
 *   4. Navigate to composition.html
 *   5. Loop over frames:
 *      a. page.clock.fastForward(frameDuration) — advance virtual time
 *      b. page.evaluate(rAF promise) — wait for Framer Motion to paint [FIX 2]
 *      c. page.screenshot() — native Node Buffer [FIX 3]
 *      d. sharp decode → raw RGBA
 *      e. Write RGBA to ffmpeg stdin (streaming, no RAM buffering)
 *   6. Finalize MP4
 */
import { chromium, type Browser, type Page } from 'playwright';
import sharp from 'sharp';
import ffmpegStatic from 'ffmpeg-static';
import { spawn, execSync, type ChildProcess } from 'child_process';
import { createServer, type ViteDevServer } from 'vite';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
 
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../../');
 
export interface RenderOptions {
  output?: string;
  port?: number;
  quiet?: boolean;
  mode?: 'cpu' | 'gpu' | 'stream' | 'auto';
}

interface CompositionInfo {
  durationInFrames: number;
  fps: number;
  width: number;
  height: number;
}

async function getViteServer(port: number): Promise<ViteDevServer> {
  const vite = await createServer({
    root: ROOT,
    server: { port, strictPort: false }, // Automatically fall back to another port if busy
    logLevel: 'silent',
  });
  await vite.listen();
  return vite;
}

function supportsEncoder(ffmpegPath: string, encoder: string): boolean {
  try {
    const output = execSync(`"${ffmpegPath}" -encoders`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return output.includes(encoder);
  } catch {
    return false;
  }
}

function resolveFfmpegAndCodec(mode: 'cpu' | 'gpu' | 'stream' | 'auto'): { ffmpegPath: string; codec: string } {
  const staticPath = ffmpegStatic ?? 'ffmpeg';
  const defaultCodec = 'libx264';
 
  if (mode === 'cpu') {
    return { ffmpegPath: staticPath, codec: defaultCodec };
  }
 
  // 1. Check if the system has an NVIDIA GPU
  let hasNvidia = false;
  try {
    execSync('nvidia-smi', { stdio: 'ignore' });
    hasNvidia = true;
  } catch {}
 
  // 2. Prioritize system-wide 'ffmpeg' command first for GPU acceleration
  if (hasNvidia) {
    if (supportsEncoder('ffmpeg', 'h264_nvenc')) {
      return { ffmpegPath: 'ffmpeg', codec: 'h264_nvenc' };
    }
    if (supportsEncoder(staticPath, 'h264_nvenc')) {
      return { ffmpegPath: staticPath, codec: 'h264_nvenc' };
    }
  }
 
  // Heuristic 2: Check for macOS Apple Silicon (Videotoolbox)
  if (process.platform === 'darwin' && process.arch === 'arm64') {
    if (supportsEncoder('ffmpeg', 'h264_videotoolbox')) {
      return { ffmpegPath: 'ffmpeg', codec: 'h264_videotoolbox' };
    }
    if (supportsEncoder(staticPath, 'h264_videotoolbox')) {
      return { ffmpegPath: staticPath, codec: 'h264_videotoolbox' };
    }
  }
 
  // Heuristic 3: Check for Intel/AMD graphics on Windows
  if (process.platform === 'win32') {
    try {
      const output = execSync('wmic path win32_VideoController get name', { encoding: 'utf8' }).toLowerCase();
      if (output.includes('intel')) {
        if (supportsEncoder('ffmpeg', 'h264_qsv')) return { ffmpegPath: 'ffmpeg', codec: 'h264_qsv' };
        if (supportsEncoder(staticPath, 'h264_qsv')) return { ffmpegPath: staticPath, codec: 'h264_qsv' };
      }
      if (output.includes('amd') || output.includes('radeon')) {
        if (supportsEncoder('ffmpeg', 'h264_amf')) return { ffmpegPath: 'ffmpeg', codec: 'h264_amf' };
        if (supportsEncoder(staticPath, 'h264_amf')) return { ffmpegPath: staticPath, codec: 'h264_amf' };
      }
    } catch {}
  }
 
  // 3. Fallback checks for explicit 'gpu' mode
  if (mode === 'gpu') {
    for (const gpuCodec of ['h264_nvenc', 'h264_qsv', 'h264_amf', 'h264_videotoolbox']) {
      if (supportsEncoder('ffmpeg', gpuCodec)) return { ffmpegPath: 'ffmpeg', codec: gpuCodec };
      if (supportsEncoder(staticPath, gpuCodec)) return { ffmpegPath: staticPath, codec: gpuCodec };
    }
 
    console.warn(`  ⚠️  GPU mode requested, but neither system 'ffmpeg' nor static 'ffmpeg-static' supports hardware encoding. Falling back to CPU.`);
  }
 
  return { ffmpegPath: staticPath, codec: defaultCodec };
}

function spawnFfmpeg(
  ffmpegPath: string,
  width: number,
  height: number,
  fps: number,
  outputPath: string,
  codec: string,
  audioSourcePath?: string
): ChildProcess {
  const args = [
    '-f', 'rawvideo',
    '-pixel_format', 'rgba',
    '-video_size', `${width}x${height}`,
    '-framerate', String(fps),
    '-i', 'pipe:0',
  ];

  if (audioSourcePath && fs.existsSync(audioSourcePath)) {
    args.push('-i', audioSourcePath);
    args.push('-map', '0:v');
    args.push('-map', '1:a?');
    args.push('-c:a', 'aac');
  }

  args.push(
    '-c:v', codec,
    '-pix_fmt', 'yuv420p'
  );

  // Set codec-specific presets and quality targets
  if (codec === 'libx264') {
    args.push('-preset', 'ultrafast', '-crf', '18');
  } else if (codec === 'h264_nvenc') {
    args.push('-preset', 'p3', '-cq:v', '20'); // nvenc constant quality using -cq:v
  } else if (codec === 'h264_videotoolbox') {
    args.push('-preset', 'slow', '-q:v', '65'); // videotoolbox quality target
  } else {
    args.push('-preset', 'fast');
  }

  args.push(
    '-movflags', '+faststart',
    '-shortest',
    '-y',
    outputPath
  );

  const proc = spawn(ffmpegPath, args, {
    stdio: ['pipe', 'ignore', 'pipe'],
  });

  // Surface ffmpeg errors only
  proc.stderr?.on('data', (chunk: Buffer) => {
    const msg = chunk.toString();
    if (msg.includes('Error') || msg.includes('error') || msg.includes('Invalid')) {
      process.stderr.write(`[ffmpeg] ${msg}`);
    }
  });

  return proc;
}

export async function render(
  compositionId: string,
  propsOverride?: Record<string, unknown>,
  options: RenderOptions = {}
): Promise<string> {
  const port = options.port ?? 3101;
  const quiet = options.quiet ?? false;
  const log = (...args: unknown[]) => { if (!quiet) console.log(...args); };

  log(`\n  🎬 MotionFlow Renderer`);
  log(`  Composition: ${compositionId}`);

  // 1. Start Vite
  let vite: ViteDevServer | null = null;
  try {
    vite = await getViteServer(port);
  } catch (e: any) {
    throw e;
  }

  const boundPort = vite.config.server.port ?? port;
  log(`  Dev server running on port ${boundPort}...`);
 
  const mode = options.mode ?? 'auto';
 
  // Resolve both FFmpeg path and hardware codec in one step (preferring system-wide global ffmpeg command)
  const resolved = resolveFfmpegAndCodec(mode);
  const ffmpegPath = resolved.ffmpegPath;
  const codec = resolved.codec;
  const useGpu = codec !== 'libx264';
 
  // 2. Launch Playwright
  log(`  Launching headless Chromium (${useGpu ? 'GPU Accelerated' : 'CPU Software GL'})...`);
  log(`  Encoder:    ${codec} (${useGpu ? 'GPU hardware-accelerated' : 'CPU software-based'})`);
 
  const launchArgs = [
    '--disable-web-security',
    '--allow-running-insecure-content',
  ];
 
  if (useGpu) {
    launchArgs.push(
      '--enable-gpu',
      '--use-gl=desktop',
      '--ignore-gpu-blocklist',
      '--disable-software-rasterizer'
    );
  } else {
    launchArgs.push(
      '--disable-gpu',
      '--disable-software-rasterizer'
    );
  }
 
  const browser: Browser = await chromium.launch({
    headless: true,
    args: launchArgs
  });

  try {
    // 3. Navigate to composition page to read metadata
    const metaContext = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
    const metaPage: Page = await metaContext.newPage();
    
    // Log browser errors and console outputs to diagnose timeouts
    metaPage.on('console', msg => {
      console.log(`[Browser Console] ${msg.type().toUpperCase()}: ${msg.text()}`);
    });
    metaPage.on('pageerror', err => {
      console.error(`[Browser Page Error] ${err.message}`);
      if (err.stack) console.error(err.stack);
    });

    const propsParam = propsOverride
      ? `&props=${encodeURIComponent(JSON.stringify(propsOverride))}`
      : '';
    const url = `http://localhost:${boundPort}/composition.html?id=${encodeURIComponent(compositionId)}&render=true${propsParam}`;

    await metaPage.goto(url);
    await metaPage.waitForFunction(() => !!(globalThis as any).__MOTIONFLOW_READY__, { timeout: 15000 });

    // Read composition metadata from the registry
    const meta = await metaPage.evaluate((id: string) => {
      const reg = (globalThis as any).__MOTIONFLOW_REGISTRY__;
      if (!reg) throw new Error('Registry not found');
      const comp = reg.getComposition(id);
      if (!comp) throw new Error(`Composition "${id}" not found`);
      return {
        durationInFrames: comp.durationInFrames as number,
        fps: comp.fps as number,
        width: comp.width as number,
        height: comp.height as number,
      };
    }, compositionId) as CompositionInfo;

    await metaContext.close();

    log(`  Resolution: ${meta.width}×${meta.height} @ ${meta.fps}fps`);
    log(`  Duration:   ${meta.durationInFrames} frames (${(meta.durationInFrames / meta.fps).toFixed(2)}s)`);

    // 4. Set up render context with correct viewport (and optional video recording)
    const isStreamMode = mode === 'stream';
    const videoDir = path.join(ROOT, 'out', 'temp');
    if (isStreamMode) {
      fs.mkdirSync(videoDir, { recursive: true });
    }
 
    const context = await browser.newContext({
      viewport: { width: meta.width, height: meta.height },
      deviceScaleFactor: 1,
      ...(isStreamMode ? {
        recordVideo: {
          dir: videoDir,
          size: { width: meta.width, height: meta.height }
        }
      } : {})
    });
 
    const page: Page = await context.newPage();
    page.on('console', msg => {
      console.log(`[Render Browser Console] ${msg.type().toUpperCase()}: ${msg.text()}`);
    });
    page.on('pageerror', err => {
      console.error(`[Render Browser Page Error] ${err.message}`);
      if (err.stack) console.error(err.stack);
    });
 
    // Set up output path
    const outputPath = options.output
      ?? path.join(ROOT, 'out', `${compositionId}.mp4`);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
 
    if (!ffmpegPath) throw new Error('FFmpeg not found');
    const audioSourcePath = path.join(ROOT, 'public/assets', `${compositionId.replace('edit-', '')}.mp4`);
 
    if (isStreamMode) {
      // 🚀 STREAM / REAL-TIME CAPTURE MODE (Bypasses screenshots and WebSockets entirely!)
      log(`\n  Capturing tab video stream natively (GPU Accelerated)...`);
      const playUrl = `${url}&play=true`;
      
      const startTime = Date.now();
      await page.goto(playUrl);
      await page.waitForFunction(() => !!(globalThis as any).__MOTIONFLOW_READY__, { timeout: 15000 });
 
      const renderDuration = meta.durationInFrames / meta.fps;
      const step = 0.4;
      for (let elapsedSec = 0; elapsedSec < renderDuration + 0.3; elapsedSec += step) {
        await page.waitForTimeout(step * 1000);
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        const pct = Math.min(100, Math.round((parseFloat(elapsed) / renderDuration) * 100));
        const bar = '█'.repeat(Math.floor(pct / 5)) + '░'.repeat(20 - Math.floor(pct / 5));
        process.stdout.write(
          `\r  [${bar}] Streaming tab: ${elapsed}s / ${renderDuration.toFixed(1)}s (${pct}%)`
        );
      }
      process.stdout.write(`\n`);
 
      // Fetch recorded video path before closing context
      const videoPath = await page.video()?.path();
      await page.close();
      await context.close();
 
      if (!videoPath) {
        throw new Error('Playwright video recording failed (no videoPath returned).');
      }
 
      log(`  Real-time capture complete. Merging audio track in FFmpeg...`);
      const mergeDone = new Promise<void>((resolve, reject) => {
        const args = [
          '-i', videoPath,
        ];
        let hasAudio = false;
        if (fs.existsSync(audioSourcePath)) {
          args.push('-i', audioSourcePath);
          hasAudio = true;
        }
        args.push(
          '-map', '0:v',
          ...(hasAudio ? ['-map', '1:a?'] : []),
          '-c:v', 'libx264',
          '-pix_fmt', 'yuv420p',
          '-preset', 'ultrafast',
          '-crf', '18',
          ...(hasAudio ? ['-c:a', 'aac'] : []),
          '-shortest',
          '-y',
          outputPath
        );
 
        const proc = spawn(ffmpegPath, args, { stdio: 'ignore' });
        proc.on('close', (code) => {
          if (code === 0) resolve();
          else reject(new Error(`FFmpeg merge exited with code ${code}`));
        });
      });
 
      await mergeDone;
 
      // Clean up temporary WebM recording
      try {
        fs.unlinkSync(videoPath);
      } catch {}
 
      const totalTime = ((Date.now() - startTime) / 1000).toFixed(2);
      const fileSize = (fs.statSync(outputPath).size / 1024 / 1024).toFixed(2);
 
      log(`\n  ✅ Done!`);
      log(`  Output:  ${outputPath}`);
      log(`  Size:    ${fileSize} MB`);
      log(`  Time:    ${totalTime}s\n`);
 
      return outputPath;
 
    } else {
      // 🐢 CLASSIC FRAME-BY-FRAME SCREENSHOT MODE
      await page.clock.install({ time: new Date('2024-01-01T00:00:00Z') });
      await page.goto(url);
      await page.waitForFunction(() => !!(globalThis as any).__MOTIONFLOW_READY__, { timeout: 15000 });
 
      // Spawn ffmpeg subprocess
      const ffmpegProc = spawnFfmpeg(ffmpegPath, meta.width, meta.height, meta.fps, outputPath, codec, audioSourcePath);
      const ffmpegDone = new Promise<void>((resolve, reject) => {
        ffmpegProc.on('close', (code) => {
          if (code === 0) resolve();
          else reject(new Error(`ffmpeg process exited with code ${code}`));
        });
      });
 
      // Frame render loop
      const { durationInFrames, fps } = meta;
      const frameDuration = 1000 / fps;
      const startTime = Date.now();
 
      log(`\n  Rendering frames:`);
 
      for (let f = 0; f < durationInFrames; f++) {
        // a. Advance virtual time by one frame
        await page.clock.fastForward(frameDuration);
 
        // b. Synchronously await the video frame seek and set the React frame state
        await page.evaluate(async ([f, fpsVal]) => {
          if ((globalThis as any).__setFrame) {
            (globalThis as any).__setFrame(f);
          }
          if ((globalThis as any).__MOTIONFLOW_SEEK_TO_FRAME__) {
            await (globalThis as any).__MOTIONFLOW_SEEK_TO_FRAME__(f, fpsVal);
          }
        }, [f, fps] as const);
 
        // c. Wait for the next requestAnimationFrame paint so Framer Motion renders the overlays
        await page.evaluate(`
          new Promise((res) => {
            requestAnimationFrame(() => res());
          })
        `);
 
        // c. Capture via page.screenshot — using JPEG for speed
        const jpegBuffer = await page.screenshot({
          type: 'jpeg',
          quality: 90,
        });
 
        // d. Decode JPEG → raw RGBA using sharp
        const rgbaBuffer = await sharp(jpegBuffer)
          .raw()
          .ensureAlpha()
          .toBuffer();
 
        // e. Write to ffmpeg stdin (incremental — constant RAM usage)
        const canWrite = ffmpegProc.stdin!.write(rgbaBuffer);
        if (!canWrite) {
          await new Promise<void>((r) => ffmpegProc.stdin!.once('drain', r));
        }
 
        // Progress display
        const pct = Math.round(((f + 1) / durationInFrames) * 100);
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        const bar = '█'.repeat(Math.floor(pct / 5)) + '░'.repeat(20 - Math.floor(pct / 5));
        process.stdout.write(
          `\r  [${bar}] ${String(f + 1).padStart(String(durationInFrames).length)}/${durationInFrames} (${pct}%) ${elapsed}s`
        );
      }
 
      // 8. Close ffmpeg stdin and wait for finalization
      ffmpegProc.stdin!.end();
      await ffmpegDone;
 
      const totalTime = ((Date.now() - startTime) / 1000).toFixed(2);
      const fileSize = (fs.statSync(outputPath).size / 1024 / 1024).toFixed(2);
 
      log(`\n\n  ✅ Done!`);
      log(`  Output:  ${outputPath}`);
      log(`  Size:    ${fileSize} MB`);
      log(`  Time:    ${totalTime}s\n`);
 
      return outputPath;
    }

  } finally {
    await browser.close();
    await vite?.close();
  }
}
