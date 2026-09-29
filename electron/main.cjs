"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.startElectronRenderer = startElectronRenderer;
exports.startForgeRenderer = startForgeRenderer;
const electron_1 = require("electron");
const child_process_1 = require("child_process");
const ffmpeg_static_1 = require("ffmpeg-static");
const path = require("path");
const fs = require("fs");
// Disable background throttling for renderer process so requestAnimationFrame works reliably
electron_1.app.commandLine.appendSwitch('disable-renderer-backgrounding');
electron_1.app.commandLine.appendSwitch('disable-background-timer-throttling');
electron_1.app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
// Force device scale factor to 1.0 so display scaling doesn't resize the offscreen canvas
electron_1.app.commandLine.appendSwitch('force-device-scale-factor', '1');
let mainWindow;
function supportsEncoder(ffmpegPath, encoder) {
    try {
        const out = (0, child_process_1.execSync)(`"${ffmpegPath}" -hide_banner -h encoder=${encoder}`, {
            encoding: 'utf8',
            timeout: 8000,
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        return out.includes(encoder);
    }
    catch {
        return false;
    }
}
function selectEncoder(mode) {
    const staticPath = ffmpeg_static_1.default || 'ffmpeg';
    const cpuFallback = { ffmpegPath: staticPath, codec: 'libx264' };
    if (mode === 'cpu')
        return cpuFallback;
    // NVIDIA (Windows/Linux): nvidia-smi present + nvenc encoder available.
    try {
        (0, child_process_1.execSync)('nvidia-smi -L', { encoding: 'utf8', timeout: 5000 });
        if (supportsEncoder('ffmpeg', 'h264_nvenc'))
            return { ffmpegPath: 'ffmpeg', codec: 'h264_nvenc' };
        if (supportsEncoder(staticPath, 'h264_nvenc'))
            return { ffmpegPath: staticPath, codec: 'h264_nvenc' };
    }
    catch { /* no NVIDIA driver */ }
    if (process.platform === 'darwin') {
        if (supportsEncoder('ffmpeg', 'h264_videotoolbox'))
            return { ffmpegPath: 'ffmpeg', codec: 'h264_videotoolbox' };
    }
    if (process.platform === 'win32') {
        try {
            const gpuName = (0, child_process_1.execSync)('wmic path win32_VideoController get name', {
                encoding: 'utf8',
                timeout: 5000,
            }).toLowerCase();
            if (gpuName.includes('intel') && supportsEncoder('ffmpeg', 'h264_qsv'))
                return { ffmpegPath: 'ffmpeg', codec: 'h264_qsv' };
            if ((gpuName.includes('amd') || gpuName.includes('radeon')) &&
                supportsEncoder('ffmpeg', 'h264_amf'))
                return { ffmpegPath: 'ffmpeg', codec: 'h264_amf' };
        }
        catch { /* wmic unavailable */ }
    }
    if (mode === 'gpu') {
        for (const c of ['h264_nvenc', 'h264_videotoolbox', 'h264_qsv', 'h264_amf']) {
            if (supportsEncoder('ffmpeg', c))
                return { ffmpegPath: 'ffmpeg', codec: c };
            if (supportsEncoder(staticPath, c))
                return { ffmpegPath: staticPath, codec: c };
        }
        console.warn('  ⚠️  --gpu gpu requested but no HW encoder found; using libx264.');
    }
    return cpuFallback;
}
function spawnFfmpegPipe(o) {
    const { ffmpegPath, codec } = o.forceCpu
        ? { ffmpegPath: ffmpeg_static_1.default || 'ffmpeg', codec: 'libx264' }
        : selectEncoder(o.gpuMode ?? 'auto');
    console.log(`  Encoder: ${codec} (${ffmpegPath})`);
    const args = [
        '-y', '-hide_banner', '-loglevel', 'error',
        '-f', 'rawvideo', '-pix_fmt', 'bgra',
        '-s', `${o.width}x${o.height}`, '-r', String(o.fps),
        '-i', 'pipe:0',
    ];
    if (o.audioSourcePath && fs.existsSync(o.audioSourcePath)) {
        args.push('-i', o.audioSourcePath);
        args.push('-map', '0:v', '-map', '1:a?', '-c:a', 'aac');
    }
    else {
        args.push('-map', '0:v');
    }
    args.push('-c:v', codec, '-pix_fmt', 'yuv420p');
    if (o.forceCpu || codec === 'libx264') {
        // Quality tiers map to preset/CRF (motion path: fixed high).
        const q = o.quality ?? 'high';
        const preset = q === 'draft' ? 'ultrafast' : q === 'medium' ? 'veryfast' : q === 'high' ? 'fast' : 'medium';
        const crf = q === 'draft' ? '23' : q === 'medium' ? '20' : q === 'high' ? '18' : '16';
        args.push('-preset', o.forceCpu ? 'ultrafast' : preset, '-crf', o.forceCpu ? '18' : crf);
    }
    else if (codec === 'h264_nvenc') {
        const q = o.quality ?? 'high';
        const preset = q === 'draft' ? 'p1' : q === 'medium' ? 'p4' : q === 'high' ? 'p5' : 'p7';
        const cq = q === 'draft' ? '23' : q === 'medium' ? '20' : q === 'high' ? '18' : '16';
        args.push('-preset', preset, '-tune', 'hq', '-rc', 'vbr', '-cq', cq, '-b:v', '0');
    }
    else if (codec === 'h264_videotoolbox') {
        const q = o.quality ?? 'high';
        args.push('-q:v', q === 'draft' ? '50' : q === 'medium' ? '60' : q === 'high' ? '65' : '70');
    }
    else if (codec === 'h264_qsv') {
        const q = o.quality ?? 'high';
        args.push('-global_quality', q === 'draft' ? '23' : q === 'medium' ? '20' : q === 'high' ? '18' : '16');
    }
    else if (codec === 'h264_amf') {
        const q = o.quality ?? 'high';
        const qp = q === 'draft' ? '23' : q === 'medium' ? '20' : q === 'high' ? '18' : '16';
        args.push('-rc', 'cqp', '-qp_i', qp, '-qp_p', qp);
    }
    // VBV cap when the scene specifies a bitrate (CRF + ceiling).
    if (o.bitrate && /^\d+\s*[kKmM]$/.test(o.bitrate.trim())) {
        const m = o.bitrate.trim().match(/^(\d+)\s*([kKmM])$/);
        args.push('-maxrate', o.bitrate.trim(), '-bufsize', `${Number(m[1]) * 2}${m[2]}`);
    }
    args.push('-movflags', '+faststart', '-shortest', o.outputPath);
    const ffmpeg = (0, child_process_1.spawn)(ffmpegPath, args);
    ffmpeg.stderr?.on('data', (data) => {
        const msg = data.toString();
        if (/error|invalid|unknown|no such/i.test(msg)) {
            console.error(`[ffmpeg] ${msg}`);
        }
    });
    return ffmpeg;
}
/* ─── MotionFlow path (unchanged behavior) ────────────────────────────────── */
function startElectronRenderer(compositionId, outputPath) {
    function createWindow() {
        mainWindow = new electron_1.BrowserWindow({
            width: 1920,
            height: 1080,
            useContentSize: true,
            frame: false,
            show: false,
            webPreferences: {
                preload: path.join(__dirname, 'preload.js'),
                contextIsolation: false,
                offscreen: true
            }
        });
        // Ensure the offscreen webContents compositor frame rate ticks regularly
        mainWindow.webContents.setFrameRate(60);
        mainWindow.loadURL(`http://localhost:3101/composition.html?id=${compositionId}`);
    }
    electron_1.app.whenReady().then(() => {
        createWindow();
        mainWindow.webContents.on('did-finish-load', async () => {
            const meta = await mainWindow.webContents.executeJavaScript(`
        (() => {
          const reg = window.__motionFlowRegistry || window.__MOTIONFLOW_REGISTRY__;
          if (!reg) return null;
          const comp = reg.getComposition("${compositionId}");
          if (!comp) return null;
          return {
            width: comp.width,
            height: comp.height,
            fps: comp.fps,
            durationInFrames: comp.durationInFrames
          };
        })()
      `);
            if (!meta) {
                console.error("Registry not found.");
                electron_1.app.quit();
                return;
            }
            const { width, height, fps, durationInFrames } = meta;
            // Set the content size to match the composition dimensions exactly
            mainWindow.setContentSize(width, height);
            const audioSourcePath = path.join(process.cwd(), 'public/assets', `${compositionId.replace('edit-', '')}.mp4`);
            const ffmpeg = spawnFfmpegPipe({
                width, height, fps, outputPath,
                audioSourcePath,
                forceCpu: true, // motion path keeps its proven ultrafast/crf18 recipe
            });
            ffmpeg.stderr?.on('data', (data) => console.error(`[ffmpeg] ${data.toString()}`));
            console.log(`⚡ Starting Raw Pixel Pipeline: ${durationInFrames} frames...`);
            let currentFrame = 0;
            const renderLoop = async () => {
                try {
                    while (currentFrame < durationInFrames) {
                        // 1. Trigger the paint and wait for requestAnimationFrame to complete
                        await mainWindow.webContents.executeJavaScript(`
              window.__setFrame && window.__setFrame(${currentFrame}, ${fps});
              new Promise(r => {
                requestAnimationFrame(() => {
                  requestAnimationFrame(() => r());
                });
              });
            `);
                        // 2. Capture the current page from the render surface
                        const image = await mainWindow.webContents.capturePage();
                        const rawBuffer = image.toBitmap();
                        // 3. Write to FFmpeg (handling backpressure)
                        const canWrite = ffmpeg.stdin.write(rawBuffer);
                        if (!canWrite) {
                            await new Promise((resolve) => ffmpeg.stdin.once('drain', resolve));
                        }
                        currentFrame++;
                        // Print progress
                        const pct = Math.round((currentFrame / durationInFrames) * 100);
                        process.stdout.write(`\rProgress: ${currentFrame}/${durationInFrames} frames (${pct}%)`);
                    }
                    // Complete
                    ffmpeg.stdin.end();
                    console.log(`\n✅ Render complete! Saved to: ${outputPath}`);
                    setTimeout(() => electron_1.app.quit(), 1000);
                }
                catch (error) {
                    console.error("Error in render loop:", error);
                    electron_1.app.quit();
                }
            };
            // Start the render loop
            renderLoop();
        });
    });
}
function startForgeRenderer(sceneFile, outputPath, opts = {}) {
    const port = Number(process.env.VITE_PORT ?? 3101);
    const absSceneFile = path.resolve(sceneFile);
    function createWindow() {
        mainWindow = new electron_1.BrowserWindow({
            width: 1080,
            height: 1920,
            useContentSize: true,
            frame: false,
            show: false,
            webPreferences: {
                contextIsolation: false,
                offscreen: true,
            },
        });
        mainWindow.webContents.setFrameRate(60);
        mainWindow.loadURL(`http://localhost:${port}/forge-scene.html`);
    }
    electron_1.app.whenReady().then(() => {
        createWindow();
        mainWindow.webContents.on('did-finish-load', async () => {
            try {
                if (!fs.existsSync(absSceneFile)) {
                    console.error(`Scene file not found: ${absSceneFile}`);
                    electron_1.app.quit();
                    return;
                }
                const sceneJson = fs.readFileSync(absSceneFile, 'utf8');
                const parsed = JSON.parse(sceneJson);
                const quality = parsed?.render?.quality ?? 'high';
                const bitrate = parsed?.render?.bitrate;
                console.log(`  Scene: ${parsed?.name ?? '(unnamed)'} — ${parsed?.objects?.length ?? 0} objects`);
                // Inject the scene (double-encoded so no escaping edge cases).
                await mainWindow.webContents.executeJavaScript(`window.__FORGE_SCENE__ = JSON.parse(${JSON.stringify(sceneJson)}); true;`);
                await mainWindow.webContents.executeJavaScript(`window.__FORGE_BOOT__ ? window.__FORGE_BOOT__().then(() => true) : false`);
                // Poll for readiness (physics WASM boot can take a few seconds).
                const t0 = Date.now();
                for (;;) {
                    const ready = await mainWindow.webContents.executeJavaScript(`window.__FORGE_READY__ === true`);
                    if (ready)
                        break;
                    if (Date.now() - t0 > 180000) {
                        console.error('Timed out waiting for scene boot.');
                        electron_1.app.quit();
                        return;
                    }
                    await new Promise((r) => setTimeout(r, 250));
                }
                const meta = await mainWindow.webContents.executeJavaScript(`window.__FORGE_META__`);
                if (!meta) {
                    console.error('Renderer did not report metadata.');
                    electron_1.app.quit();
                    return;
                }
                const { width, height, fps, durationInFrames } = meta;
                console.log(`  Format: ${width}×${height} @ ${fps}fps — ${durationInFrames} frames`);
                mainWindow.setContentSize(width, height);
                // Let the canvas resize propagate before frame 0.
                await new Promise((r) => setTimeout(r, 500));
                const ffmpeg = spawnFfmpegPipe({
                    width, height, fps, outputPath,
                    audioSourcePath: opts.audioFile,
                    quality,
                    bitrate,
                    gpuMode: opts.gpuMode ?? 'auto',
                });
                console.log(`⚡ Starting Forge frame pipeline: ${durationInFrames} frames...`);
                let currentFrame = 0;
                while (currentFrame < durationInFrames) {
                    await mainWindow.webContents.executeJavaScript(`
            window.__setFrame && window.__setFrame(${currentFrame});
            new Promise(r => {
              requestAnimationFrame(() => {
                requestAnimationFrame(() => r());
              });
            });
          `);
                    const image = await mainWindow.webContents.capturePage();
                    const rawBuffer = image.toBitmap();
                    const canWrite = ffmpeg.stdin.write(rawBuffer);
                    if (!canWrite) {
                        await new Promise((resolve) => ffmpeg.stdin.once('drain', resolve));
                    }
                    currentFrame++;
                    const pct = Math.round((currentFrame / durationInFrames) * 100);
                    process.stdout.write(`\rProgress: ${currentFrame}/${durationInFrames} frames (${pct}%)`);
                }
                ffmpeg.stdin.end();
                console.log(`\n✅ Render complete! Saved to: ${outputPath}`);
                setTimeout(() => electron_1.app.quit(), 1000);
            }
            catch (error) {
                console.error('Error in forge render loop:', error);
                electron_1.app.quit();
            }
        });
    });
}
// ─── CLI dispatch ───────────────────────────────────────────────────────────
// Forge mode:  electron electron/main.cjs --forge ./scene.forge.json ./out.mp4
// Motion mode: electron electron/main.cjs <compositionId> <outputPath>
const forgeFlag = process.argv.indexOf('--forge');
const envScene = process.env.FORGE_SCENE_FILE;
const envOut = process.env.OUTPUT_PATH;
if (forgeFlag >= 0 || envScene) {
    const sceneFile = envScene ?? process.argv[forgeFlag + 1] ?? process.argv[2];
    const outPath = envOut ?? process.argv[forgeFlag + 2] ?? process.argv[3];
    const gpuMode = process.env.FORGE_GPU_MODE ?? 'auto';
    const audioFile = process.env.FORGE_AUDIO_FILE;
    if (sceneFile && outPath) {
        startForgeRenderer(sceneFile, outPath, { gpuMode, audioFile });
    }
    else {
        console.error('Usage: electron electron/main.cjs --forge <scene.forge.json> <output.mp4>');
        process.exit(1);
    }
}
else {
    const compId = process.env.COMPOSITION_ID || process.argv[2];
    const outPath = process.env.OUTPUT_PATH || process.argv[3];
    if (compId && outPath) {
        startElectronRenderer(compId, outPath);
    }
    else if (require.main === module || !module.parent) {
        console.error('Usage: electron electron/main.js <compositionId> <outputPath>');
        process.exit(1);
    }
}
