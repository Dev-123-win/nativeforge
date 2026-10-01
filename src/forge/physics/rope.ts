/**
 * Rope & chain builder — segments + real Rapier joints, baked into the scene.
 *
 * A rope is N dynamic link bodies connected by spherical (ball) joints, with
 * an optional static pin anchor at the top. Chains use alternating torus
 * links with cheap sphere colliders (stable + fast at scale).
 */

import type {
  ForgeConstraint,
  ForgeObject,
  GeneratorRecord,
  Vec3,
} from '../core/types';
import {
  defaultCollider,
  defaultRigidBody,
  makeConstraint,
  makeObject,
  uid,
} from '../core/types';
import { presetToPhysical } from './materials';

export interface RopeOpts {
  count: number;
  segLength: number;
  radius: number;
  position: Vec3; // top attach point
  pinTop: boolean;
  linkType: 'capsule' | 'box' | 'ring';
  physicalKey: string;
  color: string;
  breakForce: number; // 0 = unbreakable
}

export const DEFAULT_ROPE_OPTS: RopeOpts = {
  count: 12,
  segLength: 0.4,
  radius: 0.06,
  position: [0, 6, 0],
  pinTop: true,
  linkType: 'capsule',
  physicalKey: 'steel',
  color: '#8a93a5',
  breakForce: 0,
};

export interface RopeBake {
  objects: ForgeObject[];
  joints: ForgeConstraint[];
  record: GeneratorRecord;
}

function makeLink(
  o: RopeOpts,
  index: number,
  y: number,
  instanceKey: string,
): ForgeObject {
  const link = makeObject(`Link ${index + 1}`, 'primitive');
  const phys = presetToPhysical(o.physicalKey);
  link.visual.baseColor = o.color;
  link.physical = { ...link.physical, ...phys };
  link.instanceKey = instanceKey;

  if (o.linkType === 'capsule') {
    const len = Math.max(0.05, o.segLength - o.radius * 2);
    link.geometry = { type: 'capsule', params: { radius: o.radius, length: len } };
    link.collider = defaultCollider({
      shape: 'capsule',
      radius: o.radius,
      height: o.segLength,
      friction: phys.friction,
      restitution: phys.restitution,
    });
  } else if (o.linkType === 'box') {
    link.geometry = {
      type: 'box',
      params: { width: o.radius * 2, height: o.segLength, depth: o.radius * 2 },
    };
    link.collider = defaultCollider({
      shape: 'box',
      halfExtents: [o.radius, o.segLength / 2, o.radius],
      friction: phys.friction,
      restitution: phys.restitution,
    });
  } else {
    // Ring: torus visual, sphere collider (convex of a ring is a blob and
    // trimesh rings are unstable in long chains — documented approximation).
    link.geometry = {
      type: 'torus',
      params: { radius: o.segLength * 0.32, tube: o.radius },
    };
    link.collider = defaultCollider({
      shape: 'sphere',
      radius: o.segLength * 0.38,
      friction: phys.friction,
      restitution: phys.restitution,
    });
    link.transform.rotation = [0, (index % 2) * (Math.PI / 2), 0];
  }
  link.rigidBody = defaultRigidBody({ density: phys.density });
  link.transform.position = [o.position[0], y, o.position[2]];
  return link;
}

export function bakeRope(opts: Partial<RopeOpts> = {}): RopeBake {
  const o: RopeOpts = { ...DEFAULT_ROPE_OPTS, ...opts };
  const count = Math.max(2, Math.min(200, Math.round(o.count)));
  const instanceKey = uid('inst');
  const objects: ForgeObject[] = [];
  const joints: ForgeConstraint[] = [];

  let topId: string | null = null;
  let topAnchor: Vec3 = [0, 0, 0];
  if (o.pinTop) {
    const anchor = makeObject('Rope Anchor', 'primitive');
    anchor.geometry = { type: 'box', params: { width: 0.3, height: 0.2, depth: 0.3 } };
    anchor.collider = defaultCollider({
      shape: 'box',
      halfExtents: [0.15, 0.1, 0.15],
    });
    anchor.rigidBody = defaultRigidBody({ bodyType: 'static' });
    anchor.transform.position = [...o.position];
    anchor.visual.baseColor = '#3a4358';
    objects.push(anchor);
    topId = anchor.id;
    topAnchor = [0, -0.1, 0];
  }

  let prevId = topId;
  let prevBottom: Vec3 = topAnchor;
  for (let i = 0; i < count; i++) {
    const y = o.position[1] - (o.pinTop ? 0.1 : 0) - (i + 0.5) * o.segLength;
    const link = makeLink(o, i, y, instanceKey);
    objects.push(link);
    if (prevId) {
      const j = makeConstraint(`Link ${i}`, 'ball', prevId, link.id);
      j.anchorA = [...prevBottom];
      j.anchorB = [0, o.segLength / 2, 0];
      j.breakForce = o.breakForce;
      joints.push(j);
    }
    prevId = link.id;
    prevBottom = [0, -o.segLength / 2, 0];
  }

  const record: GeneratorRecord = {
    id: uid('gen'),
    type: o.linkType === 'ring' ? 'chain' : 'rope',
    name: `${o.linkType === 'ring' ? 'Chain' : 'Rope'} ×${count}`,
    seed: 0,
    params: { count, segLength: o.segLength, radius: o.radius },
    templateId: o.linkType,
    generatedIds: objects.map((x) => x.id),
    generatedJoints: joints.map((j) => j.id),
  };
  return { objects, joints, record };
}

/** Convenience: a hanging chain with alternating steel rings. */
export function bakeChain(opts: Partial<RopeOpts> = {}): RopeBake {
  return bakeRope({
    linkType: 'ring',
    physicalKey: 'steel',
    color: '#b8c2cc',
    ...opts,
  });
}
