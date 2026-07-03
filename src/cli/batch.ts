import os from 'os';
import fs from 'fs';
import path from 'path';
import { render, type RenderOptions } from './render.js';

interface BatchItem {
  props: Record<string, unknown>;
  output?: string;
}

export async function batchRender(
  compositionId: string,
  dataFile: string,
  concurrency?: number,
  options: RenderOptions = {}
): Promise<void> {
  if (!fs.existsSync(dataFile)) {
    throw new Error(`Batch data file not found: ${dataFile}`);
  }

  const raw = fs.readFileSync(dataFile, 'utf-8');
  let items: BatchItem[];
  try {
    const parsed = JSON.parse(raw);
    items = Array.isArray(parsed)
      ? parsed.map((p, i) => (typeof p === 'object' && p !== null && 'props' in p ? p as BatchItem : { props: p as Record<string, unknown>, output: undefined }))
      : [{ props: parsed, output: undefined }];
  } catch {
    throw new Error(`Failed to parse batch data file as JSON: ${dataFile}`);
  }

  const maxWorkers = concurrency ?? Math.max(1, os.cpus().length - 1);
  console.log(`\n  🎬 MotionFlow Batch Render`);
  console.log(`  Composition:  ${compositionId}`);
  console.log(`  Items:        ${items.length}`);
  console.log(`  Concurrency:  ${maxWorkers}`);
  console.log(`  Data file:    ${dataFile}\n`);

  const outDir = path.resolve('out');
  fs.mkdirSync(outDir, { recursive: true });

  let completed = 0;

  // Process in batches of maxWorkers
  for (let i = 0; i < items.length; i += maxWorkers) {
    const batch = items.slice(i, i + maxWorkers);
    await Promise.all(
      batch.map(async (item, batchIdx) => {
        const globalIdx = i + batchIdx;
        const outputPath = item.output
          ?? path.join(outDir, `${compositionId}_${String(globalIdx).padStart(3, '0')}.mp4`);

        // Use a different port for each parallel render
        const port = 3200 + globalIdx;

        try {
          await render(compositionId, item.props, {
            ...options,
            output: outputPath,
            port,
            quiet: true, // suppress per-render logs in batch mode
          });
          completed++;
          console.log(`  ✅ [${globalIdx + 1}/${items.length}] → ${path.basename(outputPath)}`);
        } catch (err) {
          console.error(`  ❌ [${globalIdx + 1}/${items.length}] Failed: ${(err as Error).message}`);
        }
      })
    );
  }

  console.log(`\n  Batch complete: ${completed}/${items.length} succeeded.\n`);
}
