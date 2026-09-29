/**
 * Persistence layer — IndexedDB with an in-memory fallback.
 *
 * Safety rules (§34, §51):
 * - Writes are transactional: the previous revision is snapshotted BEFORE the
 *   new one lands, so a partial write can never destroy the last good save.
 * - A short per-scene revision history is kept for crash recovery.
 * - In non-browser contexts (tests, SSR) a Map-backed store is used so all
 *   higher-level logic stays testable.
 */

import type { AssetRecord, ForgeScene, SceneSummary } from './types';

const DB_NAME = 'nativeforge';
const DB_VERSION = 1;
const MAX_REVISIONS = 10;

interface Revision {
  revId: string; // `${sceneId}:${timestamp}:${counter}`
  sceneId: string;
  timestamp: number;
  scene: ForgeScene;
}

/* ─── Backend interface ──────────────────────────────────────────────────── */

interface Backend {
  putScene(scene: ForgeScene): Promise<void>;
  getScene(sceneId: string): Promise<ForgeScene | null>;
  listScenes(): Promise<ForgeScene[]>;
  deleteScene(sceneId: string): Promise<void>;
  putRevision(rev: Revision): Promise<void>;
  listRevisions(sceneId: string): Promise<Revision[]>;
  pruneRevisions(sceneId: string, keep: number): Promise<void>;
  putAsset(asset: AssetRecord): Promise<void>;
  getAsset(id: string): Promise<AssetRecord | null>;
  listAssets(): Promise<AssetRecord[]>;
  deleteAsset(id: string): Promise<void>;
  putMeta(key: string, value: unknown): Promise<void>;
  getMeta<T>(key: string): Promise<T | null>;
}

/* ─── In-memory backend (tests / non-browser) ────────────────────────────── */

class MemoryBackend implements Backend {
  scenes = new Map<string, ForgeScene>();
  revisions = new Map<string, Revision[]>();
  assets = new Map<string, AssetRecord>();
  meta = new Map<string, unknown>();

  async putScene(s: ForgeScene) {
    this.scenes.set(s.sceneId, structuredCloneSafe(s));
  }
  async getScene(id: string) {
    const s = this.scenes.get(id);
    return s ? structuredCloneSafe(s) : null;
  }
  async listScenes() {
    return [...this.scenes.values()].map(structuredCloneSafe);
  }
  async deleteScene(id: string) {
    this.scenes.delete(id);
  }
  async putRevision(rev: Revision) {
    const list = this.revisions.get(rev.sceneId) ?? [];
    list.push(structuredCloneSafe(rev));
    this.revisions.set(rev.sceneId, list);
  }
  async listRevisions(sceneId: string) {
    return (this.revisions.get(sceneId) ?? []).map(structuredCloneSafe);
  }
  async pruneRevisions(sceneId: string, keep: number) {
    const list = this.revisions.get(sceneId) ?? [];
    list.sort((a, b) => b.timestamp - a.timestamp);
    this.revisions.set(sceneId, list.slice(0, keep));
  }
  async putAsset(a: AssetRecord) {
    this.assets.set(a.id, structuredCloneSafe(a));
  }
  async getAsset(id: string) {
    const a = this.assets.get(id);
    return a ? structuredCloneSafe(a) : null;
  }
  async listAssets() {
    return [...this.assets.values()].map(structuredCloneSafe);
  }
  async deleteAsset(id: string) {
    this.assets.delete(id);
  }
  async putMeta(key: string, value: unknown) {
    this.meta.set(key, structuredCloneSafe(value));
  }
  async getMeta<T>(key: string) {
    return (this.meta.get(key) as T) ?? null;
  }
}

function structuredCloneSafe<T>(v: T): T {
  if (typeof structuredClone === 'function') return structuredClone(v);
  return JSON.parse(JSON.stringify(v)) as T;
}

/* ─── IndexedDB backend ──────────────────────────────────────────────────── */

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('scenes')) {
        db.createObjectStore('scenes', { keyPath: 'sceneId' });
      }
      if (!db.objectStoreNames.contains('revisions')) {
        const rs = db.createObjectStore('revisions', { keyPath: 'revId' });
        rs.createIndex('by-scene', 'sceneId', { unique: false });
      }
      if (!db.objectStoreNames.contains('assets')) {
        db.createObjectStore('assets', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('meta')) {
        db.createObjectStore('meta', { keyPath: 'key' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(
  db: IDBDatabase,
  stores: string[],
  mode: IDBTransactionMode,
  fn: (t: IDBTransaction) => IDBRequest<T>,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = db.transaction(stores, mode);
    const req = fn(t);
    req.onsuccess = () => resolve(req.result as T);
    req.onerror = () => reject(req.error);
    t.onerror = () => reject(t.error);
  });
}

class IdbBackend implements Backend {
  private db: IDBDatabase | null = null;

  private async ready(): Promise<IDBDatabase> {
    if (!this.db) this.db = await openDb();
    return this.db;
  }

  async putScene(scene: ForgeScene) {
    const db = await this.ready();
    await tx(db, ['scenes'], 'readwrite', (t) =>
      t.objectStore('scenes').put(structuredCloneSafe(scene)),
    );
  }
  async getScene(sceneId: string) {
    const db = await this.ready();
    const r = await tx<ForgeScene | undefined>(db, ['scenes'], 'readonly', (t) =>
      t.objectStore('scenes').get(sceneId),
    );
    return r ?? null;
  }
  async listScenes() {
    const db = await this.ready();
    return tx<ForgeScene[]>(db, ['scenes'], 'readonly', (t) =>
      t.objectStore('scenes').getAll(),
    );
  }
  async deleteScene(sceneId: string) {
    const db = await this.ready();
    await tx(db, ['scenes'], 'readwrite', (t) =>
      t.objectStore('scenes').delete(sceneId),
    );
  }
  async putRevision(rev: Revision) {
    const db = await this.ready();
    await tx(db, ['revisions'], 'readwrite', (t) =>
      t.objectStore('revisions').put(structuredCloneSafe(rev)),
    );
  }
  async listRevisions(sceneId: string) {
    const db = await this.ready();
    return tx<Revision[]>(db, ['revisions'], 'readonly', (t) =>
      t.objectStore('revisions').index('by-scene').getAll(sceneId),
    );
  }
  async pruneRevisions(sceneId: string, keep: number) {
    const db = await this.ready();
    const all = await this.listRevisions(sceneId);
    all.sort((a, b) => b.timestamp - a.timestamp);
    const stale = all.slice(keep);
    if (stale.length === 0) return;
    await new Promise<void>((resolve, reject) => {
      const t = db.transaction(['revisions'], 'readwrite');
      const store = t.objectStore('revisions');
      for (const r of stale) store.delete(r.revId);
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error);
    });
  }
  async putAsset(asset: AssetRecord) {
    const db = await this.ready();
    await tx(db, ['assets'], 'readwrite', (t) =>
      t.objectStore('assets').put(structuredCloneSafe(asset)),
    );
  }
  async getAsset(id: string) {
    const db = await this.ready();
    const r = await tx<AssetRecord | undefined>(db, ['assets'], 'readonly', (t) =>
      t.objectStore('assets').get(id),
    );
    return r ?? null;
  }
  async listAssets() {
    const db = await this.ready();
    return tx<AssetRecord[]>(db, ['assets'], 'readonly', (t) =>
      t.objectStore('assets').getAll(),
    );
  }
  async deleteAsset(id: string) {
    const db = await this.ready();
    await tx(db, ['assets'], 'readwrite', (t) =>
      t.objectStore('assets').delete(id),
    );
  }
  async putMeta(key: string, value: unknown) {
    const db = await this.ready();
    await tx(db, ['meta'], 'readwrite', (t) =>
      t.objectStore('meta').put({ key, value: structuredCloneSafe(value) }),
    );
  }
  async getMeta<T>(key: string) {
    const db = await this.ready();
    const r = await tx<{ key: string; value: T } | undefined>(
      db,
      ['meta'],
      'readonly',
      (t) => t.objectStore('meta').get(key),
    );
    return r ? r.value : null;
  }
}

/* ─── Singleton + high-level API ─────────────────────────────────────────── */

function createBackend(): Backend {
  if (typeof indexedDB !== 'undefined') {
    try {
      return new IdbBackend();
    } catch {
      return new MemoryBackend();
    }
  }
  return new MemoryBackend();
}

let backend: Backend = createBackend();

/** Swap backend (tests use a fresh MemoryBackend per case). */
export function __setBackendForTests(b: Backend): void {
  backend = b;
}
export function __createMemoryBackend(): Backend {
  return new MemoryBackend();
}

let revCounter = 0;

export function toSummary(s: ForgeScene): SceneSummary {
  return {
    sceneId: s.sceneId,
    name: s.name,
    updatedAt: s.updatedAt,
    objectCount: s.objects.length,
    durationFrames: s.render.durationFrames,
    width: s.render.width,
    height: s.render.height,
    renderStatus: 'never',
    thumbnail: s.thumbnail,
  };
}

/**
 * Transactional save: snapshot the previous good revision first, then write.
 * A crash between the two leaves the old scene intact + a recoverable copy.
 */
export async function saveScene(scene: ForgeScene): Promise<void> {
  const prev = await backend.getScene(scene.sceneId).catch(() => null);
  if (prev) {
    await backend.putRevision({
      revId: `${scene.sceneId}:${Date.now()}:${revCounter++}`,
      sceneId: scene.sceneId,
      timestamp: Date.now(),
      scene: prev,
    });
    await backend.pruneRevisions(scene.sceneId, MAX_REVISIONS);
  }
  const stamped: ForgeScene = { ...scene, updatedAt: Date.now() };
  await backend.putScene(stamped);
}

export async function loadScene(sceneId: string): Promise<ForgeScene | null> {
  return backend.getScene(sceneId);
}

export async function listSceneSummaries(): Promise<SceneSummary[]> {
  const scenes = await backend.listScenes();
  scenes.sort((a, b) => b.updatedAt - a.updatedAt);
  const statuses = await backend.getMeta<Record<string, SceneSummary['renderStatus']>>(
    'renderStatus',
  );
  return scenes.map((s) => ({
    ...toSummary(s),
    renderStatus: statuses?.[s.sceneId] ?? 'never',
  }));
}

export async function deleteSceneRecord(sceneId: string): Promise<void> {
  await backend.deleteScene(sceneId);
}

export async function listRevisions(sceneId: string): Promise<Revision[]> {
  const revs = await backend.listRevisions(sceneId);
  revs.sort((a, b) => b.timestamp - a.timestamp);
  return revs;
}

export async function setRenderStatus(
  sceneId: string,
  status: SceneSummary['renderStatus'],
): Promise<void> {
  const all =
    (await backend.getMeta<Record<string, SceneSummary['renderStatus']>>(
      'renderStatus',
    )) ?? {};
  all[sceneId] = status;
  await backend.putMeta('renderStatus', all);
}

export async function getLastSession(): Promise<{ sceneId: string } | null> {
  return backend.getMeta('lastSession');
}

export async function setLastSession(sceneId: string | null): Promise<void> {
  await backend.putMeta('lastSession', sceneId ? { sceneId } : null);
}

/* Assets */

export async function putAssetRecord(asset: AssetRecord): Promise<void> {
  await backend.putAsset(asset);
}
export async function getAssetRecord(id: string): Promise<AssetRecord | null> {
  return backend.getAsset(id);
}
export async function listAssetRecords(): Promise<AssetRecord[]> {
  return backend.listAssets();
}
export async function deleteAssetRecord(id: string): Promise<void> {
  await backend.deleteAsset(id);
}

export async function putMeta(key: string, value: unknown): Promise<void> {
  await backend.putMeta(key, value);
}

export async function getMeta<T>(key: string): Promise<T | null> {
  return backend.getMeta<T>(key);
}

export type { Backend, Revision };
