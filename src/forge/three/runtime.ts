/**
 * ThreeRuntime — Three.js viewport renderer for Forge scenes.
 *
 * Responsibilities: meshes, instanced batches, lights, cameras, selection,
 * transform gizmos, debug visualization, particle bursts, frame capture.
 * It NEVER owns physics state — transforms are pushed in every frame.
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { ConvexGeometry } from 'three/examples/jsm/geometries/ConvexGeometry.js';
import type {
  ForgeObject,
  ForgeScene,
  GeometryData,
  Vec3,
} from '../core/types';
import type { BodyTransform, SpawnedDescriptor } from '../physics/runtime';
import { FLUID_MAX_PARTICLES } from '../physics/fluid';
import type { DebugFlags } from '../core/store';
import type { CameraPose } from '../render/director';

export interface ViewportCallbacks {
  onSelect: (ids: string[]) => void;
  onTransformEdit: (
    id: string,
    patch: { position?: Vec3; rotation?: Vec3; scale?: Vec3 },
  ) => void;
  onStats: (s: ViewportStats) => void;
}

export interface ViewportStats {
  triangles: number;
  drawCalls: number;
  geometries: number;
  textures: number;
  fps: number;
}

interface Batch {
  key: string;
  mesh: THREE.InstancedMesh;
  memberIds: string[];
  geoKey: string;
}

/* ─── Geometry factory (unit-ish, scaled by mesh.scale) ──────────────────── */

function geoCacheKey(g: GeometryData): string {
  // Convex shards carry explicit vertices: key them exactly so re-breaks
  // (rewind + re-fracture) hit the cache instead of rebuilding hulls.
  if (g.type === 'convex') return `convex:${JSON.stringify(g.vertices ?? [])}`;
  return `${g.type}:${JSON.stringify(g.params)}`;
}

function buildGeometry(g: GeometryData): THREE.BufferGeometry {
  const p = g.params;
  switch (g.type) {
    case 'sphere': {
      const geo = new THREE.SphereGeometry(p.radius ?? 0.5, 32, 20);
      geo.scale(1 / (p.radius ?? 0.5), 1 / (p.radius ?? 0.5), 1 / (p.radius ?? 0.5));
      return geo; // unit radius 1 → mesh.scale sets radius
    }
    case 'box':
      return new THREE.BoxGeometry(1, 1, 1);
    case 'capsule':
      return new THREE.CapsuleGeometry(0.5, 1, 8, 16);
    case 'cylinder':
      return new THREE.CylinderGeometry(
        p.radiusTop ?? p.radius ?? 0.5,
        p.radiusBottom ?? p.radius ?? 0.5,
        p.height ?? 1, 28);
    case 'cone':
      return new THREE.ConeGeometry(p.radius ?? 0.5, p.height ?? 1, 28);
    case 'torus':
      return new THREE.TorusGeometry(p.radius ?? 0.5, p.tube ?? 0.15, 14, 36);
    case 'plane':
      return new THREE.PlaneGeometry(1, 1);
    case 'circle':
      return new THREE.CircleGeometry(1, 32);
    case 'ring':
      return new THREE.RingGeometry(0.6, 1, 32);
    case 'convex': {
      const v = g.vertices ?? [];
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i + 2 < v.length + 1; i += 3) {
        pts.push(new THREE.Vector3(v[i], v[i + 1], v[i + 2]));
      }
      if (pts.length < 4) return new THREE.BoxGeometry(1, 1, 1);
      try {
        return new ConvexGeometry(pts);
      } catch {
        return new THREE.BoxGeometry(1, 1, 1);
      }
    }
    default:
      return new THREE.BoxGeometry(1, 1, 1);
  }
}

/** Local scale mapping geometry params → mesh.scale multiplier. */
function geometryBaseScale(g: GeometryData): Vec3 {
  const p = g.params;
  switch (g.type) {
    case 'sphere':
      return [p.radius ?? 0.5, p.radius ?? 0.5, p.radius ?? 0.5];
    case 'box':
      return [p.width ?? 1, p.height ?? 1, p.depth ?? 1];
    case 'capsule': {
      const r = p.radius ?? 0.5;
      return [r * 2, (p.length ?? 1) + r * 2, r * 2];
    }
    case 'plane':
      return [p.width ?? 2, p.height ?? 2, 1];
    case 'circle':
    case 'ring':
      return [p.radius ?? p.outer ?? 1, p.radius ?? p.outer ?? 1, 1];
    case 'convex':
      return [1, 1, 1]; // explicit vertices are already full-size
    default:
      return [1, 1, 1];
  }
}

function visualKey(o: {
  visual: ForgeObject['visual'];
  geometry: GeometryData;
}): string {
  const v = o.visual;
  return `${geoCacheKey(o.geometry)}|${v.baseColor}|${v.metalness}|${v.roughness}|${v.opacity}|${v.transparent}|${v.emissive}|${v.emissiveIntensity}`;
}

/* ─── Runtime ────────────────────────────────────────────────────────────── */

const tmpM = new THREE.Matrix4();
const tmpP = new THREE.Vector3();
const tmpQ = new THREE.Quaternion();
const tmpS = new THREE.Vector3();
const tmpC = new THREE.Color();

export class ThreeRuntime {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private ortho: THREE.OrthographicCamera;
  private useOrtho = false;
  private controls: OrbitControls;
  private gizmo: TransformControls;
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();

  private geometries = new Map<string, THREE.BufferGeometry>();
  private materials = new Map<string, THREE.Material>();
  private meshes = new Map<string, THREE.Object3D>();
  private batches = new Map<string, Batch>();
  private meshToId = new Map<number, string>();
  private colliderHelpers = new THREE.Group();
  private debugGroup = new THREE.Group();
  private lightsGroup = new THREE.Group();
  private grid: THREE.GridHelper;
  private axes: THREE.AxesHelper;
  private shadowCatcher: THREE.Mesh;
  private boxHelper: THREE.BoxHelper | null = null;

  private particles: {
    points: THREE.Points;
    geo: THREE.BufferGeometry;
    pos: Float32Array;
    vel: Float32Array;
    life: Float32Array;
    maxLife: Float32Array;
    count: number;
  };
  /** SPH water pool: one instanced sphere per live particle, pushed per frame. */
  private fluidMesh: THREE.InstancedMesh | null = null;
  private fluidDummy = new THREE.Object3D();
  private shockwaves: Array<{ mesh: THREE.Mesh; t0: number }> = [];
  private popAnims = new Map<string, number>();
  private camSig = '';
  private directorFrame = -1;
  private sceneData: ForgeScene | null = null;
  private transformsById = new Map<string, BodyTransform>();
  private gizmoMode: 'translate' | 'rotate' | 'scale' = 'translate';
  private snap = { translate: 0.1, rotate: Math.PI / 36, scale: 0.05 };
  private snapping = true;
  private frameCount = 0;
  private lastFpsAt = performance.now();
  private fps = 60;
  private disposed = false;
  private lookThroughCamera = false;

  constructor(
    private canvas: HTMLCanvasElement,
    private cb: ViewportCallbacks,
  ) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      preserveDrawingBuffer: true,
    });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.scene.background = new THREE.Color('#0b0e14');
    this.scene.fog = new THREE.Fog('#0b0e14', 40, 140);

    this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 300);
    this.camera.position.set(6, 5, 9);
    this.ortho = new THREE.OrthographicCamera(-8, 8, 8, -8, 0.1, 300);
    this.ortho.position.set(6, 5, 9);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.maxDistance = 120;
    this.controls.target.set(0, 1, 0);

    this.gizmo = new TransformControls(this.camera, canvas);
    this.gizmo.setSize(0.85);
    this.scene.add(this.gizmo.getHelper());
    this.gizmo.addEventListener('dragging-changed', (e: unknown) => {
      const dragging = (e as { value: boolean }).value;
      this.controls.enabled = !dragging;
    });
    this.gizmo.addEventListener('objectChange', () => {
      const obj = this.gizmo.object;
      if (!obj) return;
      const id = this.meshToId.get(obj.id);
      if (!id) return;
      const euler = new THREE.Euler().setFromQuaternion(obj.quaternion, 'XYZ');
      this.cb.onTransformEdit(id, {
        position: [obj.position.x, obj.position.y, obj.position.z],
        rotation: [euler.x, euler.y, euler.z],
        scale: this.gizmoMode === 'scale' ? undefined : undefined,
      });
      if (this.gizmoMode === 'scale') {
        // Convert world scale back to object scale via base scale.
        const def = this.sceneData?.objects.find((o) => o.id === id);
        if (def) {
          const base = geometryBaseScale(def.geometry);
          this.cb.onTransformEdit(id, {
            scale: [
              obj.scale.x / base[0],
              obj.scale.y / base[1],
              obj.scale.z / base[2],
            ],
          });
        }
      }
    });

    this.grid = new THREE.GridHelper(40, 40, 0x2a3345, 0x1a2233);
    this.grid.position.y = 0;
    this.scene.add(this.grid);
    this.axes = new THREE.AxesHelper(2);
    this.scene.add(this.axes);

    this.shadowCatcher = new THREE.Mesh(
      new THREE.PlaneGeometry(80, 80),
      new THREE.ShadowMaterial({ opacity: 0.35 }),
    );
    this.shadowCatcher.rotation.x = -Math.PI / 2;
    this.shadowCatcher.position.y = -0.001;
    this.shadowCatcher.receiveShadow = true;
    this.scene.add(this.shadowCatcher);

    this.scene.add(this.colliderHelpers);
    this.scene.add(this.debugGroup);
    this.scene.add(this.lightsGroup);

    // Particle pool.
    const MAXP = 4000;
    const pgeo = new THREE.BufferGeometry();
    const pos = new Float32Array(MAXP * 3);
    const col = new Float32Array(MAXP * 3);
    pgeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    pgeo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const pmat = new THREE.PointsMaterial({
      size: 0.09, vertexColors: true, transparent: true, opacity: 0.95,
      depthWrite: false, sizeAttenuation: true,
    });
    const points = new THREE.Points(pgeo, pmat);
    points.frustumCulled = false;
    this.scene.add(points);
    this.particles = {
      points, geo: pgeo, pos,
      vel: new Float32Array(MAXP * 3),
      life: new Float32Array(MAXP),
      maxLife: new Float32Array(MAXP),
      count: MAXP,
    };
    (pgeo.getAttribute('color') as THREE.BufferAttribute).setUsage(THREE.DynamicDrawUsage);
    (pgeo.getAttribute('position') as THREE.BufferAttribute).setUsage(THREE.DynamicDrawUsage);

    // Fluid pool (fixed capacity, count-driven; no shadows for perf).
    const fgeo = new THREE.SphereGeometry(1, 10, 8);
    const fmat = new THREE.MeshStandardMaterial({ roughness: 0.15, metalness: 0.0 });
    this.fluidMesh = new THREE.InstancedMesh(fgeo, fmat, FLUID_MAX_PARTICLES);
    this.fluidMesh.castShadow = false;
    this.fluidMesh.receiveShadow = false;
    this.fluidMesh.frustumCulled = false;
    this.fluidMesh.count = 0;
    this.fluidMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.scene.add(this.fluidMesh);

    canvas.addEventListener('pointerdown', this.onPointerDown);
    window.addEventListener('resize', this.onResize);
    this.onResize();
  }

  /* ── Scene sync ── */

  syncScene(scene: ForgeScene, selection: string[], debug: DebugFlags): void {
    this.sceneData = scene;
    this.grid.visible = debug.showGrid;
    this.axes.visible = debug.showAxes;

    // Lights.
    while (this.lightsGroup.children.length > 0) {
      const l = this.lightsGroup.children.pop()!;
      this.lightsGroup.remove(l);
    }
    for (const l of scene.lights) {
      const light = this.buildLight(l.kind, l.color, l.intensity);
      if (!light) continue;
      light.position.set(...l.position);
      if ('target' in light && light.target instanceof THREE.Object3D) {
        light.target.position.set(...l.target);
        this.lightsGroup.add(light.target);
      }
      if ('castShadow' in light) {
        (light as THREE.DirectionalLight).castShadow = l.castShadow;
        const sl = light as THREE.DirectionalLight;
        if (sl.shadow) {
          sl.shadow.mapSize.set(l.shadowSize, l.shadowSize);
          sl.shadow.camera.left = -15;
          sl.shadow.camera.right = 15;
          sl.shadow.camera.top = 15;
          sl.shadow.camera.bottom = -15;
          sl.shadow.camera.far = 60;
          sl.shadow.bias = -0.0005;
        }
      }
      this.lightsGroup.add(light);
    }

    // Camera — applied ONLY when camera data changed, so user orbiting
    // is never clobbered by selection/debug syncs.
    const cam = scene.cameras.find((c) => c.id === scene.activeCameraId) ?? scene.cameras[0];
    if (cam) {
      const sig = `${cam.id}|${cam.kind}|${cam.position.join(',')}|${cam.target.join(',')}|${cam.fov}|${cam.near}|${cam.far}`;
      if (sig !== this.camSig) {
        this.camSig = sig;
        this.useOrtho = cam.kind === 'orthographic';
        const active = this.activeCamera();
        active.position.set(...cam.position);
        active.near = cam.near;
        active.far = cam.far;
        active.updateProjectionMatrix();
        if (active instanceof THREE.PerspectiveCamera) {
          active.fov = cam.fov;
          active.updateProjectionMatrix();
        }
        this.controls.target.set(...cam.target);
        this.gizmo.camera = active;
      }
      if (this.lookThroughCamera) {
        this.controls.enabled = false;
        this.activeCamera().lookAt(cam.target[0], cam.target[1], cam.target[2]);
      } else if (!this.gizmo.dragging) {
        this.controls.enabled = true;
      }
    }

    // Remove stale meshes.
    const liveIds = new Set(scene.objects.map((o) => o.id));
    for (const [id, mesh] of [...this.meshes]) {
      if (!liveIds.has(id)) {
        this.scene.remove(mesh);
        this.meshToId.delete(mesh.id);
        this.meshes.delete(id);
        if (this.gizmo.object === mesh) this.gizmo.detach();
      }
    }

    // Partition: instanced (shared instanceKey + physics-similar) vs regular.
    const groups = new Map<string, ForgeObject[]>();
    const regular: ForgeObject[] = [];
    for (const o of scene.objects) {
      if (o.kind === 'field' || o.kind === 'emitter' || o.kind === 'fluid') {
        regular.push(o); // helper gizmos, not batched
      } else if (o.instanceKey) {
        const k = `${o.instanceKey}|${visualKey(o)}`;
        if (!groups.has(k)) groups.set(k, []);
        groups.get(k)!.push(o);
      } else {
        regular.push(o);
      }
    }

    // Remove stale batches.
    for (const [k, batch] of [...this.batches]) {
      if (!groups.has(k)) {
        this.scene.remove(batch.mesh);
        batch.mesh.dispose();
        this.batches.delete(k);
      }
    }

    // Build/update batches.
    for (const [k, members] of groups) {
      let batch = this.batches.get(k);
      const first = members[0];
      if (!batch || batch.memberIds.length !== members.length) {
        if (batch) {
          this.scene.remove(batch.mesh);
          batch.mesh.dispose();
        }
        const geo = this.getGeometry(first.geometry);
        const mat = this.getMaterial(first) as THREE.Material;
        const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, members.length));
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.frustumCulled = false;
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        this.scene.add(mesh);
        batch = { key: k, mesh, memberIds: members.map((m) => m.id), geoKey: geoCacheKey(first.geometry) };
        this.batches.set(k, batch);
      } else {
        batch.memberIds = members.map((m) => m.id);
      }
      // Remove any regular meshes for batched members.
      for (const m of members) {
        const stale = this.meshes.get(m.id);
        if (stale) {
          this.scene.remove(stale);
          this.meshToId.delete(stale.id);
          this.meshes.delete(m.id);
          if (this.gizmo.object === stale) this.gizmo.detach();
        }
      }
    }

    // Regular meshes.
    for (const o of regular) {
      let mesh: THREE.Object3D | undefined = this.meshes.get(o.id);
      if (!mesh) {
        const fresh = this.buildObjectMesh(o);
        if (!fresh) continue;
        mesh = fresh;
        this.meshes.set(o.id, mesh);
        this.meshToId.set(mesh.id, o.id);
        this.scene.add(mesh);
      } else {
        this.updateObjectMesh(o, mesh);
      }
    }

    // Selection helper + gizmo attach.
    if (this.boxHelper) {
      this.scene.remove(this.boxHelper);
      this.boxHelper = null;
    }
    this.gizmo.detach();
    if (selection.length === 1) {
      const mesh = this.meshes.get(selection[0]);
      if (mesh && this.isGizmoEligible(selection[0])) {
        this.boxHelper = new THREE.BoxHelper(mesh, 0xffc247);
        this.scene.add(this.boxHelper);
        this.gizmo.attach(mesh as unknown as THREE.Object3D);
      }
    } else if (selection.length > 1) {
      // Multi-select: helpers only, no gizmo.
      for (const id of selection) {
        const mesh = this.meshes.get(id);
        if (mesh) {
          const h = new THREE.BoxHelper(mesh, 0xffc247);
          this.scene.add(h);
          // Tracked loosely; cleared next sync via full helper rebuild.
          (this.debugGroup as unknown as { __sel?: THREE.Object3D[] }).__sel =
            [...((this.debugGroup as unknown as { __sel?: THREE.Object3D[] }).__sel ?? []), h];
        }
      }
    }

    this.rebuildColliderHelpers(debug);
  }

  private isGizmoEligible(id: string): boolean {
    const def = this.sceneData?.objects.find((o) => o.id === id);
    if (!def || def.locked) return false;
    if (def.instanceKey) return false; // batches move via physics, not gizmo
    return true;
  }

  /**
   * Push fresh SPH particle state (called every frame, after transforms).
   * Droplet radius is supports[i]/3 (= 0.5 * spacing, touching spheres) per
   * particle so mixed-spacing volumes render at their own correct size.
   * Colors arrive as sRGB and are converted to the working color space.
   */
  syncFluid(
    positions: Float32Array,
    colors: Float32Array,
    count: number,
    supports: Float32Array,
  ): void {
    const mesh = this.fluidMesh;
    if (!mesh) return;
    const n = Math.max(0, Math.min(count, FLUID_MAX_PARTICLES));
    mesh.visible = n > 0;
    if (n === 0) {
      mesh.count = 0;
      return;
    }
    const d = this.fluidDummy;
    for (let i = 0; i < n; i++) {
      d.position.set(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]);
      d.scale.setScalar(Math.max(0.001, supports[i] / 3));
      d.updateMatrix();
      mesh.setMatrixAt(i, d.matrix);
      mesh.setColorAt(
        i,
        tmpC.setRGB(
          colors[i * 3],
          colors[i * 3 + 1],
          colors[i * 3 + 2],
          THREE.SRGBColorSpace,
        ),
      );
    }
    mesh.count = n;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }

  /** Push fresh physics transforms (called every frame). */
  applyTransforms(
    list: BodyTransform[],
    popped: Set<string>,
    fractured: Set<string>,
  ): void {
    this.transformsById.clear();
    for (const t of list) this.transformsById.set(t.id, t);

    for (const [id, mesh] of this.meshes) {
      const t = this.transformsById.get(id);
      const def = this.sceneData?.objects.find((o) => o.id === id);
      if (popped.has(id)) {
        // Pop animation: shrink + sink, driven by wall clock (visual only).
        let t0 = this.popAnims.get(id);
        if (t0 === undefined) {
          t0 = performance.now();
          this.popAnims.set(id, t0);
        }
        const k = Math.min(1, (performance.now() - t0) / 280);
        const s = Math.max(0.001, 1 - k);
        if (def) {
          const b = geometryBaseScale(def.geometry);
          mesh.scale.set(
            b[0] * def.transform.scale[0] * s,
            b[1] * def.transform.scale[1] * s,
            b[2] * def.transform.scale[2] * s,
          );
        } else {
          mesh.scale.setScalar(s);
        }
        mesh.position.y -= 0.02;
        mesh.visible = k < 1;
        continue;
      }
      if (fractured.has(id)) {
        mesh.visible = false;
        continue;
      }
      if (t) {
        mesh.position.set(t.p[0], t.p[1], t.p[2]);
        mesh.quaternion.set(t.q[0], t.q[1], t.q[2], t.q[3]);
        mesh.visible = def?.visible ?? true;
      } else if (def) {
        // Non-physical object: direct from scene transform.
        mesh.position.set(...def.transform.position);
        mesh.quaternion.setFromEuler(new THREE.Euler(...def.transform.rotation));
        mesh.visible = def.visible;
      }
      // Squash-and-recover for elastic materials (visual, velocity-driven).
      if (def && t && def.physical.elasticity > 0.55 && def.kind !== 'field' && def.kind !== 'emitter') {
        const sp = Math.sqrt(t.v[0] ** 2 + t.v[1] ** 2 + t.v[2] ** 2);
        const squash = Math.min(0.25, sp * 0.012) * def.physical.elasticity;
        const gb = geometryBaseScale(def.geometry);
        const sx = gb[0] * def.transform.scale[0];
        const sy = gb[1] * def.transform.scale[1];
        const sz = gb[2] * def.transform.scale[2];
        mesh.scale.set(sx * (1 + squash), sy * (1 - squash), sz * (1 + squash));
      }
      if (this.boxHelper && this.gizmo.object === mesh) this.boxHelper.update();
    }

    // Batches.
    for (const batch of this.batches.values()) {
      const first = this.sceneData?.objects.find((o) => o.id === batch.memberIds[0]);
      const base: Vec3 = first ? geometryBaseScale(first.geometry) : [1, 1, 1];
      for (let i = 0; i < batch.memberIds.length; i++) {
        const id = batch.memberIds[i];
        const t = this.transformsById.get(id);
        const def = this.sceneData?.objects.find((o) => o.id === id);
        const s: Vec3 = def
          ? [base[0] * def.transform.scale[0], base[1] * def.transform.scale[1], base[2] * def.transform.scale[2]]
          : base;
        if (t) {
          tmpP.set(t.p[0], t.p[1], t.p[2]);
          tmpQ.set(t.q[0], t.q[1], t.q[2], t.q[3]);
        } else if (def) {
          tmpP.set(...def.transform.position);
          tmpQ.setFromEuler(new THREE.Euler(...def.transform.rotation));
        } else {
          tmpP.set(0, -100, 0);
          tmpQ.identity();
        }
        tmpS.set(s[0], s[1], s[2]);
        tmpM.compose(tmpP, tmpQ, tmpS);
        batch.mesh.setMatrixAt(i, tmpM);
      }
      batch.mesh.instanceMatrix.needsUpdate = true;
    }
  }

  /** Spawned-body meshes (fragments, emitter products). */
  syncSpawned(
    descriptors: SpawnedDescriptor[],
    removed: string[],
    transforms: Map<string, BodyTransform>,
  ): void {
    for (const id of removed) {
      const mesh = this.meshes.get(id);
      if (mesh) {
        this.scene.remove(mesh);
        this.meshToId.delete(mesh.id);
        this.meshes.delete(id);
      }
    }
    for (const d of descriptors) {
      if (this.meshes.has(d.id)) continue;
      const geo = this.getGeometry(d.geometry);
      const mat = new THREE.MeshStandardMaterial({
        color: new THREE.Color(d.baseColor),
        metalness: d.metalness,
        roughness: d.roughness,
        emissive: new THREE.Color(d.emissive),
        transparent: d.opacity < 1,
        opacity: d.opacity,
      });
      const mesh = new THREE.Mesh(geo, mat);
      const b = geometryBaseScale(d.geometry);
      mesh.scale.set(b[0] * d.scale[0], b[1] * d.scale[1], b[2] * d.scale[2]);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      const t = transforms.get(d.id);
      if (t) {
        mesh.position.set(t.p[0], t.p[1], t.p[2]);
        mesh.quaternion.set(t.q[0], t.q[1], t.q[2], t.q[3]);
      }
      this.meshes.set(d.id, mesh);
      this.meshToId.set(mesh.id, d.id);
      this.scene.add(mesh);
    }
    // Move spawned meshes (they're not in sceneData).
    for (const d of descriptors) {
      const mesh = this.meshes.get(d.id);
      const t = transforms.get(d.id);
      if (mesh && t && mesh instanceof THREE.Mesh) {
        mesh.position.set(t.p[0], t.p[1], t.p[2]);
        mesh.quaternion.set(t.q[0], t.q[1], t.q[2], t.q[3]);
      }
    }
  }

  /* ── Mesh construction ── */

  private getGeometry(g: GeometryData): THREE.BufferGeometry {
    const k = geoCacheKey(g);
    let geo = this.geometries.get(k);
    if (!geo) {
      geo = buildGeometry(g);
      this.geometries.set(k, geo);
    }
    return geo;
  }

  private getMaterial(o: { visual: ForgeObject['visual']; geometry: GeometryData }): THREE.Material {
    const k = visualKey(o);
    let mat = this.materials.get(k);
    if (!mat) {
      const v = o.visual;
      mat = new THREE.MeshStandardMaterial({
        color: new THREE.Color(v.baseColor),
        metalness: v.metalness,
        roughness: v.roughness,
        transparent: v.transparent || v.opacity < 1,
        opacity: v.opacity,
        emissive: new THREE.Color(v.emissive),
        emissiveIntensity: v.emissiveIntensity,
      });
      this.materials.set(k, mat);
    }
    return mat;
  }

  private buildObjectMesh(o: ForgeObject): THREE.Object3D | null {
    if (o.kind === 'field') return this.buildFieldHelper(o);
    if (o.kind === 'emitter') return this.buildEmitterHelper(o);
    if (o.kind === 'fluid') return this.buildFluidHelper(o);
    const geo = this.getGeometry(o.geometry);
    const mat = this.getMaterial(o);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    const base = geometryBaseScale(o.geometry);
    mesh.scale.set(
      base[0] * o.transform.scale[0],
      base[1] * o.transform.scale[1],
      base[2] * o.transform.scale[2],
    );
    mesh.position.set(...o.transform.position);
    mesh.quaternion.setFromEuler(new THREE.Euler(...o.transform.rotation));
    mesh.visible = o.visible;
    return mesh;
  }

  private updateObjectMesh(o: ForgeObject, mesh: THREE.Object3D): void {
    if (o.kind === 'field' || o.kind === 'emitter' || o.kind === 'fluid') {
      // Rebuild helpers cheaply on sync (they're small).
      const fresh =
        o.kind === 'field' ? this.buildFieldHelper(o)
        : o.kind === 'emitter' ? this.buildEmitterHelper(o)
        : this.buildFluidHelper(o);
      if (fresh) {
        const idx = this.scene.children.indexOf(mesh);
        this.meshToId.delete(mesh.id);
        this.scene.remove(mesh);
        this.meshes.set(o.id, fresh);
        this.meshToId.set(fresh.id, o.id);
        if (idx >= 0) this.scene.children.splice(idx, 0, fresh);
        else this.scene.add(fresh);
      }
      return;
    }
    if (!(mesh instanceof THREE.Mesh)) return;
    const wantGeo = this.getGeometry(o.geometry);
    if (mesh.geometry !== wantGeo) mesh.geometry = wantGeo;
    const wantMat = this.getMaterial(o);
    if (mesh.material !== wantMat) mesh.material = wantMat;
    const base = geometryBaseScale(o.geometry);
    mesh.scale.set(
      base[0] * o.transform.scale[0],
      base[1] * o.transform.scale[1],
      base[2] * o.transform.scale[2],
    );
    if (!this.transformsById.has(o.id)) {
      mesh.position.set(...o.transform.position);
      mesh.quaternion.setFromEuler(new THREE.Euler(...o.transform.rotation));
    }
    mesh.visible = o.visible;
  }

  private buildFieldHelper(o: ForgeObject): THREE.Object3D {
    const group = new THREE.Group();
    const r = o.field?.radius ?? 3;
    const color =
      o.field?.kind === 'attractor' ? 0xb366ff
      : o.field?.kind === 'repulsor' ? 0xff6666
      : o.field?.kind === 'vortex' ? 0x66ccff
      : 0x66ffaa;
    const wire = new THREE.Mesh(
      new THREE.SphereGeometry(r, 20, 14),
      new THREE.MeshBasicMaterial({ color, wireframe: true, transparent: true, opacity: 0.25 }),
    );
    group.add(wire);
    const core = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.25),
      new THREE.MeshBasicMaterial({ color }),
    );
    group.add(core);
    group.position.set(...o.transform.position);
    return group;
  }

  private buildEmitterHelper(o: ForgeObject): THREE.Object3D {
    const group = new THREE.Group();
    const cone = new THREE.Mesh(
      new THREE.ConeGeometry(0.4, 1, 16, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xffc247, wireframe: true, transparent: true, opacity: 0.7 }),
    );
    cone.rotation.x = Math.PI;
    group.add(cone);
    group.position.set(...o.transform.position);
    group.quaternion.setFromEuler(new THREE.Euler(...o.transform.rotation));
    return group;
  }

  private buildFluidHelper(o: ForgeObject): THREE.Object3D {
    const group = new THREE.Group();
    tmpC.set(o.fluid?.color ?? '#2f7fff');
    const wire = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshBasicMaterial({ color: tmpC.clone(), wireframe: true, transparent: true, opacity: 0.5 }),
    );
    group.add(wire);
    // Fill-level slab: bottom-aligned, height = fill fraction.
    const fill = Math.min(1, Math.max(0, o.fluid?.fill ?? 0.6));
    if (fill > 0.001) {
      const slab = new THREE.Mesh(
        new THREE.BoxGeometry(1, 1, 1),
        new THREE.MeshBasicMaterial({ color: tmpC.clone(), transparent: true, opacity: 0.16, depthWrite: false }),
      );
      slab.scale.set(1, fill, 1);
      slab.position.y = -(1 - fill) / 2;
      group.add(slab);
    }
    group.position.set(...o.transform.position);
    group.quaternion.setFromEuler(new THREE.Euler(...o.transform.rotation));
    group.scale.set(...o.transform.scale);
    return group;
  }

  private buildLight(kind: string, color: string, intensity: number): THREE.Light | null {
    const c = new THREE.Color(color);
    switch (kind) {
      case 'directional':
        return new THREE.DirectionalLight(c, intensity);
      case 'point':
        return new THREE.PointLight(c, intensity, 60, 1.6);
      case 'spot':
        return new THREE.SpotLight(c, intensity, 80, Math.PI / 5, 0.4, 1.2);
      case 'ambient':
        return new THREE.AmbientLight(c, intensity);
      case 'hemisphere':
        return new THREE.HemisphereLight(c, new THREE.Color('#223044'), intensity);
      default:
        return null;
    }
  }

  /* ── Debug ── */

  private rebuildColliderHelpers(debug: DebugFlags): void {
    while (this.colliderHelpers.children.length > 0) {
      const c = this.colliderHelpers.children.pop()!;
      this.colliderHelpers.remove(c);
    }
    if (!debug.showColliders || !this.sceneData) return;
    const mat = new THREE.MeshBasicMaterial({
      color: 0x51ff7a, wireframe: true, transparent: true, opacity: 0.5,
    });
    for (const o of this.sceneData.objects) {
      if (!o.collider || !o.rigidBody) continue;
      const c = o.collider;
      let geo: THREE.BufferGeometry;
      const s = o.transform.scale;
      if (c.shape === 'sphere') {
        geo = new THREE.SphereGeometry(Math.max(0.01, c.radius * Math.max(s[0], s[2])), 14, 10);
      } else if (c.shape === 'cone') {
        geo = new THREE.ConeGeometry(Math.max(0.01, c.radius * Math.max(s[0], s[2])), Math.max(0.01, c.height * s[1]), 14);
      } else if (c.shape === 'cylinder') {
        geo = new THREE.CylinderGeometry(Math.max(0.01, c.radius * Math.max(s[0], s[2])), Math.max(0.01, c.radius * Math.max(s[0], s[2])), Math.max(0.01, c.height * s[1]), 14);
      } else if (c.shape === 'capsule') {
        geo = new THREE.CapsuleGeometry(Math.max(0.01, c.radius), Math.max(0.01, c.height - 2 * c.radius), 6, 12);
      } else {
        geo = new THREE.BoxGeometry(
          Math.max(0.02, c.halfExtents[0] * 2 * s[0]),
          Math.max(0.02, c.halfExtents[1] * 2 * s[1]),
          Math.max(0.02, c.halfExtents[2] * 2 * s[2]));
      }
      const mesh = new THREE.Mesh(geo, mat);
      mesh.userData.bodyId = o.id;
      this.colliderHelpers.add(mesh);
    }
  }

  /** Debug overlays that move every frame (colliders, velocity, contacts). */
  updateDebug(
    debug: DebugFlags,
    contacts: Vec3[],
    transforms: Map<string, BodyTransform>,
  ): void {
    // Collider helpers follow bodies.
    for (const child of this.colliderHelpers.children) {
      const id = (child as THREE.Mesh).userData.bodyId as string;
      const t = transforms.get(id);
      const def = this.sceneData?.objects.find((o) => o.id === id);
      if (t && def?.collider) {
        const off = def.collider.offset;
        tmpQ.set(t.q[0], t.q[1], t.q[2], t.q[3]);
        tmpP.set(off[0], off[1], off[2]).applyQuaternion(tmpQ);
        child.position.set(t.p[0] + tmpP.x, t.p[1] + tmpP.y, t.p[2] + tmpP.z);
        child.quaternion.copy(tmpQ);
        child.visible = true;
      } else {
        child.visible = false;
      }
    }
    // Velocity / contacts / COM overlays are rebuilt each frame (pooled, capped).
    while (this.debugGroup.children.length > 0) {
      const c = this.debugGroup.children.pop()!;
      this.debugGroup.remove(c);
      const mesh = c as THREE.Mesh;
      if (mesh.geometry && !(mesh.geometry instanceof THREE.BufferGeometry && mesh.userData.shared)) {
        // Only dispose private geometries (arrow/contact geoms are fresh each frame).
      }
    }
    if (debug.showVelocity) {
      const mat = new THREE.LineBasicMaterial({ color: 0x4fd2ff });
      const pts: number[] = [];
      let n = 0;
      for (const t of transforms.values()) {
        if (n++ > 400) break;
        const sp = Math.sqrt(t.v[0] ** 2 + t.v[1] ** 2 + t.v[2] ** 2);
        if (sp < 0.2) continue;
        pts.push(t.p[0], t.p[1], t.p[2], t.p[0] + t.v[0] * 0.25, t.p[1] + t.v[1] * 0.25, t.p[2] + t.v[2] * 0.25);
      }
      if (pts.length > 0) {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pts), 3));
        this.debugGroup.add(new THREE.LineSegments(g, mat));
      }
    }
    if (debug.showContacts && contacts.length > 0) {
      const g = new THREE.BufferGeometry();
      const arr = new Float32Array(contacts.flat());
      g.setAttribute('position', new THREE.BufferAttribute(arr, 3));
      this.debugGroup.add(new THREE.Points(g, new THREE.PointsMaterial({
        color: 0xff4444, size: 0.14,
      })));
    }
    if (debug.showCOM) {
      const g = new THREE.BufferGeometry();
      const arr: number[] = [];
      let n = 0;
      for (const t of transforms.values()) {
        if (n++ > 400) break;
        arr.push(t.p[0], t.p[1], t.p[2]);
      }
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(arr), 3));
      this.debugGroup.add(new THREE.Points(g, new THREE.PointsMaterial({
        color: 0xffc247, size: 0.1,
      })));
    }
    if (debug.showSleeping) {
      const g = new THREE.BufferGeometry();
      const arr: number[] = [];
      for (const t of transforms.values()) {
        if (!t.sleeping || !t.dynamic) continue;
        arr.push(t.p[0], t.p[1] + 0.4, t.p[2]);
      }
      if (arr.length > 0) {
        g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(arr), 3));
        this.debugGroup.add(new THREE.Points(g, new THREE.PointsMaterial({
          color: 0x8899ff, size: 0.12,
        })));
      }
    }
    if (debug.showJoints && this.sceneData && this.sceneData.constraints.length > 0) {
      const mat = new THREE.LineBasicMaterial({ color: 0xffc247 });
      const pts: number[] = [];
      const dots: number[] = [];
      for (const c of this.sceneData.constraints) {
        const ta = transforms.get(c.bodyA);
        const tb = transforms.get(c.bodyB);
        if (!ta || !tb) continue;
        tmpQ.set(ta.q[0], ta.q[1], ta.q[2], ta.q[3]);
        tmpP.set(c.anchorA[0], c.anchorA[1], c.anchorA[2]).applyQuaternion(tmpQ);
        const ax = ta.p[0] + tmpP.x;
        const ay = ta.p[1] + tmpP.y;
        const az = ta.p[2] + tmpP.z;
        tmpQ.set(tb.q[0], tb.q[1], tb.q[2], tb.q[3]);
        tmpP.set(c.anchorB[0], c.anchorB[1], c.anchorB[2]).applyQuaternion(tmpQ);
        const bx = tb.p[0] + tmpP.x;
        const by = tb.p[1] + tmpP.y;
        const bz = tb.p[2] + tmpP.z;
        pts.push(ax, ay, az, bx, by, bz);
        dots.push(ax, ay, az, bx, by, bz);
      }
      if (pts.length > 0) {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pts), 3));
        this.debugGroup.add(new THREE.LineSegments(g, mat));
        const gd = new THREE.BufferGeometry();
        gd.setAttribute('position', new THREE.BufferAttribute(new Float32Array(dots), 3));
        this.debugGroup.add(new THREE.Points(gd, new THREE.PointsMaterial({
          color: 0xffc247, size: 0.12,
        })));
      }
    }
  }

  /* ── Particles / shockwaves ── */

  burst(point: Vec3, colorHex: string, count: number, power: number): void {
    const P = this.particles;
    tmpC.set(colorHex);
    let spawned = 0;
    for (let i = 0; i < P.count && spawned < count; i++) {
      if (P.life[i] > 0) continue;
      P.life[i] = P.maxLife[i] = 0.5 + Math.random() * 0.7;
      P.pos[i * 3] = point[0];
      P.pos[i * 3 + 1] = point[1];
      P.pos[i * 3 + 2] = point[2];
      const th = Math.random() * Math.PI * 2;
      const ph = Math.acos(2 * Math.random() - 1);
      const sp = (1.5 + Math.random() * 3) * power;
      P.vel[i * 3] = Math.sin(ph) * Math.cos(th) * sp;
      P.vel[i * 3 + 1] = Math.abs(Math.cos(ph)) * sp + 1.5 * power;
      P.vel[i * 3 + 2] = Math.sin(ph) * Math.sin(th) * sp;
      const colAttr = P.geo.getAttribute('color') as THREE.BufferAttribute;
      colAttr.setXYZ(i, tmpC.r, tmpC.g, tmpC.b);
      spawned++;
    }
    (P.geo.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
  }

  shockwave(point: Vec3, maxR = 3): void {
    const mesh = new THREE.Mesh(
      new THREE.TorusGeometry(0.5, 0.05, 8, 40),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9 }),
    );
    mesh.position.set(point[0], point[1], point[2]);
    mesh.rotation.x = Math.PI / 2;
    mesh.userData.maxR = maxR;
    this.scene.add(mesh);
    this.shockwaves.push({ mesh, t0: performance.now() });
  }

  private stepParticles(dt: number): void {
    const P = this.particles;
    let any = false;
    for (let i = 0; i < P.count; i++) {
      if (P.life[i] <= 0) continue;
      any = true;
      P.life[i] -= dt;
      if (P.life[i] <= 0) {
        P.pos[i * 3 + 1] = -1000;
        continue;
      }
      P.vel[i * 3 + 1] -= 9.81 * dt * 0.6;
      P.vel[i * 3] *= 1 - 1.5 * dt;
      P.vel[i * 3 + 2] *= 1 - 1.5 * dt;
      P.pos[i * 3] += P.vel[i * 3] * dt;
      P.pos[i * 3 + 1] += P.vel[i * 3 + 1] * dt;
      P.pos[i * 3 + 2] += P.vel[i * 3 + 2] * dt;
      if (P.pos[i * 3 + 1] < 0.02) {
        P.pos[i * 3 + 1] = 0.02;
        P.vel[i * 3 + 1] *= -0.4;
      }
    }
    if (any) {
      (P.geo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    }
    const now = performance.now();
    this.shockwaves = this.shockwaves.filter((s) => {
      const k = (now - s.t0) / 450;
      if (k >= 1) {
        this.scene.remove(s.mesh);
        return false;
      }
      const r = 0.3 + k * (s.mesh.userData.maxR as number);
      s.mesh.scale.set(r, r, r);
      (s.mesh.material as THREE.MeshBasicMaterial).opacity = 0.9 * (1 - k);
      return true;
    });
  }

  /* ── Frame loop ── */

  private activeCamera(): THREE.PerspectiveCamera | THREE.OrthographicCamera {
    return this.useOrtho ? this.ortho : this.camera;
  }

  /** Live viewport pose, for camera-keyframe capture. */
  getCameraPose(): CameraPose {
    const active = this.activeCamera();
    return {
      position: [active.position.x, active.position.y, active.position.z],
      target: [
        this.controls.target.x,
        this.controls.target.y,
        this.controls.target.z,
      ],
      fov: active instanceof THREE.PerspectiveCamera ? active.fov : 50,
    };
  }

  render(
    dt: number,
    followPos: Vec3 | null,
    shake: number,
    director: { frame: number; pose: CameraPose } | null = null,
  ): void {
    if (this.disposed) return;
    // Director track owns the camera on frames it defines: applied only
    // when the frame number changes, so free-orbiting while paused (same
    // frame, no re-apply) never fights the user.
    if (director && director.frame !== this.directorFrame) {
      this.directorFrame = director.frame;
      const active = this.activeCamera();
      active.position.set(...director.pose.position);
      this.controls.target.set(...director.pose.target);
      if (active instanceof THREE.PerspectiveCamera) {
        active.fov = director.pose.fov;
        active.updateProjectionMatrix();
      }
    }
    if (followPos && !this.lookThroughCamera) {
      this.controls.target.lerp(tmpP.set(followPos[0], followPos[1], followPos[2]), 0.12);
    }
    this.controls.update();
    if (this.useOrtho) {
      this.ortho.position.copy(this.camera.position);
      this.ortho.quaternion.copy(this.camera.quaternion);
    }
    if (shake > 0) {
      const t = performance.now() / 1000;
      const s = shake * 0.15;
      this.camera.position.x += Math.sin(t * 39.7) * s;
      this.camera.position.y += Math.sin(t * 44.3) * s;
    }
    this.stepParticles(dt);
    this.renderer.render(this.scene, this.activeCamera());

    this.frameCount++;
    const now = performance.now();
    if (now - this.lastFpsAt > 500) {
      this.fps = Math.round((this.frameCount * 1000) / (now - this.lastFpsAt));
      this.frameCount = 0;
      this.lastFpsAt = now;
      const info = this.renderer.info;
      this.cb.onStats({
        triangles: info.render.triangles,
        drawCalls: info.render.calls,
        geometries: info.memory.geometries,
        textures: info.memory.textures,
        fps: this.fps,
      });
    }
  }

  /* ── Capture ── */

  /** Render exactly W×H and return a PNG data URL (thumbnails / frame export). */
  captureAt(w: number, h: number): string {
    const canvas = this.renderer.domElement;
    const prevW = canvas.clientWidth;
    const prevH = canvas.clientHeight;
    const prevAspect = this.camera.aspect;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.render(this.scene, this.activeCamera());
    const url = canvas.toDataURL('image/png');
    this.renderer.setSize(prevW, prevH, false);
    this.camera.aspect = prevAspect;
    this.camera.updateProjectionMatrix();
    return url;
  }

  captureThumbnail(maxW = 320): string {
    const canvas = this.renderer.domElement;
    const aspect = canvas.height / Math.max(1, canvas.width);
    const w = maxW;
    const h = Math.round(maxW * aspect);
    const src = this.captureAt(canvas.width, canvas.height);
    // Downscale via temp canvas for small thumbnails.
    const img = new Image();
    img.src = src;
    const out = document.createElement('canvas');
    out.width = w;
    out.height = h;
    // Note: synchronous draw may race image decode; fallback to full capture.
    try {
      const ctx = out.getContext('2d');
      if (ctx && img.complete && img.naturalWidth > 0) {
        ctx.drawImage(img, 0, 0, w, h);
        return out.toDataURL('image/jpeg', 0.7);
      }
    } catch { /* fall through */ }
    return src;
  }

  /* ── Interaction ── */

  private onPointerDown = (e: PointerEvent): void => {
    if (e.button !== 0) return;
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.activeCamera());
    const targets: THREE.Object3D[] = [...this.meshes.values()];
    for (const b of this.batches.values()) targets.push(b.mesh);
    const hits = this.raycaster.intersectObjects(targets, false);
    if (hits.length === 0) {
      this.cb.onSelect([]);
      return;
    }
    const hit = hits[0];
    if ((hit.object as THREE.InstancedMesh).isInstancedMesh) {
      const batch = [...this.batches.values()].find((b) => b.mesh === hit.object);
      const id = batch?.memberIds[hit.instanceId ?? 0];
      this.cb.onSelect(id ? [id] : []);
    } else {
      const id = this.meshToId.get(hit.object.id);
      this.cb.onSelect(id ? [id] : []);
    }
  };

  private onResize = (): void => {
    const parent = this.canvas.parentElement;
    if (!parent) return;
    const w = parent.clientWidth;
    const h = parent.clientHeight;
    if (w === 0 || h === 0) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    const aspect = w / h;
    const d = 8;
    this.ortho.left = -d * aspect;
    this.ortho.right = d * aspect;
    this.ortho.top = d;
    this.ortho.bottom = -d;
    this.ortho.updateProjectionMatrix();
  };

  setGizmoMode(m: 'translate' | 'rotate' | 'scale'): void {
    this.gizmoMode = m;
    this.gizmo.setMode(m);
  }

  setSnapping(on: boolean): void {
    this.snapping = on;
    this.gizmo.setTranslationSnap(on ? this.snap.translate : null);
    this.gizmo.setRotationSnap(on ? this.snap.rotate : null);
    this.gizmo.setScaleSnap(on ? this.snap.scale : null);
  }

  /** Viewport quality — real pixel-ratio + shadow scaling. */
  setQuality(q: 'draft' | 'medium' | 'high' | 'ultra'): void {
    const dpr = window.devicePixelRatio || 1;
    if (q === 'draft') {
      this.renderer.setPixelRatio(Math.min(0.5, dpr));
      this.renderer.shadowMap.enabled = false;
    } else if (q === 'medium') {
      this.renderer.setPixelRatio(Math.min(0.75, dpr));
      this.renderer.shadowMap.enabled = true;
    } else if (q === 'high') {
      this.renderer.setPixelRatio(Math.min(1, dpr));
      this.renderer.shadowMap.enabled = true;
    } else {
      this.renderer.setPixelRatio(Math.min(2, dpr));
      this.renderer.shadowMap.enabled = true;
    }
    // Toggling shadows requires material recompile.
    for (const m of this.materials.values()) m.needsUpdate = true;
    this.onResize();
  }

  focusOn(id: string | null): void {
    const mesh = id ? this.meshes.get(id) : null;
    if (mesh) {
      this.controls.target.copy(mesh.position);
    } else {
      this.controls.target.set(0, 1, 0);
    }
  }

  setLookThroughCamera(on: boolean): void {
    this.lookThroughCamera = on;
    this.controls.enabled = !on;
  }

  get lookThrough(): boolean {
    return this.lookThroughCamera;
  }

  resetPopAnims(): void {
    this.popAnims.clear();
  }

  dispose(): void {
    this.disposed = true;
    if (this.fluidMesh) {
      this.scene.remove(this.fluidMesh);
      this.fluidMesh.geometry.dispose();
      (this.fluidMesh.material as THREE.Material).dispose();
      this.fluidMesh = null;
    }
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    window.removeEventListener('resize', this.onResize);
    this.controls.dispose();
    this.gizmo.dispose();
    this.renderer.dispose();
  }
}
