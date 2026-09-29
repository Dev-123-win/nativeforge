/**
 * render-forge — render a .forge.json physics scene to MP4.
 *
 * Pipeline: validate scene → start Vite → Electron offscreen loads
 * forge-scene.html → scene injected → deterministic frames → capturePage
 * raw BGRA pipe → FFmpeg (CPU or hardware encoder) → MP4.
 */
import { createServer, type ViteDevServer } from 'vite';
import { spawn } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import { fileURLToPath } from 'url';
import { migrateScene } from '../forge/core/types';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../../');

export interface ForgeRenderCliOptions {
  output?: string;
  port?: number;
  audio?: string;
  gpuMode?: 'auto' | 'cpu' | 'gpu';
  quiet?: boolean;
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
