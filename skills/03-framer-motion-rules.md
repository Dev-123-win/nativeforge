# Framer Motion & Clock Hijacking Rules

Because MotionFlow renders videos frame-by-frame and allows frame scrubbing, time is non-linear. You must strictly adhere to the following execution constraints to ensure visual consistency between the Studio preview and the final MP4 output.

---

## 🚫 What You Must Avoid

Do NOT use real-time Web APIs or native timers inside your composition components. Since time is stepped deterministically, real-world clocks will lead to mismatched animation frames, skipped render loops, and engine crashes.

1. **Do not use `Date.now()` or `performance.now()` directly** for tracking animations. Use the `useCurrentFrame()` hook instead.
2. **Do not use `setTimeout` or `setInterval`** for timed events. Time events should be bound to the frame number (e.g., `frame > 30` means 1 second has passed in a 30fps video).
3. **Do not use `requestAnimationFrame`** inside your compositions to drive state changes. Framer Motion hooks into the hijacked clock automatically, but custom handlers will run asynchronously and break frame rendering.

---

## ⏱️ How Clock Hijacking Works

The engine runs time hijacking differently depending on whether it is running the preview UI (Studio) or executing a CLI render:

### 1. Studio Mode (Iframe Isolation)
In the Studio preview, we only hijack `performance.now()`. We leave `requestAnimationFrame` running naturally at the display's actual refresh rate.
- An inline script in `composition.html` intercepts and overrides `performance.now()` before React loads:
  ```javascript
  var _origNow = performance.now.bind(performance);
  Object.defineProperty(performance, 'now', {
    get: function() {
      return function() {
        var override = performance.__motionFlowOverride;
        return (override !== undefined) ? override : _origNow();
      };
    }
  });
  ```
- When scrubbing, the parent window sends a `SET_FRAME` postMessage.
- The iframe's `TimelineProvider` receives the message, computes the target timestamp (`(frame / fps) * 1000`), sets `performance.__motionFlowOverride` **synchronously**, and triggers a React state update.
- Framer Motion reads this overridden time value on the very next frame render loop and instantly snaps the spring state to that exact frame.

### 2. Render Mode (Playwright Engine)
In headless render mode, Playwright's `page.clock` API is installed before navigating to the page.
- `page.clock` overrides `performance.now`, `Date.now`, `setTimeout`, `setInterval`, **and** `requestAnimationFrame` at the browser engine level.
- During rendering, the CLI loop steps forward exactly one frame duration (e.g., `33.33ms` for 30fps) by calling:
  ```typescript
  await page.clock.fastForward(1000 / fps);
  ```
- This safely triggers all pending `requestAnimationFrame` and timer callbacks registered by Framer Motion synchronously, avoiding infinite rendering loops.

---

## 📹 Video Synchronization Rule

When building compositions that include background video layers, you **cannot** rely on native media auto-play. Because time is stepped deterministically, the video decoder does not follow the mocked clock naturally, resulting in blank/frozen screenshots.

To synchronize video playback cleanly:
1. Attach a `useRef<HTMLVideoElement>` to the `<video>` element.
2. Call the `useVideoSync(videoRef)` hook exported from `motionflow` inside your composition:
   ```typescript
   import { useVideoSync } from 'motionflow';

   export default function MyComposition() {
     const videoRef = React.useRef<HTMLVideoElement>(null);
     
     // Centralized hook that handles play/pause sync, scrubbing seeks, 
     // and Playwright seeks automatically.
     useVideoSync(videoRef);

     return <video ref={videoRef} src="..." />;
   }
   ```

