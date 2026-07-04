"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.startElectronRenderer = startElectronRenderer;
const electron_1 = require("electron");
const child_process_1 = require("child_process");
const ffmpeg_static_1 = require("ffmpeg-static");
const path = require("path");
const fs = require("fs");
let mainWindow;
function startElectronRenderer(compositionId, outputPath) {
    function createWindow() {
        mainWindow = new electron_1.BrowserWindow({
            width: 1920, height: 1080, show: false,
            webPreferences: {
                preload: path.join(__dirname, 'preload.js'),
                contextIsolation: false,
                offscreen: true
            }
        });
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
            const audioSourcePath = path.join(process.cwd(), 'public/assets', `${compositionId.replace('edit-', '')}.mp4`);
            const args = [
                '-y', '-hide_banner', '-loglevel', 'error',
                '-f', 'rawvideo', '-pix_fmt', 'bgra',
                '-s', `${width}x${height}`, '-r', String(fps),
                '-i', 'pipe:0',
            ];
            if (fs.existsSync(audioSourcePath)) {
                args.push('-i', audioSourcePath);
                args.push('-map', '0:v', '-map', '1:a?', '-c:a', 'aac');
            }
            else {
                args.push('-map', '0:v');
            }
            args.push('-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-shortest', outputPath);
            const ffmpeg = (0, child_process_1.spawn)(ffmpeg_static_1.default || 'ffmpeg', args);
            ffmpeg.stderr?.on('data', (data) => console.error(`[ffmpeg] ${data.toString()}`));
            console.log(`⚡ Starting Raw Pixel Pipeline: ${durationInFrames} frames...`);
            let currentFrame = 0;
            let waitingForFrame = false;
            const stepFrame = async () => {
                if (waitingForFrame)
                    return;
                if (currentFrame >= durationInFrames) {
                    mainWindow.webContents.endFrameSubscription();
                    ffmpeg.stdin.end();
                    console.log(`✅ Render complete! Saved to: ${outputPath}`);
                    setTimeout(() => electron_1.app.quit(), 1000);
                    return;
                }
                waitingForFrame = true;
                await mainWindow.webContents.executeJavaScript(`
          window.__setFrame && window.__setFrame(${currentFrame}, ${fps});
          new Promise(r => requestAnimationFrame(() => r()));
        `);
            };
            mainWindow.webContents.beginFrameSubscription((image) => {
                if (!image || !waitingForFrame)
                    return;
                waitingForFrame = false;
                currentFrame++;
                const rawBuffer = image.getBitmap();
                const canWrite = ffmpeg.stdin.write(rawBuffer);
                if (canWrite)
                    stepFrame();
                else
                    ffmpeg.stdin.once('drain', () => stepFrame());
            });
            stepFrame();
        });
    });
}
// If run directly via Electron CLI
const compId = process.env.COMPOSITION_ID || process.argv[2];
const outPath = process.env.OUTPUT_PATH || process.argv[3];
if (compId && outPath) {
    startElectronRenderer(compId, outPath);
}
else if (require.main === module || !module.parent) {
    console.error("Usage: electron electron/main.js <compositionId> <outputPath>");
    process.exit(1);
}
