/**
 * Right panel — inspector with Basic / Advanced / Expert detail levels.
 * Tabs: Object · World · Events · Joints · Director · Render.
 * Every control is live-wired.
 */
import React from 'react';
import { useForge } from '../core/store';
import type {
  ActionType,
  CameraTrack,
  ConstraintType,
  DriverTrack,
  EasingName,
  ForgeObject,
  MotorTrack,
  TriggerType,
  UiLevel,
  Vec3,
} from '../core/types';
import {
  EASING_NAMES,
  makeCameraTrack,
  makeConstraint,
  makeDriverTrack,
  makeMotorTrack,
  uid,
} from '../core/types';
import {
  autoMass,
  colliderVolume,
  PHYSICAL_PRESETS,
  presetToPhysical,
} from '../physics/materials';
import { EXPORT_PRESETS } from '../presets';
import {
  ColorInput,
  Num,
  Section,
  Select,
  TextInput,
  Toggle,
  Vec3Input,
  visible,
} from './fields';

export interface RenderActions {
  downloadJson: () => void;
  copyCommand: () => void;
  downloadFrame: () => void;
}

export interface DriverPoseCapture {
  position: Vec3;
  rotation: Vec3;
}

export interface DirectorActions {
  goToFrame: (f: number) => void;
  captureCamera: () => import('../render/director').CameraPose | null;
  captureObjectPose: (objectId: string) => DriverPoseCapture | null;
}

type Tab = 'object' | 'world' | 'events' | 'joints' | 'director' | 'render';

export function Inspector(props: {
  renderActions: RenderActions;
  brokenJoints: string[];
  director: DirectorActions;
}) {
  const selection = useForge((s) => s.selection);
  const uiLevel = useForge((s) => s.uiLevel);
  const setUiLevel = useForge((s) => s.setUiLevel);
  const [tab, setTab] = React.useState<Tab>('object');

  return (
    <div className="forge-right">
      <div className="forge-level-tabs">
        {(['basic', 'advanced', 'expert'] as UiLevel[]).map((l) => (
          <button
            key={l}
            type="button"
            className={uiLevel === l ? 'active' : ''}
            onClick={() => setUiLevel(l)}
          >
            {l}
          </button>
        ))}
      </div>
      <div className="forge-inspector-tabs">
        {(['object', 'world', 'events', 'joints', 'director', 'render'] as Tab[]).map((t) => (
          <button
            key={t}
            type="button"
            className={tab === t ? 'active' : ''}
            onClick={() => setTab(t)}
          >
            {t}
          </button>
        ))}
      </div>
      <div className="forge-inspector-body">
        {tab === 'object' && <ObjectTab level={uiLevel} />}
        {tab === 'world' && <WorldTab level={uiLevel} />}
        {tab === 'events' && <EventsTab level={uiLevel} />}
        {tab === 'joints' && <JointsTab level={uiLevel} broken={props.brokenJoints} />}
        {tab === 'director' && <DirectorTab level={uiLevel} actions={props.director} />}
        {tab === 'render' && <RenderTab level={uiLevel} actions={props.renderActions} />}
      </div>
      {selection.length > 0 && tab === 'object' && <SelectionFooter />}
    </div>
  );
}

/* ─── Object tab ─────────────────────────────────────────────────────────── */

function ObjectTab({ level }: { level: UiLevel }) {
  const scene = useForge((s) => s.activeScene);
  const selection = useForge((s) => s.selection);
  const patchObject = useForge((s) => s.patchObject);

  if (!scene) return null;
  if (selection.length === 0) {
    return (
      <div className="forge-empty">
        <p>No object selected.</p>
        <p className="forge-hint">
          Click an object in the viewport, or add one from the left panel.
          World settings live under the <b>World</b> tab.
        </p>
        <SceneStats />
      </div>
    );
  }
  if (selection.length > 1) {
    return <MultiSelect ids={selection} />;
  }
  const obj = scene.objects.find((o) => o.id === selection[0]);
  if (!obj) return <div className="forge-empty">Selection no longer exists.</div>;
  const patch = (p: Partial<ForgeObject>) => patchObject(obj.id, p);

  return (
    <div>
      <div className="forge-obj-head">
        <TextInput label="Name" value={obj.name} onChange={(v) => patch({ name: v })} />
        <div className="forge-badges">
          <span className="forge-badge">{obj.kind}</span>
          <span className="forge-badge dim">{obj.geometry.type}</span>
          {obj.instanceKey && <span className="forge-badge inst">instanced</span>}
        </div>
      </div>

      <Section title="Transform" defaultOpen>
        <Vec3Input label="Position" value={obj.transform.position}
          onChange={(v) => patch({ transform: { ...obj.transform, position: v } })} />
        {visible('advanced', level) && (
          <>
            <Vec3Input label="Rotation" value={obj.transform.rotation}
              onChange={(v) => patch({ transform: { ...obj.transform, rotation: v } })} />
            <Vec3Input label="Scale" value={obj.transform.scale}
              onChange={(v) => patch({ transform: { ...obj.transform, scale: v } })} />
          </>
        )}
      </Section>

      {obj.rigidBody && (
        <BodySection obj={obj} patch={patch} level={level} />
      )}
      {obj.collider && (
        <ColliderSection obj={obj} patch={patch} level={level} />
      )}

      <Section title="Visual material">
        <ColorInput label="Base color" value={obj.visual.baseColor}
          onChange={(v) => patch({ visual: { ...obj.visual, baseColor: v } })} />
        {visible('advanced', level) && (
          <>
            <Num label="Metalness" value={obj.visual.metalness} min={0} max={1}
              onChange={(v) => patch({ visual: { ...obj.visual, metalness: v } })} />
            <Num label="Roughness" value={obj.visual.roughness} min={0} max={1}
              onChange={(v) => patch({ visual: { ...obj.visual, roughness: v } })} />
            <Num label="Opacity" value={obj.visual.opacity} min={0} max={1}
              onChange={(v) => patch({ visual: { ...obj.visual, opacity: v } })} />
            <Toggle label="Transparent" checked={obj.visual.transparent}
              onChange={(v) => patch({ visual: { ...obj.visual, transparent: v } })} />
          </>
        )}
        {visible('expert', level) && (
          <>
            <ColorInput label="Emissive" value={obj.visual.emissive}
              onChange={(v) => patch({ visual: { ...obj.visual, emissive: v } })} />
            <Num label="Emissive strength" value={obj.visual.emissiveIntensity} min={0} max={4}
              onChange={(v) => patch({ visual: { ...obj.visual, emissiveIntensity: v } })} />
          </>
        )}
      </Section>

      <Section title="Physical material">
        <Select label="Preset" value={obj.physical.preset}
          options={Object.values(PHYSICAL_PRESETS).map((p) => ({ value: p.key, label: p.label }))}
          onChange={(v) => {
            const phys = presetToPhysical(v);
            patch({
              physical: phys,
              collider: obj.collider
                ? { ...obj.collider, friction: phys.friction, restitution: phys.restitution }
                : obj.collider,
              rigidBody: obj.rigidBody
                ? { ...obj.rigidBody, density: phys.density }
                : obj.rigidBody,
            });
          }} />
        {visible('expert', level) && (
          <>
            <Num label="Density" value={obj.physical.density} min={1} max={20000} unit="kg/m³"
              onChange={(v) => patch({ physical: { ...obj.physical, preset: 'custom', density: v } })} />
            <Num label="Friction" value={obj.physical.friction} min={0} max={2}
              onChange={(v) => patch({ physical: { ...obj.physical, preset: 'custom', friction: v } })} />
            <Num label="Restitution" value={obj.physical.restitution} min={0} max={1.2}
              onChange={(v) => patch({ physical: { ...obj.physical, preset: 'custom', restitution: v } })} />
            <Num label="Elasticity" value={obj.physical.elasticity} min={0} max={1}
              onChange={(v) => patch({ physical: { ...obj.physical, preset: 'custom', elasticity: v } })} />
            <Num label="Hardness" value={obj.physical.hardness} min={0} max={1}
              onChange={(v) => patch({ physical: { ...obj.physical, preset: 'custom', hardness: v } })} />
            <Num label="Adhesion" value={obj.physical.adhesion} min={0} max={1}
              onChange={(v) => patch({ physical: { ...obj.physical, preset: 'custom', adhesion: v } })} />
          </>
        )}
      </Section>

      {visible('advanced', level) && (
        <Section title="Constant force">
          <Vec3Input label="Force (N)" value={obj.constantForce}
            onChange={(v) => patch({ constantForce: v })} />
          <Vec3Input label="Torque (N·m)" value={obj.constantTorque}
            onChange={(v) => patch({ constantTorque: v })} />
        </Section>
      )}

      {obj.field && <FieldSection obj={obj} patch={patch} level={level} />}
      {obj.balloon && <BalloonSection obj={obj} patch={patch} level={level} />}
      {obj.collider && <BreakableSection obj={obj} patch={patch} level={level} />}
      {obj.emitter && <EmitterSection obj={obj} patch={patch} level={level} />}
      {obj.machine && <MachineSection obj={obj} patch={patch} level={level} />}
      {obj.pressure && <PressureSection obj={obj} patch={patch} />}
      {visible('advanced', level) && <CustomVars obj={obj} patch={patch} />}
    </div>
  );
}

function BodySection({ obj, patch, level }: {
  obj: ForgeObject;
  patch: (p: Partial<ForgeObject>) => void;
  level: UiLevel;
}) {
  const rb = obj.rigidBody!;
  const set = (p: Partial<typeof rb>) => patch({ rigidBody: { ...rb, ...p } });
  const vol = obj.collider
    ? colliderVolume(obj.collider.shape,
      [obj.collider.halfExtents[0] * obj.transform.scale[0],
       obj.collider.halfExtents[1] * obj.transform.scale[1],
       obj.collider.halfExtents[2] * obj.transform.scale[2]],
      obj.collider.radius * Math.max(obj.transform.scale[0], obj.transform.scale[2]),
      obj.collider.height * obj.transform.scale[1])
    : 1;
  const mass = rb.massMode === 'auto' ? autoMass(rb.density, vol) : rb.mass;
  return (
    <Section title="Rigid body" defaultOpen>
      <Select label="Body type" value={rb.bodyType}
        options={['static', 'dynamic', 'kinematic', 'sensor']}
        onChange={(v) => set({ bodyType: v as typeof rb.bodyType })} />
      <div className="forge-mass-line">
        Mass <b>{mass.toFixed(3)} kg</b>
        <span className="dim">· vol {vol.toFixed(4)} m³</span>
      </div>
      {visible('advanced', level) && (
        <>
          <Select label="Mass mode" value={rb.massMode}
            options={[{ value: 'auto', label: 'Auto (density × volume)' }, { value: 'override', label: 'Override' }]}
            onChange={(v) => set({ massMode: v as 'auto' | 'override' })} />
          {rb.massMode === 'override' ? (
            <Num label="Mass" value={rb.mass} min={0.001} max={100000} unit="kg"
              onChange={(v) => set({ mass: v })} />
          ) : (
            <Num label="Density" value={rb.density} min={1} max={20000} unit="kg/m³"
              onChange={(v) => set({ density: v })} />
          )}
          <Num label="Gravity scale" value={rb.gravityScale} min={-2} max={5}
            onChange={(v) => set({ gravityScale: v })} />
          <Num label="Linear damping" value={rb.linearDamping} min={0} max={5}
            onChange={(v) => set({ linearDamping: v })} />
          <Num label="Angular damping" value={rb.angularDamping} min={0} max={5}
            onChange={(v) => set({ angularDamping: v })} />
          <Vec3Input label="Initial velocity" value={rb.linvel}
            onChange={(v) => set({ linvel: v })} />
          <Vec3Input label="Initial spin" value={rb.angvel}
            onChange={(v) => set({ angvel: v })} />
        </>
      )}
      {visible('expert', level) && (
        <>
          <Toggle label="Enabled" checked={rb.enabled} onChange={(v) => set({ enabled: v })} />
          <Toggle label="Can sleep" checked={rb.canSleep} onChange={(v) => set({ canSleep: v })} />
          <Toggle label="Start asleep" checked={rb.sleeping} onChange={(v) => set({ sleeping: v })} />
          <Toggle label="CCD" checked={rb.ccd} onChange={(v) => set({ ccd: v })} />
          <Num label="Max speed" value={rb.maxLinvel} min={0} max={200} unit="m/s"
            onChange={(v) => set({ maxLinvel: v })} />
          <Num label="Max spin" value={rb.maxAngvel} min={0} max={200} unit="rad/s"
            onChange={(v) => set({ maxAngvel: v })} />
          <LockRow label="Lock position" value={rb.lockTranslation}
            onChange={(v) => set({ lockTranslation: v })} />
          <LockRow label="Lock rotation" value={rb.lockRotation}
            onChange={(v) => set({ lockRotation: v })} />
          <Num label="Memberships" value={rb.memberships} min={1} max={65535} step={1}
            onChange={(v) => set({ memberships: Math.round(v) })} />
          <Num label="Collide with" value={rb.filters} min={0} max={65535} step={1}
            onChange={(v) => set({ filters: Math.round(v) })} />
        </>
      )}
    </Section>
  );
}

function LockRow({ label, value, onChange }: {
  label: string;
  value: [boolean, boolean, boolean];
  onChange: (v: [boolean, boolean, boolean]) => void;
}) {
  return (
    <div className="forge-field">
      <span className="forge-label">{label}</span>
      <span className="forge-lock-row">
        {(['X', 'Y', 'Z'] as const).map((axis, i) => (
          <button
            key={axis}
            type="button"
            className={`forge-btn small ${value[i] ? 'warn' : ''}`}
            onClick={() => {
              const v: [boolean, boolean, boolean] = [...value] as [boolean, boolean, boolean];
              v[i] = !v[i];
              onChange(v);
            }}
          >
            {axis}
          </button>
        ))}
      </span>
    </div>
  );
}

function ColliderSection({ obj, patch, level }: {
  obj: ForgeObject;
  patch: (p: Partial<ForgeObject>) => void;
  level: UiLevel;
}) {
  const c = obj.collider!;
  const set = (p: Partial<typeof c>) => patch({ collider: { ...c, ...p } });
  return (
    <Section title="Collision">
      {visible('advanced', level) ? (
        <Select label="Shape" value={c.shape}
          options={['sphere', 'box', 'capsule', 'cylinder', 'cone', 'convex', 'trimesh']}
          onChange={(v) => set({ shape: v as typeof c.shape })} />
      ) : (
        <div className="forge-mass-line">Shape <b>{c.shape}</b></div>
      )}
      <Num label="Friction" value={c.friction} min={0} max={2}
        onChange={(v) => set({ friction: v })} />
      <Num label="Bounce" value={c.restitution} min={0} max={1.2}
        onChange={(v) => set({ restitution: v })} />
      {visible('advanced', level) && (
        <>
          <Toggle label="Sensor (trigger only)" checked={c.sensor}
            onChange={(v) => set({ sensor: v })} />
          <Num label="Sharpness" value={c.sharpness} min={0} max={1}
            onChange={(v) => set({ sharpness: v })} />
        </>
      )}
      {visible('expert', level) && (
        <>
          <Select label="Friction combine" value={c.frictionCombine}
            options={['average', 'min', 'max', 'multiply']}
            onChange={(v) => set({ frictionCombine: v as typeof c.frictionCombine })} />
          <Select label="Bounce combine" value={c.restitutionCombine}
            options={['average', 'min', 'max', 'multiply']}
            onChange={(v) => set({ restitutionCombine: v as typeof c.restitutionCombine })} />
          <Vec3Input label="Offset" value={c.offset}
            onChange={(v) => set({ offset: v })} />
          <Vec3Input label="Collider rotation" value={c.rotation}
            onChange={(v) => set({ rotation: v })} />
          <Num label="Rolling resistance" value={c.rollingResistance} min={0} max={2}
            onChange={(v) => set({ rollingResistance: v })} />
        </>
      )}
    </Section>
  );
}

function FieldSection({ obj, patch, level }: {
  obj: ForgeObject;
  patch: (p: Partial<ForgeObject>) => void;
  level: UiLevel;
}) {
  const f = obj.field!;
  const set = (p: Partial<typeof f>) => patch({ field: { ...f, ...p } });
  return (
    <Section title="Force field" defaultOpen>
      <Select label="Kind" value={f.kind}
        options={['attractor', 'repulsor', 'vortex', 'wind', 'wave', 'turbulence', 'directional']}
        onChange={(v) => set({ kind: v as typeof f.kind })} />
      <Toggle label="Enabled" checked={f.enabled} onChange={(v) => set({ enabled: v })} />
      <Num label="Strength" value={f.strength} min={0} max={500} unit="N"
        onChange={(v) => set({ strength: v })} />
      <Num label="Radius" value={f.radius} min={0.5} max={40} unit="m"
        onChange={(v) => set({ radius: v })} />
      {visible('advanced', level) && (
        <>
          <Num label="Falloff" value={f.falloff} min={0} max={4}
            onChange={(v) => set({ falloff: v })} />
          <Vec3Input label="Direction" value={f.direction}
            onChange={(v) => set({ direction: v })} />
          <Num label="Frequency" value={f.frequency} min={0} max={10} unit="Hz"
            onChange={(v) => set({ frequency: v })} />
          <Num label="Turbulence" value={f.turbulence} min={0} max={2}
            onChange={(v) => set({ turbulence: v })} />
        </>
      )}
    </Section>
  );
}

function BalloonSection({ obj, patch, level }: {
  obj: ForgeObject;
  patch: (p: Partial<ForgeObject>) => void;
  level: UiLevel;
}) {
  const b = obj.balloon!;
  const set = (p: Partial<typeof b>) => patch({ balloon: { ...b, ...p } });
  void level;
  return (
    <Section title="Balloon" defaultOpen>
      <Num label="Pressure" value={b.pressure} min={0} max={500000} step={1000} unit="Pa"
        onChange={(v) => set({ pressure: v })} />
      <Num label="Burst at" value={b.maxPressure} min={10000} max={1000000} step={1000} unit="Pa"
        onChange={(v) => set({ maxPressure: v })} />
      <Num label="Skin fragments" value={b.fragmentCount} min={4} max={40} step={1}
        onChange={(v) => set({ fragmentCount: Math.round(v) })} />
      <p className="forge-hint">
        Touching a sharp (sharpness ≥ 0.5) collider tip pops the balloon.
      </p>
    </Section>
  );
}

function BreakableSection({ obj, patch, level }: {
  obj: ForgeObject;
  patch: (p: Partial<ForgeObject>) => void;
  level: UiLevel;
}) {
  const b = obj.breakable ?? {
    enabled: false, fractured: false, mode: 'radial' as const,
    fragmentCount: 10, breakImpulse: 30, fragmentSpread: 2, fragmentScale: 1,
  };
  const set = (p: Partial<typeof b>) => patch({ breakable: { ...b, ...p } });
  void level;
  return (
    <Section title="Fracture">
      <Toggle label="Breakable" checked={b.enabled} onChange={(v) => set({ enabled: v })} />
      {b.enabled && (
        <>
          <Select label="Pattern" value={b.mode}
            options={['grid', 'radial', 'random', 'voronoi-lite']}
            onChange={(v) => set({ mode: v as typeof b.mode })} />
          <Num label="Fragments" value={b.fragmentCount} min={2} max={64} step={1}
            onChange={(v) => set({ fragmentCount: Math.round(v) })} />
          <Num label="Break impulse" value={b.breakImpulse} min={1} max={1000}
            onChange={(v) => set({ breakImpulse: v })} />
          <Num label="Spread" value={b.fragmentSpread} min={0} max={20} unit="m/s"
            onChange={(v) => set({ fragmentSpread: v })} />
        </>
      )}
    </Section>
  );
}

function EmitterSection({ obj, patch, level }: {
  obj: ForgeObject;
  patch: (p: Partial<ForgeObject>) => void;
  level: UiLevel;
}) {
  const e = obj.emitter!;
  const set = (p: Partial<typeof e>) => patch({ emitter: { ...e, ...p } });
  void level;
  return (
    <Section title="Emitter" defaultOpen>
      <Toggle label="Enabled" checked={e.enabled} onChange={(v) => set({ enabled: v })} />
      <Select label="Shape" value={e.shape}
        options={['point', 'line', 'circle', 'rectangle', 'sphere', 'box', 'cone']}
        onChange={(v) => set({ shape: v as typeof e.shape })} />
      <TextInput label="Template id" value={e.templateId}
        onChange={(v) => set({ templateId: v })} />
      <Num label="Rate" value={e.rate} min={0} max={500} unit="/s"
        onChange={(v) => set({ rate: v })} />
      <Num label="Burst" value={e.burst} min={0} max={5000} step={1}
        onChange={(v) => set({ burst: Math.round(v) })} />
      <Num label="Total (0 ∞)" value={e.count} min={0} max={20000} step={1}
        onChange={(v) => set({ count: Math.round(v) })} />
      <Num label="Start" value={e.startTime} min={0} max={120} unit="s"
        onChange={(v) => set({ startTime: v })} />
      <Num label="End" value={e.endTime} min={0} max={300} unit="s"
        onChange={(v) => set({ endTime: v })} />
      <Num label="Max alive" value={e.maxAlive} min={1} max={20000} step={1}
        onChange={(v) => set({ maxAlive: Math.round(v) })} />
      <Vec3Input label="Velocity" value={e.initialVelocity}
        onChange={(v) => set({ initialVelocity: v })} />
      <Num label="Spread" value={e.spread} min={0} max={1}
        onChange={(v) => set({ spread: v })} />
    </Section>
  );
}

function MachineSection({ obj, patch, level }: {
  obj: ForgeObject;
  patch: (p: Partial<ForgeObject>) => void;
  level: UiLevel;
}) {
  const m = obj.machine!;
  const set = (p: Partial<typeof m>) => patch({ machine: { ...m, ...p } });
  void level;
  return (
    <Section title="Machine" defaultOpen>
      <Select label="Kind" value={m.kind}
        options={['press', 'piston', 'hammer', 'conveyor', 'spinner', 'gate', 'platform', 'wheel']}
        onChange={(v) => set({ kind: v as typeof m.kind })} />
      <Toggle label="Enabled" checked={m.enabled} onChange={(v) => set({ enabled: v })} />
      <Num label="Speed" value={m.speed} min={0} max={30}
        onChange={(v) => set({ speed: v })} />
      <Num label="Stroke" value={m.stroke} min={0} max={20} unit="m"
        onChange={(v) => set({ stroke: v })} />
      <Num label="Cycle" value={m.cycleTime} min={0.1} max={60} unit="s"
        onChange={(v) => set({ cycleTime: v })} />
      <Vec3Input label="Direction" value={m.direction}
        onChange={(v) => set({ direction: v })} />
      <Num label="Start at" value={m.startTime} min={0} max={300} unit="s"
        onChange={(v) => set({ startTime: v })} />
    </Section>
  );
}

function PressureSection({ obj, patch }: {
  obj: ForgeObject;
  patch: (p: Partial<ForgeObject>) => void;
}) {
  const p = obj.pressure!;
  const set = (q: Partial<typeof p>) => patch({ pressure: { ...p, ...q } });
  return (
    <Section title="Pressure vessel" defaultOpen>
      <Num label="Internal" value={p.internal} min={0} max={2000000} step={1000} unit="Pa"
        onChange={(v) => set({ internal: v })} />
      <Num label="Volume" value={p.volume} min={0.01} max={100} unit="m³"
        onChange={(v) => set({ volume: v })} />
      <Num label="Leak" value={p.leak} min={0} max={100000} step={100} unit="Pa/s"
        onChange={(v) => set({ leak: v })} />
      <Num label="Vent above" value={p.releaseThreshold} min={0} max={2000000} step={1000} unit="Pa"
        onChange={(v) => set({ releaseThreshold: v })} />
      <Vec3Input label="Vent dir" value={p.ventDirection}
        onChange={(v) => set({ ventDirection: v })} />
    </Section>
  );
}

function CustomVars({ obj, patch }: {
  obj: ForgeObject;
  patch: (p: Partial<ForgeObject>) => void;
}) {
  const [name, setName] = React.useState('');
  return (
    <Section title="Custom variables">
      {obj.customVars.map((v, i) => (
        <div key={`${v.name}-${i}`} className="forge-customvar">
          <code>{v.name}</code>
          <input
            type="number"
            className="forge-num"
            value={v.value}
            onChange={(e) => {
              const n = Number(e.target.value);
              if (!Number.isFinite(n)) return;
              const vars = obj.customVars.slice();
              vars[i] = { ...v, value: n };
              patch({ customVars: vars });
            }}
          />
          <span className="dim">{v.unit}</span>
          <button
            type="button"
            className="forge-btn small danger"
            onClick={() => patch({ customVars: obj.customVars.filter((_, j) => j !== i) })}
          >
            ×
          </button>
        </div>
      ))}
      <div className="forge-customvar">
        <input
          type="text"
          className="forge-text"
          placeholder="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <button
          type="button"
          className="forge-btn small"
          onClick={() => {
            if (!name.trim()) return;
            patch({
              customVars: [...obj.customVars, { name: name.trim(), value: 0, min: 0, max: 1, unit: '' }],
            });
            setName('');
          }}
        >
          + Add
        </button>
      </div>
    </Section>
  );
}

function MultiSelect({ ids }: { ids: string[] }) {
  const removeObjects = useForge((s) => s.removeObjects);
  const duplicateObjects = useForge((s) => s.duplicateObjects);
  const setSelection = useForge((s) => s.setSelection);
  return (
    <div className="forge-empty">
      <p>{ids.length} objects selected</p>
      <div className="forge-actions">
        <button type="button" className="forge-btn small" onClick={() => duplicateObjects(ids)}>
          Duplicate
        </button>
        <button type="button" className="forge-btn small danger" onClick={() => removeObjects(ids)}>
          Delete
        </button>
        <button type="button" className="forge-btn small" onClick={() => setSelection([])}>
          Clear
        </button>
      </div>
    </div>
  );
}

function SelectionFooter() {
  const selection = useForge((s) => s.selection);
  const removeObjects = useForge((s) => s.removeObjects);
  const duplicateObjects = useForge((s) => s.duplicateObjects);
  return (
    <div className="forge-inspector-footer">
      <button type="button" className="forge-btn small" onClick={() => duplicateObjects(selection)}>
        Duplicate ⧉
      </button>
      <button type="button" className="forge-btn small danger" onClick={() => removeObjects(selection)}>
        Delete ⌫
      </button>
    </div>
  );
}

function SceneStats() {
  const scene = useForge((s) => s.activeScene);
  if (!scene) return null;
  const dyn = scene.objects.filter((o) => o.rigidBody?.bodyType === 'dynamic').length;
  return (
    <div className="forge-stat-list">
      <div><span>Objects</span><b>{scene.objects.length}</b></div>
      <div><span>Dynamic bodies</span><b>{dyn}</b></div>
      <div><span>Events</span><b>{scene.events.length}</b></div>
      <div><span>Generators</span><b>{scene.generators.length}</b></div>
      <div><span>Seed</span><b>{scene.seed}</b></div>
    </div>
  );
}

/* ─── World tab ──────────────────────────────────────────────────────────── */

function WorldTab({ level }: { level: UiLevel }) {
  const scene = useForge((s) => s.activeScene);
  const patchWorld = useForge((s) => s.patchWorld);
  const setSeed = useForge((s) => s.setSeed);
  if (!scene) return null;
  const w = scene.world;
  const setGravityPreset = (preset: typeof w.gravityPreset) => {
    const g: Vec3 =
      preset === 'earth' ? [0, -9.81, 0]
      : preset === 'moon' ? [0, -1.62, 0]
      : preset === 'mars' ? [0, -3.71, 0]
      : preset === 'zero' ? [0, 0, 0]
      : w.gravity;
    patchWorld({ gravityPreset: preset, gravity: g });
  };
  return (
    <div>
      <Section title="Gravity" defaultOpen>
        <Select label="Preset" value={w.gravityPreset}
          options={['earth', 'moon', 'mars', 'zero', 'custom']}
          onChange={(v) => setGravityPreset(v as typeof w.gravityPreset)} />
        <Vec3Input label="Vector" value={w.gravity}
          onChange={(v) => patchWorld({ gravity: v, gravityPreset: 'custom' })} />
      </Section>
      <Section title="Time & solver" defaultOpen>
        <Num label="Sim rate" value={w.simFps} min={30} max={240} step={1} unit="Hz"
          onChange={(v) => patchWorld({ simFps: Math.round(v) })} />
        {visible('advanced', level) && (
          <>
            <Num label="Render rate" value={w.renderFps} min={24} max={120} step={1} unit="fps"
              onChange={(v) => patchWorld({ renderFps: Math.round(v) })} />
            <Num label="Substeps" value={w.substeps} min={1} max={8} step={1}
              onChange={(v) => patchWorld({ substeps: Math.round(v) })} />
            <Num label="Solver iterations" value={w.solverIterations} min={1} max={32} step={1}
              onChange={(v) => patchWorld({ solverIterations: Math.round(v) })} />
            <Num label="Time scale" value={w.timeScale} min={0.05} max={4}
              onChange={(v) => patchWorld({ timeScale: v })} />
          </>
        )}
        {visible('expert', level) && (
          <Num label="Max timestep" value={w.maxTimestep} min={1 / 240} max={1 / 10} step={0.001} unit="s"
            onChange={(v) => patchWorld({ maxTimestep: v })} />
        )}
        <Toggle label="Deterministic mode" checked={w.deterministic}
          onChange={(v) => patchWorld({ deterministic: v })} />
        <p className="forge-hint">
          Deterministic = fixed timestep + seeded streams. Bit-identical replay
          is guaranteed per platform/WASM build.
        </p>
      </Section>
      <Section title="Atmosphere">
        <Toggle label="Vacuum" checked={w.vacuum} onChange={(v) => patchWorld({ vacuum: v })} />
        {!w.vacuum && (
          <>
            <Num label="Air density" value={w.airDensity} min={0} max={10} unit="kg/m³"
              onChange={(v) => patchWorld({ airDensity: v })} />
            <Vec3Input label="Wind" value={w.wind} onChange={(v) => patchWorld({ wind: v })} />
            <Num label="Turbulence" value={w.turbulence} min={0} max={2}
              onChange={(v) => patchWorld({ turbulence: v })} />
          </>
        )}
      </Section>
      <Section title="Seed">
        <Num label="Scene seed" value={scene.seed} min={1} max={999999999} step={1}
          onChange={(v) => setSeed(Math.round(v))} />
        <button
          type="button"
          className="forge-btn small"
          onClick={() => setSeed(Math.floor(Math.random() * 999999999) + 1)}
        >
          🎲 New variation
        </button>
        <p className="forge-hint">Same seed + same scene = same simulation.</p>
      </Section>
    </div>
  );
}

/* ─── Events tab ─────────────────────────────────────────────────────────── */

const TRIGGER_TYPES: TriggerType[] = ['time', 'collision', 'impact', 'velocity', 'height', 'pressure', 'distance', 'random'];
const ACTION_TYPES: ActionType[] = ['spawn', 'delete', 'impulse', 'force', 'setPressure', 'break', 'pop', 'setGravity', 'setCamera', 'sound', 'particles', 'toggle', 'motor'];

function EventsTab({ level }: { level: UiLevel }) {
  const scene = useForge((s) => s.activeScene);
  const upsertEvent = useForge((s) => s.upsertEvent);
  const removeEvent = useForge((s) => s.removeEvent);
  void level;
  if (!scene) return null;
  const objOptions = [{ value: '', label: '(none)' },
    ...scene.objects.map((o) => ({ value: o.id, label: `${o.name} (${o.id.slice(-4)})` }))];
  return (
    <div>
      {scene.events.map((ev) => (
        <div key={ev.id} className="forge-event-card">
          <div className="forge-event-head">
            <input
              type="text"
              className="forge-text"
              value={ev.name}
              onChange={(e) => upsertEvent({ ...ev, name: e.target.value })}
            />
            <button
              type="button"
              className={`forge-btn small ${ev.enabled ? '' : 'dim'}`}
              onClick={() => upsertEvent({ ...ev, enabled: !ev.enabled })}
            >
              {ev.enabled ? 'on' : 'off'}
            </button>
            <button
              type="button"
              className="forge-btn small danger"
              onClick={() => removeEvent(ev.id)}
            >
              ×
            </button>
          </div>
          {ev.fired && <span className="forge-badge inst">fired</span>}
          <Select label="When" value={ev.trigger.type}
            options={TRIGGER_TYPES}
            onChange={(v) => upsertEvent({ ...ev, trigger: { ...ev.trigger, type: v as TriggerType } })} />
          {(ev.trigger.type === 'collision' || ev.trigger.type === 'impact' ||
            ev.trigger.type === 'velocity' || ev.trigger.type === 'height' ||
            ev.trigger.type === 'pressure' || ev.trigger.type === 'distance') && (
            <Select label="Object A" value={ev.trigger.objectA ?? ''}
              options={objOptions}
              onChange={(v) => upsertEvent({ ...ev, trigger: { ...ev.trigger, objectA: v || null } })} />
          )}
          {(ev.trigger.type === 'collision' || ev.trigger.type === 'impact' ||
            ev.trigger.type === 'distance') && (
            <Select label="Object B" value={ev.trigger.objectB ?? ''}
              options={objOptions}
              onChange={(v) => upsertEvent({ ...ev, trigger: { ...ev.trigger, objectB: v || null } })} />
          )}
          {ev.trigger.type === 'time' && (
            <Num label="At" value={ev.trigger.time} min={0} max={300} unit="s"
              onChange={(v) => upsertEvent({ ...ev, trigger: { ...ev.trigger, time: v } })} />
          )}
          {['impact', 'velocity', 'height', 'pressure', 'distance'].includes(ev.trigger.type) && (
            <Num label="Threshold" value={ev.trigger.threshold} min={0} max={1000000}
              onChange={(v) => upsertEvent({ ...ev, trigger: { ...ev.trigger, threshold: v } })} />
          )}
          {ev.trigger.type === 'random' && (
            <Num label="Probability/s" value={ev.trigger.probability} min={0} max={1}
              onChange={(v) => upsertEvent({ ...ev, trigger: { ...ev.trigger, probability: v } })} />
          )}
          <Select label="Do" value={ev.action.type}
            options={ACTION_TYPES}
            onChange={(v) => upsertEvent({ ...ev, action: { ...ev.action, type: v as ActionType } })} />
          {['delete', 'impulse', 'force', 'setPressure', 'break', 'pop', 'toggle', 'motor', 'spawn', 'particles'].includes(ev.action.type) && (
            <Select label="Target" value={ev.action.targetId ?? ''}
              options={objOptions}
              onChange={(v) => upsertEvent({ ...ev, action: { ...ev.action, targetId: v || null } })} />
          )}
          {['impulse', 'force', 'setGravity'].includes(ev.action.type) && (
            <Vec3Input label="Vector" value={ev.action.vector}
              onChange={(v) => upsertEvent({ ...ev, action: { ...ev.action, vector: v } })} />
          )}
          {['setPressure', 'particles', 'sound', 'motor'].includes(ev.action.type) && (
            <Num label="Amount" value={ev.action.scalar} min={0} max={2000000}
              onChange={(v) => upsertEvent({ ...ev, action: { ...ev.action, scalar: v } })} />
          )}
          {['spawn', 'sound'].includes(ev.action.type) && (
            <TextInput label={ev.action.type === 'spawn' ? 'Template id' : 'Sound name'}
              value={ev.action.presetId ?? ''}
              placeholder={ev.action.type === 'spawn' ? 'ball-rubber' : 'pop'}
              onChange={(v) => upsertEvent({ ...ev, action: { ...ev.action, presetId: v } })} />
          )}
          {ev.action.type === 'setCamera' && (
            <Select label="Camera" value={ev.action.targetId ?? ''}
              options={scene.cameras.map((c) => ({ value: c.id, label: c.name }))}
              onChange={(v) => upsertEvent({ ...ev, action: { ...ev.action, targetId: v || null } })} />
          )}
        </div>
      ))}
      <button
        type="button"
        className="forge-btn"
        onClick={() => upsertEvent({
          id: uid('evt'), name: `Event ${scene.events.length + 1}`,
          enabled: true, fired: false,
          trigger: { type: 'time', objectA: null, objectB: null, time: 1, threshold: 0, probability: 0 },
          action: { type: 'sound', targetId: null, vector: [0, 0, 0], scalar: 1, presetId: 'blip' },
        })}
      >
        + Add event
      </button>
    </div>
  );
}

/* ─── Render tab ─────────────────────────────────────────────────────────── */

function RenderTab({ level, actions }: { level: UiLevel; actions: RenderActions }) {
  const scene = useForge((s) => s.activeScene);
  const patchRender = useForge((s) => s.patchRender);
  const patchCamera = useForge((s) => s.patchCamera);
  const patchLight = useForge((s) => s.patchLight);
  const setActiveCamera = useForge((s) => s.setActiveCamera);
  if (!scene) return null;
  const r = scene.render;
  return (
    <div>
      <Section title="Format" defaultOpen>
        <div className="forge-preset-grid">
          {EXPORT_PRESETS.map((p) => (
            <button
              key={p.key}
              type="button"
              className={`forge-btn small ${r.preset === p.key ? 'primary' : ''}`}
              onClick={() => patchRender({
                preset: p.key, width: p.width, height: p.height,
                fps: p.fps, bitrate: p.bitrate,
              })}
            >
              {p.label}
            </button>
          ))}
        </div>
        <Num label="Width" value={r.width} min={64} max={7680} step={2} unit="px"
          onChange={(v) => patchRender({ width: Math.round(v), preset: 'custom' })} />
        <Num label="Height" value={r.height} min={64} max={7680} step={2} unit="px"
          onChange={(v) => patchRender({ height: Math.round(v), preset: 'custom' })} />
        <Num label="FPS" value={r.fps} min={1} max={120} step={1}
          onChange={(v) => patchRender({ fps: Math.round(v) })} />
        <Num label="Duration" value={r.durationFrames} min={1} max={60000} step={1} unit="fr"
          onChange={(v) => patchRender({ durationFrames: Math.round(v) })} />
        <Num label="Record from" value={r.recordStart} min={0} max={r.durationFrames} step={1} unit="fr"
          onChange={(v) => patchRender({ recordStart: Math.round(v) })} />
        <Num label="Record to" value={r.recordEnd} min={1} max={r.durationFrames} step={1} unit="fr"
          onChange={(v) => patchRender({ recordEnd: Math.round(v) })} />
        {visible('advanced', level) && (
          <>
            <TextInput label="Bitrate" value={r.bitrate}
              onChange={(v) => patchRender({ bitrate: v })} />
            <Select label="Quality" value={r.quality}
              options={['draft', 'medium', 'high', 'ultra']}
              onChange={(v) => patchRender({ quality: v as typeof r.quality })} />
          </>
        )}
        <div className="forge-mass-line">
          Output <b>{r.width}×{r.height}</b> · {(r.recordEnd - r.recordStart) / r.fps}s ·{' '}
          {r.recordEnd - r.recordStart} frames
        </div>
      </Section>

      <Section title="Export MP4" defaultOpen>
        <p className="forge-hint">
          Final video renders through the Electron + FFmpeg pipeline
          (frame-accurate, deterministic).
        </p>
        <div className="forge-actions col">
          <button type="button" className="forge-btn primary" onClick={actions.downloadJson}>
            ⬇ Download scene file
          </button>
          <button type="button" className="forge-btn" onClick={actions.copyCommand}>
            ⧉ Copy render command
          </button>
          <button type="button" className="forge-btn" onClick={actions.downloadFrame}>
            🖼 Export current frame PNG
          </button>
        </div>
        <code className="forge-cmd">
          npx motionflow render-forge ./scene.forge.json --output out/clip.mp4
        </code>
      </Section>

      <Section title="Cameras">
        {scene.cameras.map((c) => (
          <div key={c.id} className="forge-event-card">
            <div className="forge-event-head">
              <b>{c.name}</b>
              <button
                type="button"
                className={`forge-btn small ${scene.activeCameraId === c.id ? 'primary' : ''}`}
                onClick={() => setActiveCamera(c.id)}
              >
                {scene.activeCameraId === c.id ? 'active' : 'use'}
              </button>
            </div>
            <Vec3Input label="Position" value={c.position}
              onChange={(v) => patchCamera(c.id, { position: v })} />
            <Vec3Input label="Target" value={c.target}
              onChange={(v) => patchCamera(c.id, { target: v })} />
            <Num label="FOV" value={c.fov} min={10} max={120}
              onChange={(v) => patchCamera(c.id, { fov: v })} />
            {visible('advanced', level) && (
              <Num label="Shake" value={c.shake} min={0} max={2}
                onChange={(v) => patchCamera(c.id, { shake: v })} />
            )}
          </div>
        ))}
      </Section>

      <Section title="Lights">
        {scene.lights.map((l) => (
          <div key={l.id} className="forge-event-card">
            <div className="forge-event-head">
              <b>{l.name}</b>
              <span className="forge-badge dim">{l.kind}</span>
            </div>
            <Num label="Intensity" value={l.intensity} min={0} max={10}
              onChange={(v) => patchLight(l.id, { intensity: v })} />
            <ColorInput label="Color" value={l.color}
              onChange={(v) => patchLight(l.id, { color: v })} />
            {visible('advanced', level) && (
              <>
                <Vec3Input label="Position" value={l.position}
                  onChange={(v) => patchLight(l.id, { position: v })} />
                <Toggle label="Shadows" checked={l.castShadow}
                  onChange={(v) => patchLight(l.id, { castShadow: v })} />
              </>
            )}
          </div>
        ))}
      </Section>
    </div>
  );
}


/* ─── Joints tab ─────────────────────────────────────────────────────────── */

const CONSTRAINT_TYPES: ConstraintType[] = [
  'fixed', 'distance', 'hinge', 'slider', 'spring', 'ball', 'rope',
];

function JointsTab({ level, broken }: { level: UiLevel; broken: string[] }) {
  const scene = useForge((s) => s.activeScene);
  const selection = useForge((s) => s.selection);
  const upsertConstraint = useForge((s) => s.upsertConstraint);
  const removeConstraint = useForge((s) => s.removeConstraint);
  const [linkType, setLinkType] = React.useState<ConstraintType>('distance');
  if (!scene) return null;
  const brokenSet = new Set(broken);
  const objOptions = scene.objects.map((o) => ({
    value: o.id, label: `${o.name} (${o.id.slice(-4)})`,
  }));

  const linkSelected = () => {
    if (selection.length !== 2) return;
    const [a, b] = selection
      .map((id) => scene.objects.find((o) => o.id === id))
      .filter((x): x is ForgeObject => !!x);
    if (!a || !b) return;
    const dx = a.transform.position[0] - b.transform.position[0];
    const dy = a.transform.position[1] - b.transform.position[1];
    const dz = a.transform.position[2] - b.transform.position[2];
    const c = makeConstraint(`${a.name} ↔ ${b.name}`, linkType, a.id, b.id);
    c.restLength = Math.max(0.05, Math.sqrt(dx * dx + dy * dy + dz * dz));
    upsertConstraint(c);
  };

  return (
    <div>
      <div className="forge-event-card">
        <b style={{ fontSize: 12 }}>Link selected objects</b>
        <Select label="Joint" value={linkType}
          options={CONSTRAINT_TYPES}
          onChange={(v) => setLinkType(v as ConstraintType)} />
        <button
          type="button"
          className="forge-btn small primary"
          disabled={selection.length !== 2}
          onClick={linkSelected}
          title={selection.length !== 2 ? 'Select exactly 2 objects in the viewport' : 'Create joint'}
        >
          {selection.length !== 2
            ? `Select 2 objects (${selection.length}/2)`
            : `Link as ${linkType}`}
        </button>
        <p className="forge-hint">
          Anchors default to body centers — refine them below after linking.
        </p>
      </div>

      {scene.constraints.length === 0 && (
        <p className="forge-hint">
          No joints yet. Ropes and chains from the left panel also appear here.
        </p>
      )}
      {scene.constraints.map((c) => {
        const isBroken = brokenSet.has(c.id);
        return (
          <div key={c.id} className="forge-event-card">
            <div className="forge-event-head">
              <input
                type="text"
                className="forge-text"
                value={c.name}
                onChange={(e) => upsertConstraint({ ...c, name: e.target.value })}
              />
              <button
                type="button"
                className="forge-btn small danger"
                onClick={() => removeConstraint(c.id)}
              >
                ×
              </button>
            </div>
            <div className="forge-badges">
              <span className="forge-badge">{c.type}</span>
              {isBroken && <span className="forge-badge inst">broken — rewinds reset</span>}
            </div>
            <Toggle label="Enabled" checked={c.enabled}
              onChange={(v) => upsertConstraint({ ...c, enabled: v })} />
            <Select label="Type" value={c.type}
              options={CONSTRAINT_TYPES}
              onChange={(v) => upsertConstraint({ ...c, type: v as ConstraintType })} />
            <Select label="Body A" value={c.bodyA}
              options={objOptions}
              onChange={(v) => upsertConstraint({ ...c, bodyA: v })} />
            <Select label="Body B" value={c.bodyB}
              options={objOptions}
              onChange={(v) => upsertConstraint({ ...c, bodyB: v })} />
            {visible('advanced', level) && (
              <>
                <Vec3Input label="Anchor A (local)" value={c.anchorA}
                  onChange={(v) => upsertConstraint({ ...c, anchorA: v })} />
                <Vec3Input label="Anchor B (local)" value={c.anchorB}
                  onChange={(v) => upsertConstraint({ ...c, anchorB: v })} />
              </>
            )}
            {(c.type === 'hinge' || c.type === 'slider') && (
              <Vec3Input label="Axis (A local)" value={c.axis}
                onChange={(v) => upsertConstraint({ ...c, axis: v })} />
            )}
            {(c.type === 'distance' || c.type === 'spring' || c.type === 'rope') && (
              <Num label="Rest length" value={c.restLength} min={0.01} max={50} unit="m"
                onChange={(v) => upsertConstraint({ ...c, restLength: v })} />
            )}
            {(c.type === 'spring' || c.type === 'distance') && visible('advanced', level) && (
              <>
                <Num label="Stiffness" value={c.stiffness} min={1} max={500000}
                  onChange={(v) => upsertConstraint({ ...c, stiffness: v })} />
                <Num label="Damping" value={c.damping} min={0} max={1000}
                  onChange={(v) => upsertConstraint({ ...c, damping: v })} />
              </>
            )}
            {(c.type === 'hinge' || c.type === 'slider') && visible('advanced', level) && (
              <>
                <Toggle label="Limits" checked={c.limitsEnabled}
                  onChange={(v) => upsertConstraint({ ...c, limitsEnabled: v })} />
                {c.limitsEnabled && (
                  <>
                    <Num label="Min" value={c.minLimit} min={-30} max={30}
                      onChange={(v) => upsertConstraint({ ...c, minLimit: v })} />
                    <Num label="Max" value={c.maxLimit} min={-30} max={30}
                      onChange={(v) => upsertConstraint({ ...c, maxLimit: v })} />
                  </>
                )}
              </>
            )}
            {(c.type === 'hinge' || c.type === 'slider') && visible('expert', level) && (
              <>
                <Toggle label="Motor" checked={c.motorEnabled}
                  onChange={(v) => upsertConstraint({ ...c, motorEnabled: v })} />
                {c.motorEnabled && (
                  <>
                    <Select label="Motor mode" value={c.motorMode}
                      options={['velocity', 'position']}
                      onChange={(v) => upsertConstraint({ ...c, motorMode: v as 'velocity' | 'position' })} />
                    {c.motorMode === 'velocity' ? (
                      <Num label="Speed" value={c.motorSpeed} min={-30} max={30}
                        onChange={(v) => upsertConstraint({ ...c, motorSpeed: v })} />
                    ) : (
                      <Num label="Target" value={c.motorTarget} min={-30} max={30}
                        onChange={(v) => upsertConstraint({ ...c, motorTarget: v })} />
                    )}
                    <Num label="Force" value={c.motorForce} min={0} max={100000}
                      onChange={(v) => upsertConstraint({ ...c, motorForce: v })} />
                  </>
                )}
              </>
            )}
            {visible('expert', level) && (
              <Num label="Break force (0 ∞)" value={c.breakForce} min={0} max={10000000} unit="N"
                onChange={(v) => upsertConstraint({ ...c, breakForce: v })} />
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ─── Director tab: camera moves + motor choreography ─────────────────────── */

function distinctFrames(t: CameraTrack): number[] {
  const frames = new Set<number>();
  for (const k of t.position) frames.add(k.frame);
  for (const k of t.target) frames.add(k.frame);
  for (const k of t.fov) frames.add(k.frame);
  return [...frames].sort((a, b) => a - b);
}

function distinctDriverFrames(t: DriverTrack): number[] {
  const frames = new Set<number>();
  for (const k of t.position) frames.add(k.frame);
  for (const k of t.rotation) frames.add(k.frame);
  return [...frames].sort((a, b) => a - b);
}

function DirectorTab({ level, actions }: { level: UiLevel; actions: DirectorActions }) {
  const scene = useForge((s) => s.activeScene);
  const frame = useForge((s) => s.playback.frame);
  const upsertCameraTrack = useForge((s) => s.upsertCameraTrack);
  const removeCameraTrack = useForge((s) => s.removeCameraTrack);
  const upsertMotorTrack = useForge((s) => s.upsertMotorTrack);
  const removeMotorTrack = useForge((s) => s.removeMotorTrack);
  const upsertDriverTrack = useForge((s) => s.upsertDriverTrack);
  const removeDriverTrack = useForge((s) => s.removeDriverTrack);
  const patchObject = useForge((s) => s.patchObject);
  const [motorJoint, setMotorJoint] = React.useState('');
  const [motorValue, setMotorValue] = React.useState(0);
  const [driverObject, setDriverObject] = React.useState('');
  if (!scene) return null;

  const cam =
    scene.cameras.find((c) => c.id === scene.activeCameraId) ?? scene.cameras[0];
  const camTrack =
    (cam && scene.cameraTracks.find((t) => t.cameraId === cam.id)) || null;
  const motorJoints = scene.constraints.filter(
    (c) => c.type === 'hinge' || c.type === 'slider',
  );

  const addCamKey = () => {
    if (!cam) return;
    const pose = actions.captureCamera();
    if (!pose) return;
    const t = camTrack ?? makeCameraTrack(`${cam.name} move`, cam.id);
    const drop = <K extends { frame: number }>(ks: K[]): K[] =>
      ks.filter((k) => k.frame !== frame);
    upsertCameraTrack({
      ...t,
      position: [
        ...drop(t.position),
        { frame, value: [...pose.position] as Vec3, easing: 'smooth' as EasingName },
      ],
      target: [
        ...drop(t.target),
        { frame, value: [...pose.target] as Vec3, easing: 'smooth' as EasingName },
      ],
      fov: [
        ...drop(t.fov),
        { frame, value: pose.fov, easing: 'smooth' as EasingName },
      ],
    });
  };

  const setCamEasing = (t: CameraTrack, at: number, easing: EasingName) => {
    const map = <K extends { frame: number; easing: EasingName }>(ks: K[]): K[] =>
      ks.map((k) => (k.frame === at ? { ...k, easing } : k));
    upsertCameraTrack({
      ...t,
      position: map(t.position),
      target: map(t.target),
      fov: map(t.fov),
    });
  };

  const deleteCamKey = (t: CameraTrack, at: number) => {
    const drop = <K extends { frame: number }>(ks: K[]): K[] =>
      ks.filter((k) => k.frame !== at);
    upsertCameraTrack({
      ...t,
      position: drop(t.position),
      target: drop(t.target),
      fov: drop(t.fov),
    });
  };

  const addMotorTrack = () => {
    const j = scene.constraints.find((c) => c.id === motorJoint);
    if (!j) return;
    upsertMotorTrack(makeMotorTrack(`${j.name} motion`, j.id));
  };

  const addMotorKey = (t: MotorTrack) => {
    upsertMotorTrack({
      ...t,
      keys: [
        ...t.keys.filter((k) => k.frame !== frame),
        { frame, value: motorValue, easing: 'smooth' as EasingName },
      ],
    });
  };

  return (
    <div>
      <Section title="Camera move" defaultOpen>
        {!cam && <p className="forge-hint">No camera in this scene.</p>}
        {cam && !camTrack && (
          <>
            <p className="forge-hint">
              Orbit to a start pose, key it, scrub forward, orbit to an end
              pose, key it — playback and export fly the move.
            </p>
            <button type="button" className="forge-btn small primary" onClick={addCamKey}>
              ＋ Key {cam.name} @ f{frame}
            </button>
          </>
        )}
        {cam && camTrack && (
          <div className="forge-event-card">
            <div className="forge-event-head">
              <input
                type="text"
                className="forge-text"
                value={camTrack.name}
                onChange={(e) =>
                  upsertCameraTrack({ ...camTrack, name: e.target.value })
                }
              />
              <button
                type="button"
                className="forge-btn small danger"
                onClick={() => removeCameraTrack(camTrack.id)}
              >
                ×
              </button>
            </div>
            <Toggle
              label="Enabled (drives camera)"
              checked={camTrack.enabled}
              onChange={(v) => upsertCameraTrack({ ...camTrack, enabled: v })}
            />
            <button type="button" className="forge-btn small primary" onClick={addCamKey}>
              ＋ Key @ f{frame} (capture viewport)
            </button>
            {distinctFrames(camTrack).map((f) => {
              const easing =
                camTrack.position.find((k) => k.frame === f)?.easing ?? 'smooth';
              const pos = camTrack.position.find((k) => k.frame === f);
              const tgt = camTrack.target.find((k) => k.frame === f);
              const fv = camTrack.fov.find((k) => k.frame === f);
              return (
                <div key={f} className="forge-key-row">
                  <button
                    type="button"
                    className="forge-btn small"
                    onClick={() => actions.goToFrame(f)}
                    title="Jump to keyframe"
                  >
                    f{f}
                  </button>
                  <Select
                    label=""
                    value={easing}
                    options={[...EASING_NAMES]}
                    onChange={(v) => setCamEasing(camTrack, f, v as EasingName)}
                  />
                  <button
                    type="button"
                    className="forge-btn small danger"
                    onClick={() => deleteCamKey(camTrack, f)}
                  >
                    ×
                  </button>
                  {visible('advanced', level) && pos && tgt && fv && (
                    <div className="forge-key-values">
                      <Vec3Input
                        label="pos"
                        value={pos.value}
                        onChange={(v) =>
                          upsertCameraTrack({
                            ...camTrack,
                            position: camTrack.position.map((k) =>
                              k.frame === f ? { ...k, value: v } : k,
                            ),
                          })
                        }
                      />
                      <Vec3Input
                        label="target"
                        value={tgt.value}
                        onChange={(v) =>
                          upsertCameraTrack({
                            ...camTrack,
                            target: camTrack.target.map((k) =>
                              k.frame === f ? { ...k, value: v } : k,
                            ),
                          })
                        }
                      />
                      <Num
                        label="fov"
                        value={fv.value}
                        min={5}
                        max={170}
                        onChange={(v) =>
                          upsertCameraTrack({
                            ...camTrack,
                            fov: camTrack.fov.map((k) =>
                              k.frame === f ? { ...k, value: v } : k,
                            ),
                          })
                        }
                      />
                    </div>
                  )}
                </div>
              );
            })}
            {distinctFrames(camTrack).length === 0 && (
              <p className="forge-hint">No keys yet — capture at least two.</p>
            )}
            <p className="forge-hint">
              While enabled, the track owns the camera during playback and
              export. Pause to orbit freely; the next frame change re-applies
              the move.
            </p>
          </div>
        )}
      </Section>

      <Section title="Motor choreography" defaultOpen>
        {motorJoints.length === 0 && (
          <p className="forge-hint">
            No hinge or slider joints yet — link two objects in the Joints tab
            first.
          </p>
        )}
        {motorJoints.length > 0 && (
          <div className="forge-event-card">
            <Select
              label="Joint"
              value={motorJoint}
              options={motorJoints.map((j) => j.id)}
              onChange={setMotorJoint}
            />
            <button
              type="button"
              className="forge-btn small primary"
              disabled={!motorJoint}
              onClick={addMotorTrack}
            >
              ＋ Motor track
            </button>
          </div>
        )}
        {scene.motorTracks.map((t) => {
          const j = scene.constraints.find((c) => c.id === t.jointId);
          return (
            <div key={t.id} className="forge-event-card">
              <div className="forge-event-head">
                <input
                  type="text"
                  className="forge-text"
                  value={t.name}
                  onChange={(e) => upsertMotorTrack({ ...t, name: e.target.value })}
                />
                <button
                  type="button"
                  className="forge-btn small danger"
                  onClick={() => removeMotorTrack(t.id)}
                >
                  ×
                </button>
              </div>
              <div className="forge-badges">
                <span className="forge-badge">{j ? j.name : 'joint deleted'}</span>
                {j && <span className="forge-badge">{j.motorMode}</span>}
                {j && !j.motorEnabled && (
                  <span className="forge-badge inst">motor off — enable in Joints tab</span>
                )}
              </div>
              <Toggle
                label="Enabled"
                checked={t.enabled}
                onChange={(v) => upsertMotorTrack({ ...t, enabled: v })}
              />
              <Num
                label={j?.motorMode === 'velocity' ? 'Speed @ key' : 'Target @ key'}
                value={motorValue}
                min={-30}
                max={30}
                onChange={setMotorValue}
              />
              <button
                type="button"
                className="forge-btn small primary"
                onClick={() => addMotorKey(t)}
              >
                ＋ Key @ f{frame}
              </button>
              {t.keys.map((k) => (
                <div key={k.frame} className="forge-key-row">
                  <button
                    type="button"
                    className="forge-btn small"
                    onClick={() => actions.goToFrame(k.frame)}
                  >
                    f{k.frame}
                  </button>
                  <Num
                    label=""
                    value={k.value}
                    min={-1000}
                    max={1000}
                    onChange={(v) =>
                      upsertMotorTrack({
                        ...t,
                        keys: t.keys.map((x) =>
                          x.frame === k.frame ? { ...x, value: v } : x,
                        ),
                      })
                    }
                  />
                  <Select
                    label=""
                    value={k.easing}
                    options={[...EASING_NAMES]}
                    onChange={(v) =>
                      upsertMotorTrack({
                        ...t,
                        keys: t.keys.map((x) =>
                          x.frame === k.frame
                            ? { ...x, easing: v as EasingName }
                            : x,
                        ),
                      })
                    }
                  />
                  <button
                    type="button"
                    className="forge-btn small danger"
                    onClick={() =>
                      upsertMotorTrack({
                        ...t,
                        keys: t.keys.filter((x) => x.frame !== k.frame),
                      })
                    }
                  >
                    ×
                  </button>
                </div>
              ))}
              <p className="forge-hint">
                Keys drive {j?.motorMode === 'velocity' ? 'speed' : 'target position'} per
                frame — deterministic, rewind-safe, and baked into export.
              </p>
            </div>
          );
        })}
      </Section>

      <Section title="Kinematic drivers" defaultOpen>
        {scene.objects.length === 0 && (
          <p className="forge-hint">
            No objects yet — add a platform or paddle from the left panel
            first.
          </p>
        )}
        {scene.objects.length > 0 && (
          <div className="forge-event-card">
            <Select
              label="Object"
              value={driverObject}
              options={scene.objects.map((o) => o.id)}
              onChange={setDriverObject}
            />
            <button
              type="button"
              className="forge-btn small primary"
              disabled={!driverObject}
              onClick={() => {
                const o = scene.objects.find((x) => x.id === driverObject);
                if (!o) return;
                upsertDriverTrack(makeDriverTrack(`${o.name} driver`, o.id));
              }}
            >
              ＋ Driver track
            </button>
          </div>
        )}
        {scene.driverTracks.map((t) => {
          const o = scene.objects.find((x) => x.id === t.objectId);
          const isKinematic = o?.rigidBody?.bodyType === 'kinematic';
          return (
            <div key={t.id} className="forge-event-card">
              <div className="forge-event-head">
                <input
                  type="text"
                  className="forge-text"
                  value={t.name}
                  onChange={(e) =>
                    upsertDriverTrack({ ...t, name: e.target.value })
                  }
                />
                <button
                  type="button"
                  className="forge-btn small danger"
                  onClick={() => removeDriverTrack(t.id)}
                >
                  ×
                </button>
              </div>
              <div className="forge-badges">
                <span className="forge-badge">{o ? o.name : 'object deleted'}</span>
                {o && (
                  <span className="forge-badge">
                    {o.rigidBody?.bodyType ?? 'no body'}
                  </span>
                )}
                {o && !isKinematic && (
                  <span className="forge-badge inst">ignored — not kinematic</span>
                )}
              </div>
              {o && !isKinematic && o.rigidBody && (
                <button
                  type="button"
                  className="forge-btn small"
                  onClick={() =>
                    patchObject(o.id, {
                      rigidBody: { ...o.rigidBody!, bodyType: 'kinematic' },
                    })
                  }
                >
                  Make kinematic
                </button>
              )}
              <Toggle
                label="Enabled"
                checked={t.enabled}
                onChange={(v) => upsertDriverTrack({ ...t, enabled: v })}
              />
              <button
                type="button"
                className="forge-btn small primary"
                disabled={!o}
                onClick={() => {
                  const pose = actions.captureObjectPose(t.objectId);
                  if (!pose) return;
                  const drop = <K extends { frame: number }>(ks: K[]): K[] =>
                    ks.filter((k) => k.frame !== frame);
                  upsertDriverTrack({
                    ...t,
                    position: [
                      ...drop(t.position),
                      {
                        frame,
                        value: [...pose.position] as Vec3,
                        easing: 'smooth' as EasingName,
                      },
                    ],
                    rotation: [
                      ...drop(t.rotation),
                      {
                        frame,
                        value: [...pose.rotation] as Vec3,
                        easing: 'smooth' as EasingName,
                      },
                    ],
                  });
                }}
              >
                ＋ Key @ f{frame} (capture live pose)
              </button>
              {distinctDriverFrames(t).map((f) => {
                const easing =
                  t.position.find((k) => k.frame === f)?.easing ?? 'smooth';
                const pos = t.position.find((k) => k.frame === f);
                const rot = t.rotation.find((k) => k.frame === f);
                return (
                  <div key={f} className="forge-key-row">
                    <button
                      type="button"
                      className="forge-btn small"
                      onClick={() => actions.goToFrame(f)}
                      title="Jump to keyframe"
                    >
                      f{f}
                    </button>
                    <Select
                      label=""
                      value={easing}
                      options={[...EASING_NAMES]}
                      onChange={(v) => {
                        const e = v as EasingName;
                        const map = <K extends { frame: number; easing: EasingName }>(
                          ks: K[],
                        ): K[] =>
                          ks.map((k) => (k.frame === f ? { ...k, easing: e } : k));
                        upsertDriverTrack({
                          ...t,
                          position: map(t.position),
                          rotation: map(t.rotation),
                        });
                      }}
                    />
                    <button
                      type="button"
                      className="forge-btn small danger"
                      onClick={() => {
                        const drop = <K extends { frame: number }>(ks: K[]): K[] =>
                          ks.filter((k) => k.frame !== f);
                        upsertDriverTrack({
                          ...t,
                          position: drop(t.position),
                          rotation: drop(t.rotation),
                        });
                      }}
                    >
                      ×
                    </button>
                    {visible('advanced', level) && pos && rot && (
                      <div className="forge-key-values">
                        <Vec3Input
                          label="pos"
                          value={pos.value}
                          onChange={(v) =>
                            upsertDriverTrack({
                              ...t,
                              position: t.position.map((k) =>
                                k.frame === f ? { ...k, value: v } : k,
                              ),
                            })
                          }
                        />
                        <Vec3Input
                          label="rot"
                          value={rot.value}
                          onChange={(v) =>
                            upsertDriverTrack({
                              ...t,
                              rotation: t.rotation.map((k) =>
                                k.frame === f ? { ...k, value: v } : k,
                              ),
                            })
                          }
                        />
                      </div>
                    )}
                  </div>
                );
              })}
              <p className="forge-hint">
                The platform follows keys exactly and shoves dynamic bodies —
                deterministic, rewind-safe, and baked into export. Gizmo edits
                lose on the next frame while the track is enabled.
              </p>
            </div>
          );
        })}
      </Section>
    </div>
  );
}
