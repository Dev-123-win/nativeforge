# Rendering Pipeline

The rendering engine transforms a web-based Framer Motion composition into a high-fidelity H.264 MP4 video. It runs entirely headless in Node.js without requiring a pre-installed system FFmpeg.

---

## 🚀 Step-by-Step Render Workflow

```
[Start Vite Server] (Port 3101)
        │
[Launch Headless Chromium] (Playwright)
        │
[page.clock.install()] (Intercept time APIs)
        │
[Navigate to composition.html] (With ID & Props)
        │
        ▼
 ┌─────────────── Frame Loop ───────────────┐
 │                                          │
 │ 1. page.clock.fastForward(frameDuration)  │ (Step time)
 │                                          │
 │ 2. requestAnimationFrame check           │ (Wait for repaint)
 │                                          │
 │ 3. page.screenshot({ type: 'png' })      │ (Capture buffer)
 │                                          │
 │ 4. sharp(pngBuffer).raw()                │ (Decode to RGBA)
 │                                          │
 │ 5. ffmpegProc.stdin.write(rgbaBuffer)    │ (Pipe raw pixels)
 │                                          │
 └──────────────────┬───────────────────────┘
                    │ (Finished all frames)
                    ▼
       [ffmpegProc.stdin.end()]
                    │
         [Generate Output MP4]
```

### 1. Vite Server Setup
A local Vite dev server is programmatically started on port `3101`. This matches the Studio config and compiles the React components on the fly (allowing hot module replacement).

### 2. Browser Initialization
Headless Playwright Chromium is launched. Before navigation, Playwright's `page.clock.install()` intercepts the system clock. 

### 3. Metadata Extraction
The page loads, registers the composition, and exposes its configuration parameters (`width`, `height`, `fps`, `durationInFrames`) on `window.__MOTIONFLOW_REGISTRY__`. The Node CLI evaluates these parameters to initialize the screenshot viewport and configure the encoder.

### 4. Spawning FFmpeg Subprocess
Rather than buffering entire sequences in memory (which causes Out-Of-Memory crashes on standard 1080p outputs), MotionFlow uses `ffmpeg-static` to spawn an incremental encoder:
- Input format: `rawvideo`, pixel format: `rgba`.
- Frame size matches composition dimensions exactly.
- Input is read continuously via standard input (`pipe:0`).
- Outputs to `libx264` format with a standard `yuv420p` pixel format (for universal player compatibility) and `-movflags +faststart` (for instant web streaming).

### 5. Incremental Render Loop
For each frame:
- **Time step**: The engine jumps forward by `1000 / fps` milliseconds.
- **Paint verification**: Wait for React to finish rendering:
  ```typescript
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())));
  ```
- **Capture**: `page.screenshot` retrieves a native binary PNG buffer (avoiding slow Base64 conversions).
- **Decode**: The native C++ addon `sharp` transforms the PNG to raw, uncompressed RGBA pixel bytes.
- **Write**: The bytes are written to FFmpeg's `stdin`. If writing returns false, the loop pauses for the `drain` event to respect backpressure.

---

## 🛠️ CLI Interface

The CLI entry is at `src/cli/index.ts`. It parses arguments using the `commander` package.

### Commands

#### 1. Studio
Starts the Vite dev server and opens the studio UI in the browser.
```bash
npx tsx src/cli/index.ts studio
```

#### 2. Render
Renders a single composition:
```bash
npx tsx src/cli/index.ts render <compositionId> [options]
```
Options:
- `--props '<json_string>'`: Key-value properties to override default props.
- `--output <file_path>`: The output filename destination.
- `--batch <json_file>`: Path to a file containing an array of props objects.
- `--concurrency <limit>`: Parallel browser pipelines during batch processing.

---

## ⚠️ Key Constraints

1. **Dimensions must be even**: The H.264 codec requires that the resolution width and height are divisible by 2. Odd-numbered resolutions will cause FFmpeg to fail with compilation errors.
2. **Backpressure**: Raw RGBA buffers for 1080p frames are ~8MB each. Ensure the stream is throttled using `stdin.once('drain', ...)` to prevent Node.js memory leaks during rendering.
