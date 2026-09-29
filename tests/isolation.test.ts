import { describe, it, expect, beforeEach } from 'vitest';
import { __setBackendForTests, __createMemoryBackend } from '../src/forge/core/db';
import {
  collectAssetIds,
  createAsset,
  findOrphanAssets,
  reconcileRefCounts,
  releaseSceneAssets,
  retainSceneAssets,
} from '../src/forge/core/assets';
import { makeScene } from '../src/forge/core/types';

beforeEach(() => {
  __setBackendForTests(__createMemoryBackend());
});

describe('scene isolation (§32)', () => {
  it('deleting one scene never breaks another (shared assets survive)', async () => {
    const a = await createAsset('A', 'material', {});
    const b = await createAsset('B', 'material', {});
    const c = await createAsset('C', 'material', {});

    const s1 = makeScene('A-scene');
    s1.assets = [{ assetId: a.id, role: 'mat' }, { assetId: b.id, role: 'mat' }];
    const s2 = makeScene('B-scene');
    s2.assets = [{ assetId: b.id, role: 'mat' }, { assetId: c.id, role: 'mat' }];

    await retainSceneAssets(s1);
    await retainSceneAssets(s2);

    // Delete scene 1: only its exclusive asset is garbage-collected.
    const r1 = await releaseSceneAssets(s1);
    expect(r1.deleted).toContain(a.id);
    expect(r1.deleted).not.toContain(b.id);

    // Scene 2 still resolves everything it references.
    const { getAssetRecord } = await import('../src/forge/core/db');
    expect(await getAssetRecord(b.id)).not.toBeNull();
    expect(await getAssetRecord(c.id)).not.toBeNull();
    expect(collectAssetIds(s2).has(b.id)).toBe(true);

    // Delete scene 2: remainder collected.
    const r2 = await releaseSceneAssets(s2);
    expect(r2.deleted).toContain(b.id);
    expect(r2.deleted).toContain(c.id);
  });

  it('protected assets are never garbage-collected', async () => {
    const p = await createAsset('builtin', 'material', {}, { protect: true });
    const s = makeScene('s');
    s.assets = [{ assetId: p.id, role: 'mat' }];
    await retainSceneAssets(s);
    const r = await releaseSceneAssets(s);
    expect(r.deleted).not.toContain(p.id);
    const { getAssetRecord } = await import('../src/forge/core/db');
    expect(await getAssetRecord(p.id)).not.toBeNull();
  });

  it('retain is idempotent per scene', async () => {
    const a = await createAsset('A', 'material', {});
    const s = makeScene('s');
    s.assets = [{ assetId: a.id, role: 'mat' }];
    await retainSceneAssets(s);
    await retainSceneAssets(s);
    const { getAssetRecord } = await import('../src/forge/core/db');
    expect((await getAssetRecord(a.id))!.refCount).toBe(1);
  });

  it('reconcile repairs drifted refCounts and finds orphans', async () => {
    const a = await createAsset('A', 'material', {});
    const orphan = await createAsset('orphan', 'material', {});
    const s = makeScene('s');
    s.assets = [{ assetId: a.id, role: 'mat' }];
    const all = await reconcileRefCounts([s]);
    expect(all.find((x) => x.id === a.id)!.refCount).toBe(1);
    const orphans = await findOrphanAssets();
    expect(orphans.map((o) => o.id)).toContain(orphan.id);
    expect(orphans.map((o) => o.id)).not.toContain(a.id);
  });
});
