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
import { spawn, type ChildProcess } from 'child_process';
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

function spawnFfmpeg(
  ffmpegPath: string,
  width: number,
  height: number,
  fps: number,
  outputPath: string
): ChildProcess {
  const args = [
    '-f', 'rawvideo',
    '-pixel_format', 'rgba',
    '-video_size', `${width}x${height}`,
    '-framerate', String(fps),
    '-i', 'pipe:0',
    '-c:v', 'libx264',
    '-pix_fmt', 'yuv420p',
    '-preset', 'ultrafast',
    '-crf', '18',
    '-movflags', '+faststart',
    '-y',
    outputPath,
  ];

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

  // 2. Launch Playwright
  log(`  Launching headless Chromium...`);
  const browser: Browser = await chromium.launch({ headless: true });

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

    // 4. Set up render context with correct viewport
    const context = await browser.newContext({
      viewport: { width: meta.width, height: meta.height },
      deviceScaleFactor: 1,
    });
    const page: Page = await context.newPage();
    page.on('console', msg => {
      console.log(`[Render Browser Console] ${msg.type().toUpperCase()}: ${msg.text()}`);
    });
    page.on('pageerror', err => {
      console.error(`[Render Browser Page Error] ${err.message}`);
      if (err.stack) console.error(err.stack);
    });

    await page.clock.install({ time: new Date('2024-01-01T00:00:00Z') });
    await page.goto(url);
    await page.waitForFunction(() => !!(globalThis as any).__MOTIONFLOW_READY__, { timeout: 15000 });

    // 5. Set up output path
    const outputPath = options.output
      ?? path.join(ROOT, 'out', `${compositionId}.mp4`);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });

    if (!ffmpegStatic) throw new Error('ffmpeg-static not found');

    // 6. Spawn ffmpeg subprocess
    const ffmpegProc = spawnFfmpeg(ffmpegStatic, meta.width, meta.height, meta.fps, outputPath);
    const ffmpegDone = new Promise<void>((resolve, reject) => {
      ffmpegProc.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`ffmpeg process exited with code ${code}`));
      });
    });

    // 7. Frame render loop
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

  } finally {
    await browser.close();
    await vite?.close();
  }
}
