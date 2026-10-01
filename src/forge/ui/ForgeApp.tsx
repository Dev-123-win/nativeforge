/**
 * ForgeApp — Physics Studio shell.
 *
 * Owns the two runtimes (PhysicsRuntime + ThreeRuntime) and the frame loop.
 * React state is NEVER the physics engine: the loop pushes scene → physics
 * → transforms → three.js every tick.
 */
import React from 'react';
import { useForge } from '../core/store';
import { PhysicsRuntime, type PhysicsStats, type RuntimeEventMsg } from '../physics/runtime';
import { ThreeRuntime, type ViewportStats } from '../three/runtime';
import { templateProvider } from '../presets';
import { AssetBrowser } from './AssetBrowser';
import { Inspector, type RenderActions } from './Inspector';
import { Timeline } from './Timeline';
import { SceneLibrary } from './SceneLibrary';
import { playSynth } from './sound';
import './forge.css';

export function ForgeApp({ onExit }: { onExit: () => void }) {
  const activeScene = useForge((s) => s.activeScene);
  const refreshLibrary = useForge((s) => s.refreshLibrary);

  React.useEffect(() => {
    void refreshLibrary();
  }, [refreshLibrary]);

  if (!activeScene) return <SceneLibrary onExit={onExit} />;
  return <Editor key={activeScene.sceneId} onExit={onExit} />;
}

type GizmoMode = 'translate' | 'rotate' | 'scale';

function Editor({ onExit }: { onExit: () => void }) {
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const threeRef = React.useRef<ThreeRuntime | null>(null);
  const physRef = React.useRef<PhysicsRuntime | null>(null);
  const accRef = React.useRef(0);
  const readyRef = React.useRef(false);
  const lastVentRef = React.useRef(0);
  const [ready, setReady] = React.useState(false);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [vStats, setVStats] = React.useState<ViewportStats | null>(null);
  const [pStats, setPStats] = React.useState<PhysicsStats | null>(null);
  const [cacheSize, setCacheSize] = React.useState(0);
  const [brokenJoints, setBrokenJoints] = React.useState<string[]>([]);
  const [gizmoMode, setGizmoModeState] = React.useState<GizmoMode>('translate');
  const [snapOn, setSnapOn] = React.useState(true);
  const [lookThrough, setLookThrough] = React.useState(false);
  const [quality, setQuality] = React.useState<'draft' | 'medium' | 'high' | 'ultra'>('high');

  const scene = useForge((s) => s.activeScene);
  const simRevision = useForge((s) => s.simRevision);
  const selection = useForge((s) => s.selection);
  const debug = useForge((s) => s.debug);

  /* ── Mount runtimes + frame loop ── */
  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let alive = true;
    let raf = 0;
    let last = performance.now();
    let statAt = 0;

    const handleEvent = (e: RuntimeEventMsg) => {
      const three = threeRef.current;
      const st = useForge.getState();
      if (e.type === 'pop' && e.point) {
        const def = st.activeScene?.objects.find((o) => o.id === e.objectId);
        three?.burst(e.point, def?.visual.baseColor ?? '#ff3b3b', 70, 1.2);
        three?.shockwave(e.point, 3);
        playSynth('pop', 1);
      } else if (e.type === 'fracture' && e.point) {
        three?.burst(e.point, '#ffffff', 45, 1);
        playSynth('crash', e.intensity ?? 0.9);
      } else if (e.type === 'sound') {
        playSynth(e.name ?? 'blip', e.intensity ?? 1);
      } else if (e.type === 'particles' && e.point) {
        three?.burst(e.point, '#ffd166', Math.round(30 * (e.intensity ?? 1)), 1);
      } else if (e.type === 'vent' && e.point) {
        const now = performance.now();
        if (now - lastVentRef.current > 180) {
          lastVentRef.current = now;
          three?.burst(e.point, '#9fd8ff', 6, 0.4);
        }
      } else if (e.type === 'camera' && e.cameraId) {
        st.setActiveCamera(e.cameraId);
      }
    };

    const phys = new PhysicsRuntime({ templateProvider, onEvent: handleEvent });
    physRef.current = phys;
    const three = new ThreeRuntime(canvas, {
      onSelect: (ids) => useForge.getState().setSelection(ids),
      onTransformEdit: (id, tpatch) => {
        const st = useForge.getState();
        const obj = st.activeScene?.objects.find((o) => o.id === id);
        if (!obj) return;
        st.patchObject(id, {
          transform: {
            position: tpatch.position ?? obj.transform.position,
            rotation: tpatch.rotation ?? obj.transform.rotation,
            scale: tpatch.scale ?? obj.transform.scale,
          },
        });
      },
      onStats: (s) => setVStats(s),
    });
    threeRef.current = three;
    three.setSnapping(true);

    const boot = async () => {
      try {
        const sc = useForge.getState().activeScene;
        if (!sc) throw new Error('No active scene.');
        await phys.loadScene(sc);
        if (!alive) return;
        three.syncScene(sc, [], useForge.getState().debug);
        readyRef.current = true;
        setReady(true);
      } catch (err) {
        if (!alive) return;
        setLoadError((err as Error).message);
      }
    };
    void boot();

    const tick = () => {
      if (!alive) return;
      raf = requestAnimationFrame(tick);
      const now = performance.now();
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const st = useForge.getState();
      const sc = st.activeScene;
      const p = physRef.current;
      const t3 = threeRef.current;
      if (!sc || !p || !t3 || !readyRef.current) return;

      // Advance playback clock.
      if (st.playback.playing) {
        accRef.current += dt * sc.world.renderFps * st.playback.speed * sc.world.timeScale;
        const n = Math.floor(accRef.current);
        accRef.current -= n;
        if (n > 0) {
          const max = sc.render.durationFrames - 1;
          const f = Math.min(st.playback.frame + n, max);
          st.setPlayback({ frame: f });
          if (f >= max) st.setPlayback({ playing: false });
        }
      }
      // Reconcile physics to desired frame.
      const want = useForge.getState().playback.frame;
      const have = p.currentFrame;
      if (want !== have) {
        if (want < have || want - have > 120) {
          t3.resetPopAnims();
          try {
            p.gotoFrame(want);
          } catch (err) {
            st.setError(`Simulation error: ${(err as Error).message}`);
            st.setPlayback({ playing: false });
          }
        } else {
          try {
            p.stepFrames(want - have);
          } catch (err) {
            st.setError(`Simulation error: ${(err as Error).message}`);
            st.setPlayback({ playing: false });
          }
        }
      }

      // Push transforms → viewport.
      const transforms = p.transforms();
      const map = new Map(transforms.map((t) => [t.id, t]));
      t3.applyTransforms(transforms, p.poppedIds(), p.fracturedIds());
      t3.syncSpawned(p.spawnedDescriptors(), p.drainRemovedSpawned(), map);
      t3.updateDebug(st.debug, p.contacts(), map);
      const cam = sc.cameras.find((c) => c.id === sc.activeCameraId);
      const follow = cam?.followObjectId ? (map.get(cam.followObjectId) ?? null) : null;
      t3.render(dt, follow ? follow.p : null, cam?.shake ?? 0);

      if (now - statAt > 500) {
        statAt = now;
        setPStats(p.stats());
        setCacheSize(p.cacheSize);
        setBrokenJoints([...p.brokenJointIds()]);
      }
    };
    raf = requestAnimationFrame(tick);

    return () => {
      alive = false;
      readyRef.current = false;
      cancelAnimationFrame(raf);
      three.dispose();
      phys.dispose();
      threeRef.current = null;
      physRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ── Scene → runtime sync ── */
  React.useEffect(() => {
    const sc = useForge.getState().activeScene;
    if (!ready || !sc || !physRef.current || !threeRef.current) return;
    try {
      physRef.current.syncScene(sc);
    } catch (err) {
      useForge.getState().setError(`Physics sync failed: ${(err as Error).message}`);
    }
    threeRef.current.syncScene(sc, useForge.getState().selection, useForge.getState().debug);
  }, [simRevision, ready]);

  /* ── Selection / debug → viewport ── */
  React.useEffect(() => {
    const sc = useForge.getState().activeScene;
    if (!ready || !sc || !threeRef.current) return;
    threeRef.current.syncScene(sc, selection, debug);
  }, [selection, debug, ready]);

  /* ── Keyboard shortcuts ── */
  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      const st = useForge.getState();
      const max = (st.activeScene?.render.durationFrames ?? 1) - 1;
      switch (e.key) {
        case ' ':
          e.preventDefault();
          if (!st.playback.playing && st.playback.frame >= max) {
            st.setPlayback({ frame: 0 });
          }
          st.setPlayback({ playing: !st.playback.playing });
          break;
        case 'ArrowLeft':
          e.preventDefault();
          st.setPlayback({ playing: false, frame: Math.max(0, st.playback.frame - 1) });
          break;
        case 'ArrowRight':
          e.preventDefault();
          st.setPlayback({ playing: false, frame: Math.min(max, st.playback.frame + 1) });
          break;
        case 'Home':
          st.setPlayback({ playing: false, frame: 0 });
          break;
        case 'End':
          st.setPlayback({ playing: false, frame: max });
          break;
        case 'Delete':
        case 'Backspace':
          if (st.selection.length > 0) st.removeObjects(st.selection);
          break;
        case 'Escape':
          st.setSelection([]);
          break;
        case 'f':
        case 'F':
          threeRef.current?.focusOn(st.selection[0] ?? null);
          break;
        case '1':
          setGizmoMode('translate');
          break;
        case '2':
          setGizmoMode('rotate');
          break;
        case '3':
          setGizmoMode('scale');
          break;
        default:
          if ((e.ctrlKey || e.metaKey) && e.key === 's') {
            e.preventDefault();
            void saveWithThumbnail();
          }
          if ((e.ctrlKey || e.metaKey) && e.key === 'd') {
            e.preventDefault();
            if (st.selection.length > 0) st.duplicateObjects(st.selection);
          }
          break;
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setGizmoMode = (m: GizmoMode) => {
    setGizmoModeState(m);
    threeRef.current?.setGizmoMode(m);
  };

  const saveWithThumbnail = async () => {
    const st = useForge.getState();
    if (!st.activeScene || !threeRef.current) {
      await st.saveNow();
      return;
    }
    try {
      const thumb = threeRef.current.captureThumbnail(320);
      useForge.setState((s) => ({
        activeScene: s.activeScene ? { ...s.activeScene, thumbnail: thumb } : null,
        dirty: true,
      }));
    } catch {
      /* thumbnail is best-effort */
    }
    await st.saveNow();
  };

  const renderActions: RenderActions = React.useMemo(() => ({
    downloadJson: async () => {
      const st = useForge.getState();
      const sc = st.activeScene;
      if (!sc) return;
      try {
        const json = await st.exportSceneJson(sc.sceneId);
        const blob = new Blob([json], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `${sc.name.replace(/[^a-z0-9-_]+/gi, '-').toLowerCase()}.forge.json`;
        a.click();
        URL.revokeObjectURL(a.href);
      } catch (err) {
        st.setError(`Export failed: ${(err as Error).message}`);
      }
    },
    copyCommand: () => {
      const st = useForge.getState();
      const sc = st.activeScene;
      if (!sc) return;
      const file = `${sc.name.replace(/[^a-z0-9-_]+/gi, '-').toLowerCase()}.forge.json`;
      const cmd = `npx motionflow render-forge "./${file}" --output out/${sc.sceneId}.mp4`;
      void navigator.clipboard?.writeText(cmd).catch(() => {
        st.setError('Clipboard unavailable — command is shown in the Render tab.');
      });
    },
    downloadFrame: () => {
      const st = useForge.getState();
      const sc = st.activeScene;
      const t3 = threeRef.current;
      if (!sc || !t3) return;
      try {
        const url = t3.captureAt(sc.render.width, sc.render.height);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${sc.sceneId}-f${st.playback.frame}.png`;
        a.click();
      } catch (err) {
        st.setError(`Frame capture failed: ${(err as Error).message}`);
      }
    },
  }), []);

  if (!scene) return null;
  const aspect = `${scene.render.width} / ${scene.render.height}`;

  return (
    <div className="forge-app">
      <EditorHeader onExit={onExit} onSave={saveWithThumbnail} />

      <div className="forge-main">
        <AssetBrowser />

        <div className="forge-viewport-col">
          <ViewportToolbar
            gizmoMode={gizmoMode}
            setGizmoMode={setGizmoMode}
            snapOn={snapOn}
            setSnapOn={(v) => {
              setSnapOn(v);
              threeRef.current?.setSnapping(v);
            }}
            lookThrough={lookThrough}
            setLookThrough={(v) => {
              setLookThrough(v);
              threeRef.current?.setLookThroughCamera(v);
            }}
            quality={quality}
            setQuality={(q) => {
              setQuality(q);
              threeRef.current?.setQuality(q);
            }}
            onFocus={() => threeRef.current?.focusOn(selection[0] ?? null)}
          />
          <div className="forge-canvas-wrap">
            <canvas ref={canvasRef} className="forge-canvas" />
            {debug.showSafeArea && (
              <div className="forge-safe-area" style={{ aspectRatio: aspect }}>
                <div className="forge-safe thirds-h" />
                <div className="forge-safe thirds-v" />
                <span className="forge-safe-label">
                  {scene.render.width}×{scene.render.height}
                </span>
              </div>
            )}
            {debug.showStats && (
              <div className="forge-stats">
                <span>{vStats?.fps ?? '—'} fps</span>
                <span>{pStats?.bodies ?? 0} bodies</span>
                <span>{pStats?.joints ?? 0} joints</span>
                {brokenJoints.length > 0 && <span>{brokenJoints.length} broken</span>}
                <span>{pStats?.contacts ?? 0} contacts</span>
                <span>{(pStats?.stepMs ?? 0).toFixed(1)}ms phys</span>
                <span>{vStats?.drawCalls ?? 0} draws</span>
                <span>{((vStats?.triangles ?? 0) / 1000).toFixed(0)}k tris</span>
              </div>
            )}
            {!ready && (
              <div className="forge-loading">
                {loadError ? (
                  <div className="forge-error-box">
                    <b>Simulation failed to start</b>
                    <p>{loadError}</p>
                  </div>
                ) : (
                  <p>Loading physics (Rapier WASM)…</p>
                )}
              </div>
            )}
          </div>
          <Timeline cacheSize={cacheSize} />
        </div>

        <Inspector renderActions={renderActions} brokenJoints={brokenJoints} />
      </div>
    </div>
  );
}

function EditorHeader({ onExit, onSave }: { onExit: () => void; onSave: () => void }) {
  const scene = useForge((s) => s.activeScene);
  const dirty = useForge((s) => s.dirty);
  const saving = useForge((s) => s.saving);
  const lastError = useForge((s) => s.lastError);
  const setError = useForge((s) => s.setError);
  const renameScene = useForge((s) => s.renameScene);
  const closeScene = useForge((s) => s.closeScene);
  const [name, setName] = React.useState(scene?.name ?? '');
  React.useEffect(() => setName(scene?.name ?? ''), [scene?.sceneId]);

  if (!scene) return null;
  return (
    <header className="forge-header">
      <button
        type="button"
        className="forge-btn small"
        onClick={() => {
          void closeScene();
          onExit();
        }}
      >
        ← Library
      </button>
      <input
        className="forge-title-input"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => {
          if (name.trim() && name !== scene.name) void renameScene(scene.sceneId, name.trim());
          else setName(scene.name);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        }}
        aria-label="Scene name"
      />
      <span className={`forge-dirty ${dirty ? 'on' : ''}`} title={dirty ? 'Unsaved changes' : 'Saved'}>
        {saving ? 'saving…' : dirty ? '● unsaved' : '✓ saved'}
      </span>
      <span className="forge-seed-chip" title="Scene seed">seed {scene.seed}</span>
      <div className="forge-header-spacer" />
      <button type="button" className="forge-btn small primary" onClick={() => void onSave()}>
        💾 Save
      </button>
      {lastError && (
        <div className="forge-error-toast" role="alert">
          <span>{lastError}</span>
          <button type="button" onClick={() => setError(null)}>
            ×
          </button>
        </div>
      )}
    </header>
  );
}

function ViewportToolbar(props: {
  gizmoMode: GizmoMode;
  setGizmoMode: (m: GizmoMode) => void;
  snapOn: boolean;
  setSnapOn: (v: boolean) => void;
  lookThrough: boolean;
  setLookThrough: (v: boolean) => void;
  quality: 'draft' | 'medium' | 'high' | 'ultra';
  setQuality: (q: 'draft' | 'medium' | 'high' | 'ultra') => void;
  onFocus: () => void;
}) {
  const debug = useForge((s) => s.debug);
  const setDebug = useForge((s) => s.setDebug);
  const chip = (
    key: keyof typeof debug,
    label: string,
    title: string,
  ) => (
    <button
      key={key}
      type="button"
      className={`forge-btn tiny ${debug[key] ? 'primary' : ''}`}
      title={title}
      onClick={() => setDebug({ [key]: !debug[key] })}
    >
      {label}
    </button>
  );
  return (
    <div className="forge-toolbar">
      <div className="forge-toolbar-group">
        {(['translate', 'rotate', 'scale'] as GizmoMode[]).map((m) => (
          <button
            key={m}
            type="button"
            className={`forge-btn tiny ${props.gizmoMode === m ? 'primary' : ''}`}
            title={`${m} (gizmo)`}
            onClick={() => props.setGizmoMode(m)}
          >
            {m === 'translate' ? '✥ move' : m === 'rotate' ? '⟳ rot' : '⤢ scale'}
          </button>
        ))}
        <button
          type="button"
          className={`forge-btn tiny ${props.snapOn ? 'primary' : ''}`}
          title="Toggle snapping"
          onClick={() => props.setSnapOn(!props.snapOn)}
        >
          🧲 snap
        </button>
        <button type="button" className="forge-btn tiny" title="Focus selection (F)" onClick={props.onFocus}>
          🎯 focus
        </button>
        <button
          type="button"
          className={`forge-btn tiny ${props.lookThrough ? 'primary' : ''}`}
          title="Lock view to active scene camera"
          onClick={() => props.setLookThrough(!props.lookThrough)}
        >
          📷 cam
        </button>
        <select
          className="forge-select tiny"
          value={props.quality}
          title="Viewport quality (pixel ratio + shadows)"
          onChange={(e) => props.setQuality(e.target.value as typeof props.quality)}
        >
          <option value="draft">draft</option>
          <option value="medium">medium</option>
          <option value="high">high</option>
          <option value="ultra">ultra</option>
        </select>
      </div>
      <div className="forge-toolbar-group">
        {chip('showColliders', 'bodies', 'Show collision shapes')}
        {chip('showVelocity', 'vel', 'Show velocities')}
        {chip('showContacts', 'contacts', 'Show contact points')}
        {chip('showJoints', 'joints', 'Show joints')}
        {chip('showCOM', 'com', 'Show centers of mass')}
        {chip('showSleeping', 'sleep', 'Show sleeping bodies')}
        {chip('showGrid', 'grid', 'Show grid')}
        {chip('showSafeArea', 'safe', 'Show video safe area')}
        {chip('showStats', 'stats', 'Show stats overlay')}
      </div>
    </div>
  );
}
