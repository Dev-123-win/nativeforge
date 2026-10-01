/**
 * UI store (Zustand) — owns the Scene Model, NOT the simulation.
 *
 * Flow: UI state → Scene Model (here) → Physics/Three runtimes.
 * Runtimes subscribe to `simRevision` / per-object `rev` and patch
 * incrementally; React never holds physics bodies.
 */

import { create } from 'zustand';
import type {
  CameraData,
  CameraTrack,
  ForgeConstraint,
  ForgeEvent,
  ForgeObject,
  ForgeScene,
  GeneratorRecord,
  LightData,
  MotorTrack,
  RenderSettings,
  SceneSummary,
  UiLevel,
  WorldSettings,
} from './types';
import { makeScene, migrateScene, uid } from './types';
import {
  deleteSceneRecord,
  listSceneSummaries,
  loadScene,
  saveScene,
  setLastSession,
} from './db';
import { releaseSceneAssets, retainSceneAssets } from './assets';

export interface DebugFlags {
  showColliders: boolean;
  showVelocity: boolean;
  showContacts: boolean;
  showCOM: boolean;
  showJoints: boolean;
  showSleeping: boolean;
  showGrid: boolean;
  showAxes: boolean;
  showSafeArea: boolean;
  showStats: boolean;
}

export interface PlaybackState {
  frame: number;
  playing: boolean;
  speed: number;
}

interface ForgeState {
  summaries: SceneSummary[];
  libraryLoaded: boolean;
  activeScene: ForgeScene | null;
  dirty: boolean;
  saving: boolean;
  lastError: string | null;
  selection: string[];
  uiLevel: UiLevel;
  playback: PlaybackState;
  debug: DebugFlags;
  /** Bumped on any physics-relevant scene change → runtimes resync. */
  simRevision: number;

  refreshLibrary: () => Promise<void>;
  newScene: (name?: string) => Promise<string>;
  openScene: (sceneId: string) => Promise<void>;
  closeScene: () => Promise<void>;
  saveNow: () => Promise<void>;
  duplicateScene: (sceneId: string) => Promise<string>;
  renameScene: (sceneId: string, name: string) => Promise<void>;
  deleteSceneSafe: (sceneId: string) => Promise<void>;
  importSceneJson: (json: string) => Promise<string>;
  exportSceneJson: (sceneId: string) => Promise<string>;

  addObject: (obj: ForgeObject) => void;
  addObjects: (objs: ForgeObject[]) => void;
  patchObject: (id: string, patch: Partial<ForgeObject>) => void;
  removeObjects: (ids: string[]) => void;
  duplicateObjects: (ids: string[]) => void;
  clearDynamicState: () => void;

  patchWorld: (patch: Partial<WorldSettings>) => void;
  patchRender: (patch: Partial<RenderSettings>) => void;
  patchCamera: (id: string, patch: Partial<CameraData>) => void;
  patchLight: (id: string, patch: Partial<LightData>) => void;
  setActiveCamera: (id: string) => void;
  upsertEvent: (ev: ForgeEvent) => void;
  removeEvent: (id: string) => void;
  upsertConstraint: (c: ForgeConstraint) => void;
  addConstraints: (cs: ForgeConstraint[]) => void;
  removeConstraint: (id: string) => void;
  upsertCameraTrack: (t: CameraTrack) => void;
  removeCameraTrack: (id: string) => void;
  upsertMotorTrack: (t: MotorTrack) => void;
  removeMotorTrack: (id: string) => void;
  addGenerator: (g: GeneratorRecord) => void;
  removeGenerator: (id: string) => void;
  setSeed: (seed: number) => void;

  setSelection: (ids: string[]) => void;
  setUiLevel: (l: UiLevel) => void;
  setPlayback: (p: Partial<PlaybackState>) => void;
  setDebug: (d: Partial<DebugFlags>) => void;
  setError: (msg: string | null) => void;
}

const DEFAULT_DEBUG: DebugFlags = {
  showColliders: false,
  showVelocity: false,
  showContacts: false,
  showCOM: false,
  showJoints: true,
  showSleeping: false,
  showGrid: true,
  showAxes: true,
  showSafeArea: true,
  showStats: true,
};

/* Autosave (debounced, transactional via db.saveScene) */
let autosaveTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleAutosave(): void {
  if (autosaveTimer) clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(() => {
    autosaveTimer = null;
    void useForge.getState().saveNow();
  }, 1500);
}

function touchScene(s: ForgeScene): ForgeScene {
  return { ...s, updatedAt: Date.now() };
}

export const useForge = create<ForgeState>((set, get) => ({
  summaries: [],
  libraryLoaded: false,
  activeScene: null,
  dirty: false,
  saving: false,
  lastError: null,
  selection: [],
  uiLevel: 'basic',
  playback: { frame: 0, playing: false, speed: 1 },
  debug: { ...DEFAULT_DEBUG },
  simRevision: 0,

  refreshLibrary: async () => {
    try {
      const summaries = await listSceneSummaries();
      set({ summaries, libraryLoaded: true });
    } catch (e) {
      set({ lastError: `Library load failed: ${(e as Error).message}` });
    }
  },

  newScene: async (name = 'Untitled Scene') => {
    const scene = makeScene(name);
    await saveScene(scene);
    await retainSceneAssets(scene);
    await setLastSession(scene.sceneId);
    await get().refreshLibrary();
    set({
      activeScene: scene,
      dirty: false,
      selection: [],
      playback: { frame: 0, playing: false, speed: 1 },
      simRevision: get().simRevision + 1,
    });
    return scene.sceneId;
  },

  openScene: async (sceneId: string) => {
    // Persist current scene first — never strand user data.
    if (get().activeScene && get().dirty) await get().saveNow();
    const raw = await loadScene(sceneId);
    if (!raw) {
      set({ lastError: `Scene ${sceneId} not found in storage.` });
      return;
    }
    let scene: ForgeScene;
    try {
      scene = migrateScene(raw);
    } catch (e) {
      set({ lastError: `Scene failed validation: ${(e as Error).message}` });
      return;
    }
    await retainSceneAssets(scene);
    await setLastSession(scene.sceneId);
    set({
      activeScene: scene,
      dirty: false,
      selection: [],
      playback: { frame: 0, playing: false, speed: 1 },
      simRevision: get().simRevision + 1,
    });
  },

  closeScene: async () => {
    if (get().activeScene && get().dirty) await get().saveNow();
    await setLastSession(null);
    set({ activeScene: null, selection: [], dirty: false });
    await get().refreshLibrary();
  },

  saveNow: async () => {
    const { activeScene, saving } = get();
    if (!activeScene || saving) return;
    set({ saving: true });
    try {
      const stamped = touchScene(activeScene);
      await saveScene(stamped);
      await retainSceneAssets(stamped);
      set({ activeScene: stamped, dirty: false });
      await get().refreshLibrary();
    } catch (e) {
      set({ lastError: `Save failed: ${(e as Error).message}` });
    } finally {
      set({ saving: false });
    }
  },

  duplicateScene: async (sceneId: string) => {
    const raw = await loadScene(sceneId);
    if (!raw) throw new Error('Scene to duplicate was not found.');
    const scene = migrateScene(structuredClone(raw));
    const now = Date.now();
    const idMap = new Map<string, string>();
    // Remap object ids so events/generators stay internally consistent.
    for (const o of scene.objects) idMap.set(o.id, uid('obj'));
    for (const o of scene.objects) {
      o.id = idMap.get(o.id)!;
      o.rev = 1;
    }
    for (const g of scene.generators) {
      g.id = uid('gen');
      g.generatedIds = g.generatedIds
        .map((id) => idMap.get(id))
        .filter((x): x is string => !!x);
    }
    const remapTarget = (id: string | null) =>
      id ? (idMap.get(id) ?? id) : id;
    const jointMap = new Map<string, string>();
    for (const c of scene.constraints) {
      const newId = uid('joint');
      jointMap.set(c.id, newId);
      c.id = newId;
      c.bodyA = idMap.get(c.bodyA) ?? c.bodyA;
      c.bodyB = idMap.get(c.bodyB) ?? c.bodyB;
      c.rev = 1;
    }
    for (const g of scene.generators) {
      g.generatedJoints = (g.generatedJoints ?? [])
        .map((id) => jointMap.get(id))
        .filter((x): x is string => !!x);
    }
    for (const t of scene.motorTracks) {
      t.id = uid('motortrack');
      t.jointId = jointMap.get(t.jointId) ?? t.jointId;
    }
    for (const t of scene.cameraTracks) {
      t.id = uid('camtrack');
    }
    for (const e of scene.events) {
      e.id = uid('evt');
      e.trigger.objectA = remapTarget(e.trigger.objectA);
      e.trigger.objectB = remapTarget(e.trigger.objectB);
      e.action.targetId = remapTarget(e.action.targetId);
      e.fired = false;
    }
    for (const c of scene.cameras) {
      c.followObjectId = remapTarget(c.followObjectId);
    }
    scene.sceneId = uid('scene');
    scene.name = `${scene.name} (copy)`;
    scene.createdAt = now;
    scene.updatedAt = now;
    await saveScene(scene);
    await retainSceneAssets(scene); // shared assets gain a ref — never copied
    await get().refreshLibrary();
    return scene.sceneId;
  },

  renameScene: async (sceneId: string, name: string) => {
    const raw = await loadScene(sceneId);
    if (!raw) return;
    raw.name = name;
    await saveScene(raw);
    const { activeScene } = get();
    if (activeScene?.sceneId === sceneId) {
      set({ activeScene: { ...activeScene, name } });
    }
    await get().refreshLibrary();
  },

  deleteSceneSafe: async (sceneId: string) => {
    const raw = await loadScene(sceneId);
    if (get().activeScene?.sceneId === sceneId) {
      set({ activeScene: null, selection: [], dirty: false });
      await setLastSession(null);
    }
    if (raw) {
      // Release refs FIRST so GC only collects assets nobody else uses.
      await releaseSceneAssets(migrateScene(raw));
    }
    await deleteSceneRecord(sceneId);
    await get().refreshLibrary();
  },

  importSceneJson: async (json: string) => {
    let raw: unknown;
    try {
      raw = JSON.parse(json);
    } catch {
      throw new Error('File is not valid JSON.');
    }
    const scene = migrateScene(raw);
    scene.sceneId = uid('scene'); // imports never collide with existing ids
    scene.updatedAt = Date.now();
    await saveScene(scene);
    await retainSceneAssets(scene);
    await get().refreshLibrary();
    return scene.sceneId;
  },

  exportSceneJson: async (sceneId: string) => {
    const { activeScene } = get();
    if (activeScene?.sceneId === sceneId) return JSON.stringify(activeScene);
    const raw = await loadScene(sceneId);
    if (!raw) throw new Error('Scene not found.');
    return JSON.stringify(raw);
  },

  /* ── Object mutations (immutable, rev-bumped, autosaved) ── */

  addObject: (obj) => {
    const { activeScene } = get();
    if (!activeScene) return;
    set({
      activeScene: touchScene({
        ...activeScene,
        objects: [...activeScene.objects, obj],
      }),
      dirty: true,
      selection: [obj.id],
      simRevision: get().simRevision + 1,
    });
    scheduleAutosave();
  },

  addObjects: (objs) => {
    const { activeScene } = get();
    if (!activeScene || objs.length === 0) return;
    set({
      activeScene: touchScene({
        ...activeScene,
        objects: [...activeScene.objects, ...objs],
      }),
      dirty: true,
      selection: objs.map((o) => o.id),
      simRevision: get().simRevision + 1,
    });
    scheduleAutosave();
  },

  patchObject: (id, patch) => {
    const { activeScene } = get();
    if (!activeScene) return;
    const idx = activeScene.objects.findIndex((o) => o.id === id);
    if (idx < 0) return;
    const objects = activeScene.objects.slice();
    objects[idx] = { ...objects[idx], ...patch, rev: objects[idx].rev + 1 };
    set({
      activeScene: touchScene({ ...activeScene, objects }),
      dirty: true,
      simRevision: get().simRevision + 1,
    });
    scheduleAutosave();
  },

  removeObjects: (ids) => {
    const { activeScene, selection } = get();
    if (!activeScene) return;
    const doomed = new Set(ids);
    set({
      activeScene: touchScene({
        ...activeScene,
        objects: activeScene.objects.filter((o) => !doomed.has(o.id)),
        constraints: activeScene.constraints.filter(
          (c) => !doomed.has(c.bodyA) && !doomed.has(c.bodyB),
        ),
        generators: activeScene.generators.map((g) => ({
          ...g,
          generatedIds: g.generatedIds.filter((id) => !doomed.has(id)),
        })),
      }),
      dirty: true,
      selection: selection.filter((id) => !doomed.has(id)),
      simRevision: get().simRevision + 1,
    });
    scheduleAutosave();
  },

  duplicateObjects: (ids) => {
    const { activeScene } = get();
    if (!activeScene) return;
    const clones: ForgeObject[] = [];
    for (const id of ids) {
      const src = activeScene.objects.find((o) => o.id === id);
      if (!src) continue;
      const c = structuredClone(src);
      c.id = uid('obj');
      c.name = `${src.name} copy`;
      c.rev = 1;
      c.transform.position = [
        src.transform.position[0] + 0.5,
        src.transform.position[1] + 0.5,
        src.transform.position[2],
      ];
      clones.push(c);
    }
    if (clones.length === 0) return;
    set({
      activeScene: touchScene({
        ...activeScene,
        objects: [...activeScene.objects, ...clones],
      }),
      dirty: true,
      selection: clones.map((c) => c.id),
      simRevision: get().simRevision + 1,
    });
    scheduleAutosave();
  },

  /** Reset popped/fractured/fired runtime flags without touching design data. */
  clearDynamicState: () => {
    const { activeScene } = get();
    if (!activeScene) return;
    set({
      activeScene: touchScene({
        ...activeScene,
        objects: [
          ...activeScene.objects.filter((o) => o.kind !== 'fragment'),
        ].map((o) => ({
          ...o,
          rev: o.rev + 1,
          balloon: o.balloon
            ? { ...o.balloon, popped: false, deflation: 0 }
            : o.balloon,
          breakable: o.breakable
            ? { ...o.breakable, fractured: false }
            : o.breakable,
        })),
        events: activeScene.events.map((e) => ({ ...e, fired: false })),
      }),
      dirty: true,
      playback: { ...get().playback, frame: 0, playing: false },
      simRevision: get().simRevision + 1,
    });
    scheduleAutosave();
  },

  patchWorld: (patch) => {
    const { activeScene } = get();
    if (!activeScene) return;
    set({
      activeScene: touchScene({
        ...activeScene,
        world: { ...activeScene.world, ...patch },
      }),
      dirty: true,
      simRevision: get().simRevision + 1,
    });
    scheduleAutosave();
  },

  patchRender: (patch) => {
    const { activeScene } = get();
    if (!activeScene) return;
    set({
      activeScene: touchScene({
        ...activeScene,
        render: { ...activeScene.render, ...patch },
      }),
      dirty: true,
    });
    scheduleAutosave();
  },

  patchCamera: (id, patch) => {
    const { activeScene } = get();
    if (!activeScene) return;
    set({
      activeScene: touchScene({
        ...activeScene,
        cameras: activeScene.cameras.map((c) =>
          c.id === id ? { ...c, ...patch } : c,
        ),
      }),
      dirty: true,
    });
    scheduleAutosave();
  },

  patchLight: (id, patch) => {
    const { activeScene } = get();
    if (!activeScene) return;
    set({
      activeScene: touchScene({
        ...activeScene,
        lights: activeScene.lights.map((l) =>
          l.id === id ? { ...l, ...patch } : l,
        ),
      }),
      dirty: true,
    });
    scheduleAutosave();
  },

  setActiveCamera: (id) => {
    const { activeScene } = get();
    if (!activeScene) return;
    set({
      activeScene: touchScene({ ...activeScene, activeCameraId: id }),
      dirty: true,
    });
    scheduleAutosave();
  },

  upsertEvent: (ev) => {
    const { activeScene } = get();
    if (!activeScene) return;
    const exists = activeScene.events.some((e) => e.id === ev.id);
    set({
      activeScene: touchScene({
        ...activeScene,
        events: exists
          ? activeScene.events.map((e) => (e.id === ev.id ? ev : e))
          : [...activeScene.events, ev],
      }),
      dirty: true,
      simRevision: get().simRevision + 1,
    });
    scheduleAutosave();
  },

  removeEvent: (id) => {
    const { activeScene } = get();
    if (!activeScene) return;
    set({
      activeScene: touchScene({
        ...activeScene,
        events: activeScene.events.filter((e) => e.id !== id),
      }),
      dirty: true,
      simRevision: get().simRevision + 1,
    });
    scheduleAutosave();
  },

  upsertConstraint: (c) => {
    const { activeScene } = get();
    if (!activeScene) return;
    const exists = activeScene.constraints.some((x) => x.id === c.id);
    set({
      activeScene: touchScene({
        ...activeScene,
        constraints: exists
          ? activeScene.constraints.map((x) =>
              x.id === c.id ? { ...c, rev: x.rev + 1 } : x,
            )
          : [...activeScene.constraints, c],
      }),
      dirty: true,
      simRevision: get().simRevision + 1,
    });
    scheduleAutosave();
  },

  addConstraints: (cs) => {
    const { activeScene } = get();
    if (!activeScene || cs.length === 0) return;
    set({
      activeScene: touchScene({
        ...activeScene,
        constraints: [...activeScene.constraints, ...cs],
      }),
      dirty: true,
      simRevision: get().simRevision + 1,
    });
    scheduleAutosave();
  },

  removeConstraint: (id) => {
    const { activeScene } = get();
    if (!activeScene) return;
    set({
      activeScene: touchScene({
        ...activeScene,
        constraints: activeScene.constraints.filter((x) => x.id !== id),
        motorTracks: activeScene.motorTracks.filter((t) => t.jointId !== id),
      }),
      dirty: true,
      simRevision: get().simRevision + 1,
    });
    scheduleAutosave();
  },

  upsertCameraTrack: (t) => {
    const { activeScene } = get();
    if (!activeScene) return;
    const sorted: CameraTrack = {
      ...t,
      position: [...t.position].sort((a, b) => a.frame - b.frame),
      target: [...t.target].sort((a, b) => a.frame - b.frame),
      fov: [...t.fov].sort((a, b) => a.frame - b.frame),
    };
    const exists = activeScene.cameraTracks.some((x) => x.id === t.id);
    set({
      activeScene: touchScene({
        ...activeScene,
        cameraTracks: exists
          ? activeScene.cameraTracks.map((x) => (x.id === t.id ? sorted : x))
          : [...activeScene.cameraTracks, sorted],
      }),
      dirty: true,
    });
    scheduleAutosave();
  },

  removeCameraTrack: (id) => {
    const { activeScene } = get();
    if (!activeScene) return;
    set({
      activeScene: touchScene({
        ...activeScene,
        cameraTracks: activeScene.cameraTracks.filter((x) => x.id !== id),
      }),
      dirty: true,
    });
    scheduleAutosave();
  },

  upsertMotorTrack: (t) => {
    const { activeScene } = get();
    if (!activeScene) return;
    const sorted: MotorTrack = {
      ...t,
      keys: [...t.keys].sort((a, b) => a.frame - b.frame),
    };
    const exists = activeScene.motorTracks.some((x) => x.id === t.id);
    set({
      activeScene: touchScene({
        ...activeScene,
        motorTracks: exists
          ? activeScene.motorTracks.map((x) => (x.id === t.id ? sorted : x))
          : [...activeScene.motorTracks, sorted],
      }),
      dirty: true,
      simRevision: get().simRevision + 1,
    });
    scheduleAutosave();
  },

  removeMotorTrack: (id) => {
    const { activeScene } = get();
    if (!activeScene) return;
    set({
      activeScene: touchScene({
        ...activeScene,
        motorTracks: activeScene.motorTracks.filter((x) => x.id !== id),
      }),
      dirty: true,
      simRevision: get().simRevision + 1,
    });
    scheduleAutosave();
  },

  addGenerator: (g) => {
    const { activeScene } = get();
    if (!activeScene) return;
    set({
      activeScene: touchScene({
        ...activeScene,
        generators: [...activeScene.generators, g],
      }),
      dirty: true,
      simRevision: get().simRevision + 1,
    });
    scheduleAutosave();
  },

  removeGenerator: (id) => {
    const { activeScene } = get();
    if (!activeScene) return;
    const gen = activeScene.generators.find((g) => g.id === id);
    const doomed = new Set(gen?.generatedIds ?? []);
    const doomedJoints = new Set(gen?.generatedJoints ?? []);
    set({
      activeScene: touchScene({
        ...activeScene,
        generators: activeScene.generators.filter((g) => g.id !== id),
        objects: activeScene.objects.filter((o) => !doomed.has(o.id)),
        constraints: activeScene.constraints.filter((c) => !doomedJoints.has(c.id)),
      }),
      dirty: true,
      simRevision: get().simRevision + 1,
    });
    scheduleAutosave();
  },

  setSeed: (seed) => {
    const { activeScene } = get();
    if (!activeScene) return;
    set({
      activeScene: touchScene({ ...activeScene, seed }),
      dirty: true,
      playback: { ...get().playback, frame: 0, playing: false },
      simRevision: get().simRevision + 1,
    });
    scheduleAutosave();
  },

  setSelection: (ids) => set({ selection: ids }),
  setUiLevel: (l) => set({ uiLevel: l }),
  setPlayback: (p) =>
    set({ playback: { ...get().playback, ...p } }),
  setDebug: (d) => set({ debug: { ...get().debug, ...d } }),
  setError: (msg) => set({ lastError: msg }),
}));
