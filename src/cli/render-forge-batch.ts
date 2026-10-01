/**
 * render-forge-batch — render one Forge scene across many seeds.
 *
 * Same deterministic pipeline as render-forge, run once per seed with the
 * scene seed overridden (original file untouched). One MP4 per seed:
 *   <outDir>/<base>-seed<seed>.mp4
 */
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { migrateScene } from '../forge/core/types';
import {
  applySeedOverride,
  batchOutputName,
  parseSeedList,
} from '../forge/render/batch';
import { renderForge } from './render-forge';

export interface ForgeBatchCliOptions {
  seeds: string;
  outDir?: string;
  baseName?: string;
  port?: number;
  audio?: string;
  gpuMode?: 'auto' | 'cpu' | 'gpu';
  keepTemp?: boolean;
}

export async function renderForgeBatch(
  sceneFile: string,
  options: ForgeBatchCliOptions,
): Promise<string[]> {
  const seeds = parseSeedList(options.seeds);
  if (seeds.length === 0) throw new Error('No seeds resolved from --seeds spec.');

  const absScene = path.resolve(sceneFile);
  if (!fs.existsSync(absScene)) {
    throw new Error(`Scene file not found: ${absScene}`);
  }
  const scene = migrateScene(JSON.parse(fs.readFileSync(absScene, 'utf8')));

  const outDir = path.resolve(options.outDir ?? path.join(process.cwd(), 'out'));
  fs.mkdirSync(outDir, { recursive: true });
  const base = (options.baseName ?? scene.name ?? scene.sceneId)
    .replace(/[^\w\-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || scene.sceneId;

  console.log(`\n  🧪 NativeForge batch renderer — ${seeds.length} seed(s)`);
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-batch-'));
  const outputs: string[] = [];
  try {
    // Sequential renders: each renderForge boots its own Vite+Electron, and
    // parallel Electron instances would fight over the GPU encoder.
    for (let i = 0; i < seeds.length; i++) {
      const seed = seeds[i];
      const variant = applySeedOverride(scene, seed);
      const tmpFile = path.join(tmpDir, `seed-${seed}.forge.json`);
      fs.writeFileSync(tmpFile, JSON.stringify(variant));
      const out = path.join(outDir, batchOutputName(base, seed));
      console.log(`\n━━ seed ${seed} (${i + 1}/${seeds.length}) → ${out}`);
      outputs.push(
        await renderForge(tmpFile, {
          output: out,
          port: options.port,
          audio: options.audio,
          gpuMode: options.gpuMode,
        }),
      );
    }
  } finally {
    if (!options.keepTemp) fs.rmSync(tmpDir, { recursive: true, force: true });
  }
  return outputs;
}
