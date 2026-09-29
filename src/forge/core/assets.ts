/**
 * Asset management with reference counting (§32, §35).
 *
 * Scene isolation guarantee: assets are shared by stable id and carry a
 * refCount of referencing scenes. Deleting a scene decrements counts and
 * garbage-collects ONLY assets that reach zero references and are not
 * protected. Scene B can never lose an asset it still references.
 */

import type { AssetRecord, AssetType, ForgeScene } from './types';
import { uid } from './types';
import {
  deleteAssetRecord,
  getAssetRecord,
  getMeta,
  listAssetRecords,
  putAssetRecord,
  putMeta,
} from './db';

/** All asset ids referenced by a scene (explicit refs + object payloads). */
export function collectAssetIds(scene: ForgeScene): Set<string> {
  const ids = new Set<string>();
  for (const ref of scene.assets) ids.add(ref.assetId);
  for (const o of scene.objects) {
    if (o.prefabId) ids.add(o.prefabId);
    if (o.visual.textureAssetId) ids.add(o.visual.textureAssetId);
  }
  return ids;
}

export async function createAsset(
  name: string,
  type: AssetType,
  data: Record<string, unknown>,
  opts: { protect?: boolean; thumbnail?: string | null } = {},
): Promise<AssetRecord> {
  const now = Date.now();
  const asset: AssetRecord = {
    id: uid('asset'),
    name,
    type,
    data,
    refCount: 0,
    protected: opts.protect ?? false,
    createdAt: now,
    updatedAt: now,
    thumbnail: opts.thumbnail ?? null,
  };
  await putAssetRecord(asset);
  return asset;
}

/** Retain (refCount++) every asset a scene references. Idempotent per scene. */
export async function retainSceneAssets(scene: ForgeScene): Promise<void> {
  const ids = collectAssetIds(scene);
  // Track which scenes already retain which assets to stay idempotent.
  const key = `retained:${scene.sceneId}`;
  const prev = (await getMeta<string[]>(key)) ?? [];
  const prevSet = new Set(prev);
  for (const id of ids) {
    if (prevSet.has(id)) continue;
    const a = await getAssetRecord(id);
    if (!a) continue; // missing asset: surfaced by validation, never fatal here
    a.refCount += 1;
    a.updatedAt = Date.now();
    await putAssetRecord(a);
  }
  await putMeta(key, [...ids]);
}

/**
 * Release a scene's references and GC zero-ref unprotected assets.
 * Returns the ids that were actually deleted.
 */
export async function releaseSceneAssets(
  scene: ForgeScene,
): Promise<{ released: string[]; deleted: string[] }> {
  const key = `retained:${scene.sceneId}`;
  const retained = (await getMeta<string[]>(key)) ?? [...collectAssetIds(scene)];
  const released: string[] = [];
  const deleted: string[] = [];
  for (const id of new Set(retained)) {
    const a = await getAssetRecord(id);
    if (!a) continue;
    a.refCount = Math.max(0, a.refCount - 1);
    a.updatedAt = Date.now();
    released.push(id);
    if (a.refCount === 0 && !a.protected) {
      await deleteAssetRecord(id);
      deleted.push(id);
    } else {
      await putAssetRecord(a);
    }
  }
  await putMeta(key, []);
  return { released, deleted };
}

/** Reconcile refCounts from scratch across all scenes (repair tool). */
export async function reconcileRefCounts(
  scenes: ForgeScene[],
): Promise<AssetRecord[]> {
  const counts = new Map<string, number>();
  for (const s of scenes) {
    for (const id of collectAssetIds(s)) {
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
  }
  const all = await listAssetRecords();
  for (const a of all) {
    const want = counts.get(a.id) ?? 0;
    if (a.refCount !== want) {
      a.refCount = want;
      a.updatedAt = Date.now();
      await putAssetRecord(a);
    }
  }
  return listAssetRecords();
}

/** Assets with zero references that are safe to delete (dry-run for UI). */
export async function findOrphanAssets(): Promise<AssetRecord[]> {
  const all = await listAssetRecords();
  return all.filter((a) => a.refCount === 0 && !a.protected);
}
