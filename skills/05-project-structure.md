# Project Structure

MotionFlow splits code bases between client-side React UI (the Studio + custom animations) and server-side CLI tools (the Playwright + FFmpeg rendering engine).

---

## 📁 Directory Map

```
frame native/
├── package.json               # Config, scripts, and dependencies
├── tsconfig.json              # Client React configuration
├── tsconfig.node.json         # Node CLI configuration
├── vite.config.ts             # Dev server config (multi-page entry)
├── index.html                 # Studio layout container (real time)
├── composition.html           # Isolated composition player (hijacked time)
├── skills/                    # AI Knowledge Base / documentation directory
├── src/
│   ├── Root.tsx               # Central composition registration file
│   ├── core/                  # Engine runtime and core context
│   │   ├── index.ts           # Public API barrel export
│   │   ├── Composition.tsx    # Declarative registry element
│   │   ├── registry.ts        # Map registry and window exposures
│   │   └── TimelineContext.tsx # Frame context, hooks, and message listener
│   ├── studio/                # Editor application code
│   │   ├── App.tsx            # Playback manager, loops, and hotkeys
│   │   ├── Viewport.tsx       # Iframe container & scale metrics
│   │   ├── PlayerBar.tsx      # Video controls, scrubber track, timecode
│   │   ├── CompositionList.tsx # Landing dashboard showing registered items
│   │   ├── compositionEntry.tsx # React root renderer for composition.html
│   │   └── styles.css         # Dark theme style sheets
│   ├── cli/                   # Node pipeline
│   │   ├── index.ts           # Commander CLI registry
│   │   ├── studio.ts          # Studio server launch helper
│   │   ├── render.ts          # Core rendering pipeline implementation
│   │   └── batch.ts           # Parallel batch render dispatcher
│   └── motions/               # Custom composition source components
│       └── Intro.tsx          # Default title-card animation example
└── out/                       # Compiled MP4 videos output destination
```

---

## 🎯 Entry Points

### 1. `index.html`
- Serves the **Studio Dashboard**.
- Loads `src/studio/main.tsx` which boots the wrapper React application.
- Runs in **real time** (no browser API overrides).

### 2. `composition.html`
- Serves the **Isolated Composition Player** loaded inside the viewport iframe.
- Contains the crucial inline script to intercept `performance.now()` before React mounts.
- Loads `src/studio/compositionEntry.tsx` which resolves compositions by querying URL parameters and renders the composition wrapped in `<TimelineProvider>`.

### 3. `src/cli/index.ts`
- Serves as the **Node CLI Entry Point**.
- Exposes `studio`, `render`, and `batch` commands.
- Runs inside Node.js, managing child processes (`ffmpeg-static`) and headless browser orchestration (`playwright`).
