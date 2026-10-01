/**
 * PhysicsRuntime — Rapier rigid-body world + all custom subsystems.
 *
 * Determinism: fixed timestep, fixed call order, seeded streams. Identical
 * scene + seed + frame count reproduces identical transforms (per platform /
 * WASM build — cross-platform bit-identical results are NOT guaranteed by
 * Rapier and we don't claim them).
 *
 * Scrubbing: keyframed world snapshots + auxiliary subsystem state, so
 * gotoFrame(f) restores balloons/emitters/events exactly.
 */

import RAPIER from '@dimforge/rapier3d-compat';
import type {
  ColliderShape,
  CombineRule,
  ForgeConstraint,
  ForgeObject,
  ForgeScene,
  GeometryData,
  Vec3,
} from '../core/types';
import { colliderVolume, resolvePair } from './materials';
import { fieldForce, pseudoNoise } from './fields';
import { PressureSystem } from './pressure';
import { BalloonSystem, type SharpCollider } from './balloon';
import { planFracture } from './fracture';
import {
  createEmitterState,
  resetEmitter,
  stepEmitter,
  type EmitterState,
  type SpawnSpec,
} from './emitters';
import {
  evaluateEvents,
  type CollisionRecord,
  type EventActions,
} from './events';
import { Rng } from '../core/rng';
import { evalDriverTrack, evalMotorTrack } from '../render/director';
import { SimCache, scenePhysicsHash } from './cache';
import {
  FluidSystem,
  FLUID_SUBSTEPS,
  bodyVolumeAndRadius,
  hexToRgbFluid,
  type FluidCollider,
  type FluidSnapshot,
  type FluidVolumeSeed,
} from './fluid';

let initPromise: Promise<void> | null = null;
export function ensureRapier(): Promise<void> {
  if (!initPromise) initPromise = RAPIER.init();
  return initPromise;
}

/* ─── Math helpers (engine-agnostic, no three dependency) ────────────────── */

export function eulerToQuat(e: Vec3): [number, number, number, number] {
  const [x, y, z] = [e[0] / 2, e[1] / 2, e[2] / 2];
  const cx = Math.cos(x);
  const sx = Math.sin(x);
  const cy = Math.cos(y);
  const sy = Math.sin(y);
  const cz = Math.cos(z);
  const sz = Math.sin(z);
  return [
    sx * cy * cz + cx * sy * sz,
    cx * sy * cz - sx * cy * sz,
    cx * cy * sz + sx * sy * cz,
    cx * cy * cz - sx * sy * sz,
  ];
}

/**
 * Inverse of eulerToQuat (same XYZ convention): quaternion → euler.
 * Used to capture live body poses as driver keys. Gimbal edge (|pitch|
 * near π/2) pins roll to zero — same policy as three.js XYZ extraction.
 */
export function quatToEuler(q: [number, number, number, number]): Vec3 {
  const [x, y, z, w] = q;
  const m13 = 2 * (x * z + y * w);
  const m11 = 1 - 2 * (y * y + z * z);
  const m12 = 2 * (x * y - z * w);
  const m23 = 2 * (y * z - x * w);
  const m33 = 1 - 2 * (x * x + y * y);
  const pitch = Math.asin(Math.max(-1, Math.min(1, m13)));
  if (Math.abs(m13) < 0.9999999) {
    return [Math.atan2(-m23, m33), pitch, Math.atan2(-m12, m11)];
  }
  const m22 = 1 - 2 * (x * x + z * z);
  const m32 = 2 * (y * z + x * w);
  return [Math.atan2(m32, m22), pitch, 0];
}

function rotateByQuat(
  v: Vec3,
  q: { x: number; y: number; z: number; w: number },
): Vec3 {
  const { x: qx, y: qy, z: qz, w: qw } = q;
  const ix = qw * v[0] + qy * v[2] - qz * v[1];
  const iy = qw * v[1] + qz * v[0] - qx * v[2];
  const iz = qw * v[2] + qx * v[1] - qy * v[0];
  const iw = -qx * v[0] - qy * v[1] - qz * v[2];
  return [
    ix * qw + iw * -qx + iy * -qz - iz * -qy,
    iy * qw + iw * -qy + iz * -qx - ix * -qz,
    iz * qw + iw * -qz + ix * -qy - iy * -qx,
  ];
}

function combineRule(r: CombineRule): number {
  switch (r) {
    case 'min':
      return RAPIER.CoefficientCombineRule.Min;
    case 'max':
      return RAPIER.CoefficientCombineRule.Max;
    case 'multiply':
      return RAPIER.CoefficientCombineRule.Multiply;
    default:
      return RAPIER.CoefficientCombineRule.Average;
  }
}

/* ─── Primitive mesh sampler (convex / trimesh colliders) ────────────────── */

export interface SampledMesh {
  vertices: Float32Array;
  indices: Uint32Array;
}

/** Hamilton product q1 ⊗ q2 (applies q2 first). [x, y, z, w] order. */
function mulQuat(
  q1: [number, number, number, number],
  q2: [number, number, number, number],
): [number, number, number, number] {
  return [
    q1[3] * q2[0] + q1[0] * q2[3] + q1[1] * q2[2] - q1[2] * q2[1],
    q1[3] * q2[1] - q1[0] * q2[2] + q1[1] * q2[3] + q1[2] * q2[0],
    q1[3] * q2[2] + q1[0] * q2[1] - q1[1] * q2[0] + q1[2] * q2[3],
    q1[3] * q2[3] - q1[0] * q2[0] - q1[1] * q2[1] - q1[2] * q2[2],
  ];
}

/**
 * Structural signature of the scene's fluid volumes: seed, id, pose, and
 * every fluid parameter. Any change reseeds the particle lattice.
 */
function fluidSigOf(scene: ForgeScene): string {
  const rows: string[] = [];
  const objs = [...scene.objects].sort((a, b) => (a.id < b.id ? -1 : 1));
  for (const o of objs) {
    if (o.kind !== 'fluid' || !o.fluid) continue;
    rows.push(
      `${o.id}|${o.fluid.enabled ? 1 : 0}|${o.transform.position.join(',')}|` +
        `${o.transform.rotation.join(',')}|${o.transform.scale.join(',')}|` +
        `${o.fluid.spacing},${o.fluid.viscosity},${o.fluid.stiffness},` +
        `${o.fluid.density},${o.fluid.color},${o.fluid.fill},` +
        `${o.fluid.maxParticles},${o.fluid.openTop ? 1 : 0}`,
    );
  }
  return `${scene.seed}::fps${scene.world.renderFps}::${rows.join(';')}`;
}

/** Broadphase: is a sphere at t with radius r near any fluid volume? */
function nearFluid(
  bounds: Array<{ center: Vec3; radius: number }>,
  t: { x: number; y: number; z: number },
  r: number,
): boolean {
  for (const b of bounds) {
    const dx = t.x - b.center[0];
    const dy = t.y - b.center[1];
    const dz = t.z - b.center[2];
    const reach = b.radius + r + 0.5;
    if (dx * dx + dy * dy + dz * dz < reach * reach) return true;
  }
  return false;
}

export function sampleGeometryMesh(
  geo: GeometryData,
  scale: Vec3,
): SampledMesh {
  const p = geo.params;
  const pts: number[] = [];
  const idx: number[] = [];
  const push = (x: number, y: number, z: number) => {
    pts.push(x * scale[0], y * scale[1], z * scale[2]);
    return pts.length / 3 - 1;
  };
  const type = geo.type;
  if (type === 'box') {
    const w = (p.width ?? 1) / 2;
    const h = (p.height ?? 1) / 2;
    const d = (p.depth ?? 1) / 2;
    const c = [
      push(-w, -h, -d), push(w, -h, -d), push(w, h, -d), push(-w, h, -d),
      push(-w, -h, d), push(w, -h, d), push(w, h, d), push(-w, h, d),
    ];
    idx.push(0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4,
      2, 3, 7, 2, 7, 6, 0, 4, 7, 0, 7, 3, 1, 2, 6, 1, 6, 5);
    void c;
  } else if (type === 'sphere') {
    const r = p.radius ?? 0.5;
    const ws = 12;
    const hs = 8;
    for (let y = 0; y <= hs; y++) {
      const th = (y / hs) * Math.PI;
      for (let x = 0; x <= ws; x++) {
        const ph = (x / ws) * Math.PI * 2;
        push(r * Math.sin(th) * Math.cos(ph), r * Math.cos(th), r * Math.sin(th) * Math.sin(ph));
      }
    }
    for (let y = 0; y < hs; y++) {
      for (let x = 0; x < ws; x++) {
        const a = y * (ws + 1) + x;
        const b = a + 1;
        const c2 = a + ws + 1;
        const d2 = c2 + 1;
        idx.push(a, c2, b, b, c2, d2);
      }
    }
  } else if (type === 'cylinder' || type === 'cone' || type === 'capsule') {
    const rt = type === 'cone' ? 0.001 : (p.radiusTop ?? p.radius ?? 0.5);
    const rb = p.radiusBottom ?? p.radius ?? 0.5;
    const h = (p.height ?? p.length ?? 1) / 2;
    const seg = 12;
    for (let i = 0; i < seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      push(rb * ca, -h, rb * sa);
      push(rt * ca, h, rt * sa);
    }
    const topC = push(0, h, 0);
    const botC = push(0, -h, 0);
    for (let i = 0; i < seg; i++) {
      const n = (i + 1) % seg;
      const b0 = i * 2;
      const t0 = i * 2 + 1;
      const b1 = n * 2;
      const t1 = n * 2 + 1;
      idx.push(b0, b1, t1, b0, t1, t0, topC, t0, t1, botC, b1, b0);
    }
  } else if (type === 'torus') {
    const R = p.radius ?? 0.5;
    const t = p.tube ?? 0.15;
    const rs = 14;
    const ts = 8;
    for (let i = 0; i <= rs; i++) {
      const u = (i / rs) * Math.PI * 2;
      for (let j = 0; j <= ts; j++) {
        const v = (j / ts) * Math.PI * 2;
        push((R + t * Math.cos(v)) * Math.cos(u), t * Math.sin(v), (R + t * Math.cos(v)) * Math.sin(u));
      }
    }
    for (let i = 0; i < rs; i++) {
      for (let j = 0; j < ts; j++) {
        const a = i * (ts + 1) + j;
        const b = a + 1;
        const c2 = a + ts + 1;
        const d2 = c2 + 1;
        idx.push(a, b, c2, b, d2, c2);
      }
    }
  } else if (type === 'convex') {
    // Explicit vertices (voronoi shards); scale applies via push().
    const verts = geo.vertices ?? [];
    for (let i = 0; i + 2 < verts.length + 1; i += 3) {
      push(verts[i], verts[i + 1], verts[i + 2]);
    }
  } else {
    // plane / circle / ring → flat box slab so colliders stay volumetric.
    const w = type === 'plane' ? (p.width ?? 2) / 2 : (p.outer ?? p.radius ?? 1);
    const h = type === 'plane' ? (p.height ?? 2) / 2 : (p.outer ?? p.radius ?? 1);
    const t = 0.02;
    push(-w, -t, -h); push(w, -t, -h); push(w, -t, h); push(-w, -t, h);
    push(-w, t, -h); push(w, t, -h); push(w, t, h); push(-w, t, h);
    idx.push(0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4,
      2, 3, 7, 2, 7, 6, 0, 4, 7, 0, 7, 3, 1, 2, 6, 1, 6, 5);
  }
  return { vertices: new Float32Array(pts), indices: new Uint32Array(idx) };
}

/* ─── Types ──────────────────────────────────────────────────────────────── */

export interface RuntimeEventMsg {
  type: 'pop' | 'fracture' | 'sound' | 'particles' | 'vent' | 'camera' | 'impact';
  objectId?: string;
  point?: Vec3;
  name?: string;
  intensity?: number;
  cameraId?: string;
}

export interface SpawnedDescriptor {
  id: string;
  geometry: GeometryData;
  /** Local scale applied to the spawned mesh (physics already scales). */
  scale: Vec3;
  baseColor: string;
  metalness: number;
  roughness: number;
  emissive: string;
  opacity: number;
}

export interface BodyTransform {
  id: string;
  p: Vec3;
  q: [number, number, number, number];
  v: Vec3;
  sleeping: boolean;
  dynamic: boolean;
}

export interface PhysicsStats {
  bodies: number;
  colliders: number;
  contacts: number;
  joints: number;
  brokenJoints: number;
  stepMs: number;
  fluid: number;
}

export interface RuntimeOptions {
  templateProvider: (id: string) => ForgeObject | null;
  onEvent: (e: RuntimeEventMsg) => void;
}

interface BuiltBody {
  id: string;
  body: RAPIER.RigidBody;
  colliders: RAPIER.Collider[];
  bodyHandle: number;
  colliderHandles: number[];
  def: ForgeObject;
  structSig: string;
  isDynamic: boolean;
  sharpTipLocal: Vec3 | null;
  sharpness: number;
  machineBase: { p: Vec3; q: [number, number, number, number] } | null;
  preset: string;
  /** Last scene transform applied — teleport only fires on user edits,
   *  never because physics moved the body mid-flight. */
  lastScenePos: Vec3;
  lastSceneRot: Vec3;
  lastSceneLinvel: Vec3;
  lastSceneAngvel: Vec3;
}

interface AuxState {
  simTime: number;
  spawnCounter: number;
  popped: string[];
  fractured: string[];
  brokenJoints: string[];
  fired: string[];
  venting: string[];
  emitters: Array<{
    id: string;
    acc: number;
    spawned: number;
    burstDone: boolean;
    rng: [number, number | null];
    alive: string[];
    ages: Array<[string, number]>;
  }>;
  spawnedMeta: Array<[string, SpawnedDescriptor]>;
  removedSpawned: string[];
  /** Null when the scene has no fluid volumes (skips the particle copy). */
  fluid: FluidSnapshot | null;
}

const AUX_EMPTY: AuxState = {
  simTime: 0, spawnCounter: 0, popped: [], fractured: [],
  brokenJoints: [], fired: [], venting: [], emitters: [],
  spawnedMeta: [], removedSpawned: [], fluid: null,
};

/* ─── Runtime ────────────────────────────────────────────────────────────── */

export class PhysicsRuntime {
  private world: RAPIER.World | null = null;
  private queue: RAPIER.EventQueue | null = null;
  private scene: ForgeScene | null = null;
  private bodies = new Map<string, BuiltBody>();
  private colliderToBody = new Map<number, string>();
  private pressure = new PressureSystem();
  private balloons = new BalloonSystem();
  private emitters = new Map<string, EmitterState>();
  private fluid = new FluidSystem();
  private fluidSig = '';
  private events: ForgeScene['events'] = [];
  private eventRng = new Rng(1);
  private cache = new SimCache(10, 120);
  private auxByFrame = new Map<number, AuxState>();
  private frame = 0;
  private simTime = 0;
  private spawnCounter = 0;
  private spawnedMeta = new Map<string, SpawnedDescriptor>();
  private removedSpawned: string[] = [];
  private poppedSet = new Set<string>();
  private fracturedSet = new Set<string>();
  private joints = new Map<
    string,
    { joint: RAPIER.ImpulseJoint; handle: number; def: ForgeConstraint }
  >();
  private brokenJoints = new Set<string>();
  private constraintsSig = '';
  private activeContacts = new Map<string, { a: string; b: string }>();
  private frameCollisions: CollisionRecord[] = [];
  private contactsDebug: Vec3[] = [];
  private lastSoundAt = -1; // sim-seconds; -1 lets the first impact sing
  private stepMs = 0;
  private physicsHash = '';

  constructor(private opts: RuntimeOptions) {}

  get currentFrame(): number {
    return this.frame;
  }
  get currentTime(): number {
    return this.simTime;
  }
  get cacheSize(): number {
    return this.cache.size;
  }

  /* ── Lifecycle ── */

  async loadScene(scene: ForgeScene): Promise<void> {
    await ensureRapier();
    this.disposeWorld();
    this.scene = scene;
    this.physicsHash = scenePhysicsHash(scene);
    this.cache.validate(this.physicsHash);
    this.auxByFrame.clear();

    const w = scene.world;
    this.world = new RAPIER.World({ x: w.gravity[0], y: w.gravity[1], z: w.gravity[2] });
    this.world.timestep = 1 / Math.max(1, w.simFps);
    try {
      this.world.integrationParameters.numSolverIterations = Math.max(1, Math.min(32, w.solverIterations));
    } catch {
      /* older/back-compat builds ignore */
    }
    this.queue = new RAPIER.EventQueue(true);

    this.bodies.clear();
    this.colliderToBody.clear();
    this.pressure.clear();
    this.balloons.clear();
    this.emitters.clear();
    this.activeContacts.clear();
    this.spawnedMeta.clear();
    this.removedSpawned = [];
    this.poppedSet.clear();
    this.fracturedSet.clear();
    this.joints.clear();
    this.brokenJoints.clear();
    this.frame = 0;
    this.simTime = 0;
    this.lastSoundAt = -1;
    this.spawnCounter = 0;
    this.frameCollisions = [];
    // Clone events so `fired` flags stay runtime-local.
    this.events = scene.events.map((e) => ({ ...e, fired: false }));
    this.eventRng = new Rng(`${scene.seed}:events`);

    for (const obj of scene.objects) this.buildObject(obj);
    for (const obj of scene.objects) {
      if (obj.kind === 'emitter' && obj.emitter) {
        this.emitters.set(obj.id, createEmitterState(obj.id, obj.emitter, scene.seed));
      }
    }
    this.rebuildJoints();
    this.reseedFluid();
    this.snapshotFrame(0);
  }

  /**
   * Incremental sync: rebuild only bodies whose structural signature changed,
   * teleport bodies whose transform moved, add/remove the rest.
   */
  syncScene(scene: ForgeScene): void {
    if (!this.world || !this.scene) return;
    const newHash = scenePhysicsHash(scene);
    const structuralChange = newHash !== this.physicsHash;
    this.scene = scene;
    this.physicsHash = newHash;
    if (structuralChange) {
      // Any physics edit invalidates future cache — never past keyframes we keep.
      this.cache.invalidate();
      this.auxByFrame.clear();
    }
    // Fluid volumes reseed (deterministic lattice) whenever their signature
    // changes. Fluid params are part of the physics hash, so aux snapshots
    // are already cleared above — reseed explicitly anyway for robustness.
    if (fluidSigOf(scene) !== this.fluidSig) {
      this.auxByFrame.clear();
      this.reseedFluid();
    }

    // Gravity / solver live update (no rebuild needed).
    const w = scene.world;
    this.world.gravity.x = w.gravity[0];
    this.world.gravity.y = w.gravity[1];
    this.world.gravity.z = w.gravity[2];
    this.world.timestep = 1 / Math.max(1, w.simFps);
    try {
      this.world.integrationParameters.numSolverIterations = Math.max(1, Math.min(32, w.solverIterations));
    } catch { /* ignore */ }

    const seen = new Set<string>();
    let bodiesTouched = false;
    for (const obj of scene.objects) {
      seen.add(obj.id);
      const built = this.bodies.get(obj.id);
      if (this.poppedSet.has(obj.id) || this.fracturedSet.has(obj.id)) continue;
      if (!built) {
        this.buildObject(obj);
        bodiesTouched = true;
        continue;
      }
      const sig = this.structSig(obj);
      if (sig !== built.structSig) {
        // Structural change → rebuild, preserving live dynamic state so the
        // body doesn't jump back to its initial transform mid-flight.
        const preserve = this.captureLiveState(built);
        const rbNow = obj.rigidBody;
        const velEdited =
          !!rbNow &&
          (Math.abs(rbNow.linvel[0] - built.lastSceneLinvel[0]) +
            Math.abs(rbNow.linvel[1] - built.lastSceneLinvel[1]) +
            Math.abs(rbNow.linvel[2] - built.lastSceneLinvel[2]) >
            1e-9 ||
            Math.abs(rbNow.angvel[0] - built.lastSceneAngvel[0]) +
              Math.abs(rbNow.angvel[1] - built.lastSceneAngvel[1]) +
              Math.abs(rbNow.angvel[2] - built.lastSceneAngvel[2]) >
              1e-9);
        this.removeBuilt(built);
        this.buildObject(obj, preserve, !velEdited);
        bodiesTouched = true;
        continue;
      }
      // Transform-only change → teleport (preserves velocities). Guarded by
      // last-synced values so physics motion never triggers a snap-back.
      const t = obj.transform.position;
      const r = obj.transform.rotation;
      const edited =
        Math.abs(built.lastScenePos[0] - t[0]) +
          Math.abs(built.lastScenePos[1] - t[1]) +
          Math.abs(built.lastScenePos[2] - t[2]) >
          1e-9 ||
        Math.abs(built.lastSceneRot[0] - r[0]) +
          Math.abs(built.lastSceneRot[1] - r[1]) +
          Math.abs(built.lastSceneRot[2] - r[2]) >
          1e-9;
      if (edited) {
        const q = eulerToQuat(r);
        try {
          if (built.body.bodyType() === RAPIER.RigidBodyType.KinematicPositionBased) {
            built.body.setNextKinematicTranslation({ x: t[0], y: t[1], z: t[2] });
            built.body.setNextKinematicRotation({ x: q[0], y: q[1], z: q[2], w: q[3] });
          } else {
            built.body.setTranslation({ x: t[0], y: t[1], z: t[2] }, true);
            built.body.setRotation({ x: q[0], y: q[1], z: q[2], w: q[3] }, true);
          }
          if (built.machineBase) {
            built.machineBase = { p: [...t], q };
          }
        } catch { /* stale handle after restore — rebuilt next sync */ }
        built.lastScenePos = [...t];
        built.lastSceneRot = [...r];
      }
    }
    // Removals (scene objects only; transient spawns are snapshot-managed).
    for (const id of [...this.bodies.keys()]) {
      if (!seen.has(id) && !this.spawnedMeta.has(id)) {
        const built = this.bodies.get(id)!;
        this.removeBuilt(built);
        bodiesTouched = true;
      }
    }
    // Emitters add/remove.
    for (const obj of scene.objects) {
      if (obj.kind === 'emitter' && obj.emitter && !this.emitters.has(obj.id)) {
        this.emitters.set(obj.id, createEmitterState(obj.id, obj.emitter, scene.seed));
      }
    }
    for (const id of [...this.emitters.keys()]) {
      if (!seen.has(id)) this.emitters.delete(id);
    }
    // Events: merge enabled/config, keep runtime fired flags.
    const fired = new Set(this.events.filter((e) => e.fired).map((e) => e.id));
    this.events = scene.events.map((e) => ({ ...e, fired: fired.has(e.id) }));

    // Joints: rebuild when constraints changed or any body was rebuilt
    // (Rapier joints hold body handles, so body rebuilds orphan them).
    const jointSig = this.constraintsSigOf(scene);
    if (jointSig !== this.constraintsSig || bodiesTouched) {
      this.rebuildJoints();
    }
  }

  dispose(): void {
    this.disposeWorld();
    this.scene = null;
  }

  private disposeWorld(): void {
    if (this.world) {
      try {
        this.world.free();
      } catch { /* ignore */ }
      this.world = null;
    }
    if (this.queue) {
      try {
        this.queue.free();
      } catch { /* ignore */ }
      this.queue = null;
    }
  }

  /* ── Build ── */

  private structSig(o: ForgeObject): string {
    // NOTE: excludes `rev` and transform position/rotation — those take the
    // cheap teleport path instead of a full body rebuild.
    return `${o.kind}|${o.transform.scale.join(',')}|${JSON.stringify(o.rigidBody)}|${JSON.stringify(o.collider)}|${JSON.stringify(o.field)}|${JSON.stringify(o.machine)}|${JSON.stringify(o.pressure)}|${o.physical.preset}|${o.balloon?.pressure ?? ''}|${JSON.stringify(o.breakable)}`;
  }

  private captureLiveState(built: BuiltBody): {
    p: Vec3; q: [number, number, number, number]; lv: Vec3; av: Vec3;
  } | null {
    try {
      const p = built.body.translation();
      const q = built.body.rotation();
      const lv = built.body.linvel();
      const av = built.body.angvel();
      return {
        p: [p.x, p.y, p.z],
        q: [q.x, q.y, q.z, q.w],
        lv: [lv.x, lv.y, lv.z],
        av: [av.x, av.y, av.z],
      };
    } catch {
      return null;
    }
  }

  private buildObject(
    obj: ForgeObject,
    preserve?: {
      p: Vec3; q: [number, number, number, number]; lv: Vec3; av: Vec3;
    } | null,
    keepVel = true,
  ): void {
    if (!this.world || !this.scene) return;
    const rb = obj.rigidBody;
    const col = obj.collider;
    // Non-physical objects (pure visuals/fields/emitters) need no body.
    if (!rb || !rb.enabled || !col || !col.enabled) {
      return;
    }

    const t = obj.transform;
    const q = eulerToQuat(t.rotation);
    let desc: RAPIER.RigidBodyDesc;
    const isSensorBody = rb.bodyType === 'sensor';
    if (rb.bodyType === 'dynamic') desc = RAPIER.RigidBodyDesc.dynamic();
    else if (rb.bodyType === 'kinematic') desc = RAPIER.RigidBodyDesc.kinematicPositionBased();
    else desc = RAPIER.RigidBodyDesc.fixed();

    // Preserve live pose across rebuilds (edits shouldn't teleport bodies).
    // Velocities restore too, UNLESS the user just edited the initial
    // velocity — then the new value wins (keepVel=false from syncScene).
    const px = preserve ? preserve.p : t.position;
    const pq = preserve ? preserve.q : q;
    const lv = preserve && keepVel ? preserve.lv : rb.linvel;
    const av = preserve && keepVel ? preserve.av : rb.angvel;

    desc
      .setTranslation(px[0], px[1], px[2])
      .setRotation({ x: pq[0], y: pq[1], z: pq[2], w: pq[3] })
      .setLinvel(lv[0], lv[1], lv[2])
      .setAngvel({ x: av[0], y: av[1], z: av[2] })
      .setLinearDamping(rb.linearDamping)
      .setAngularDamping(rb.angularDamping)
      .setGravityScale(isSensorBody ? 0 : rb.gravityScale)
      .setCcdEnabled(rb.ccd)
      .setCanSleep(rb.canSleep)
      .enabledTranslations(!rb.lockTranslation[0], !rb.lockTranslation[1], !rb.lockTranslation[2])
      .enabledRotations(!rb.lockRotation[0], !rb.lockRotation[1], !rb.lockRotation[2]);

    const body = this.world.createRigidBody(desc);
    if (rb.sleeping) {
      try {
        body.sleep();
      } catch { /* ignore */ }
    }

    const cdesc = this.makeColliderDesc(obj, col);
    if (!cdesc) {
      this.world.removeRigidBody(body);
      return;
    }
    const collider = this.world.createCollider(cdesc, body);

    const built: BuiltBody = {
      id: obj.id,
      body,
      colliders: [collider],
      bodyHandle: body.handle,
      colliderHandles: [collider.handle],
      def: obj,
      structSig: this.structSig(obj),
      isDynamic: rb.bodyType === 'dynamic' && !isSensorBody,
      sharpTipLocal: this.computeSharpTip(obj, col),
      sharpness: col.sharpness,
      machineBase: obj.machine ? { p: [...t.position], q } : null,
      preset: obj.physical.preset,
      lastScenePos: [...t.position],
      lastSceneRot: [...t.rotation],
      lastSceneLinvel: [...rb.linvel],
      lastSceneAngvel: [...rb.angvel],
    };
    this.bodies.set(obj.id, built);
    this.colliderToBody.set(collider.handle, obj.id);

    // Balloon registration.
    if (obj.balloon && obj.kind === 'balloon') {
      const r = this.approxRadius(obj);
      this.balloons.register({
        id: obj.id,
        pressure: obj.balloon.pressure,
        maxPressure: obj.balloon.maxPressure,
        skinThickness: obj.balloon.skinThickness,
        fragmentCount: obj.balloon.fragmentCount,
        radius: r,
      });
      this.pressure.register(obj.id, {
        internal: obj.balloon.pressure,
        volume: (4 / 3) * Math.PI * r ** 3,
        leak: 0,
        releaseThreshold: obj.balloon.maxPressure,
        ventDirection: [0, 1, 0],
      });
    }
    if (obj.pressure) {
      this.pressure.register(obj.id, {
        internal: obj.pressure.internal,
        volume: obj.pressure.volume,
        leak: obj.pressure.leak,
        releaseThreshold: obj.pressure.releaseThreshold,
        ventDirection: obj.pressure.ventDirection,
      });
    }
  }

  private makeColliderDesc(
    obj: ForgeObject,
    col: ForgeObject['collider'] & object,
  ): RAPIER.ColliderDesc | null {
    const c = col as ForgeObject['collider'] & {
      shape: ColliderShape;
      halfExtents: Vec3;
      radius: number;
      height: number;
    };
    const s = obj.transform.scale;
    const cq = eulerToQuat(c.rotation ?? [0, 0, 0]);
    let desc: RAPIER.ColliderDesc | null = null;
    const he: Vec3 = [c.halfExtents[0] * s[0], c.halfExtents[1] * s[1], c.halfExtents[2] * s[2]];
    const radius = c.radius * Math.max(s[0], s[2]);
    const height = c.height * s[1];

    switch (c.shape) {
      case 'sphere':
        desc = RAPIER.ColliderDesc.ball(Math.max(0.01, radius));
        break;
      case 'box':
        desc = RAPIER.ColliderDesc.cuboid(
          Math.max(0.01, he[0]), Math.max(0.01, he[1]), Math.max(0.01, he[2]));
        break;
      case 'capsule':
        desc = RAPIER.ColliderDesc.capsule(
          Math.max(0.01, height / 2 - radius), Math.max(0.01, radius));
        break;
      case 'cylinder':
        desc = RAPIER.ColliderDesc.cylinder(
          Math.max(0.01, height / 2), Math.max(0.01, radius));
        break;
      case 'cone':
        desc = RAPIER.ColliderDesc.cone(
          Math.max(0.01, height / 2), Math.max(0.01, radius));
        break;
      case 'convex':
      case 'trimesh': {
        const mesh = sampleGeometryMesh(obj.geometry, s);
        if (c.shape === 'convex') {
          desc = RAPIER.ColliderDesc.convexHull(mesh.vertices);
        } else {
          desc = RAPIER.ColliderDesc.trimesh(mesh.vertices, mesh.indices);
        }
        if (!desc) {
          // Fallback: bounding cuboid (convex hull can fail on degenerate sets).
          desc = RAPIER.ColliderDesc.cuboid(
            Math.max(0.01, he[0]), Math.max(0.01, he[1]), Math.max(0.01, he[2]));
        }
        break;
      }
      default:
        desc = RAPIER.ColliderDesc.cuboid(0.5, 0.5, 0.5);
    }

    const rb = obj.rigidBody!;
    desc
      .setTranslation(c.offset[0], c.offset[1], c.offset[2])
      .setRotation({ x: cq[0], y: cq[1], z: cq[2], w: cq[3] })
      .setFriction(c.friction)
      .setFrictionCombineRule(combineRule(c.frictionCombine))
      .setRestitution(c.restitution)
      .setRestitutionCombineRule(combineRule(c.restitutionCombine))
      .setSensor(c.sensor || rb.bodyType === 'sensor');

    if (rb.massMode === 'override') {
      desc.setMass(Math.max(0.001, rb.mass));
    } else {
      const vol = colliderVolume(c.shape, he, radius, height);
      void vol;
      desc.setDensity(Math.max(1, rb.density));
    }

    let active = RAPIER.ActiveEvents.COLLISION_EVENTS;
    if (obj.breakable?.enabled || obj.kind === 'balloon') {
      active = active | RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS;
      desc.setContactForceEventThreshold(
        obj.breakable?.enabled ? Math.max(0.5, obj.breakable.breakImpulse * 0.5) : 1,
      );
    }
    desc.setActiveEvents(active);
    // Rapier 0.21: InteractionGroups is a packed u32 (groups << 16 | mask).
    desc.setCollisionGroups(
      (((rb.memberships & 0xffff) << 16) | (rb.filters & 0xffff)) >>> 0,
    );
    return desc;
  }

  private computeSharpTip(
    obj: ForgeObject,
    col: NonNullable<ForgeObject['collider']>,
  ): Vec3 | null {
    if (col.sharpness < 0.5) return null;
    // Cone apex in collider-local space; other shapes use collider center.
    const local: Vec3 =
      col.shape === 'cone'
        ? [col.offset[0], col.offset[1] + (col.height * obj.transform.scale[1]) / 2, col.offset[2]]
        : [...col.offset];
    return local;
  }

  private approxRadius(obj: ForgeObject): number {
    const p = obj.geometry.params;
    const s = obj.transform.scale;
    const m = Math.max(s[0], s[1], s[2]);
    switch (obj.geometry.type) {
      case 'sphere':
        return (p.radius ?? 0.5) * m;
      case 'box':
        return Math.max(p.width ?? 1, p.height ?? 1, p.depth ?? 1) * 0.5 * m;
      case 'cone':
      case 'cylinder':
      case 'capsule':
        return Math.max(p.radius ?? 0.5, (p.height ?? 1) / 2) * m;
      default:
        return 0.5 * m;
    }
  }

  private removeBuilt(built: BuiltBody): void {
    if (!this.world) return;
    for (const [jid, j] of [...this.joints]) {
      if (j.def.bodyA === built.id || j.def.bodyB === built.id) {
        try {
          this.world.removeImpulseJoint(j.joint, true);
        } catch { /* already gone */ }
        this.joints.delete(jid);
      }
    }
    try {
      this.world.removeRigidBody(built.body);
    } catch { /* already gone */ }
    for (const h of built.colliderHandles) this.colliderToBody.delete(h);
    this.bodies.delete(built.id);
    this.pressure.unregister(built.id);
    this.balloons.unregister(built.id);
    for (const [k, v] of this.activeContacts) {
      if (v.a === built.id || v.b === built.id) this.activeContacts.delete(k);
    }
  }

  /* ── Joints ── */

  private constraintsSigOf(scene: ForgeScene): string {
    return JSON.stringify(scene.constraints);
  }

  private rebuildJoints(): void {
    if (!this.world || !this.scene) return;
    for (const [, j] of this.joints) {
      try {
        this.world.removeImpulseJoint(j.joint, true);
      } catch { /* already gone */ }
    }
    this.joints.clear();
    this.brokenJoints.clear();
    for (const c of this.scene.constraints) this.buildJoint(c);
    this.constraintsSig = this.constraintsSigOf(this.scene);
  }

  private buildJoint(def: ForgeConstraint): void {
    if (!this.world || !def.enabled) return;
    const A = this.bodies.get(def.bodyA);
    const B = this.bodies.get(def.bodyB);
    if (!A || !B) return;
    const a1 = { x: def.anchorA[0], y: def.anchorA[1], z: def.anchorA[2] };
    const a2 = { x: def.anchorB[0], y: def.anchorB[1], z: def.anchorB[2] };
    const ax = { x: def.axis[0], y: def.axis[1], z: def.axis[2] };
    let data: RAPIER.JointData | null = null;
    try {
      switch (def.type) {
        case 'fixed':
          data = RAPIER.JointData.fixed(
            a1, { x: 0, y: 0, z: 0, w: 1 }, a2, { x: 0, y: 0, z: 0, w: 1 });
          break;
        case 'distance':
          // Fixed distance via a stiff spring (Rapier has no rigid
          // distance joint; stiffness floor keeps it near-rigid).
          data = RAPIER.JointData.spring(
            Math.max(0.01, def.restLength),
            Math.max(def.stiffness, 50000),
            def.damping, a1, a2);
          break;
        case 'hinge':
          data = RAPIER.JointData.revolute(a1, a2, ax);
          break;
        case 'slider':
          data = RAPIER.JointData.prismatic(a1, a2, ax);
          break;
        case 'spring':
          data = RAPIER.JointData.spring(
            Math.max(0.01, def.restLength), def.stiffness, def.damping, a1, a2);
          break;
        case 'ball':
          data = RAPIER.JointData.spherical(a1, a2);
          break;
        case 'rope':
          data = RAPIER.JointData.rope(Math.max(0.01, def.restLength), a1, a2);
          break;
        default:
          return;
      }
    } catch {
      return;
    }
    if (!data) return;
    try {
      const joint = this.world.createImpulseJoint(data, A.body, B.body, true);
      this.joints.set(def.id, { joint, handle: joint.handle, def });
      // Limits + motors (revolute/prismatic) — feature-detected.
      const uj = joint as unknown as {
        setLimits?: (min: number, max: number) => void;
        configureMotorVelocity?: (v: number, f: number) => void;
        configureMotorPosition?: (p: number, s: number, d: number) => void;
        configureMotorModel?: (m: number) => void;
      };
      if (def.limitsEnabled && typeof uj.setLimits === 'function') {
        try {
          uj.setLimits(def.minLimit, def.maxLimit);
        } catch { /* ignore */ }
      }
      if (def.motorEnabled) {
        const MM = (
          RAPIER as unknown as { MotorModel?: { ForceBased: number } }
        ).MotorModel;
        try {
          if (MM && typeof uj.configureMotorModel === 'function') {
            uj.configureMotorModel(MM.ForceBased);
          }
        } catch { /* ignore */ }
        try {
          if (def.motorMode === 'velocity') {
            uj.configureMotorVelocity?.(def.motorSpeed, def.motorForce);
          } else {
            uj.configureMotorPosition?.(
              def.motorTarget, Math.max(1, def.motorForce), def.damping);
          }
        } catch { /* ignore */ }
      }
    } catch { /* stale body — rebuilt next sync */ }
  }

  /**
   * Per-frame motor choreography. Keyframed targets apply to live joints
   * only while the joint's own motor is enabled; pure function of frame,
   * so rewind/replay and cached restores stay deterministic.
   */
  private applyMotorTracks(): void {
    const scene = this.scene;
    if (!scene || !this.world || scene.motorTracks.length === 0) return;
    for (const t of scene.motorTracks) {
      if (!t.enabled || t.keys.length === 0) continue;
      const live = this.joints.get(t.jointId);
      if (!live || !live.def.motorEnabled) continue;
      const v = evalMotorTrack(t, this.frame);
      if (v == null || !Number.isFinite(v)) continue;
      const uj = live.joint as unknown as {
        configureMotorVelocity?: (v: number, f: number) => void;
        configureMotorPosition?: (p: number, s: number, d: number) => void;
      };
      try {
        if (live.def.motorMode === 'velocity') {
          uj.configureMotorVelocity?.(v, live.def.motorForce);
        } else {
          uj.configureMotorPosition?.(
            v, Math.max(1, live.def.motorForce), live.def.damping);
        }
      } catch { /* ignore */ }
    }
  }

  /**
   * Per-frame kinematic drivers. Keyframed poses apply to live bodies
   * only while they are kinematic position-based — dynamic bodies
   * ignore their driver tracks. Pure function of frame, so scrub and
   * replay stay deterministic.
   */
  private applyDriverTracks(): void {
    const scene = this.scene;
    if (!scene || !this.world || scene.driverTracks.length === 0) return;
    for (const t of scene.driverTracks) {
      if (!t.enabled) continue;
      const built = this.bodies.get(t.objectId);
      if (!built) continue;
      try {
        if (
          built.body.bodyType() !== RAPIER.RigidBodyType.KinematicPositionBased
        ) {
          continue;
        }
      } catch {
        continue;
      }
      const pose = evalDriverTrack(
        t,
        {
          position: built.def.transform.position,
          rotation: built.def.transform.rotation,
        },
        this.frame,
      );
      if (!pose) continue;
      const q = eulerToQuat(pose.rotation);
      try {
        built.body.setNextKinematicTranslation({
          x: pose.position[0],
          y: pose.position[1],
          z: pose.position[2],
        });
        built.body.setNextKinematicRotation({ x: q[0], y: q[1], z: q[2], w: q[3] });
      } catch { /* stale handle after restore — rebuilt next sync */ }
    }
  }

  /** Break a joint with effect hooks. */
  private breakJoint(id: string): void {
    const j = this.joints.get(id);
    if (!j || !this.world) return;
    try {
      this.world.removeImpulseJoint(j.joint, true);
    } catch { /* ignore */ }
    this.joints.delete(id);
    this.brokenJoints.add(id);
    const point = this.midpoint(j.def.bodyA, j.def.bodyB);
    this.opts.onEvent({ type: 'sound', name: 'snap', point, intensity: 0.8 });
    this.opts.onEvent({ type: 'particles', point, intensity: 0.5 });
  }

  brokenJointIds(): Set<string> {
    return this.brokenJoints;
  }

  /* ── Stepping ── */

  /** Advance N render-frames of simulation. */
  stepFrames(n: number): void {
    for (let i = 0; i < n; i++) this.stepOneFrame();
  }

  private stepOneFrame(): void {
    if (!this.world || !this.queue || !this.scene) return;
    const t0 = performance.now();
    const w = this.scene.world;
    const dtFrame = 1 / Math.max(1, w.renderFps);
    const stepsPerFrame = Math.max(1, Math.round(w.simFps / w.renderFps));
    const sub = Math.max(1, w.substeps);
    const dt = dtFrame / stepsPerFrame / sub;
    this.world.timestep = Math.min(dt, w.maxTimestep);
    this.frameCollisions = [];
    this.contactsDebug = [];
    this.applyMotorTracks();
    this.applyDriverTracks();
    this.stepFluid(dtFrame);

    for (let s = 0; s < stepsPerFrame; s++) {
      for (let k = 0; k < sub; k++) {
        this.preStep(dt);
        this.world.step(this.queue);
        this.drainEvents();
        this.simTime += dt;
      }
    }

    this.postFrame(dtFrame);
    this.frame += 1;
    if (this.cache.shouldSnapshot(this.frame)) this.snapshotFrame(this.frame);
    this.stepMs = performance.now() - t0;
  }

  private preStep(dt: number): void {
    if (!this.world || !this.scene) return;
    const w = this.scene.world;
    const timeScale = w.timeScale;
    void timeScale; // timeScale maps to frames advanced by the caller, not dt
    void dt;

    // Machines (kinematic targets).
    for (const built of this.bodies.values()) {
      const m = built.def.machine;
      if (!m || !m.enabled || !built.machineBase) continue;
      this.driveMachine(built, m, this.simTime);
    }

    // Per-body forces: constant force/torque, gravity is native.
    for (const built of this.bodies.values()) {
      if (!built.isDynamic) continue;
      const b = built.body;
      try {
        if (typeof (b as unknown as { resetForces?: (w: boolean) => void }).resetForces === 'function') {
          (b as unknown as { resetForces: (w: boolean) => void }).resetForces(true);
        }
      } catch { /* ignore */ }
      const f = built.def.constantForce;
      const tq = built.def.constantTorque;
      if (f[0] !== 0 || f[1] !== 0 || f[2] !== 0) {
        try {
          b.addForce({ x: f[0], y: f[1], z: f[2] }, true);
        } catch { /* ignore */ }
      }
      if (tq[0] !== 0 || tq[1] !== 0 || tq[2] !== 0) {
        try {
          b.addTorque({ x: tq[0], y: tq[1], z: tq[2] }, true);
        } catch { /* ignore */ }
      }
    }
    this.applyBuoyancy();

    // Force fields.
    if (this.scene) {
      const fields = this.scene.objects.filter(
        (o) => o.kind === 'field' && o.field?.enabled,
      );
      if (fields.length > 0) {
        for (const built of this.bodies.values()) {
          if (!built.isDynamic) continue;
          const bp = built.body.translation();
          const pos: Vec3 = [bp.x, bp.y, bp.z];
          let fx = 0;
          let fy = 0;
          let fz = 0;
          for (const fl of fields) {
            const f = fieldForce(fl, pos, this.simTime);
            fx += f[0];
            fy += f[1];
            fz += f[2];
          }
          if (fx !== 0 || fy !== 0 || fz !== 0) {
            try {
              built.body.addForce({ x: fx, y: fy, z: fz }, true);
            } catch { /* ignore */ }
          }
        }
      }
    }

    // Wind + air drag (skipped in vacuum).
    if (!w.vacuum && w.airDensity > 0) {
      const k = Math.min(0.9, w.airDensity * 0.35 * dt * 60 * 0.016);
      const wind = w.wind;
      const turb = w.turbulence;
      for (const built of this.bodies.values()) {
        if (!built.isDynamic) continue;
        try {
          const v = built.body.linvel();
          const bp = built.body.translation();
          const gust = turb > 0 ? turb * 3 : 0;
          const wx = wind[0] + (gust ? pseudoNoise([bp.x, bp.y, bp.z], this.simTime, 1) * gust : 0);
          const wy = wind[1];
          const wz = wind[2] + (gust ? pseudoNoise([bp.x, bp.y, bp.z], this.simTime, 7) * gust : 0);
          const m = Math.max(0.01, built.body.mass());
          built.body.applyImpulse(
            { x: (wx - v.x) * k * m, y: (wy - v.y) * k * m, z: (wz - v.z) * k * m },
            true,
          );
        } catch { /* ignore */ }
      }
    }

    // Conveyor belts: push bodies resting in the belt zone.
    for (const built of this.bodies.values()) {
      const m = built.def.machine;
      if (!m || !m.enabled || m.kind !== 'conveyor') continue;
      if (this.simTime < m.startTime) continue;
      if (m.stopTime > 0 && this.simTime > m.stopTime) continue;
      const cp = built.body.translation();
      const g = built.def.geometry.params;
      const hx = ((g.width ?? 2) / 2) * built.def.transform.scale[0] + 0.3;
      const hz = ((g.depth ?? 2) / 2) * built.def.transform.scale[2] + 0.3;
      const topY = cp.y + ((g.height ?? 0.3) / 2) * built.def.transform.scale[1];
      for (const other of this.bodies.values()) {
        if (!other.isDynamic || other.id === built.id) continue;
        try {
          const op = other.body.translation();
          if (
            Math.abs(op.x - cp.x) < hx &&
            Math.abs(op.z - cp.z) < hz &&
            op.y > topY - 0.5 &&
            op.y < topY + 1.2
          ) {
            const v = other.body.linvel();
            const mm = Math.max(0.01, other.body.mass());
            const blend = 0.12;
            other.body.applyImpulse(
              {
                x: (m.direction[0] * m.speed - v.x) * blend * mm,
                y: 0,
                z: (m.direction[2] * m.speed - v.z) * blend * mm,
              },
              true,
            );
          }
        } catch { /* ignore */ }
      }
    }
  }

  private driveMachine(
    built: BuiltBody,
    m: NonNullable<ForgeObject['machine']>,
    t: number,
  ): void {
    if (!m || !built.machineBase) return;
    if (t < m.startTime) return;
    if (m.stopTime > 0 && t > m.stopTime) return;
    const base = built.machineBase;
    const b = built.body;
    try {
      if (m.kind === 'press' || m.kind === 'piston' || m.kind === 'hammer' || m.kind === 'platform') {
        const cycle = Math.max(0.1, m.cycleTime);
        const ph = ((t + m.phase) % cycle) / cycle;
        const tri = ph < 0.5 ? ph * 2 : 2 - ph * 2; // 0→1→0
        const d = tri * m.stroke;
        b.setNextKinematicTranslation({
          x: base.p[0] + m.direction[0] * d,
          y: base.p[1] + m.direction[1] * d,
          z: base.p[2] + m.direction[2] * d,
        });
      } else if (m.kind === 'spinner' || m.kind === 'wheel') {
        const ang = (t - m.startTime) * m.speed + m.phase;
        const half = ang / 2;
        // Spin around local Y (direction.y selects axis blend — v1: Y axis).
        const q = { x: 0, y: Math.sin(half), z: 0, w: Math.cos(half) };
        b.setNextKinematicRotation(q);
      } else if (m.kind === 'gate') {
        const open = Math.min(1, (t - m.startTime) / 1);
        const ang = open * (Math.PI / 2);
        const half = ang / 2;
        b.setNextKinematicRotation({ x: 0, y: Math.sin(half), z: 0, w: Math.cos(half) });
      }
    } catch { /* ignore */ }
  }

  /* ── Events drain ── */

  private relSpeed(a: string, b: string): number {
    const ba = this.bodies.get(a);
    const bb = this.bodies.get(b);
    if (!ba || !bb) return 0;
    try {
      const va = ba.body.linvel();
      const vb = bb.body.linvel();
      const dx = va.x - vb.x;
      const dy = va.y - vb.y;
      const dz = va.z - vb.z;
      return Math.sqrt(dx * dx + dy * dy + dz * dz);
    } catch {
      return 0;
    }
  }

  /**
   * Impact momentum J = μ × v_rel with reduced mass μ. Static partners
   * contribute infinite mass (μ = dynamic mass). Units: N·s (impulse).
   */
  private impactMomentum(
    self: BuiltBody,
    other: BuiltBody,
    relSpeed: number,
  ): number {
    void self;
    try {
      const ma = self.isDynamic ? self.body.mass() : Infinity;
      const mb = other.isDynamic ? other.body.mass() : Infinity;
      if (!isFinite(ma) && !isFinite(mb)) return 0;
      const mu = !isFinite(ma) ? mb : !isFinite(mb) ? ma : (ma * mb) / (ma + mb);
      return mu * relSpeed;
    } catch {
      return 0;
    }
  }

  /** True when a contact force represents crushing, not resting/smashing. */
  private isCrushing(built: BuiltBody, forceMag: number): boolean {
    const br = built.def.breakable;
    if (!br?.enabled || this.fracturedSet.has(built.id)) return false;
    let m = 1;
    try {
      m = built.isDynamic ? Math.max(0.1, built.body.mass()) : 500;
    } catch {
      m = 500;
    }
    // F > J/dt equivalent AND > 8× static weight.
    return forceMag > br.breakImpulse * 60 && forceMag > m * 9.81 * 8;
  }

  private midpoint(a: string, b: string): Vec3 {
    const ba = this.bodies.get(a);
    const bb = this.bodies.get(b);
    if (!ba || !bb) return [0, 1, 0];
    try {
      const pa = ba.body.translation();
      const pb = bb.body.translation();
      return [(pa.x + pb.x) / 2, (pa.y + pb.y) / 2, (pa.z + pb.z) / 2];
    } catch {
      return [0, 1, 0];
    }
  }

  private drainEvents(): void {
    if (!this.queue) return;
    // Collision start/stop.
    this.queue.drainCollisionEvents((h1, h2, started) => {
      const a = this.colliderToBody.get(h1);
      const b = this.colliderToBody.get(h2);
      if (!a || !b) return;
      const key = h1 < h2 ? `${h1}|${h2}` : `${h2}|${h1}`;
      if (started) {
        this.activeContacts.set(key, { a, b });
        const speed = this.relSpeed(a, b);
        const point = this.midpoint(a, b);
        if (this.frameCollisions.length < 512) {
          this.frameCollisions.push({ a, b, point, impulse: speed, speed });
        }
        if (this.contactsDebug.length < 256) this.contactsDebug.push(point);
        // Balloon impact-pop + breakable impact fracture + impact sound.
        const ba = this.bodies.get(a);
        const bb = this.bodies.get(b);
        if (ba && bb) {
          if (this.balloons.checkImpact(a, bb.sharpness, speed)) {
            this.popBalloon(a, point);
          } else if (this.balloons.checkImpact(b, ba.sharpness, speed)) {
            this.popBalloon(b, point);
          }
          // Momentum-based fracture: J = reduced_mass × closing speed.
          // Resting contacts (v≈0) can NEVER fracture — only real impacts.
          if (
            ba.def.breakable?.enabled &&
            !this.fracturedSet.has(a) &&
            this.impactMomentum(ba, bb, speed) > ba.def.breakable.breakImpulse
          ) {
            this.fractureObject(a);
          }
          if (
            bb.def.breakable?.enabled &&
            !this.fracturedSet.has(b) &&
            this.impactMomentum(bb, ba, speed) > bb.def.breakable.breakImpulse
          ) {
            this.fractureObject(b);
          }
          if (speed > 2.5) {
            // Sim-time throttle (NOT wall clock): export audio must be
            // bit-identical across runs, and scrub-replay must re-emit.
            if (this.simTime - this.lastSoundAt > 0.06) {
              this.lastSoundAt = this.simTime;
              this.opts.onEvent({
                type: 'sound', name: 'impact', point,
                intensity: Math.min(1, speed / 12),
              });
            }
          }
        }
      } else {
        this.activeContacts.delete(key);
      }
    });
    // Contact force (breakables).
    this.queue.drainContactForceEvents((e) => {
      let mag = 0;
      let h1 = -1;
      let h2 = -1;
      try {
        mag = e.totalForceMagnitude();
        h1 = e.collider1();
        h2 = e.collider2();
      } catch {
        return;
      }
      const a = this.colliderToBody.get(h1);
      const b = this.colliderToBody.get(h2);
      if (!a || !b) return;
      // Crush rule: sustained load far above static weight (press/grind).
      // Resting weight alone never qualifies (8× static-load guard).
      const ba = this.bodies.get(a);
      const bb = this.bodies.get(b);
      if (ba?.def.breakable?.enabled && this.isCrushing(ba, mag)) {
        this.fractureObject(a);
      } else if (bb?.def.breakable?.enabled && this.isCrushing(bb, mag)) {
        this.fractureObject(b);
      }
      // Feed impact trigger with real force magnitude.
      if (this.frameCollisions.length < 512) {
        this.frameCollisions.push({ a, b, point: this.midpoint(a, b), impulse: mag, speed: this.relSpeed(a, b) });
      }
    });
  }

  /* ── Post-frame: pairs, balloons, pressure, emitters, events ── */

  private postFrame(dtFrame: number): void {
    if (!this.scene) return;

    // Pair matrix + adhesion on live contacts.
    if (this.activeContacts.size > 0) {
      let processed = 0;
      for (const { a, b } of this.activeContacts.values()) {
        if (++processed > 4000) break; // perf guard for giant piles
        const ba = this.bodies.get(a);
        const bb = this.bodies.get(b);
        if (!ba || !bb) continue;
        if (!ba.isDynamic && !bb.isDynamic) continue;
        const pair = resolvePair(ba.preset, bb.preset);
        const adhesion = Math.max(
          ba.def.physical.adhesion, bb.def.physical.adhesion);
        if (!pair && adhesion < 0.25) continue;
        try {
          const pa = ba.body.translation();
          const pb = bb.body.translation();
          let nx = pb.x - pa.x;
          let ny = pb.y - pa.y;
          let nz = pb.z - pa.z;
          const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
          nx /= len;
          ny /= len;
          nz /= len;
          for (const [built, sign] of [[ba, 1], [bb, -1]] as const) {
            if (!built.isDynamic) continue;
            const v = built.body.linvel();
            const vn = v.x * nx * sign + v.y * ny * sign + v.z * nz * sign;
            const tx = v.x - vn * nx * sign;
            const ty = v.y - vn * ny * sign;
            const tz = v.z - vn * nz * sign;
            const retain = pair ? pair.tangentRetain : 1 - adhesion * 0.08;
            const boost = pair && vn < -pair.minImpact ? pair.bounceBoost : 0;
            const m = Math.max(0.01, built.body.mass());
            built.body.applyImpulse(
              {
                x: (tx * (retain - 1) + nx * sign * boost * 0.5) * m,
                y: (ty * (retain - 1) + ny * sign * boost * 0.5) * m,
                z: (tz * (retain - 1) + nz * sign * boost * 0.5) * m,
              },
              true,
            );
          }
        } catch { /* ignore */ }
      }
    }

    // Max velocity clamps.
    for (const built of this.bodies.values()) {
      if (!built.isDynamic) continue;
      const rb = built.def.rigidBody;
      if (!rb) continue;
      if (rb.maxLinvel > 0 || rb.maxAngvel > 0) {
        try {
          if (rb.maxLinvel > 0) {
            const v = built.body.linvel();
            const sp = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
            if (sp > rb.maxLinvel) {
              const k = rb.maxLinvel / sp;
              built.body.setLinvel({ x: v.x * k, y: v.y * k, z: v.z * k }, true);
            }
          }
          if (rb.maxAngvel > 0) {
            const wv = built.body.angvel();
            const sp = Math.sqrt(wv.x * wv.x + wv.y * wv.y + wv.z * wv.z);
            if (sp > rb.maxAngvel) {
              const k = rb.maxAngvel / sp;
              built.body.setAngvel({ x: wv.x * k, y: wv.y * k, z: wv.z * k }, true);
            }
          }
        } catch { /* ignore */ }
      }
    }

    // Balloon touch-puncture + overpressure.
    const sharps: SharpCollider[] = [];
    for (const built of this.bodies.values()) {
      if (!built.sharpTipLocal || built.sharpness < 0.5) continue;
      try {
        const bp = built.body.translation();
        const bq = built.body.rotation();
        const tip = rotateByQuat(built.sharpTipLocal, bq);
        sharps.push({
          objectId: built.id,
          sharpness: built.sharpness,
          tip: [bp.x + tip[0], bp.y + tip[1], bp.z + tip[2]],
        });
      } catch { /* ignore */ }
    }
    if (sharps.length > 0 || this.balloons) {
      for (const [id] of [...this.bodies.entries()]) {
        const built = this.bodies.get(id);
        if (!built || this.poppedSet.has(id)) continue;
        if (!this.balloons.get(id)) continue;
        try {
          const bp = built.body.translation();
          const center: Vec3 = [bp.x, bp.y, bp.z];
          const touch = this.balloons.checkTouch(id, center, sharps);
          if (touch) {
            this.popBalloon(id, touch);
            continue;
          }
          const p = this.pressure.get(id);
          if (this.balloons.checkOverpressure(id, p)) {
            this.popBalloon(id, center);
          }
        } catch { /* ignore */ }
      }
    }

    // Breakable joints: stress proxy σ = μ·|Δv|/dt (N). v1 approximation,
    // documented — Rapier exposes no joint reaction forces in JS.
    if (this.joints.size > 0) {
      for (const [id, j] of [...this.joints]) {
        const threshold = j.def.breakForce;
        if (!(threshold > 0)) continue;
        const A = this.bodies.get(j.def.bodyA);
        const B = this.bodies.get(j.def.bodyB);
        if (!A || !B) continue;
        try {
          const va = A.body.linvel();
          const vb = B.body.linvel();
          const dv = Math.sqrt(
            (va.x - vb.x) ** 2 + (va.y - vb.y) ** 2 + (va.z - vb.z) ** 2,
          );
          const ma = A.isDynamic ? A.body.mass() : Infinity;
          const mb = B.isDynamic ? B.body.mass() : Infinity;
          if (!isFinite(ma) && !isFinite(mb)) continue;
          const mu = !isFinite(ma) ? mb : !isFinite(mb) ? ma : (ma * mb) / (ma + mb);
          const stress = (mu * dv) / Math.max(1e-4, dtFrame);
          if (stress > threshold) this.breakJoint(id);
        } catch { /* ignore */ }
      }
    }

    // Pressure vessels.
    const venting = this.pressure.step(
      dtFrame,
      (id) => {
        const built = this.bodies.get(id);
        if (!built) return undefined;
        try {
          const p = built.body.translation();
          return {
            id,
            position: [p.x, p.y, p.z] as Vec3,
            mass: Math.max(0.01, built.body.mass()),
            isDynamic: built.isDynamic,
            applyImpulse: (ix, iy, iz) => {
              try {
                built.body.applyImpulse({ x: ix, y: iy, z: iz }, true);
              } catch { /* ignore */ }
            },
          };
        } catch {
          return undefined;
        }
      },
      (cb) => {
        for (const built of this.bodies.values()) {
          try {
            const p = built.body.translation();
            cb({
              id: built.id,
              position: [p.x, p.y, p.z],
              mass: 1,
              isDynamic: built.isDynamic,
              applyImpulse: (ix, iy, iz) => {
                try {
                  built.body.applyImpulse({ x: ix, y: iy, z: iz }, true);
                } catch { /* ignore */ }
              },
            });
          } catch { /* ignore */ }
        }
      },
    );
    for (const id of venting) {
      const built = this.bodies.get(id);
      if (built) {
        try {
          const p = built.body.translation();
          this.opts.onEvent({ type: 'vent', objectId: id, point: [p.x, p.y, p.z] });
        } catch { /* ignore */ }
      }
    }

    // Emitters.
    for (const [id, st] of this.emitters) {
      const emitterObj = this.scene.objects.find((o) => o.id === id);
      if (!emitterObj) continue;
      stepEmitter(st, this.simTime, dtFrame, emitterObj.transform.position,
        Math.max(...emitterObj.transform.scale, 1),
        {
          spawn: (spec) => this.spawnFromSpec(spec),
          recycle: (rid, spec) => this.recycleBody(rid, spec),
          despawn: (rid) => this.despawnBody(rid),
        });
    }

    // Events.
    if (this.events.length > 0) {
      const actions: EventActions = {
        spawn: (presetId, position) => {
          const tpl = this.opts.templateProvider(presetId);
          if (!tpl) return;
          this.spawnFromSpec({
            emitterId: 'event', templateId: presetId,
            position: position ?? [0, 3, 0], rotation: [0, 0, 0],
            velocity: [0, 0, 0], scale: 1, color: null, mass: 0,
          });
        },
        delete: (id) => {
          const built = this.bodies.get(id);
          if (built && !this.spawnedMeta.has(id)) {
            // Scene object: hide from sim (restored on reset).
            this.removeBuilt(built);
          } else if (built) {
            this.despawnBody(id);
          }
        },
        impulse: (id, vec) => {
          const built = this.bodies.get(id);
          if (built) {
            try {
              built.body.applyImpulse({ x: vec[0], y: vec[1], z: vec[2] }, true);
            } catch { /* ignore */ }
          }
        },
        setPressure: (id, pa) => this.pressure.set(id, pa),
        break: (id) => this.fractureObject(id),
        pop: (id) => {
          const built = this.bodies.get(id);
          if (built) {
            try {
              const p = built.body.translation();
              this.popBalloon(id, [p.x, p.y, p.z]);
            } catch { /* ignore */ }
          }
        },
        setGravity: (vec) => {
          if (this.world) {
            this.world.gravity.x = vec[0];
            this.world.gravity.y = vec[1];
            this.world.gravity.z = vec[2];
          }
        },
        setCamera: (cameraId) => this.opts.onEvent({ type: 'camera', cameraId }),
        sound: (name, intensity) => this.opts.onEvent({ type: 'sound', name, intensity }),
        particles: (point, scalar) =>
          this.opts.onEvent({ type: 'particles', point, intensity: scalar }),
        toggle: (id) => {
          const built = this.bodies.get(id);
          if (built) {
            // Toggle = remove from sim (visibility toggles live in the scene).
            this.removeBuilt(built);
          } else if (this.scene) {
            const obj = this.scene.objects.find((o) => o.id === id);
            if (obj && !this.poppedSet.has(id) && !this.fracturedSet.has(id)) {
              this.buildObject(obj);
            }
          }
        },
        motor: (id, enabled) => {
          const built = this.bodies.get(id);
          if (built?.def.machine) built.def.machine.enabled = enabled;
        },
      };
      evaluateEvents(this.events, {
        simTime: this.simTime,
        dt: dtFrame,
        positionOf: (id) => {
          const built = this.bodies.get(id);
          if (!built) return null;
          try {
            const p = built.body.translation();
            return [p.x, p.y, p.z];
          } catch {
            return null;
          }
        },
        speedOf: (id) => {
          const built = this.bodies.get(id);
          if (!built) return 0;
          try {
            const v = built.body.linvel();
            return Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
          } catch {
            return 0;
          }
        },
        pressureOf: (id) => this.pressure.get(id),
        collisions: this.frameCollisions,
        rng: this.eventRng,
      }, actions);
    }
  }

  /* ── Balloon pop / fracture ── */

  private popBalloon(id: string, point: Vec3): void {
    const built = this.bodies.get(id);
    if (!built || this.poppedSet.has(id)) return;
    const def = this.balloons.get(id);
    const pressure = this.pressure.get(id);
    const result = this.balloons.pop(id, point, pressure);
    void result;
    this.poppedSet.add(id);

    // Skin fragments (latex chunks).
    const count = def?.fragmentCount ?? 10;
    const r = def?.radius ?? 0.5;
    const specs = planFracture([r, r, r], 'radial', count,
      (this.scene?.seed ?? 1) + this.frame, 3);
    let bp: Vec3 = [0, 1, 0];
    try {
      const p = built.body.translation();
      bp = [p.x, p.y, p.z];
    } catch { /* ignore */ }
    const latex = this.opts.templateProvider('fragment-latex');
    for (const s of specs) {
      const child: ForgeObject = latex
        ? structuredClone(latex)
        : structuredClone(built.def);
      child.id = `spawn-${this.spawnCounter++}`;
      child.kind = 'fragment';
      child.transform.position = [bp[0] + s.offset[0], bp[1] + s.offset[1], bp[2] + s.offset[2]];
      child.transform.rotation = [...s.rotation];
      child.transform.scale = [s.size[0], s.size[1], s.size[2]];
      child.geometry = { type: 'box', params: { width: 1, height: 1, depth: 1 } };
      if (child.collider) {
        child.collider.shape = 'box';
        child.collider.halfExtents = [0.5, 0.5, 0.5];
      }
      if (child.rigidBody) {
        child.rigidBody.bodyType = 'dynamic';
        child.rigidBody.linvel = [...s.velocity];
      }
      this.buildSpawned(child);
    }

    // Pressure-release radial impulse (scaled by stored pressure).
    const power = (1 + pressure / 50000) * 2.2;
    for (const other of this.bodies.values()) {
      if (other.id === id || !other.isDynamic) continue;
      try {
        const op = other.body.translation();
        const dx = op.x - bp[0];
        const dy = op.y - bp[1];
        const dz = op.z - bp[2];
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
        const radius = 3 + r * 2;
        if (d > radius || d < 1e-4) continue;
        const fall = 1 - d / radius;
        const m = Math.max(0.01, other.body.mass());
        other.body.applyImpulse(
          {
            x: (dx / d) * power * fall * m,
            y: (dy / d) * power * fall * m + power * fall * m * 0.3,
            z: (dz / d) * power * fall * m,
          },
          true,
        );
      } catch { /* ignore */ }
    }

    this.removeBuilt(built);
    this.opts.onEvent({ type: 'pop', objectId: id, point, intensity: power });
    this.opts.onEvent({ type: 'sound', name: 'pop', point, intensity: 1 });
    this.opts.onEvent({ type: 'particles', point, intensity: 1.5 });
  }

  private fractureObject(id: string): void {
    const built = this.bodies.get(id);
    if (!built || this.fracturedSet.has(id) || this.poppedSet.has(id)) return;
    const br = built.def.breakable;
    if (!br?.enabled) return;
    this.fracturedSet.add(id);

    let bp: Vec3 = [0, 1, 0];
    let bq: [number, number, number, number] = [0, 0, 0, 1];
    let bv: Vec3 = [0, 0, 0];
    try {
      const p = built.body.translation();
      const q = built.body.rotation();
      const v = built.body.linvel();
      bp = [p.x, p.y, p.z];
      bq = [q.x, q.y, q.z, q.w];
      bv = [v.x, v.y, v.z];
    } catch { /* ignore */ }

    const col = built.def.collider;
    const he: Vec3 = col
      ? [col.halfExtents[0], col.halfExtents[1], col.halfExtents[2]]
      : [0.5, 0.5, 0.5];
    const specs = planFracture(he, br.mode, br.fragmentCount,
      (this.scene?.seed ?? 1) + this.frame * 7 + id.length, br.fragmentSpread);
    for (const s of specs) {
      const child = structuredClone(built.def) as ForgeObject;
      child.id = `spawn-${this.spawnCounter++}`;
      child.kind = 'fragment';
      child.breakable = null;
      // Rotate chunk offset by parent orientation.
      const off = rotateByQuat(s.offset, { x: bq[0], y: bq[1], z: bq[2], w: bq[3] });
      child.transform.position = [bp[0] + off[0], bp[1] + off[1], bp[2] + off[2]];
      const fs = br.fragmentScale;
      if (s.convex && s.convex.length >= 4) {
        // Exact voronoi shard: centroid-relative points, parent orientation.
        const flat: number[] = [];
        for (const p of s.convex) flat.push(p[0], p[1], p[2]);
        child.geometry = { type: 'convex', params: {}, vertices: flat };
        child.transform.rotation = s.alignToParent
          ? quatToEuler(bq)
          : [...s.rotation];
        child.transform.scale = [fs, fs, fs];
        if (child.collider) {
          child.collider.shape = 'convex';
          child.collider.halfExtents = [
            s.size[0] / 2, s.size[1] / 2, s.size[2] / 2,
          ];
          child.collider.offset = [0, 0, 0];
        }
      } else {
        child.transform.rotation = [...s.rotation];
        child.transform.scale = [s.size[0] * fs, s.size[1] * fs, s.size[2] * fs];
        child.geometry = { type: 'box', params: { width: 1, height: 1, depth: 1 } };
        if (child.collider) {
          child.collider.shape = 'box';
          child.collider.halfExtents = [0.5, 0.5, 0.5];
          child.collider.offset = [0, 0, 0];
        }
      }
      if (child.rigidBody) {
        child.rigidBody.bodyType = 'dynamic';
        child.rigidBody.linvel = [bv[0] + s.velocity[0], bv[1] + s.velocity[1], bv[2] + s.velocity[2]];
      }
      this.buildSpawned(child);
    }

    this.removeBuilt(built);
    this.opts.onEvent({ type: 'fracture', objectId: id, point: bp, intensity: 1 });
    this.opts.onEvent({ type: 'sound', name: 'crash', point: bp, intensity: 0.9 });
  }

  /* ── Spawned-body management ── */

  private buildSpawned(child: ForgeObject): string {
    this.spawnedMeta.set(child.id, {
      id: child.id,
      geometry: structuredClone(child.geometry),
      scale: [...child.transform.scale],
      baseColor: child.visual.baseColor,
      metalness: child.visual.metalness,
      roughness: child.visual.roughness,
      emissive: child.visual.emissive,
      opacity: child.visual.opacity,
    });
    // Spawned bodies are always simulated — force-enable physics fields.
    if (!child.rigidBody) {
      child.rigidBody = {
        bodyType: 'dynamic', enabled: true, massMode: 'auto', mass: 1,
        density: 1000, gravityScale: 1, linearDamping: 0.01, angularDamping: 0.01,
        canSleep: true, sleeping: false, ccd: false, linvel: [0, 0, 0],
        angvel: [0, 0, 0], maxLinvel: 0, maxAngvel: 0,
        lockTranslation: [false, false, false], lockRotation: [false, false, false],
        memberships: 0xffff, filters: 0xffff,
      };
    }
    this.buildObject(child);
    return child.id;
  }

  private spawnFromSpec(spec: SpawnSpec): string {
    const tpl = this.opts.templateProvider(spec.templateId);
    const child: ForgeObject = tpl
      ? structuredClone(tpl)
      : this.fallbackTemplate();
    child.id = `spawn-${this.spawnCounter++}`;
    child.kind = child.kind === 'fragment' ? 'fragment' : 'primitive';
    child.transform.position = [...spec.position];
    child.transform.rotation = [...spec.rotation];
    child.transform.scale = [spec.scale, spec.scale, spec.scale];
    if (spec.color) child.visual = { ...child.visual, baseColor: spec.color };
    if (child.rigidBody) {
      child.rigidBody.bodyType = 'dynamic';
      child.rigidBody.linvel = [...spec.velocity];
      if (spec.mass > 0) {
        child.rigidBody.massMode = 'override';
        child.rigidBody.mass = spec.mass;
      }
    }
    return this.buildSpawned(child);
  }

  private fallbackTemplate(): ForgeObject {
    return {
      id: 'tpl', name: 'Ball', kind: 'primitive', rev: 1, visible: true,
      locked: false, instanceKey: null, prefabId: null,
      geometry: { type: 'sphere', params: { radius: 0.25 } },
      transform: {
        position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1],
      },
      rigidBody: {
        bodyType: 'dynamic', enabled: true, massMode: 'auto', mass: 1,
        density: 1100, gravityScale: 1, linearDamping: 0.01, angularDamping: 0.01,
        canSleep: true, sleeping: false, ccd: false, linvel: [0, 0, 0],
        angvel: [0, 0, 0], maxLinvel: 0, maxAngvel: 0,
        lockTranslation: [false, false, false], lockRotation: [false, false, false],
        memberships: 0xffff, filters: 0xffff,
      },
      collider: {
        shape: 'sphere', enabled: true, sensor: false, offset: [0, 0, 0],
        rotation: [0, 0, 0], halfExtents: [0.25, 0.25, 0.25], radius: 0.25,
        height: 0.5, friction: 1.2, frictionCombine: 'max', restitution: 0.85,
        restitutionCombine: 'max', rollingResistance: 0, sharpness: 0,
      },
      visual: {
        baseColor: '#ff5a5a', metalness: 0, roughness: 0.5, opacity: 1,
        transparent: false, emissive: '#000000', emissiveIntensity: 0,
        textureAssetId: null,
      },
      physical: {
        preset: 'rubber', density: 1100, friction: 1.2, restitution: 0.85,
        elasticity: 0.9, hardness: 0.25, adhesion: 0.05,
      },
      field: null, balloon: null, breakable: null, emitter: null,
      machine: null, pressure: null, fluid: null,
      constantForce: [0, 0, 0], constantTorque: [0, 0, 0], customVars: [],
    };
  }

  private recycleBody(id: string, spec: SpawnSpec): void {
    const built = this.bodies.get(id);
    if (!built) {
      this.spawnFromSpec(spec);
      return;
    }
    try {
      const q = eulerToQuat(spec.rotation);
      built.body.setTranslation(
        { x: spec.position[0], y: spec.position[1], z: spec.position[2] }, true);
      built.body.setRotation({ x: q[0], y: q[1], z: q[2], w: q[3] }, true);
      built.body.setLinvel(
        { x: spec.velocity[0], y: spec.velocity[1], z: spec.velocity[2] }, true);
      built.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    } catch { /* ignore */ }
  }

  private despawnBody(id: string): void {
    const built = this.bodies.get(id);
    if (!built) return;
    this.removeBuilt(built);
    this.spawnedMeta.delete(id);
    this.removedSpawned.push(id);
  }

  /* ── Snapshots / scrubbing ── */

  private captureAux(): AuxState {
    return {
      simTime: this.simTime,
      spawnCounter: this.spawnCounter,
      popped: [...this.poppedSet],
      fractured: [...this.fracturedSet],
      brokenJoints: [...this.brokenJoints],
      fired: this.events.filter((e) => e.fired).map((e) => e.id),
      venting: [],
      emitters: [...this.emitters.entries()].map(([id, st]) => ({
        id,
        acc: st.acc,
        spawned: st.spawned,
        burstDone: st.burstDone,
        rng: st.rng.snapshot(),
        alive: [...st.alive],
        ages: [...st.ages.entries()],
      })),
      spawnedMeta: [...this.spawnedMeta.entries()],
      removedSpawned: [...this.removedSpawned],
      fluid: this.fluid.volumeCount > 0 ? this.fluid.snapshot() : null,
    };
  }

  private restoreAux(aux: AuxState): void {
    if (!this.scene) return;
    this.simTime = aux.simTime;
    // Re-arm the impact-sound throttle: scrub-replay re-emits deterministically.
    this.lastSoundAt = aux.simTime;
    this.spawnCounter = aux.spawnCounter;
    this.poppedSet = new Set(aux.popped);
    this.fracturedSet = new Set(aux.fractured);
    // Post-keyframe spawns no longer exist — prune stale refs and tell the
    // viewport to drop their meshes.
    const spawnedBefore = new Set(this.spawnedMeta.keys());
    this.spawnedMeta = new Map(aux.spawnedMeta);
    for (const id of spawnedBefore) {
      if (!this.spawnedMeta.has(id)) this.removedSpawned.push(id);
    }
    const liveIds = new Set<string>([
      ...this.scene.objects.map((o) => o.id),
      ...this.spawnedMeta.keys(),
    ]);
    for (const id of [...this.bodies.keys()]) {
      if (!liveIds.has(id)) {
        const stale = this.bodies.get(id)!;
        for (const h of stale.colliderHandles) this.colliderToBody.delete(h);
        this.bodies.delete(id);
      }
    }
    // Joints don't survive world disposal — rebuild, then re-apply breaks.
    this.rebuildJoints();
    for (const id of aux.brokenJoints) {
      const j = this.joints.get(id);
      if (j && this.world) {
        try {
          this.world.removeImpulseJoint(j.joint, true);
        } catch { /* ignore */ }
        this.joints.delete(id);
      }
    }
    this.brokenJoints = new Set(aux.brokenJoints);
    const fired = new Set(aux.fired);
    // Rebuild event list from scene (config may have changed) + fired flags.
    this.events = this.scene.events.map((e) => ({ ...e, fired: fired.has(e.id) }));
    this.eventRng = new Rng(`${this.scene.seed}:events`);
    this.balloons.reset();
    for (const id of aux.popped) {
      const def = this.balloons.get(id);
      if (def) this.balloons.pop(id, [0, 0, 0], 0);
    }
    this.emitters.clear();
    for (const e of aux.emitters) {
      const obj = this.scene.objects.find((o) => o.id === e.id);
      if (!obj?.emitter) continue;
      const st = createEmitterState(e.id, obj.emitter, this.scene.seed);
      st.acc = e.acc;
      st.spawned = e.spawned;
      st.burstDone = e.burstDone;
      st.rng.restore(e.rng);
      st.alive = [...e.alive];
      st.ages = new Map(e.ages);
      this.emitters.set(e.id, st);
    }
    this.removedSpawned = [...aux.removedSpawned];
    // Fluid particles rewind with everything else. A null snapshot with live
    // volumes (degenerate reset path) falls back to the seeded frame-0 state.
    if (aux.fluid) this.fluid.restore(aux.fluid);
    else if (this.fluid.volumeCount > 0) this.reseedFluid();
    this.activeContacts.clear();
    this.frameCollisions = [];
  }

  private snapshotFrame(frame: number): void {
    if (!this.world) return;
    try {
      const bytes = this.world.takeSnapshot();
      this.cache.set(frame, bytes);
      this.auxByFrame.set(frame, this.captureAux());
      // Bound aux memory alongside cache eviction policy.
      if (this.auxByFrame.size > 130) {
        const keys = [...this.auxByFrame.keys()].sort((a, b) => a - b);
        for (const k of keys) {
          if (k !== 0) {
            this.auxByFrame.delete(k);
            break;
          }
        }
      }
    } catch {
      /* snapshot unsupported — scrubbing falls back to reset+replay */
    }
  }

  /** Restore world state to an exact frame (deterministic scrub / render). */
  gotoFrame(target: number): void {
    if (!this.world || !this.scene) return;
    target = Math.max(0, Math.round(target));
    if (target === this.frame) return;

    // Validate cache against current scene hash.
    const hash = scenePhysicsHash(this.scene);
    if (hash !== this.physicsHash) {
      this.physicsHash = hash;
      this.cache.invalidate();
      this.auxByFrame.clear();
    }

    if (target < this.frame || !this.cache.get(this.frame)) {
      // Need to rewind: nearest keyframe at/before target, else full rebuild.
      const key = this.cache.nearestAtOrBefore(target);
      if (key !== null) {
        const bytes = this.cache.get(key);
        const aux = this.auxByFrame.get(key);
        if (bytes && aux) {
          this.restoreWorld(bytes, aux, key);
        } else {
          this.rebuildFromScene();
        }
      } else {
        this.rebuildFromScene();
      }
    }
    // Step forward to target.
    let guard = 0;
    while (this.frame < target && guard++ < 100000) {
      this.stepOneFrame();
    }
  }

  private restoreWorld(bytes: Uint8Array, aux: AuxState, frame: number): void {
    if (!this.scene) return;
    const w = this.scene.world;
    this.disposeWorld();
    try {
      this.world = RAPIER.World.restoreSnapshot(bytes);
    } catch {
      this.rebuildFromScene();
      return;
    }
    this.world.timestep = 1 / Math.max(1, w.simFps);
    this.queue = new RAPIER.EventQueue(true);
    this.refreshRefs();
    this.restoreAux(aux);
    this.frame = frame;
  }

  /** Re-fetch JS wrappers after snapshot restore (handles persist). */
  private refreshRefs(): void {
    if (!this.world) return;
    for (const built of this.bodies.values()) {
      try {
        built.body = this.world.getRigidBody(built.bodyHandle);
        built.colliders = built.colliderHandles.map((h) =>
          this.world!.getCollider(h),
        );
      } catch { /* body genuinely gone — leave stale, rebuilt on sync */ }
    }
  }

  private rebuildFromScene(): void {
    if (!this.scene) return;
    const scene = this.scene;
    const frameBefore = this.frame;
    void frameBefore;
    this.disposeWorld();
    const w = scene.world;
    this.world = new RAPIER.World({ x: w.gravity[0], y: w.gravity[1], z: w.gravity[2] });
    this.world.timestep = 1 / Math.max(1, w.simFps);
    try {
      this.world.integrationParameters.numSolverIterations = Math.max(1, Math.min(32, w.solverIterations));
    } catch { /* ignore */ }
    this.queue = new RAPIER.EventQueue(true);
    this.bodies.clear();
    this.colliderToBody.clear();
    this.pressure.clear();
    this.balloons.clear();
    this.emitters.clear();
    this.activeContacts.clear();
    this.spawnedMeta.clear();
    this.removedSpawned = [];
    this.poppedSet.clear();
    this.fracturedSet.clear();
    this.joints.clear();
    this.brokenJoints.clear();
    this.frame = 0;
    this.simTime = 0;
    this.lastSoundAt = -1;
    this.spawnCounter = 0;
    this.events = scene.events.map((e) => ({ ...e, fired: false }));
    this.eventRng = new Rng(`${scene.seed}:events`);
    for (const obj of scene.objects) this.buildObject(obj);
    for (const obj of scene.objects) {
      if (obj.kind === 'emitter' && obj.emitter) {
        this.emitters.set(obj.id, createEmitterState(obj.id, obj.emitter, scene.seed));
      }
    }
    this.cache.validate(this.physicsHash);
    this.rebuildJoints();
    this.reseedFluid();
    this.snapshotFrame(0);
  }

  /* ── Fluid (SPH-lite water) ── */

  /**
   * Rebuild fluid volume seeds from the scene and reseed the deterministic
   * particle lattice. Called on load/reset and whenever the fluid signature
   * changes (transform or param edit). Callers clear aux snapshots first.
   */
  private reseedFluid(): void {
    if (!this.scene) return;
    const defs: FluidVolumeSeed[] = [];
    const objs = [...this.scene.objects].sort((a, b) =>
      a.id < b.id ? -1 : 1,
    );
    for (const o of objs) {
      if (o.kind !== 'fluid' || !o.fluid || !o.fluid.enabled) continue;
      const s = o.transform.scale;
      defs.push({
        id: o.id,
        center: [...o.transform.position] as Vec3,
        quat: eulerToQuat(o.transform.rotation),
        half: [
          Math.abs(s[0]) / 2,
          Math.abs(s[1]) / 2,
          Math.abs(s[2]) / 2,
        ],
        spacing: o.fluid.spacing,
        viscosity: o.fluid.viscosity,
        stiffness: o.fluid.stiffness,
        density: o.fluid.density,
        color: hexToRgbFluid(o.fluid.color),
        fill: o.fluid.fill,
        maxParticles: o.fluid.maxParticles,
        openTop: o.fluid.openTop,
      });
    }
    const dtSub = 1 / Math.max(1, this.scene.world.renderFps) / FLUID_SUBSTEPS;
    this.fluid.seedVolumes(this.scene.seed, defs, dtSub);
    this.fluidSig = fluidSigOf(this.scene);
  }

  /**
   * Advance the fluid one frame with analytic colliders gathered from live
   * bodies. Runs BEFORE the Rapier substeps; buoyancy samples the result.
   * Body motion reaches the fluid with one frame of lag (staggered coupling).
   */
  private stepFluid(dtFrame: number): void {
    if (!this.scene) return;
    if (this.fluid.count === 0 || this.fluid.volumeCount === 0) return;
    this.fluid.step(
      dtFrame,
      this.scene.world.gravity,
      this.gatherFluidColliders(),
    );
  }

  /**
   * Analytic box/sphere colliders for the fluid, broadphased against the
   * volume bounds. Non-box/sphere colliders contribute their bounding sphere
   * (documented v1 approximation). Sensors are ignored (no physical body).
   */
  private gatherFluidColliders(): FluidCollider[] {
    const out: FluidCollider[] = [];
    if (this.fluid.count === 0) return out;
    const bounds = this.fluid.volumeBounds();
    if (bounds.length === 0) return out;
    for (const built of this.bodies.values()) {
      const col = built.def.collider;
      if (!col || !col.enabled || col.sensor) continue;
      let t: { x: number; y: number; z: number };
      let q: { x: number; y: number; z: number; w: number };
      let lv = { x: 0, y: 0, z: 0 };
      try {
        t = built.body.translation();
        q = built.body.rotation();
        if (built.isDynamic) lv = built.body.linvel();
      } catch {
        continue;
      }
      const scale = built.def.transform.scale;
      const { radius } = bodyVolumeAndRadius(col, scale);
      if (!nearFluid(bounds, t, radius)) continue;
      const off = rotateByQuat(col.offset, q);
      const center: Vec3 = [t.x + off[0], t.y + off[1], t.z + off[2]];
      // World orientation = body quat ⊗ collider-local rotation (mirrors
      // makeColliderDesc's setTranslation/setRotation composition).
      const quat = mulQuat(
        [q.x, q.y, q.z, q.w],
        eulerToQuat(col.rotation ?? [0, 0, 0]),
      );
      const velocity: Vec3 = [lv.x, lv.y, lv.z];
      if (col.shape === 'box') {
        out.push({
          kind: 'box',
          center,
          quat,
          halfExtents: [
            Math.abs(col.halfExtents[0] * scale[0]),
            Math.abs(col.halfExtents[1] * scale[1]),
            Math.abs(col.halfExtents[2] * scale[2]),
          ],
          radius: 0,
          velocity,
          friction: col.friction,
        });
      } else if (col.shape === 'sphere') {
        const m = Math.max(
          Math.abs(scale[0]),
          Math.abs(scale[1]),
          Math.abs(scale[2]),
        );
        out.push({
          kind: 'sphere',
          center,
          quat,
          halfExtents: [0, 0, 0],
          radius: col.radius * m,
          velocity,
          friction: col.friction,
        });
      } else {
        // Capsule/cylinder/cone/convex/trimesh → bounding sphere.
        out.push({
          kind: 'sphere',
          center,
          quat,
          halfExtents: [0, 0, 0],
          radius,
          velocity,
          friction: col.friction,
        });
      }
    }
    return out;
  }

  /**
   * Buoyancy + drag on dynamic bodies, applied every Rapier substep from the
   * current particle distribution: F_buoy = −g·ρ·V·frac, plus quadratic and
   * linear drag in the body-relative flow. Force acts at the center of mass
   * (no righting torque in v1).
   */
  private applyBuoyancy(): void {
    if (!this.world || !this.scene) return;
    if (this.fluid.count === 0) return;
    const bounds = this.fluid.volumeBounds();
    if (bounds.length === 0) return;
    const g = this.scene.world.gravity;
    for (const built of this.bodies.values()) {
      if (!built.isDynamic) continue;
      const col = built.def.collider;
      if (!col || !col.enabled || col.sensor) continue;
      const { volume, radius, sample } = bodyVolumeAndRadius(
        col,
        built.def.transform.scale,
      );
      let t: { x: number; y: number; z: number };
      let lv: { x: number; y: number; z: number };
      try {
        t = built.body.translation();
        lv = built.body.linvel();
      } catch {
        continue;
      }
      if (!nearFluid(bounds, t, radius)) continue;
      const s = this.fluid.sampleSubmersion([t.x, t.y, t.z], sample);
      if (s.count === 0) continue;
      // Void-corrected fraction: the sample shell holds water minus the
      // body-sized void the push-out cleared (see bodyVolumeAndRadius). The
      // 0.9 compensates the push-out margin + depletion layer, which make
      // the true void slightly larger than the body volume.
      const shellVol = Math.max(
        1e-6,
        ((4 / 3) * Math.PI * sample * sample * sample - volume) * 0.9,
      );
      const frac = Math.min(1, (s.count * s.pVol) / shellVol);
      if (frac <= 0.001) continue;
      const rhoV = s.density * volume * frac;
      let fx = -g[0] * rhoV;
      let fy = -g[1] * rhoV;
      let fz = -g[2] * rhoV;
      const rvx = lv.x - s.vel[0];
      const rvy = lv.y - s.vel[1];
      const rvz = lv.z - s.vel[2];
      const spd = Math.sqrt(rvx * rvx + rvy * rvy + rvz * rvz);
      if (spd > 1e-6) {
        const area = Math.pow(volume, 2 / 3);
        const k =
          0.5 * 1.0 * area * s.density * frac * spd + 0.8 * rhoV;
        fx -= k * rvx;
        fy -= k * rvy;
        fz -= k * rvz;
      }
      try {
        built.body.addForce({ x: fx, y: fy, z: fz }, true);
      } catch {
        /* ignore */
      }
    }
  }

  /** Live particle views for the renderer (valid until the next step). */
  fluidRenderState(): {
    positions: Float32Array;
    colors: Float32Array;
    count: number;
    supports: Float32Array;
  } {
    return {
      positions: this.fluid.positions(),
      colors: this.fluid.colors(),
      count: this.fluid.count,
      supports: this.fluid.supportView(),
    };
  }

  /* ── Readouts ── */

  transforms(): BodyTransform[] {
    const out: BodyTransform[] = [];
    for (const built of this.bodies.values()) {
      try {
        const p = built.body.translation();
        const q = built.body.rotation();
        const v = built.body.linvel();
        out.push({
          id: built.id,
          p: [p.x, p.y, p.z],
          q: [q.x, q.y, q.z, q.w],
          v: [v.x, v.y, v.z],
          sleeping: built.body.isSleeping(),
          dynamic: built.isDynamic,
        });
      } catch { /* skip stale */ }
    }
    return out;
  }

  spawnedDescriptors(): SpawnedDescriptor[] {
    return [...this.spawnedMeta.values()];
  }

  drainRemovedSpawned(): string[] {
    const r = this.removedSpawned;
    this.removedSpawned = [];
    return r;
  }

  contacts(): Vec3[] {
    return this.contactsDebug;
  }

  poppedIds(): Set<string> {
    return this.poppedSet;
  }

  fracturedIds(): Set<string> {
    return this.fracturedSet;
  }

  stats(): PhysicsStats {
    return {
      bodies: this.bodies.size,
      colliders: this.colliderToBody.size,
      contacts: this.activeContacts.size,
      joints: this.joints.size,
      brokenJoints: this.brokenJoints.size,
      stepMs: this.stepMs,
      fluid: this.fluid.count,
    };
  }
}
