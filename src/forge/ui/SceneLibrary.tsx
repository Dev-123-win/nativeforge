/**
 * Scene library — project browser with safe isolated scene actions.
 */
import React from 'react';
import { useForge } from '../core/store';
import { saveScene } from '../core/db';
import { retainSceneAssets } from '../core/assets';
import { buildBalloonDemoScene, buildBenchmarkScene } from '../presets';

export function SceneLibrary({ onExit }: { onExit: () => void }) {
  const summaries = useForge((s) => s.summaries);
  const libraryLoaded = useForge((s) => s.libraryLoaded);
  const newScene = useForge((s) => s.newScene);
  const openScene = useForge((s) => s.openScene);
  const duplicateScene = useForge((s) => s.duplicateScene);
  const renameScene = useForge((s) => s.renameScene);
  const deleteSceneSafe = useForge((s) => s.deleteSceneSafe);
  const importSceneJson = useForge((s) => s.importSceneJson);
  const exportSceneJson = useForge((s) => s.exportSceneJson);
  const setError = useForge((s) => s.setError);
  const refreshLibrary = useForge((s) => s.refreshLibrary);
  const fileRef = React.useRef<HTMLInputElement>(null);
  const [busy, setBusy] = React.useState(false);

  const addStarter = async (kind: 'demo' | 100 | 1000 | 5000 | 10000) => {
    setBusy(true);
    try {
      const scene = kind === 'demo' ? buildBalloonDemoScene() : buildBenchmarkScene(kind);
      await saveScene(scene);
      await retainSceneAssets(scene);
      await refreshLibrary();
      await openScene(scene.sceneId);
    } catch (e) {
      setError(`Starter scene failed: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const doImport = async (file: File) => {
    setBusy(true);
    try {
      const text = await file.text();
      const id = await importSceneJson(text);
      await openScene(id);
    } catch (e) {
      setError(`Import failed: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const doExport = async (sceneId: string, name: string) => {
    try {
      const json = await exportSceneJson(sceneId);
      const blob = new Blob([json], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${name.replace(/[^a-z0-9-_]+/gi, '-').toLowerCase()}.forge.json`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) {
      setError(`Export failed: ${(e as Error).message}`);
    }
  };

  return (
    <div className="forge-library">
      <header className="forge-lib-header">
        <button type="button" className="forge-btn small" onClick={onExit}>
          ← MotionFlow
        </button>
        <div className="forge-lib-title">
          <h1>Physics Studio</h1>
          <p>deterministic 3D physics scenes · vertical-video ready</p>
        </div>
        <div className="forge-lib-actions">
          <input
            ref={fileRef}
            type="file"
            accept=".json,.forge.json,application/json"
            style={{ display: 'none' }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void doImport(f);
              e.target.value = '';
            }}
          />
          <button type="button" className="forge-btn" onClick={() => fileRef.current?.click()} disabled={busy}>
            ⬆ Import
          </button>
          <button type="button" className="forge-btn primary" onClick={() => void newScene()} disabled={busy}>
            + New scene
          </button>
        </div>
      </header>

      <div className="forge-starters">
        <span>Start from:</span>
        <button type="button" className="forge-btn small" disabled={busy} onClick={() => void addStarter('demo')}>
          🎈 Balloon vs Cone
        </button>
        {([100, 1000, 5000, 10000] as const).map((n) => (
          <button key={n} type="button" className="forge-btn small" disabled={busy}
            onClick={() => void addStarter(n)}>
            ⚡ {n.toLocaleString()} balls
          </button>
        ))}
      </div>

      {!libraryLoaded ? (
        <p className="forge-hint">Loading library…</p>
      ) : summaries.length === 0 ? (
        <div className="forge-empty big">
          <div className="forge-empty-icon">🎬</div>
          <h2>No scenes yet</h2>
          <p>Create a scene, import one, or try the balloon demo above.</p>
        </div>
      ) : (
        <div className="forge-card-grid">
          {summaries.map((s) => (
            <div key={s.sceneId} className="forge-card">
              <button
                type="button"
                className="forge-card-main"
                onClick={() => void openScene(s.sceneId)}
                title={`Open ${s.name}`}
              >
                <div className="forge-card-thumb">
                  {s.thumbnail ? (
                    <img src={s.thumbnail} alt="" />
                  ) : (
                    <span className="forge-card-glyph">🧪</span>
                  )}
                </div>
                <div className="forge-card-info">
                  <b>{s.name}</b>
                  <span>
                    {s.objectCount} objects · {s.width}×{s.height} ·{' '}
                    {s.durationFrames}f · {new Date(s.updatedAt).toLocaleDateString()}
                  </span>
                </div>
              </button>
              <div className="forge-card-actions">
                <button type="button" title="Open" onClick={() => void openScene(s.sceneId)}>↗</button>
                <button
                  type="button" title="Duplicate"
                  onClick={() => void duplicateScene(s.sceneId).catch((e) => setError(String(e)))}
                >
                  ⧉
                </button>
                <button
                  type="button" title="Rename"
                  onClick={() => {
                    const name = window.prompt('Rename scene', s.name);
                    if (name && name.trim()) void renameScene(s.sceneId, name.trim());
                  }}
                >
                  ✎
                </button>
                <button type="button" title="Export JSON" onClick={() => void doExport(s.sceneId, s.name)}>
                  ⬇
                </button>
                <button
                  type="button" title="Delete (safe — shared assets kept)" className="danger"
                  onClick={() => {
                    if (window.confirm(`Delete "${s.name}"? Shared assets used by other scenes are kept.`)) {
                      void deleteSceneSafe(s.sceneId);
                    }
                  }}
                >
                  🗑
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
