# NativeForge — Physics Video Studio (`src/forge/`)

Browser-based 3D physics simulation + vertical-video studio, built alongside
the existing MotionFlow engine. MotionFlow files are untouched (except a
mode switch in `src/studio/App.tsx` and a volume fix in `useSFX.ts`); all
physics code lives in `src/forge/`.

## 1. Architecture

```
UI state (Zustand store)          src/forge/core/store.ts
   │  Scene Model (versioned JSON)
   ▼
PhysicsRuntime (Rapier + subsystems)   src/forge/physics/runtime.ts
   │  transforms per frame
   ▼
ThreeRuntime (three.js viewport)       src/forge/three/runtime.ts
```

- **React never owns physics.** The store holds the Scene Model; runtimes
  subscribe to `simRevision` / per-object `rev` and patch incrementally
  (teleport, rebuild-one-body, never rebuild-all).
- **Determinism:** fixed timestep, fixed call order, seeded streams
  (`core/rng.ts`). Same scene + seed + frame = same result (per
  platform/WASM build — cross-platform bit-identity is NOT claimed).
- **Frame-accurate render:** `gotoFrame(f)` restores exact state via
  keyframed Rapier snapshots + subsystem aux state. Final video never
  depends on wall-clock FPS.

## 2. Scene schema (`core/types.ts`)

`FORGE_SCHEMA_VERSION = 1`. A `ForgeScene` is self-contained:

```
sceneId, schemaVersion, name, dates, seed,
world (gravity/time/solver/air), objects[], cameras[], lights[],
events[], generators[], assets[] (refs), render{}, activeCameraId, thumbnail
```

- Unknown/newer schemas are **rejected with an error**, never guessed.
- Import re-issues `sceneId` so imports can't collide.
- `migrateScene()` is the single validation gate (studio, CLI, renderer).

## 3. Persistence & isolation (`core/db.ts`, `core/assets.ts`)

- **IndexedDB** (`scenes`, `revisions`, `assets`, `meta` stores) with a
  **Map-backed fallback** so tests/SSR run without a browser.
- **Transactional saves:** the previous revision is snapshotted BEFORE the
  new write lands; per-scene history (last 10) enables crash recovery.
- **Autosave** debounced at 1.5 s; explicit Save captures a viewport
  thumbnail first.
- **Reference-counted assets:** scenes retain on save/open, release on
  delete; GC collects only zero-ref **unprotected** assets. Deleting scene A
  can never break scene B (covered by `tests/isolation.test.ts`).
- `reconcileRefCounts()` repairs drift; `findOrphanAssets()` dry-runs GC.

## 4. Physics modules (`physics/`)

| Module | What it does | Honesty note |
|---|---|---|
| `runtime.ts` | Rapier world, fixed-step loop, snapshots, machines, wind/drag, pair response, spawn management, impulse joints (limits/motors/break) | Rapier rigid-body only; soft/fluid are separate systems |
| `materials.ts` | 12 physical presets + pair-interaction matrix + auto-mass math | Pair matrix is a **v1 corrective-impulse approximation** on top of real Rapier combine rules |
| `fields.ts` | Attractor/repulsor/vortex/wind/wave/turbulence/directional (pure force functions) | Real forces applied to dynamic bodies |
| `pressure.ts` | Lumped-parameter vessels: leak, venting, reaction + radial forces | **Not CFD** — pressure as a real simulated variable |
| `balloon.ts` | Puncture detector (tip touch / sharp impact / overpressure) + pop sequencing | Specialized system, reused via events for generic rupture |
| `fracture.ts` | Chunk planner (grid/radial/random/voronoi-lite) | **Chunk-based**, not mesh-accurate Voronoi (roadmap) |
| `generators.ts` | Grid/circle/spiral/tower/pile/domino bakers, seeded | Pure + deterministic; baked batches share instancing keys |
| `rope.ts` | Rope/chain bakers: rigid links + ball joints + optional static pin | Deterministic; delete-safe via `generatedJoints` |
| `render/batch.ts` | Pure seed-override / output-name / `--seeds` spec helpers | No I/O; CLI-tested |
| `emitters.ts` | Rate/burst/window/lifetime/maxAlive + oldest-recycle pooling | Deterministic spawn schedules |
| `events.ts` | 8 triggers × 13 actions, one-shot per run | Engine-agnostic, unit-tested |
| `cache.ts` | Keyframed snapshots + physics-hash invalidation | **Stale cache can never render**: hash mismatch drops everything |

Fracture rule: impact momentum `J = μ·v_rel` (reduced mass) must exceed
`breakImpulse`; sustained loads need `> J/dt` **and** `> 8× static weight`
so resting objects never break and presses still crush.

Balloon pop rule: sharp tip (sharpness ≥ 0.5) within `radius + 0.08 m`
pops on contact; sharp impacts ≥ 6 m/s slash-pop; pressure ≥ max bursts.

Joint model: `fixed / distance / hinge / slider / spring / ball / rope`
backed by real Rapier impulse joints (distance = stiff spring with a
50 kN/m floor). Limits and velocity/position motors apply to hinge and
slider; graphs rebuild when constraints change and after snapshot
restore (recorded breaks are re-applied without re-firing effects).
Break rule: stress proxy `σ = μ·|Δv|/dt` must exceed `breakForce` —
v1 approximation, see §8.

## 5. Viewport (`three/`)

- Shared geometry/material caches; generator batches render as
  **one `InstancedMesh` per (batch × material)** — 10k balls ≈ 1 draw call
  per color group.
- Orbit/pan/zoom, transform gizmos with snapping, multi-select, focus,
  look-through-camera, follow targets, camera shake.
- Debug overlays: colliders, velocity, contacts, centers of mass, sleeping
  bodies, **joints** (gold anchor-to-anchor links), grid/axes, safe-area,
  live stats (fps/bodies/joints/contacts/ms/draws).
- Effects: pop shrink animation, latex fragments (real bodies), GPU particle
  pool, shockwave rings, vent puffs, elastic squash for jelly-like materials.
- `captureAt(w,h)` renders exact export resolution for frame PNGs/thumbs.
- Quality tiers are real: pixel-ratio + shadow scaling.

## 6. Video export (Windows exporter integration)

Reuses the proven Electron offscreen → raw BGRA pipe → FFmpeg pipeline:

```
Browser: download .forge.json
   ▼
npx motionflow render-forge ./scene.forge.json --output out/clip.mp4 [--audio x.mp3] [--gpu-mode auto]
   ▼
Vite serves forge-scene.html → scene injected via executeJavaScript
   → __FORGE_BOOT__ → per frame __setFrame(f) → capturePage → FFmpeg
   ▼
H.264 MP4 (libx264 / NVENC / VideoToolbox / QSV / AMF auto-detect)
```

- `electron/main.ts` keeps the MotionFlow recipe **byte-identical**
  (`forceCpu` path); the forge path adds GPU detection + quality tiers +
  bitrate VBV caps.
- Record range (`recordStart..recordEnd`) maps to output frames; duration,
  resolution, FPS come from the scene's render settings.
- Current limits (documented, not hidden): H.264 only (HEVC/VP9 live in
  the schema as future values; the pipe is H.264 — see §8), no alpha
  (yuv420p), silent unless `--audio` is passed.
- Multi-seed batches: `render-forge-batch scene.forge.json --seeds 1-5
  --out-dir out/ [--base-name clip]` renders one MP4 per seed
  (`<base>-seed<seed>.mp4`), sequentially so Electron instances never
  fight over the GPU encoder.

## 7. UI map (`ui/`)

- `ForgeApp.tsx` — shell, runtime ownership, frame loop, shortcuts, export
  actions, safe-area + stats overlays.
- `AssetBrowser.tsx` — preset browser + 6 procedural generators (incl.
  rope/chain builder).
- `Inspector.tsx` — Basic/Advanced/Expert inspector; Object/World/Events/
  Joints/Render tabs. **Every visible control is wired** — no decorative sliders.
- `Timeline.tsx` — transport, deterministic scrub, record band, event
  markers, cache size.
- `SceneLibrary.tsx` — cards with thumbnail/meta; open/duplicate/rename/
  export/delete; demo + 100/1k/5k/10k benchmark starters.
- `sound.ts` — zero-asset WebAudio synth
  (pop/impact/crash/whoosh/blip/snap; snap = joint crack).

## 8. Known limits & roadmap (explicitly not faked)

- Soft bodies: squash visuals + elastic params only; true FEM/XPBD planned
  as a pluggable backend (`Soft Body System` module boundary exists in the
  runtime's subsystem layout).
- Fluids: buoyancy/drag/vessels only; SPH/FLIP planned behind the same
  `PressureSystem`-style boundary.
- Fracture is chunk-based (see §4).
- Codec selector beyond H.264, motion blur, and transparent-background
  export are planned; the Render tab marks quality/bitrate (real) vs codec
  (H.264 effective today).
- Joints ship (Inspector Joints tab + rope builder) but joint breaking
  uses a kinematic stress proxy, not solver reaction forces — thresholds
  are comparative, not calibrated Newtons; per-v1 joints are invisible at
  export resolution unless joint debug is on.
- Rope links are rigid bodies, not a continuum — very long ropes stretch
  slightly under load; increase solver iterations for crane-cable looks.

## 9. Extending

- **New object preset:** add a factory in `presets.ts` (+ category). It
  instantly works in the browser, emitters, and events.
- **New generator:** pure `(template, opts) => { objects, record }` in
  `generators.ts` + a tab in `AssetBrowser.tsx`. Must take a seed.
- **New behavior:** triggers/actions extend `events.ts` types + evaluator +
  `RuntimeOptions` wiring in `runtime.ts` `postFrame`.
- **New export backend:** implement the `__FORGE_*` protocol
  (`forgeEntry.tsx`) or add a CLI in `src/cli/`; register in `index.ts`.
- **New physics backend:** add a subsystem class (like `PressureSystem`)
  stepped from `postFrame`; include its state in `AuxState` for scrubbing.

## 10. Testing & benchmarks

- `npm test` (vitest): 38 tests — RNG, generators, fracture, balloon,
  events, cache, isolation, materials, Rapier determinism, scrub-exactness,
  **balloon-vs-cone burst integration**, fracture thresholds.
- `npm run typecheck`, `vite build` must stay green.
- Benchmarks: library starters generate 100 / 1k / 5k / 10k-ball scenes
  (seed 1337). Measure in the stats overlay: fps, physics ms, draw calls,
  triangles. Document numbers per machine before claiming counts.
