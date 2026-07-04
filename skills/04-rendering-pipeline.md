# Electron Rendering Pipeline

The rendering engine transforms a web-based Framer Motion composition into a high-fidelity H.264 MP4 video. It runs headlessly using an offscreen Electron process that captures rendered pages directly from the browser context in RAM and pipes them straight into FFmpeg.

---

## 🚀 Step-by-Step Render Workflow

```
[Start Vite Server] (Port 3101)
        │
[Launch Offscreen Electron] (main.cjs)
        │
[App Ready & CreateWindow] (useContentSize, frame:false)
        │
[Navigate to composition.html] (With ID & Props)
        │
        ▼
 ┌─────────────── Render Loop ───────────────┐
 │                                           │
 │ 1. setFrame & requestAnimationFrame sync  │ (Advance React state & repaint)
 │                                           │
 │ 2. webContents.capturePage()              │ (Pull raw BGRA image buffer)
 │                                           │
 │ 3. image.toBitmap()                       │ (Extract raw pixel bytes)
 │                                           │
 │ 4. ffmpeg.stdin.write(rawBuffer)          │ (Pipe BGRA pixels directly)
 │                                           │
 └──────────────────┬────────────────────────┘
                    │ (Finished all frames)
                    ▼
          [ffmpeg.stdin.end()]
                    │
          [Generate Output MP4]
```

### 1. Vite Server Setup
A local Vite dev server is programmatically started on port `3101`. This matches the Studio configuration and compiles the React components dynamically.

### 2. Electron Process Spawn
The CLI spawns Electron running `electron/main.cjs`. To ensure consistent execution on all platforms:
- Background throttling is disabled using `--disable-renderer-backgrounding` and `--disable-background-timer-throttling`.
- Display scale factor is locked to `1.0` using `--force-device-scale-factor=1` to prevent layout sizing bugs from high-DPI scaling.

### 3. Window Configuration
The `BrowserWindow` is initialized with:
- `offscreen: true` (fully headless windowing).
- `frame: false` and `useContentSize: true` (removes borders to make canvas bounds exact).
- `setContentSize(width, height)` matches the target composition resolution exactly.

### 4. Time-Hijacking & Repaint Synchronization
Framer Motion is advanced frame-by-frame:
- Preload script `electron/preload.js` intercepts `performance.now()` to advance time deterministically.
- Page context waits for two nested `requestAnimationFrame` ticks to guarantee that React state updates are fully committed and drawn to the canvas before capturing:
  ```javascript
  await webContents.executeJavaScript(`
    window.__setFrame && window.__setFrame(currentFrame, fps);
    new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => r())));
  `);
  ```

### 5. rawvideo FFmpeg Pipeline
Raw BGRA bytes are piped directly into FFmpeg `stdin`:
- FFmpeg reads raw pixels via `-f rawvideo -pix_fmt bgra -s <width>x<height> -r <fps> -i pipe:0`.
- System audio from background videos is overlaid if present: `-i public/assets/<id>.mp4 -map 0:v -map 1:a? -c:a aac -shortest`.
- Output is rendered losslessly using `-c:v libx264 -preset ultrafast -crf 18 -pix_fmt yuv420p`.

---

## 🛠️ CLI Interface

Render a single composition:
```bash
npx tsx src/cli/index.ts render <compositionId>
```
Options:
- `--props '<json_string>'`: Key-value properties to override default props.
- `--output <file_path>`: The output filename destination.
- `--batch <json_file>`: Path to a file containing an array of props objects.
- `--concurrency <limit>`: Parallel browser pipelines during batch processing.

---

## ⚠️ Key Constraints

1. **Dimensions must be even**: H.264 requires that resolution dimensions are divisible by 2.
2. **Backpressure**: Raw BGRA buffers are large (~8MB per frame at 1080p). Ensure backpressure is respected by checking `stdin.write` and awaiting the `drain` event if full.
3. **No GPU Dependencies**: Runs entirely inside virtual frames and CPU encoding (`libx264 -preset ultrafast`), making it highly optimized for weak spec hardware.
