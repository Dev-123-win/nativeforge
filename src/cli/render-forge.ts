/**
 * render-forge — render a .forge.json physics scene to MP4.
 *
 * Pipeline: validate scene → start Vite → Electron offscreen loads
 * forge-scene.html → scene injected → deterministic frames → capturePage
 * raw BGRA pipe → FFmpeg (CPU or hardware encoder) → MP4 → optional
 * SFX post-step (synth WAV from the .sfx.json sidecar, second-pass mux).
 */
import { createServer, type ViteDevServer } from 'vite';
import { spawn } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { fileURLToPath } from 'url';
import ffmpegStatic from 'ffmpeg-static';
import { migrateScene, type ForgeScene } from '../forge/core/types';
import {
  buildMuxArgs,
  renderSfxWav,
  type SfxEvent,
} from '../forge/audio/sfx';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../../');

export interface ForgeRenderCliOptions {
  output?: string;
  port?: number;
  audio?: string;
  gpuMode?: 'auto' | 'cpu' | 'gpu';
  quiet?: boolean;
  /** Synthesize + mux the SFX track. Default true. */
  sfx?: boolean;
  /** SFX post-mix gain. Default 1. */
  sfxVolume?: number;
}

export async function renderForge(
  sceneFile: string,
  options: ForgeRenderCliOptions = {},
): Promise<string> {
  const port = options.port ?? 3101;
  const quiet = options.quiet ?? false;
  const log = (...args: unknown[]) => {
    if (!quiet) console.log(...args);
  };

  const absScene = path.resolve(sceneFile);
  if (!fs.existsSync(absScene)) {
    throw new Error(`Scene file not found: ${absScene}`);
  }

  // Validate before booting anything heavy.
  const raw = JSON.parse(fs.readFileSync(absScene, 'utf8'));
  const scene = migrateScene(raw);
  const frames = Math.max(1, scene.render.recordEnd - scene.render.recordStart);

  log(`\n  🧪 NativeForge scene renderer`);
  log(`  Scene: ${scene.name} (${scene.objects.length} objects, seed ${scene.seed})`);
  log(
    `  Format: ${scene.render.width}×${scene.render.height} @ ${scene.render.fps}fps — ${frames} frames`,
  );

  const vite: ViteDevServer = await createServer({
    configFile: path.join(ROOT, 'vite.config.ts'),
    server: { port, host: 'localhost' },
  });
  await vite.listen();
  const boundPort = vite.config.server.port ?? port;
  log(`  Dev server on port ${boundPort}...`);

  const outputPath =
    options.output ?? path.join(ROOT, 'out', `${scene.sceneId}.mp4`);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });

  const electronBin =
    process.platform === 'win32'
      ? `"${path.join(ROOT, 'node_modules', '.bin', 'electron.cmd')}"`
      : path.join(ROOT, 'node_modules', '.bin', 'electron');
  const electronMain =
    process.platform === 'win32'
      ? `"${path.join(ROOT, 'electron', 'main.cjs')}"`
      : path.join(ROOT, 'electron', 'main.cjs');

  const childEnv: NodeJS.ProcessEnv = {
    ...process.env,
    FORGE_SCENE_FILE: absScene,
    OUTPUT_PATH: outputPath,
    VITE_PORT: String(boundPort),
    FORGE_GPU_MODE: options.gpuMode ?? 'auto',
  };
  if (options.audio) childEnv.FORGE_AUDIO_FILE = path.resolve(options.audio);

  log(`  Spawning Electron forge renderer...`);
  const electronProc = spawn(electronBin, [electronMain], {
    env: childEnv,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });

  return new Promise<string>((resolve, reject) => {
    electronProc.on('close', async (code) => {
      await vite?.close();
      if (code === 0) {
        // SFX post-step: best-effort, never fails the render.
        try {
          await muxSfxTrack(outputPath, scene, options, log);
        } catch (err) {
          log(`  SFX: skipped (${(err as Error).message}) — video unaffected`);
        }
        log(`\n  🎉 Render completed: ${outputPath}\n`);
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

/**
 * SFX post-step: render the headless collector's `.sfx.json` sidecar to a
 * deterministic WAV and mux it as an AAC track. Best-effort by contract —
 * throws are caught by the caller so audio can never fail a video render.
 */
export async function muxSfxTrack(
  outputPath: string,
  scene: ForgeScene,
  options: ForgeRenderCliOptions,
  log: (...args: unknown[]) => void = () => {},
): Promise<boolean> {
  if (options.sfx === false) return false;
  if (options.audio) {
    log('  SFX: skipped — user audio takes precedence');
    return false;
  }
  const sidecar = `${outputPath}.sfx.json`;
  if (!fs.existsSync(sidecar)) return false;

  let events: SfxEvent[];
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(sidecar, 'utf8'));
    if (!Array.isArray(parsed)) throw new Error('sidecar is not an array');
    events = parsed.filter(
      (e): e is SfxEvent =>
        !!e && typeof e === 'object' && Number.isFinite((e as SfxEvent).frame),
    );
  } catch (err) {
    log(`  SFX: sidecar unreadable (${(err as Error).message}) — skipping`);
    return false;
  }
  if (events.length === 0) {
    fs.rmSync(sidecar, { force: true });
    return false;
  }

  const frames = Math.max(1, scene.render.recordEnd - scene.render.recordStart);
  const wav = renderSfxWav(events, {
    fps: scene.render.fps,
    recordStart: scene.render.recordStart,
    durationFrames: frames,
    seed: scene.seed,
    volume: options.sfxVolume ?? 1,
  });

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-sfx-'));
  try {
    const wavPath = path.join(tmpDir, 'sfx.wav');
    fs.writeFileSync(wavPath, wav);
    const muxed = path.join(tmpDir, 'muxed.mp4');
    const ffmpegPath = (ffmpegStatic as unknown as string) || 'ffmpeg';
    await new Promise<void>((resolve, reject) => {
      const proc = spawn(ffmpegPath, buildMuxArgs(outputPath, wavPath, muxed));
      let errOut = '';
      proc.stderr?.on('data', (d) => {
        errOut += d.toString();
      });
      proc.on('close', (code) =>
        code === 0
          ? resolve()
          : reject(new Error(`ffmpeg mux exited ${code}: ${errOut.slice(0, 300)}`)),
      );
      proc.on('error', reject);
    });
    fs.renameSync(muxed, outputPath);
    log(`  SFX: mixed ${events.length} events → AAC track`);
    return true;
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.rmSync(sidecar, { force: true });
  }
}
