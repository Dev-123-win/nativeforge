import { describe, it, expect } from 'vitest';
import { PhysicsRuntime, type RuntimeEventMsg } from '../src/forge/physics/runtime';
import { OBJECT_PRESETS, templateProvider } from '../src/forge/presets';
import { bakePile } from '../src/forge/physics/generators';
import { DEFAULT_GENERATOR_PARAMS } from '../src/forge/physics/generators';
import { makeScene } from '../src/forge/core/types';

function pileScene() {
  const scene = makeScene('pile');
  scene.seed = 777;
  scene.objects.push(OBJECT_PRESETS['ground']());
  const pile = bakePile(OBJECT_PRESETS['ball-rubber'](), {
    ...DEFAULT_GENERATOR_PARAMS,
    seed: 7, templateId: 'ball-rubber', colorRandom: 0, rotRandom: 1,
    count: 12, area: 4, height: 2, dropHeight: 3,
  });
  scene.objects.push(...pile.objects);
  return scene;
}

function transformsKey(rt: PhysicsRuntime): string {
  // NOTE: ids are random per scene build — determinism means identical
  // TRAJECTORIES in identical body order.
  return JSON.stringify(
    rt.transforms().map((t) => [
      t.p.map((n) => n.toFixed(6)),
      t.q.map((n) => n.toFixed(6)),
    ]),
  );
}

describe('PhysicsRuntime', () => {
  it('is deterministic: identical scene + seed → identical trajectory', async () => {
    const events: RuntimeEventMsg[] = [];
    const a = new PhysicsRuntime({ templateProvider, onEvent: (e) => events.push(e) });
    const b = new PhysicsRuntime({ templateProvider, onEvent: () => {} });
    await a.loadScene(pileScene());
    await b.loadScene(pileScene());
    a.stepFrames(90);
    b.stepFrames(90);
    expect(transformsKey(a)).toBe(transformsKey(b));
    a.dispose();
    b.dispose();
  }, 60000);

  it('scrubs exactly: rewind + replay matches direct simulation', async () => {
    const a = new PhysicsRuntime({ templateProvider, onEvent: () => {} });
    const b = new PhysicsRuntime({ templateProvider, onEvent: () => {} });
    await a.loadScene(pileScene());
    await b.loadScene(pileScene());
    a.stepFrames(90);
    const direct = transformsKey(a);
    b.stepFrames(90);
    b.gotoFrame(25);
    expect(b.currentFrame).toBe(25);
    b.stepFrames(65);
    expect(transformsKey(b)).toBe(direct);
    a.dispose();
    b.dispose();
  }, 60000);

  it('BALLOON + SHARP CONE → BURST (required satisfying event)', async () => {
    const scene = makeScene('balloon-pop');
    scene.seed = 424242;
    scene.objects.push(OBJECT_PRESETS['ground']());
    scene.objects.push(OBJECT_PRESETS['cone-sharp']());
    const balloon = OBJECT_PRESETS['balloon-red']();
    balloon.transform.position = [0, 4.2, 0];
    scene.objects.push(balloon);

    const events: RuntimeEventMsg[] = [];
    const rt = new PhysicsRuntime({
      templateProvider,
      onEvent: (e) => events.push(e),
    });
    await rt.loadScene(scene);
    let poppedAt = -1;
    for (let f = 0; f < 400; f++) {
      rt.stepFrames(1);
      if (rt.poppedIds().has(balloon.id)) {
        poppedAt = f;
        break;
      }
    }
    expect(poppedAt).toBeGreaterThanOrEqual(0);
    // Pop emits the full effect chain: pop + sound + particles.
    const kinds = events.map((e) => e.type);
    expect(kinds).toContain('pop');
    expect(kinds).toContain('sound');
    expect(kinds).toContain('particles');
    // Latex fragments are real simulated bodies.
    const frags = rt.spawnedDescriptors();
    expect(frags.length).toBeGreaterThan(0);
    rt.dispose();
  }, 60000);

  it('breakables fracture above their impulse threshold only', async () => {
    const scene = makeScene('fracture');
    scene.seed = 11;
    scene.objects.push(OBJECT_PRESETS['ground']());
    const panel = OBJECT_PRESETS['glass-panel']();
    panel.transform.position = [0, 0.7, 0];
    panel.transform.rotation = [0, 0, 0];
    scene.objects.push(panel);
    const hammer = OBJECT_PRESETS['ball-steel']();
    hammer.transform.position = [0, 8, 0];
    if (hammer.rigidBody) {
      hammer.rigidBody.massMode = 'override';
      hammer.rigidBody.mass = 20;
    }
    scene.objects.push(hammer);

    const rt = new PhysicsRuntime({ templateProvider, onEvent: () => {} });
    await rt.loadScene(scene);
    // Resting panel must NOT spontaneously fracture.
    rt.stepFrames(30);
    expect(rt.fracturedIds().has(panel.id)).toBe(false);
    // Steel ball dropped from height must shatter it.
    for (let f = 0; f < 300 && !rt.fracturedIds().has(panel.id); f++) {
      rt.stepFrames(1);
    }
    expect(rt.fracturedIds().has(panel.id)).toBe(true);
    rt.dispose();
  }, 60000);
});
