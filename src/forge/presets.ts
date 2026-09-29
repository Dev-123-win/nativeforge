/**
 * Presets — object templates, export profiles, demo + benchmark scenes.
 *
 * Every preset is a factory returning a FRESH object (new ids per call).
 * The physics runtime resolves emitter/event templates through
 * `templateProvider()`.
 */

import type {
  ForgeObject,
  ForgeScene,
  RenderSettings,
} from './core/types';
import {
  defaultCollider,
  defaultPhysical,
  defaultRigidBody,
  defaultVisual,
  makeObject,
  makeScene,
  uid,
} from './core/types';
import { presetToPhysical } from './physics/materials';
import { bakePile } from './physics/generators';

/* ─── Object presets ─────────────────────────────────────────────────────── */

function base(
  name: string,
  kind: ForgeObject['kind'],
  geo: ForgeObject['geometry'],
  visual: Partial<ForgeObject['visual']>,
  physicalKey: string,
): ForgeObject {
  const o = makeObject(name, kind);
  o.geometry = geo;
  o.visual = defaultVisual(visual);
  o.physical = { ...defaultPhysical(), ...presetToPhysical(physicalKey) };
  return o;
}

function ballPreset(
  name: string,
  color: string,
  physicalKey: string,
  radius = 0.25,
): ForgeObject {
  const o = base(name, 'primitive',
    { type: 'sphere', params: { radius } },
    { baseColor: color }, physicalKey);
  const p = presetToPhysical(physicalKey);
  o.collider = defaultCollider({
    shape: 'sphere', radius,
    friction: p.friction, restitution: p.restitution,
  });
  o.rigidBody = defaultRigidBody({ density: p.density });
  return o;
}

function boxPreset(
  name: string,
  color: string,
  physicalKey: string,
  w: number,
  h: number,
  d: number,
): ForgeObject {
  const o = base(name, 'primitive',
    { type: 'box', params: { width: w, height: h, depth: d } },
    { baseColor: color }, physicalKey);
  const p = presetToPhysical(physicalKey);
  o.collider = defaultCollider({
    shape: 'box', halfExtents: [w / 2, h / 2, d / 2],
    friction: p.friction, restitution: p.restitution,
  });
  o.rigidBody = defaultRigidBody({ density: p.density });
  return o;
}

export const OBJECT_PRESETS: Record<string, () => ForgeObject> = {
  'ball-rubber': () => ballPreset('Rubber Ball', '#ff5a5a', 'rubber'),
  'ball-steel': () => {
    const o = ballPreset('Steel Ball', '#b8c2cc', 'steel');
    o.visual.metalness = 0.9;
    o.visual.roughness = 0.3;
    return o;
  },
  'ball-glass': () => {
    const o = ballPreset('Glass Ball', '#9fd8ff', 'glass');
    o.visual.transparent = true;
    o.visual.opacity = 0.55;
    o.visual.roughness = 0.1;
    return o;
  },
  'ball-foam': () => ballPreset('Foam Ball', '#ffd166', 'foam', 0.3),
  'box-wood': () => boxPreset('Wood Crate', '#b07a4a', 'wood', 0.6, 0.6, 0.6),
  'box-concrete': () => boxPreset('Concrete Block', '#9aa0a8', 'concrete', 1, 0.5, 0.5),
  'domino': () => {
    const o = boxPreset('Domino', '#f2f2f2', 'plastic', 0.3, 1.2, 0.6);
    o.transform.position = [0, 0.6, 0];
    return o;
  },
  'ground': () => {
    const o = boxPreset('Ground', '#2b3345', 'concrete', 30, 1, 30);
    o.rigidBody = defaultRigidBody({ bodyType: 'static' });
    o.transform.position = [0, -0.5, 0];
    return o;
  },
  'wall': () => {
    const o = boxPreset('Wall', '#38415a', 'concrete', 0.5, 4, 8);
    o.rigidBody = defaultRigidBody({ bodyType: 'static' });
    return o;
  },
  'ramp': () => {
    const o = boxPreset('Ramp', '#4f8ff7', 'wood', 1, 0.2, 4);
    o.rigidBody = defaultRigidBody({ bodyType: 'static' });
    o.transform.rotation = [-0.35, 0, 0];
    return o;
  },
  'cone-sharp': () => {
    const o = base('Sharp Cone', 'primitive',
      { type: 'cone', params: { radius: 0.5, height: 1.6 } },
      { baseColor: '#c0c6d0', metalness: 0.85, roughness: 0.25 }, 'steel');
    o.collider = defaultCollider({
      shape: 'cone', radius: 0.5, height: 1.6,
      friction: 0.4, restitution: 0.3, sharpness: 1,
    });
    o.rigidBody = defaultRigidBody({ bodyType: 'static' });
    o.transform.position = [0, 0.8, 0];
    return o;
  },
  'cone-dull': () => {
    const o = base('Traffic Cone', 'primitive',
      { type: 'cone', params: { radius: 0.4, height: 1 } },
      { baseColor: '#ff7a1a' }, 'plastic');
    o.collider = defaultCollider({ shape: 'cone', radius: 0.4, height: 1 });
    return o;
  },
  'balloon-red': () => {
    const o = base('Balloon', 'balloon',
      { type: 'sphere', params: { radius: 0.5 } },
      { baseColor: '#ff3b3b', roughness: 0.35 }, 'latex');
    o.collider = defaultCollider({
      shape: 'sphere', radius: 0.5, friction: 0.8, restitution: 0.7,
    });
    o.rigidBody = defaultRigidBody({ density: 120, linearDamping: 0.4, angularDamping: 0.4 });
    o.balloon = {
      pressure: 110000, maxPressure: 160000, popped: false,
      deflation: 0, skinThickness: 0.002, fragmentCount: 12,
    };
    return o;
  },
  'fragment-latex': () => {
    const o = boxPreset('Latex Fragment', '#ff3b3b', 'latex', 0.12, 0.02, 0.12);
    o.kind = 'fragment';
    return o;
  },
  'glass-panel': () => {
    const o = boxPreset('Glass Panel', '#9fd8ff', 'glass', 1.4, 1.4, 0.08);
    o.visual.transparent = true;
    o.visual.opacity = 0.5;
    o.visual.roughness = 0.1;
    o.breakable = {
      enabled: true, fractured: false, mode: 'radial',
      fragmentCount: 14, breakImpulse: 25, fragmentSpread: 2.5, fragmentScale: 1,
    };
    return o;
  },
  'crate-breakable': () => {
    const o = boxPreset('Breakable Crate', '#b07a4a', 'wood', 0.8, 0.8, 0.8);
    o.breakable = {
      enabled: true, fractured: false, mode: 'grid',
      fragmentCount: 8, breakImpulse: 40, fragmentSpread: 2, fragmentScale: 1,
    };
    return o;
  },
  'field-attractor': () => {
    const o = makeObject('Attractor', 'field');
    o.rigidBody = null;
    o.collider = null;
    o.field = {
      kind: 'attractor', enabled: true, strength: 60, radius: 6,
      falloff: 1.5, direction: [0, 0, 0], frequency: 1, turbulence: 0,
    };
    return o;
  },
  'field-vortex': () => {
    const o = makeObject('Vortex', 'field');
    o.rigidBody = null;
    o.collider = null;
    o.field = {
      kind: 'vortex', enabled: true, strength: 40, radius: 7,
      falloff: 1, direction: [0, 1, 0], frequency: 1.5, turbulence: 0,
    };
    return o;
  },
  'field-wind': () => {
    const o = makeObject('Wind Zone', 'field');
    o.rigidBody = null;
    o.collider = null;
    o.field = {
      kind: 'wind', enabled: true, strength: 25, radius: 10,
      falloff: 0.5, direction: [1, 0, 0], frequency: 0.8, turbulence: 0.6,
    };
    return o;
  },
  'emitter-default': () => {
    const o = makeObject('Emitter', 'emitter');
    o.rigidBody = null;
    o.collider = null;
    o.emitter = {
      shape: 'box', enabled: true, templateId: 'ball-rubber',
      count: 0, rate: 20, burst: 0, startTime: 0, endTime: 10,
      lifetime: 0, maxAlive: 500, initialVelocity: [0, -1, 0],
      spread: 0.3, speedRandom: 0.3, scaleMin: 0.7, scaleMax: 1.3, seed: 1,
    };
    o.transform.position = [0, 6, 0];
    return o;
  },
  'press-machine': () => {
    const o = boxPreset('Hydraulic Press', '#3a4358', 'steel', 2.4, 0.5, 2.4);
    o.kind = 'machine';
    o.rigidBody = defaultRigidBody({ bodyType: 'kinematic' });
    o.machine = {
      kind: 'press', enabled: true, force: 5000, speed: 1, stroke: 2,
      cycleTime: 6, direction: [0, -1, 0], startTime: 0.5, stopTime: 0, phase: 0,
    };
    o.transform.position = [0, 3.5, 0];
    return o;
  },
  'conveyor-machine': () => {
    const o = boxPreset('Conveyor', '#2f6f4f', 'rubber', 2, 0.3, 8);
    o.kind = 'machine';
    o.rigidBody = defaultRigidBody({ bodyType: 'static' });
    o.machine = {
      kind: 'conveyor', enabled: true, force: 500, speed: 3, stroke: 0,
      cycleTime: 0, direction: [0, 0, 1], startTime: 0, stopTime: 0, phase: 0,
    };
    return o;
  },
  'spinner-machine': () => {
    const o = base('Spinner', 'machine',
      { type: 'cylinder', params: { radius: 1.2, height: 0.2 } },
      { baseColor: '#7a5cff' }, 'steel');
    o.collider = defaultCollider({ shape: 'cylinder', radius: 1.2, height: 0.2 });
    o.rigidBody = defaultRigidBody({ bodyType: 'kinematic' });
    o.machine = {
      kind: 'spinner', enabled: true, force: 1000, speed: 2, stroke: 0,
      cycleTime: 0, direction: [0, 1, 0], startTime: 0, stopTime: 0, phase: 0,
    };
    o.transform.position = [0, 0.4, 0];
    return o;
  },
  'gate-machine': () => {
    const o = boxPreset('Gate', '#c9a227', 'wood', 2, 2.5, 0.2);
    o.kind = 'machine';
    o.rigidBody = defaultRigidBody({ bodyType: 'kinematic' });
    o.machine = {
      kind: 'gate', enabled: true, force: 500, speed: 1, stroke: 0,
      cycleTime: 0, direction: [0, 1, 0], startTime: 2, stopTime: 0, phase: 0,
    };
    o.transform.position = [0, 1.25, 0];
    return o;
  },
  'tank-pressurized': () => {
    const o = base('Pressure Tank', 'container',
      { type: 'sphere', params: { radius: 0.6 } },
      { baseColor: '#3fa7ff', metalness: 0.6, roughness: 0.35 }, 'steel');
    o.collider = defaultCollider({ shape: 'sphere', radius: 0.6 });
    o.pressure = {
      internal: 300000, volume: 0.9, leak: 2000,
      releaseThreshold: 250000, ventDirection: [0, 1, 0],
    };
    return o;
  },
};

export const PRESET_CATEGORIES: Array<{ title: string; ids: string[] }> = [
  { title: 'Primitives', ids: ['ball-rubber', 'ball-steel', 'ball-glass', 'ball-foam', 'box-wood', 'box-concrete', 'domino'] },
  { title: 'Course', ids: ['ground', 'wall', 'ramp', 'cone-sharp', 'cone-dull', 'gate-machine'] },
  { title: 'Special', ids: ['balloon-red', 'glass-panel', 'crate-breakable', 'tank-pressurized'] },
  { title: 'Fields', ids: ['field-attractor', 'field-vortex', 'field-wind'] },
  { title: 'Machines', ids: ['press-machine', 'conveyor-machine', 'spinner-machine', 'emitter-default'] },
];

/** Resolve an emitter/event template id to a fresh template object. */
export function templateProvider(id: string): ForgeObject | null {
  const factory = OBJECT_PRESETS[id];
  if (!factory) return null;
  return factory();
}

/* ─── Export presets ─────────────────────────────────────────────────────── */

export interface ExportPreset {
  key: RenderSettings['preset'];
  label: string;
  width: number;
  height: number;
  fps: number;
  bitrate: string;
  blurb: string;
}

export const EXPORT_PRESETS: ExportPreset[] = [
  { key: 'shorts', label: 'YouTube Shorts', width: 1080, height: 1920, fps: 60, bitrate: '12M', blurb: 'Vertical 9:16 · 60fps' },
  { key: 'reels', label: 'Facebook Reels', width: 1080, height: 1920, fps: 30, bitrate: '10M', blurb: 'Vertical 9:16 · 30fps' },
  { key: 'tiktok', label: 'TikTok', width: 1080, height: 1920, fps: 60, bitrate: '12M', blurb: 'Vertical 9:16 · 60fps' },
  { key: 'landscape', label: 'YouTube Landscape', width: 1920, height: 1080, fps: 60, bitrate: '16M', blurb: 'Horizontal 16:9 · 60fps' },
  { key: 'square', label: 'Square', width: 1080, height: 1080, fps: 30, bitrate: '10M', blurb: '1:1 feed format' },
];

/* ─── Demo scene: balloon vs sharp cone ──────────────────────────────────── */

export function buildBalloonDemoScene(): ForgeScene {
  const scene = makeScene('Balloon vs Sharp Cone');
  scene.seed = 424242;
  scene.render = {
    ...scene.render,
    preset: 'shorts', width: 1080, height: 1920, fps: 60,
    durationFrames: 480, recordStart: 0, recordEnd: 480,
  };

  const ground = OBJECT_PRESETS['ground']();
  scene.objects.push(ground);

  const cone = OBJECT_PRESETS['cone-sharp']();
  scene.objects.push(cone);

  const balloon = OBJECT_PRESETS['balloon-red']();
  balloon.transform.position = [0, 4.2, 0];
  scene.objects.push(balloon);

  // A few rubber balls scattered for extra satisfaction after the pop.
  const tpl = OBJECT_PRESETS['ball-rubber']();
  const pile = bakePile(tpl, {
    seed: scene.seed, templateId: 'ball-rubber', colorRandom: 1,
    rotRandom: 1, scaleMin: 0.6, scaleMax: 1, massMin: 0, massMax: 0,
    palette: ['#ff5a5a', '#4f8ff7', '#ffd166', '#51ff7a', '#b366ff'],
    count: 24, area: 5, height: 2, dropHeight: 5,
  });
  scene.objects.push(...pile.objects);
  scene.generators.push(pile.record);

  // Vertical-friendly camera.
  scene.cameras[0] = {
    ...scene.cameras[0],
    name: 'Vertical Main',
    position: [3.4, 3.2, 7.2],
    target: [0, 1.6, 0],
    fov: 55,
  };

  // Event: when the balloon is gone (popped), fire a celebratory burst.
  scene.events.push({
    id: uid('evt'),
    name: 'Pop celebration',
    enabled: true,
    fired: false,
    trigger: { type: 'time', objectA: null, objectB: null, time: 1.6, threshold: 0, probability: 0 },
    action: { type: 'particles', targetId: balloon.id, vector: [0, 0, 0], scalar: 2, presetId: null },
  });
  return scene;
}

/* ─── Benchmark scenes ───────────────────────────────────────────────────── */

export function buildBenchmarkScene(count: 100 | 1000 | 5000 | 10000): ForgeScene {
  const scene = makeScene(`Benchmark — ${count.toLocaleString()} balls`);
  scene.seed = 1337;
  scene.render = {
    ...scene.render,
    preset: 'landscape', width: 1920, height: 1080, fps: 60,
    durationFrames: 600, recordStart: 0, recordEnd: 600,
  };
  const ground = OBJECT_PRESETS['ground']();
  scene.objects.push(ground);

  // Containment walls.
  const wallN = OBJECT_PRESETS['wall']();
  wallN.transform.position = [0, 2, -5];
  wallN.transform.rotation = [0, Math.PI / 2, 0];
  const wallS = OBJECT_PRESETS['wall']();
  wallS.transform.position = [0, 2, 5];
  wallS.transform.rotation = [0, Math.PI / 2, 0];
  const wallW = OBJECT_PRESETS['wall']();
  wallW.transform.position = [-5, 2, 0];
  const wallE = OBJECT_PRESETS['wall']();
  wallE.transform.position = [5, 2, 0];
  scene.objects.push(wallN, wallS, wallW, wallE);

  const tpl = OBJECT_PRESETS['ball-rubber']();
  const area = Math.max(6, Math.ceil(Math.sqrt(count) * 0.55));
  const pile = bakePile(tpl, {
    seed: scene.seed, templateId: 'ball-rubber', colorRandom: 1,
    rotRandom: 1, scaleMin: 0.8, scaleMax: 1.2, massMin: 0, massMax: 0,
    palette: ['#ff5a5a', '#4f8ff7', '#ffd166', '#51ff7a', '#b366ff', '#ff8a3d'],
    count, area, height: Math.ceil(count / (area * area)) * 0.7 + 2, dropHeight: 4,
  });
  scene.objects.push(...pile.objects);
  scene.generators.push(pile.record);

  scene.cameras[0] = {
    ...scene.cameras[0],
    position: [10, 9, 13],
    target: [0, 2, 0],
    fov: 50,
  };
  return scene;
}
