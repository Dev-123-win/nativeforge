#!/usr/bin/env node
/**
 * MotionFlow CLI entry point
 *
 * Commands:
 *   motionflow studio
 *   motionflow render <compositionId> [--props '{"key":"val"}'] [--output path]
 *   motionflow render <compositionId> --batch data.json [--concurrency N]
 */
import { Command } from 'commander';

const program = new Command();

program
  .name('motionflow')
  .description('Framer Motion-native programmatic video engine')
  .version('0.1.0');

// ── studio ────────────────────────────────────────────────────────────
program
  .command('studio')
  .description('Start the live preview studio with HMR')
  .option('-p, --port <number>', 'Dev server port', '3100')
  .action(async (opts) => {
    const { startStudio } = await import('./studio.js');
    await startStudio(parseInt(opts.port, 10));
  });

// ── render ────────────────────────────────────────────────────────────
program
  .command('render <compositionId>')
  .description('Render a composition to MP4')
  .option('--props <json>', 'Override default props as a JSON string')
  .option('--output <path>', 'Output file path (default: out/<id>.mp4)')
  .option('--mode <mode>', 'Rendering mode: cpu, gpu, auto', 'auto')
  .option('--batch <dataFile>', 'Batch render from a JSON array of props')
  .option(
    '--concurrency <n>',
    'Max parallel renders for --batch (default: CPU count - 1)',
    parseInt
  )
  .action(async (compositionId: string, opts) => {
    if (opts.batch) {
      // Batch mode
      const { batchRender } = await import('./batch.js');
      await batchRender(compositionId, opts.batch, opts.concurrency);
    } else {
      // Single render
      const { render } = await import('./render.js');
 
      let propsOverride: Record<string, unknown> | undefined;
      if (opts.props) {
        try {
          propsOverride = JSON.parse(opts.props);
        } catch {
          console.error(`  ❌ Invalid JSON passed to --props: ${opts.props}`);
          process.exit(1);
        }
      }
 
      await render(compositionId, propsOverride, { 
        output: opts.output
      });
    }
  });

// ── render-forge ──────────────────────────────────────────────────────
program
  .command('render-forge <sceneFile>')
  .description('Render a Forge physics scene (.forge.json) to MP4')
  .option('--output <path>', 'Output file path (default: out/<sceneId>.mp4)')
  .option('--port <number>', 'Dev server port', '3101')
  .option('--audio <path>', 'Audio file to mux (AAC)')
  .option('--gpu-mode <mode>', 'Encoder selection: auto, cpu, gpu', 'auto')
  .action(async (sceneFile: string, opts) => {
    const { renderForge } = await import('./render-forge.js');
    await renderForge(sceneFile, {
      output: opts.output,
      port: parseInt(opts.port, 10),
      audio: opts.audio,
      gpuMode: opts.gpuMode,
    });
  });

// ── render-forge-batch ────────────────────────────────────────────────
program
  .command('render-forge-batch <sceneFile>')
  .description('Render a Forge scene across multiple seeds (one MP4 per seed)')
  .requiredOption('--seeds <spec>', 'Seed list, e.g. "1,2,3", "1-5", "1..5"')
  .option('--out-dir <dir>', 'Output directory (default: out/)')
  .option('--base-name <name>', 'Output filename stem (default: scene name)')
  .option('--port <number>', 'Dev server port', '3101')
  .option('--audio <path>', 'Audio file to mux (AAC)')
  .option('--gpu-mode <mode>', 'Encoder selection: auto, cpu, gpu', 'auto')
  .action(async (sceneFile: string, opts) => {
    const { renderForgeBatch } = await import('./render-forge-batch.js');
    const files = await renderForgeBatch(sceneFile, {
      seeds: opts.seeds,
      outDir: opts.outDir,
      baseName: opts.baseName,
      port: parseInt(opts.port, 10),
      audio: opts.audio,
      gpuMode: opts.gpuMode,
    });
    console.log(`\n✅ ${files.length} render(s) complete:`);
    for (const f of files) console.log(`   ${f}`);
  });

program.parse(process.argv);
