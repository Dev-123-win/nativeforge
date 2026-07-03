# MotionFlow Overview

MotionFlow is a programmatic motion design generator and video rendering engine built on top of **React**, **Vite**, **Framer Motion**, and **Playwright**.

---

## 🎯 Core Philosophy

Unlike typical frame-by-frame rendering engines (such as Remotion) which force developers to write manual math interpolation (e.g., calling `interpolate(frame, [0, 10], [0, 100])`), **MotionFlow leverages 100% of Framer Motion's power natively**. 

All physics-based transitions (springs), layout animations, exit animations (`AnimatePresence`), and stagger animations work exactly as they do in a standard React web application.

To achieve this without real-time capture lag or dropped frames, **MotionFlow hijacks the browser's internal clock**. Instead of "playing and recording" in real time, the engine advances the browser's time coordinates frame-by-frame and captures snapshots deterministically.

---

## 🏗️ The Two Environments

MotionFlow runs in two distinct modes depending on the workflow:

```
                  ┌──────────────────────┐
                  │   MotionFlow Entry   │
                  └──────────┬───────────┘
                             │
              ┌──────────────┴──────────────┐
              ▼                             ▼
   ┌────────────────────┐        ┌────────────────────┐
   │    Studio Mode     │        │    Render Mode     │
   │ (index.html, port) │        │ (Playwright CLI)   │
   └──────────┬─────────┘        └──────────┬─────────┘
              │                             │
    Parent UI (Real Time)          Deterministic Engine
              │                             │
    Sandboxed iframe               Playwright page.clock
     (Hijacked Time)              Fast-forwards timeline
```

### 1. The Studio (Live Preview)
- A local web interface launched via `npm run studio` or `motionflow studio`.
- Uses **iframe isolation**:
  - The parent window hosting player controls, timeline slider, and list of compositions runs on **real time**.
  - The composition itself is sandboxed inside an `<iframe>` (navigated to `composition.html`).
  - Inside the iframe, `performance.now()` is overridden to jump to specific timestamps whenever the user scrubs or plays the timeline.
  - Time scrubs are communicated via `postMessage({ type: 'SET_FRAME', frame })`.

### 2. The Renderer (Headless MP4 Export)
- A Node.js CLI process launched via `motionflow render <compositionId>`.
- Spawns a headless **Playwright** browser instance and navigates to the composition.
- Installs Playwright's native `page.clock` API before navigation to intercept and control the browser's internal timeline (`performance.now()`, `Date.now()`, `requestAnimationFrame`, `setTimeout`, etc.).
- Steps frame-by-frame via `page.clock.fastForward(frameDuration)` and pipes raw screenshot buffers into an `ffmpeg-static` subprocess.
