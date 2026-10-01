/**
 * Procedural generators — pure functions, fully deterministic.
 *
 * Each generator clones a template object N times with computed transforms
 * and seeded randomization. Output objects share an `instanceKey` so the
 * Three.js runtime renders them as a single InstancedMesh.
 */

import type {
  ForgeObject,
  GeneratorRecord,
  Vec3,
} from '../core/types';
import { uid } from '../core/types';
import { Rng } from '../core/rng';

export interface GeneratorParams {
  seed: number;
  templateId: string;
  colorRandom: number; // 0..1 amount
  rotRandom: number; // 0..1 amount
  scaleMin: number;
  scaleMax: number;
  massMin: number;
  massMax: number; // 0 = keep template
  palette: string[]; // empty = full-spectrum random
}

export const DEFAULT_GENERATOR_PARAMS: GeneratorParams = {
  seed: 1,
  templateId: 'ball-rubber',
  colorRandom: 1,
  rotRandom: 0,
  scaleMin: 1,
  scaleMax: 1,
  massMin: 0,
  massMax: 0,
  palette: [],
};

function cloneTemplate(
  template: ForgeObject,
  rng: Rng,
  index: number,
  total: number,
  position: Vec3,
  gp: GeneratorParams,
  instanceKey: string,
  label: string,
): ForgeObject {
  const o = structuredClone(template) as ForgeObject;
  o.id = uid('obj');
  o.rev = 1;
  o.name = `${label} ${index + 1}/${total}`;
  o.instanceKey = instanceKey;
  o.transform.position = [...position];
  if (gp.rotRandom > 0) {
    o.transform.rotation = [
      rng.range(0, Math.PI * 2) * gp.rotRandom,
      rng.range(0, Math.PI * 2) * gp.rotRandom,
      rng.range(0, Math.PI * 2) * gp.rotRandom,
    ];
  }
  const s = rng.range(gp.scaleMin, gp.scaleMax);
  o.transform.scale = [s, s, s];
  if (gp.colorRandom > 0 && rng.next() < gp.colorRandom) {
    o.visual = {
      ...o.visual,
      baseColor:
        gp.palette.length > 0 ? rng.pick(gp.palette) : rng.color(),
    };
  }
  if (gp.massMax > 0 && o.rigidBody) {
    o.rigidBody = {
      ...o.rigidBody,
      massMode: 'override',
      mass: rng.range(gp.massMin, gp.massMax),
    };
  }
  return o;
}

export interface BakeResult {
  objects: ForgeObject[];
  record: GeneratorRecord;
}

function makeRecord(
  type: GeneratorRecord['type'],
  name: string,
  seed: number,
  params: Record<string, number | string>,
  templateId: string,
  ids: string[],
): GeneratorRecord {
  return {
    id: uid('gen'),
    type,
    name,
    seed,
    params,
    templateId,
    generatedIds: ids,
    generatedJoints: [],
  };
}

/* ─── Grid ───────────────────────────────────────────────────────────────── */

export interface GridOpts extends GeneratorParams {
  rows: number;
  cols: number;
  layers: number;
  spacing: number;
  jitter: number;
}

export function bakeGrid(
  template: ForgeObject,
  o: GridOpts,
): BakeResult {
  const rng = new Rng(o.seed);
  const instanceKey = uid('inst');
  const objects: ForgeObject[] = [];
  const total = o.rows * o.cols * o.layers;
  let i = 0;
  for (let y = 0; y < o.layers; y++) {
    for (let r = 0; r < o.rows; r++) {
      for (let c = 0; c < o.cols; c++) {
        const jx = () => rng.range(-o.jitter, o.jitter);
        objects.push(
          cloneTemplate(
            template, rng, i++, total,
            [
              (c - (o.cols - 1) / 2) * o.spacing + jx(),
              y * o.spacing + jx(),
              (r - (o.rows - 1) / 2) * o.spacing + jx(),
            ],
            o, instanceKey, 'Grid',
          ),
        );
      }
    }
  }
  const record = makeRecord('grid', `Grid ${o.cols}×${o.rows}×${o.layers}`, o.seed,
    { rows: o.rows, cols: o.cols, layers: o.layers, spacing: o.spacing },
    o.templateId, objects.map((x) => x.id));
  return { objects, record };
}

/* ─── Circle ─────────────────────────────────────────────────────────────── */

export interface CircleOpts extends GeneratorParams {
  count: number;
  radius: number;
  height: number;
  startAngle: number;
  endAngle: number;
}

export function bakeCircle(template: ForgeObject, o: CircleOpts): BakeResult {
  const rng = new Rng(o.seed);
  const instanceKey = uid('inst');
  const objects: ForgeObject[] = [];
  for (let i = 0; i < o.count; i++) {
    const t = o.count === 1 ? 0 : i / (o.count - 1);
    const a = o.startAngle + (o.endAngle - o.startAngle) * t;
    objects.push(
      cloneTemplate(template, rng, i, o.count,
        [Math.cos(a) * o.radius, o.height, Math.sin(a) * o.radius],
        o, instanceKey, 'Ring'),
    );
  }
  const record = makeRecord('circle', `Circle ×${o.count}`, o.seed,
    { count: o.count, radius: o.radius }, o.templateId, objects.map((x) => x.id));
  return { objects, record };
}

/* ─── Spiral ─────────────────────────────────────────────────────────────── */

export interface SpiralOpts extends GeneratorParams {
  count: number;
  turns: number;
  radiusStart: number;
  radiusEnd: number;
  heightStep: number;
}

export function bakeSpiral(template: ForgeObject, o: SpiralOpts): BakeResult {
  const rng = new Rng(o.seed);
  const instanceKey = uid('inst');
  const objects: ForgeObject[] = [];
  for (let i = 0; i < o.count; i++) {
    const t = o.count === 1 ? 0 : i / (o.count - 1);
    const a = t * o.turns * Math.PI * 2;
    const r = o.radiusStart + (o.radiusEnd - o.radiusStart) * t;
    objects.push(
      cloneTemplate(template, rng, i, o.count,
        [Math.cos(a) * r, i * o.heightStep, Math.sin(a) * r],
        o, instanceKey, 'Spiral'),
    );
  }
  const record = makeRecord('spiral', `Spiral ×${o.count}`, o.seed,
    { count: o.count, turns: o.turns }, o.templateId, objects.map((x) => x.id));
  return { objects, record };
}

/* ─── Tower ──────────────────────────────────────────────────────────────── */

export interface TowerOpts extends GeneratorParams {
  rows: number;
  cols: number;
  levels: number;
  spacing: number;
  alternate: boolean;
}

export function bakeTower(template: ForgeObject, o: TowerOpts): BakeResult {
  const rng = new Rng(o.seed);
  const instanceKey = uid('inst');
  const objects: ForgeObject[] = [];
  const total = o.rows * o.cols * o.levels;
  let i = 0;
  for (let l = 0; l < o.levels; l++) {
    const rot90 = o.alternate && l % 2 === 1;
    for (let r = 0; r < o.rows; r++) {
      for (let c = 0; c < o.cols; c++) {
        const x = (c - (o.cols - 1) / 2) * o.spacing;
        const z = (r - (o.rows - 1) / 2) * o.spacing;
        const obj = cloneTemplate(template, rng, i++, total,
          rot90 ? [z, l * o.spacing, x] : [x, l * o.spacing, z],
          o, instanceKey, 'Tower');
        if (rot90) obj.transform.rotation = [0, Math.PI / 2, 0];
        objects.push(obj);
      }
    }
  }
  const record = makeRecord('tower', `Tower ${o.cols}×${o.rows}×${o.levels}`, o.seed,
    { rows: o.rows, cols: o.cols, levels: o.levels }, o.templateId,
    objects.map((x) => x.id));
  return { objects, record };
}

/* ─── Random pile ────────────────────────────────────────────────────────── */

export interface PileOpts extends GeneratorParams {
  count: number;
  area: number;
  height: number;
  dropHeight: number;
}

export function bakePile(template: ForgeObject, o: PileOpts): BakeResult {
  const rng = new Rng(o.seed);
  const instanceKey = uid('inst');
  const objects: ForgeObject[] = [];
  for (let i = 0; i < o.count; i++) {
    objects.push(
      cloneTemplate(template, rng, i, o.count,
        [
          rng.range(-o.area / 2, o.area / 2),
          o.dropHeight + rng.range(0, o.height),
          rng.range(-o.area / 2, o.area / 2),
        ],
        { ...o, rotRandom: Math.max(o.rotRandom, 1) },
        instanceKey, 'Pile'),
    );
  }
  const record = makeRecord('pile', `Pile ×${o.count}`, o.seed,
    { count: o.count, area: o.area }, o.templateId, objects.map((x) => x.id));
  return { objects, record };
}

/* ─── Domino row (bonus satisfying preset) ───────────────────────────────── */

export interface DominoOpts extends GeneratorParams {
  count: number;
  spacing: number;
  curve: number;
}

export function bakeDominoes(
  template: ForgeObject,
  o: DominoOpts,
): BakeResult {
  const rng = new Rng(o.seed);
  const instanceKey = uid('inst');
  const objects: ForgeObject[] = [];
  for (let i = 0; i < o.count; i++) {
    const x = (i - (o.count - 1) / 2) * o.spacing;
    const z = Math.sin((i / Math.max(1, o.count - 1)) * Math.PI) * o.curve;
    const obj = cloneTemplate(template, rng, i, o.count, [x, 1, z],
      { ...o, rotRandom: 0 }, instanceKey, 'Domino');
    obj.transform.rotation = [0, 0, 0];
    objects.push(obj);
  }
  const record = makeRecord('grid', `Dominoes ×${o.count}`, o.seed,
    { count: o.count, spacing: o.spacing }, o.templateId,
    objects.map((x) => x.id));
  return { objects, record };
}
