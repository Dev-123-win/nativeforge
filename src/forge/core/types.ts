/**
 * Forge scene schema — versioned, self-contained, portable.
 *
 * Every creation exists as a ForgeScene. A scene carries everything needed to
 * restore, simulate and render it: objects, physics, materials, generators,
 * events, cameras, lights, audio hooks, render + simulation settings, seed.
 *
 * Schema evolution: bump FORGE_SCHEMA_VERSION and add a migration in
 * `migrateScene()`. Never silently reinterpret old fields.
 */

export const FORGE_SCHEMA_VERSION = 1 as const;

/* ─── Primitives ─────────────────────────────────────────────────────────── */

export type Vec3 = [number, number, number];
export type Vec2 = [number, number];

export type BodyType = 'static' | 'dynamic' | 'kinematic' | 'sensor';
export type ColliderShape =
  | 'sphere'
  | 'box'
  | 'capsule'
  | 'cylinder'
  | 'cone'
  | 'convex'
  | 'trimesh';
export type CombineRule = 'average' | 'min' | 'max' | 'multiply';
export type ObjectKind =
  | 'primitive'
  | 'balloon'
  | 'field'
  | 'emitter'
  | 'machine'
  | 'container'
  | 'light'
  | 'camera'
  | 'fragment';
export type GeometryType =
  | 'sphere'
  | 'box'
  | 'capsule'
  | 'cylinder'
  | 'cone'
  | 'torus'
  | 'plane'
  | 'circle'
  | 'ring';

export type FieldKind =
  | 'attractor'
  | 'repulsor'
  | 'vortex'
  | 'wind'
  | 'wave'
  | 'turbulence'
  | 'directional';
export type EmitterShape =
  | 'point'
  | 'line'
  | 'circle'
  | 'rectangle'
  | 'sphere'
  | 'box'
  | 'cone';
export type MachineKind =
  | 'press'
  | 'piston'
  | 'hammer'
  | 'conveyor'
  | 'spinner'
  | 'gate'
  | 'platform'
  | 'wheel';
export type FractureMode = 'grid' | 'radial' | 'random' | 'voronoi-lite';
export type UiLevel = 'basic' | 'advanced' | 'expert';
export type ConstraintType =
  | 'fixed'
  | 'distance'
  | 'hinge'
  | 'slider'
  | 'spring'
  | 'ball'
  | 'rope';

/* ─── Transform / rigid body / collider ──────────────────────────────────── */

export interface TransformData {
  position: Vec3;
  rotation: Vec3; // euler radians XYZ
  scale: Vec3;
}

export interface RigidBodyData {
  bodyType: BodyType;
  enabled: boolean;
  /** 'auto' derives mass from density × collider volume; 'override' uses mass. */
  massMode: 'auto' | 'override';
  mass: number; // kg
  density: number; // kg/m³
  gravityScale: number;
  linearDamping: number;
  angularDamping: number;
  canSleep: boolean;
  sleeping: boolean;
  ccd: boolean;
  linvel: Vec3; // m/s initial
  angvel: Vec3; // rad/s initial
  maxLinvel: number; // 0 = unlimited
  maxAngvel: number;
  lockTranslation: [boolean, boolean, boolean];
  lockRotation: [boolean, boolean, boolean];
  /** Rapier collision groups (membership) / filter (interacts-with) as bitfields. */
  memberships: number;
  filters: number;
}

export interface ColliderData {
  shape: ColliderShape;
  enabled: boolean;
  sensor: boolean;
  offset: Vec3;
  rotation: Vec3; // euler radians XYZ applied to the collider
  /** Half-extents for box, [radius, halfHeight] for cylinder/cone/capsule, [radius] sphere. */
  halfExtents: Vec3;
  radius: number;
  height: number;
  friction: number;
  frictionCombine: CombineRule;
  restitution: number;
  restitutionCombine: CombineRule;
  /** Rolling-resistance style extra angular damping applied on contact (custom). */
  rollingResistance: number;
  /** Sharpness 0..1 — cone tips etc. used by puncture detection. */
  sharpness: number;
}

/* ─── Visual + physical materials ────────────────────────────────────────── */

export interface VisualMaterialData {
  baseColor: string; // hex
  metalness: number;
  roughness: number;
  opacity: number;
  transparent: boolean;
  emissive: string;
  emissiveIntensity: number;
  /** Optional shared texture asset id. */
  textureAssetId: string | null;
}

export interface PhysicalMaterialData {
  preset: string; // key into PHYSICAL_PRESETS, or 'custom'
  density: number;
  friction: number;
  restitution: number;
  elasticity: number; // 0..1 drives squash-and-recover visuals + restitution assist
  hardness: number; // 0..1 used by fracture thresholds
  adhesion: number; // 0..1 sticky contact damping
}

/* ─── Subsystems ─────────────────────────────────────────────────────────── */

export interface ForceFieldData {
  kind: FieldKind;
  enabled: boolean;
  strength: number;
  radius: number;
  falloff: number; // exponent
  direction: Vec3;
  frequency: number; // wave/turbulence
  turbulence: number;
}

export interface BalloonData {
  pressure: number; // Pa internal
  maxPressure: number;
  popped: boolean;
  /** 0 = intact, 1 = fully deflated. Advanced by runtime after pop. */
  deflation: number;
  skinThickness: number;
  fragmentCount: number;
}

export interface BreakableData {
  enabled: boolean;
  fractured: boolean;
  mode: FractureMode;
  fragmentCount: number;
  /** Contact impulse threshold that triggers fracture. */
  breakImpulse: number;
  fragmentSpread: number;
  fragmentScale: number;
}

export interface EmitterData {
  shape: EmitterShape;
  enabled: boolean;
  /** Object template preset id to spawn. */
  templateId: string;
  count: number; // total (0 = infinite within window)
  rate: number; // objects per second
  burst: number; // extra spawn on t=0 of window
  startTime: number;
  endTime: number;
  lifetime: number; // 0 = forever
  maxAlive: number;
  initialVelocity: Vec3;
  spread: number; // 0..1 direction cone
  speedRandom: number; // 0..1
  scaleMin: number;
  scaleMax: number;
  seed: number;
}

export interface MachineData {
  kind: MachineKind;
  enabled: boolean;
  force: number;
  speed: number;
  stroke: number;
  cycleTime: number;
  direction: Vec3;
  startTime: number;
  stopTime: number; // 0 = run forever
  phase: number;
}

export interface PressureData {
  /** Internal pressure Pa (containers, balloons back this too). */
  internal: number;
  volume: number; // m³
  leak: number; // Pa/s escaping
  releaseThreshold: number; // Pa — above this, venting applies forces
  ventDirection: Vec3;
}

export interface CustomVar {
  name: string;
  value: number;
  min: number;
  max: number;
  unit: string;
}

export interface GeometryData {
  type: GeometryType;
  /** Shape params: radius, width/height/depth, segments... by type. */
  params: Record<string, number>;
}

/* ─── Objects ────────────────────────────────────────────────────────────── */

export interface ForgeObject {
  id: string;
  name: string;
  kind: ObjectKind;
  /** Incremented on every edit; runtimes rebuild when stale. */
  rev: number;
  visible: boolean;
  locked: boolean;
  /** Shared instancing key (auto-set for generator batches). */
  instanceKey: string | null;
  prefabId: string | null;
  geometry: GeometryData;
  transform: TransformData;
  rigidBody: RigidBodyData | null; // null = non-physical (light, camera rig...)
  collider: ColliderData | null;
  visual: VisualMaterialData;
  physical: PhysicalMaterialData;
  field: ForceFieldData | null;
  balloon: BalloonData | null;
  breakable: BreakableData | null;
  emitter: EmitterData | null;
  machine: MachineData | null;
  pressure: PressureData | null;
  /** Continuous force applied every step (N, world space) + torque (N·m). */
  constantForce: Vec3;
  constantTorque: Vec3;
  customVars: CustomVar[];
}

/* ─── World / cameras / lights / events ──────────────────────────────────── */

export interface WorldSettings {
  gravity: Vec3;
  gravityPreset: 'earth' | 'moon' | 'mars' | 'zero' | 'custom';
  units: 'm' | 'cm' | 'mm';
  simFps: number;
  renderFps: number;
  substeps: number;
  solverIterations: number;
  timeScale: number;
  deterministic: boolean;
  airDensity: number;
  wind: Vec3;
  turbulence: number;
  vacuum: boolean;
  maxTimestep: number;
}

export interface CameraData {
  id: string;
  name: string;
  kind: 'perspective' | 'orthographic';
  position: Vec3;
  target: Vec3;
  fov: number;
  near: number;
  far: number;
  followObjectId: string | null;
  shake: number;
}

export interface LightData {
  id: string;
  name: string;
  kind: 'directional' | 'point' | 'spot' | 'ambient' | 'hemisphere';
  color: string;
  intensity: number;
  position: Vec3;
  target: Vec3;
  castShadow: boolean;
  shadowSize: number;
}

export type TriggerType =
  | 'time'
  | 'collision'
  | 'impact'
  | 'velocity'
  | 'height'
  | 'pressure'
  | 'distance'
  | 'random';
export type ActionType =
  | 'spawn'
  | 'delete'
  | 'impulse'
  | 'force'
  | 'setPressure'
  | 'break'
  | 'pop'
  | 'setGravity'
  | 'setCamera'
  | 'sound'
  | 'particles'
  | 'toggle'
  | 'motor';

export interface ForgeEvent {
  id: string;
  name: string;
  enabled: boolean;
  fired: boolean; // runtime state (reset on rewind)
  trigger: {
    type: TriggerType;
    objectA: string | null;
    objectB: string | null;
    time: number;
    threshold: number;
    probability: number;
  };
  action: {
    type: ActionType;
    targetId: string | null;
    vector: Vec3;
    scalar: number;
    presetId: string | null;
  };
}

export interface GeneratorRecord {
  id: string;
  type: 'grid' | 'circle' | 'spiral' | 'tower' | 'pile' | 'rope' | 'chain';
  name: string;
  seed: number;
  params: Record<string, number | string>;
  templateId: string;
  generatedIds: string[];
  /** Joints created alongside the objects (ropes/chains). */
  generatedJoints: string[];
}

export interface ForgeConstraint {
  id: string;
  name: string;
  rev: number;
  enabled: boolean;
  type: ConstraintType;
  /** Object ids of the two linked bodies. */
  bodyA: string;
  bodyB: string;
  /** Anchor points in each body's LOCAL space. */
  anchorA: Vec3;
  anchorB: Vec3;
  /** Hinge/slider axis in bodyA local space. */
  axis: Vec3;
  restLength: number;
  stiffness: number;
  damping: number;
  limitsEnabled: boolean;
  minLimit: number;
  maxLimit: number;
  motorEnabled: boolean;
  motorMode: 'velocity' | 'position';
  motorSpeed: number;
  motorForce: number;
  motorTarget: number;
  /** 0 = unbreakable; otherwise stress threshold in N (v1 proxy). */
  breakForce: number;
}

export interface AssetRef {
  assetId: string;
  role: string;
}

export interface RenderSettings {
  preset: 'shorts' | 'reels' | 'tiktok' | 'landscape' | 'square' | 'custom';
  width: number;
  height: number;
  fps: number;
  durationFrames: number;
  recordStart: number;
  recordEnd: number;
  bitrate: string;
  codec: 'h264' | 'hevc' | 'vp9';
  quality: 'draft' | 'medium' | 'high' | 'ultra';
  motionBlur: boolean;
  transparent: boolean;
}

/* ─── Scene / assets ─────────────────────────────────────────────────────── */

export type EasingName =
  | 'hold'
  | 'linear'
  | 'smooth'
  | 'ease-in'
  | 'ease-out'
  | 'ease-in-out';

export const EASING_NAMES: EasingName[] = [
  'hold', 'linear', 'smooth', 'ease-in', 'ease-out', 'ease-in-out',
];

/** Scalar keyframe. `easing` shapes the segment STARTING at this key. */
export interface NumKey {
  frame: number;
  value: number;
  easing: EasingName;
}

/** Vec3 keyframe. `easing` shapes the segment STARTING at this key. */
export interface Vec3Key {
  frame: number;
  value: Vec3;
  easing: EasingName;
}

/**
 * Camera move: keyframed position / look-target / fov for one camera.
 * Render-side only (never touches the physics hash) but still a pure
 * function of frame, so scrub and export stay deterministic.
 */
export interface CameraTrack {
  id: string;
  name: string;
  cameraId: string;
  enabled: boolean;
  position: Vec3Key[];
  target: Vec3Key[];
  fov: NumKey[];
}

/**
 * Motor choreography: per-frame target (position mode) or speed
 * (velocity mode) for one hinge/slider joint. Applies only while the
 * joint's own motor is enabled. Included in the physics hash.
 */
export interface MotorTrack {
  id: string;
  name: string;
  jointId: string;
  enabled: boolean;
  keys: NumKey[];
}

/**
 * Kinematic driver: keyframed position / rotation (euler XYZ radians)
 * for one object. Applies only while the object is a kinematic body —
 * dynamic bodies ignore their driver tracks. Included in the physics
 * hash: moving platforms physically push dynamic bodies.
 */
export interface DriverTrack {
  id: string;
  name: string;
  objectId: string;
  enabled: boolean;
  position: Vec3Key[];
  rotation: Vec3Key[];
}

export interface ForgeScene {
  sceneId: string;
  schemaVersion: number;
  name: string;
  createdAt: number;
  updatedAt: number;
  seed: number;
  world: WorldSettings;
  objects: ForgeObject[];
  cameras: CameraData[];
  lights: LightData[];
  events: ForgeEvent[];
  generators: GeneratorRecord[];
  constraints: ForgeConstraint[];
  cameraTracks: CameraTrack[];
  motorTracks: MotorTrack[];
  driverTracks: DriverTrack[];
  assets: AssetRef[];
  render: RenderSettings;
  activeCameraId: string;
  thumbnail: string | null; // dataURL (small jpeg)
}

export type AssetType =
  | 'texture'
  | 'material'
  | 'prefab'
  | 'sound'
  | 'mesh'
  | 'environment';

export interface AssetRecord {
  id: string;
  name: string;
  type: AssetType;
  /** JSON-serialisable payload (never binary blobs at v1). */
  data: Record<string, unknown>;
  refCount: number;
  protected: boolean;
  createdAt: number;
  updatedAt: number;
  thumbnail: string | null;
}

export interface SceneSummary {
  sceneId: string;
  name: string;
  updatedAt: number;
  objectCount: number;
  durationFrames: number;
  width: number;
  height: number;
  renderStatus: 'never' | 'rendering' | 'done' | 'failed';
  thumbnail: string | null;
}

/* ─── Factories ──────────────────────────────────────────────────────────── */

export function uid(prefix = 'obj'): string {
  const r =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().slice(0, 8)
      : Math.floor(Math.random() * 0xffffffff).toString(16);
  return `${prefix}-${r}`;
}

export function defaultTransform(): TransformData {
  return {
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
  };
}

export function defaultRigidBody(
  overrides: Partial<RigidBodyData> = {},
): RigidBodyData {
  return {
    bodyType: 'dynamic',
    enabled: true,
    massMode: 'auto',
    mass: 1,
    density: 1000,
    gravityScale: 1,
    linearDamping: 0.01,
    angularDamping: 0.01,
    canSleep: true,
    sleeping: false,
    ccd: false,
    linvel: [0, 0, 0],
    angvel: [0, 0, 0],
    maxLinvel: 0,
    maxAngvel: 0,
    lockTranslation: [false, false, false],
    lockRotation: [false, false, false],
    memberships: 0xffff,
    filters: 0xffff,
    ...overrides,
  };
}

export function defaultCollider(
  overrides: Partial<ColliderData> = {},
): ColliderData {
  return {
    shape: 'box',
    enabled: true,
    sensor: false,
    offset: [0, 0, 0],
    rotation: [0, 0, 0],
    halfExtents: [0.5, 0.5, 0.5],
    radius: 0.5,
    height: 1,
    friction: 0.7,
    frictionCombine: 'average',
    restitution: 0.2,
    restitutionCombine: 'average',
    rollingResistance: 0,
    sharpness: 0,
    ...overrides,
  };
}

export function defaultVisual(
  overrides: Partial<VisualMaterialData> = {},
): VisualMaterialData {
  return {
    baseColor: '#4f8ff7',
    metalness: 0.1,
    roughness: 0.55,
    opacity: 1,
    transparent: false,
    emissive: '#000000',
    emissiveIntensity: 0,
    textureAssetId: null,
    ...overrides,
  };
}

export function defaultPhysical(
  overrides: Partial<PhysicalMaterialData> = {},
): PhysicalMaterialData {
  return {
    preset: 'plastic',
    density: 1000,
    friction: 0.7,
    restitution: 0.2,
    elasticity: 0.2,
    hardness: 0.5,
    adhesion: 0,
    ...overrides,
  };
}

export function defaultWorld(
  overrides: Partial<WorldSettings> = {},
): WorldSettings {
  return {
    gravity: [0, -9.81, 0],
    gravityPreset: 'earth',
    units: 'm',
    simFps: 60,
    renderFps: 60,
    substeps: 1,
    solverIterations: 4,
    timeScale: 1,
    deterministic: true,
    airDensity: 1.225,
    wind: [0, 0, 0],
    turbulence: 0,
    vacuum: false,
    maxTimestep: 1 / 30,
    ...overrides,
  };
}

export function defaultRender(
  overrides: Partial<RenderSettings> = {},
): RenderSettings {
  return {
    preset: 'shorts',
    width: 1080,
    height: 1920,
    fps: 60,
    durationFrames: 600,
    recordStart: 0,
    recordEnd: 600,
    bitrate: '12M',
    codec: 'h264',
    quality: 'high',
    motionBlur: false,
    transparent: false,
    ...overrides,
  };
}

export function makeObject(
  name: string,
  kind: ObjectKind,
  overrides: Partial<ForgeObject> = {},
): ForgeObject {
  return {
    id: uid('obj'),
    name,
    kind,
    rev: 1,
    visible: true,
    locked: false,
    instanceKey: null,
    prefabId: null,
    geometry: { type: 'box', params: { width: 1, height: 1, depth: 1 } },
    transform: defaultTransform(),
    rigidBody: kind === 'light' || kind === 'camera' ? null : defaultRigidBody(),
    collider:
      kind === 'light' || kind === 'camera' ? null : defaultCollider(),
    visual: defaultVisual(),
    physical: defaultPhysical(),
    field: null,
    balloon: null,
    breakable: null,
    emitter: null,
    machine: null,
    pressure: null,
    constantForce: [0, 0, 0],
    constantTorque: [0, 0, 0],
    customVars: [],
    ...overrides,
  };
}

export function makeConstraint(
  name: string,
  type: ConstraintType,
  bodyA: string,
  bodyB: string,
): ForgeConstraint {
  return {
    id: uid('joint'),
    name,
    rev: 1,
    enabled: true,
    type,
    bodyA,
    bodyB,
    anchorA: [0, 0, 0],
    anchorB: [0, 0, 0],
    axis: [0, 0, 1],
    restLength: 1,
    stiffness: 1000,
    damping: 10,
    limitsEnabled: false,
    minLimit: -1,
    maxLimit: 1,
    motorEnabled: false,
    motorMode: 'velocity',
    motorSpeed: 2,
    motorForce: 100,
    motorTarget: 0,
    breakForce: 0,
  };
}

export function makeCameraTrack(name: string, cameraId: string): CameraTrack {
  return {
    id: uid('camtrack'),
    name,
    cameraId,
    enabled: true,
    position: [],
    target: [],
    fov: [],
  };
}

export function makeMotorTrack(name: string, jointId: string): MotorTrack {
  return {
    id: uid('motortrack'),
    name,
    jointId,
    enabled: true,
    keys: [],
  };
}

export function makeDriverTrack(name: string, objectId: string): DriverTrack {
  return {
    id: uid('drivetrack'),
    name,
    objectId,
    enabled: true,
    position: [],
    rotation: [],
  };
}

export function makeScene(name: string): ForgeScene {
  const now = Date.now();
  const cam: CameraData = {
    id: uid('cam'),
    name: 'Main Camera',
    kind: 'perspective',
    position: [6, 5, 9],
    target: [0, 1, 0],
    fov: 50,
    near: 0.1,
    far: 200,
    followObjectId: null,
    shake: 0,
  };
  return {
    sceneId: uid('scene'),
    schemaVersion: FORGE_SCHEMA_VERSION,
    name,
    createdAt: now,
    updatedAt: now,
    seed: Math.floor(Math.random() * 1e9),
    world: defaultWorld(),
    objects: [],
    cameras: [cam],
    lights: [
      {
        id: uid('light'),
        name: 'Sun',
        kind: 'directional',
        color: '#ffffff',
        intensity: 2.2,
        position: [6, 10, 4],
        target: [0, 0, 0],
        castShadow: true,
        shadowSize: 2048,
      },
      {
        id: uid('light'),
        name: 'Fill',
        kind: 'hemisphere',
        color: '#bcd2ff',
        intensity: 0.7,
        position: [0, 8, 0],
        target: [0, 0, 0],
        castShadow: false,
        shadowSize: 1024,
      },
    ],
    events: [],
    generators: [],
    constraints: [],
    cameraTracks: [],
    motorTracks: [],
    driverTracks: [],
    assets: [],
    render: defaultRender(),
    activeCameraId: cam.id,
    thumbnail: null,
  };
}

/* ─── Migration ──────────────────────────────────────────────────────────── */

export function migrateScene(raw: unknown): ForgeScene {
  const scene = raw as ForgeScene;
  if (!scene || typeof scene !== 'object') {
    throw new Error('Scene payload is not an object.');
  }
  if (scene.schemaVersion == null) {
    // Pre-versioned payloads are rejected rather than guessed.
    throw new Error('Scene is missing schemaVersion — refusing to guess.');
  }
  if (scene.schemaVersion > FORGE_SCHEMA_VERSION) {
    throw new Error(
      `Scene schema v${scene.schemaVersion} is newer than this build (v${FORGE_SCHEMA_VERSION}).`,
    );
  }
  // Fill optional arrays so older saves / hand-written files load safely.
  const withDefaults = scene as unknown as Record<string, unknown>;
  for (const key of [
    'objects', 'cameras', 'lights', 'events', 'generators',
    'constraints', 'cameraTracks', 'motorTracks', 'driverTracks', 'assets',
  ]) {
    if (!Array.isArray(withDefaults[key])) withDefaults[key] = [];
  }
  for (const g of scene.generators as unknown as Array<Record<string, unknown>>) {
    if (!Array.isArray(g['generatedJoints'])) g['generatedJoints'] = [];
  }
  for (const t of scene.cameraTracks as unknown as Array<Record<string, unknown>>) {
    if (typeof t['enabled'] !== 'boolean') t['enabled'] = true;
    for (const k of ['position', 'target', 'fov']) {
      if (!Array.isArray(t[k])) t[k] = [];
    }
  }
  for (const t of scene.motorTracks as unknown as Array<Record<string, unknown>>) {
    if (typeof t['enabled'] !== 'boolean') t['enabled'] = true;
    if (!Array.isArray(t['keys'])) t['keys'] = [];
  }
  for (const t of scene.driverTracks as unknown as Array<Record<string, unknown>>) {
    if (typeof t['enabled'] !== 'boolean') t['enabled'] = true;
    for (const k of ['position', 'rotation']) {
      if (!Array.isArray(t[k])) t[k] = [];
    }
  }
  // v1 is current; future migrations chain here.
  return scene;
}
