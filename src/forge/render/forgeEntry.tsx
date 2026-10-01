/**
 * forgeEntry — headless frame renderer for `render-forge`.
 *
 * Protocol (driven by electron/main.ts forge mode):
 *  1. Main process injects the scene: `window.__FORGE_SCENE__ = {...}`
 *  2. Main calls `window.__FORGE_BOOT__()` → boots physics + three.js
 *  3. Main polls `window.__FORGE_READY__`
 *  4. Main reads `window.__FORGE_META__` = { width, height, fps, durationInFrames }
 *  5. Per frame: `window.__setFrame(f)` renders recordStart+f deterministically
 *
 * Frames are pure simulation state — no wall-clock, no audio, no DOM
 * overlays — so the Electron capturePage pipe produces deterministic MP4s.
 */
import * as THREE from 'three';
import { PhysicsRuntime } from '../physics/runtime';
import { ThreeRuntime } from '../three/runtime';
import { templateProvider } from '../presets';
import { migrateScene, type ForgeScene } from '../core/types';
import { activeCameraTrack, evalCameraTrack } from './director';

declare global {
  interface Window {
    __FORGE_SCENE__?: ForgeScene;
    __FORGE_BOOT__?: () => Promise<void>;
    __FORGE_READY__?: boolean;
    __FORGE_META__?: {
      width: number;
      height: number;
      fps: number;
      durationInFrames: number;
    };
    __setFrame?: (f: number) => void;
  }
}

const statusEl = document.getElementById('forge-status');
function status(msg: string): void {
  if (statusEl) statusEl.textContent = msg;
  console.log(`[forgeEntry] ${msg}`);
}

let phys: PhysicsRuntime | null = null;
let view: ThreeRuntime | null = null;
let scene: ForgeScene | null = null;

window.__FORGE_BOOT__ = async () => {
  try {
    const raw = window.__FORGE_SCENE__;
    if (!raw) throw new Error('No scene injected (window.__FORGE_SCENE__ missing).');
    scene = migrateScene(raw);
    status(`booting "${scene.name}" (${scene.objects.length} objects)…`);

    const root = document.getElementById('root')!;
    const canvas = document.createElement('canvas');
    root.appendChild(canvas);

    phys = new PhysicsRuntime({ templateProvider, onEvent: () => {} });
    await phys.loadScene(scene);

    // Headless viewport: no selection, no gizmo edits, stats to console.
    view = new ThreeRuntime(canvas, {
      onSelect: () => {},
      onTransformEdit: () => {},
      onStats: () => {},
    });
    view.setQuality('ultra');
    view.syncScene(scene, [], {
      showColliders: false,
      showVelocity: false,
      showContacts: false,
      showCOM: false,
      showJoints: false,
      showSleeping: false,
      showGrid: false,
      showAxes: false,
      showSafeArea: false,
      showStats: false,
    });
    // Shadow catcher + grid stay hidden for clean frames; keep the catcher.
    renderFrame(scene.render.recordStart);

    const frames = Math.max(1, scene.render.recordEnd - scene.render.recordStart);
    window.__FORGE_META__ = {
      width: scene.render.width,
      height: scene.render.height,
      fps: scene.render.fps,
      durationInFrames: frames,
    };
    window.__FORGE_READY__ = true;
    if (statusEl) statusEl.style.display = 'none';
    status(`ready: ${frames} frames @ ${scene.render.width}×${scene.render.height}`);
  } catch (err) {
    status(`BOOT FAILED: ${(err as Error).message}`);
    throw err;
  }
};

function renderFrame(sceneFrame: number): void {
  if (!phys || !view || !scene) return;
  phys.gotoFrame(sceneFrame);
  const transforms = phys.transforms();
  const map = new Map(transforms.map((t) => [t.id, t]));
  view.applyTransforms(transforms, phys.poppedIds(), phys.fracturedIds());
  view.syncSpawned(phys.spawnedDescriptors(), phys.drainRemovedSpawned(), map);
  const cam = scene.cameras.find((c) => c.id === scene!.activeCameraId);
  const follow = cam?.followObjectId ? (map.get(cam.followObjectId) ?? null) : null;
  // Director camera moves render in export exactly as in the viewport.
  const track = activeCameraTrack(scene);
  const pose = track && cam ? evalCameraTrack(track, cam, sceneFrame) : null;
  // Fixed dt keeps particle visuals deterministic-ish per frame index.
  view.render(
    1 / Math.max(1, scene.render.fps),
    follow ? follow.p : null,
    0,
    pose ? { frame: sceneFrame, pose } : null,
  );
}

window.__setFrame = (f: number) => {
  if (!scene) return;
  renderFrame(scene.render.recordStart + Math.round(f));
};

// Keep THREE referenced for bundlers that tree-shake aggressively.
void THREE;
