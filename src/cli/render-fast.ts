/**
 * render-fast.ts — Headless Fast Renderer using Transparent Overlay Merging
 *
 * Pipeline:
 *   1. Start Vite dev server
 *   2. Launch Playwright (headless Chromium)
 *   3. Navigate to composition.html?fast=true (disables HTML5 video seeks)
 *   4. Inject CSS to hide the browser video element and make the canvas transparent
 *   5. Loop over frames:
 *      a. Advance virtual time
 *      b. Capture transparent screenshots (JPEG, quality 90)
 *      c. Decode to raw RGBA
 *      d. Stream to FFmpeg stdin
 *   6. FFmpeg overlays the transparent stream on top of the original video file instantly.
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
    server: { port, strictPort: false },
    logLevel: 'silent',
  });
  await vite.listen();
  return vite;
}

function spawnFfmpegFast(
  ffmpegPath: string,
  bgVideoPath: string,
  width: number,
  height: number,
  fps: number,
  outputPath: string
): ChildProcess {
  const args = [
    '-i', bgVideoPath, // Input 0: Background video
    '-f', 'rawvideo',
    '-pixel_format', 'rgba',
    '-video_size', `${width}x${height}`,
    '-framerate', String(fps),
    '-i', 'pipe:0', // Input 1: Transparent motion graphics stream from stdin
    '-filter_complex', '[0:v][1:v]overlay=0:0[outv]',
    '-map', '[outv]',
    '-map', '0:a?', // Preserve audio from original background video if it exists
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

  proc.stderr?.on('data', (chunk: Buffer) => {
    const msg = chunk.toString();
    if (msg.includes('Error') || msg.includes('error') || msg.includes('Invalid')) {
      process.stderr.write(`[ffmpeg-fast] ${msg}`);
    }
  });

  return proc;
}

export async function renderFast(
  compositionId: string,
  propsOverride?: Record<string, unknown>,
  options: RenderOptions = {}
): Promise<string> {
  const port = options.port ?? 3102;
  const quiet = options.quiet ?? false;
  const log = (...args: unknown[]) => { if (!quiet) console.log(...args); };

  log(`\n  ⚡ MotionFlow Fast Renderer (Transparent Overlay Merging)`);
  log(`  Composition: ${compositionId}`);

  // Resolve background video path (e.g. edit-01 -> 01.mp4)
  const numericPart = compositionId.split('-')[1] ?? '01';
  const bgVideoPath = path.join(ROOT, 'public/assets', `${numericPart}.mp4`);

  if (!fs.existsSync(bgVideoPath)) {
    throw new Error(`Background video asset not found at: ${bgVideoPath}`);
  }

  log(`  Background:  ${path.basename(bgVideoPath)}`);

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

    const propsParam = propsOverride
      ? `&props=${encodeURIComponent(JSON.stringify(propsOverride))}`
      : '';
    // Append &fast=true to disable HTML5 video seeks in the React app
    const url = `http://localhost:${boundPort}/composition.html?id=${encodeURIComponent(compositionId)}&render=true&fast=true${propsParam}`;

    await metaPage.goto(url);
    await metaPage.waitForFunction(() => !!(globalThis as any).__MOTIONFLOW_READY__, { timeout: 15000 });

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

    await page.clock.install({ time: new Date('2024-01-01T00:00:00Z') });
    await page.goto(url);
    await page.waitForFunction(() => !!(globalThis as any).__MOTIONFLOW_READY__, { timeout: 15000 });

    // Inject CSS to hide the video element and ensure transparent background
    await page.addStyleTag({
      content: `
        video { display: none !important; }
        html, body, #root { background: transparent !important; }
      `
    });

    // 5. Set up output path
    const outputPath = options.output
      ?? path.join(ROOT, 'out', `${compositionId}.mp4`);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });

    if (!ffmpegStatic) throw new Error('ffmpeg-static not found');

    // 6. Spawn FFmpeg subprocess
    const ffmpegProc = spawnFfmpegFast(ffmpegStatic, bgVideoPath, meta.width, meta.height, meta.fps, outputPath);
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

    log(`\n  Rendering frames (fast mode):`);

    for (let f = 0; f < durationInFrames; f++) {
      // a. Advance virtual time
      await page.clock.fastForward(frameDuration);

      // b. Update React frame state (seeking video is skipped in React due to fast=true)
      await page.evaluate(([fVal]) => {
        if ((globalThis as any).__setFrame) {
          (globalThis as any).__setFrame(fVal);
        }
      }, [f]);

      // c. Wait for requestAnimationFrame paint
      await page.evaluate(`
        new Promise((res) => {
          requestAnimationFrame(() => res());
        })
      `);

      // d. Capture transparent screenshot (JPEG quality 90)
      const jpegBuffer = await page.screenshot({
        type: 'jpeg',
        quality: 90,
      });

      // e. Decode JPEG -> raw RGBA
      const rgbaBuffer = await sharp(jpegBuffer)
        .raw()
        .ensureAlpha()
        .toBuffer();

      // f. Write to FFmpeg stdin
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

    // 8. Close FFmpeg stdin and wait for completion
    ffmpegProc.stdin!.end();
    await ffmpegDone;

    const totalTime = ((Date.now() - startTime) / 1000).toFixed(2);
    const fileSize = (fs.statSync(outputPath).size / 1024 / 1024).toFixed(2);

    log(`\n\n  ⚡ Done!`);
    log(`  Output:  ${outputPath}`);
    log(`  Size:    ${fileSize} MB`);
    log(`  Time:    ${totalTime}s\n`);

    return outputPath;

  } finally {
    await browser.close();
    await vite?.close();
  }
}
