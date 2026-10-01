/**
 * Left panel — asset / creation browser: presets, generators, helpers.
 */
import React from 'react';
import { useForge } from '../core/store';
import { OBJECT_PRESETS, PRESET_CATEGORIES } from '../presets';
import {
  DEFAULT_GENERATOR_PARAMS,
  bakeCircle,
  bakeGrid,
  bakePile,
  bakeSpiral,
  bakeTower,
} from '../physics/generators';
import { Rng } from '../core/rng';
import { bakeChain, bakeRope } from '../physics/rope';

const GEN_TABS = ['grid', 'circle', 'spiral', 'tower', 'pile', 'rope'] as const;
type GenTab = (typeof GEN_TABS)[number];

export function AssetBrowser() {
  const addObject = useForge((s) => s.addObject);
  const addObjects = useForge((s) => s.addObjects);
  const addGenerator = useForge((s) => s.addGenerator);
  const seed = useForge((s) => s.activeScene?.seed ?? 1);
  const [tab, setTab] = React.useState<'assets' | GenTab>('assets');
  const [templateId, setTemplateId] = React.useState('ball-rubber');
  const [count, setCount] = React.useState(100);
  const [spacing, setSpacing] = React.useState(1);
  const [genSeed, setGenSeed] = React.useState(7);

  const spawn = (id: string) => {
    const factory = OBJECT_PRESETS[id];
    if (!factory) return;
    const obj = factory();
    // Scatter slightly so repeated clicks don't stack bodies.
    obj.transform.position[0] += (Math.random() - 0.5) * 0.4;
    obj.transform.position[2] += (Math.random() - 0.5) * 0.4;
    addObject(obj);
  };

  const bake = () => {
    const factory = OBJECT_PRESETS[templateId];
    if (!factory) return;
    const tpl = factory();
    const gp = {
      ...DEFAULT_GENERATOR_PARAMS,
      seed: genSeed,
      templateId,
      colorRandom: 1,
      rotRandom: tab === 'pile' ? 1 : 0,
    };
    if (tab === 'grid') {
      const n = Math.max(1, Math.round(Math.cbrt(count)));
      const r = bakeGrid(tpl, { ...gp, rows: n, cols: n, layers: Math.max(1, Math.ceil(count / (n * n))), spacing, jitter: 0.02 });
      addObjects(r.objects);
      addGenerator(r.record);
    } else if (tab === 'circle') {
      const r = bakeCircle(tpl, { ...gp, count, radius: Math.max(1, spacing * 3), height: 3, startAngle: 0, endAngle: Math.PI * 2 });
      addObjects(r.objects);
      addGenerator(r.record);
    } else if (tab === 'spiral') {
      const r = bakeSpiral(tpl, { ...gp, count, turns: 4, radiusStart: 0.5, radiusEnd: Math.max(1, spacing * 3), heightStep: 0.6 });
      addObjects(r.objects);
      addGenerator(r.record);
    } else if (tab === 'tower') {
      const n = Math.max(1, Math.round(Math.sqrt(count / 6)));
      const r = bakeTower(tpl, { ...gp, rows: n, cols: n, levels: Math.max(1, Math.round(count / (n * n))), spacing, alternate: true });
      addObjects(r.objects);
      addGenerator(r.record);
    } else {
      const r = bakePile(tpl, { ...gp, count, area: Math.max(2, Math.sqrt(count) * 0.5), height: 4, dropHeight: 4 });
      addObjects(r.objects);
      addGenerator(r.record);
    }
  };

  const diceSeed = () => setGenSeed(new Rng(`${Date.now()}`).int(1, 999999));

  return (
    <div className="forge-left">
      <div className="forge-left-tabs">
        <button
          className={tab === 'assets' ? 'active' : ''}
          onClick={() => setTab('assets')}
          type="button"
        >
          Objects
        </button>
        {GEN_TABS.map((g) => (
          <button
            key={g}
            className={tab === g ? 'active' : ''}
            onClick={() => setTab(g)}
            type="button"
          >
            {g[0].toUpperCase() + g.slice(1)}
          </button>
        ))}
      </div>

      {tab === 'assets' ? (
        <div className="forge-asset-list">
          {PRESET_CATEGORIES.map((cat) => (
            <div key={cat.title} className="forge-asset-cat">
              <h4>{cat.title}</h4>
              <div className="forge-asset-grid">
                {cat.ids.map((id) => (
                  <button
                    key={id}
                    className="forge-asset-btn"
                    onClick={() => spawn(id)}
                    type="button"
                    title={`Add ${id}`}
                  >
                    <span className="forge-asset-icon">{iconFor(id)}</span>
                    <span className="forge-asset-name">{labelFor(id)}</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
          <p className="forge-hint">
            Scene seed <code>{seed}</code> drives all procedural randomness.
          </p>
        </div>
      ) : tab === 'rope' ? (
        <RopeForm />
      ) : (
        <div className="forge-gen-form">
          <h4>
            {tab[0].toUpperCase() + tab.slice(1)} generator
          </h4>
          <label className="forge-field">
            <span className="forge-label">Template</span>
            <select
              className="forge-select"
              value={templateId}
              onChange={(e) => setTemplateId(e.target.value)}
            >
              {Object.keys(OBJECT_PRESETS).map((id) => (
                <option key={id} value={id}>
                  {id}
                </option>
              ))}
            </select>
          </label>
          <label className="forge-field">
            <span className="forge-label">Count</span>
            <input
              type="number"
              className="forge-num wide"
              value={count}
              min={1}
              max={20000}
              onChange={(e) =>
                setCount(Math.max(1, Math.min(20000, Number(e.target.value) || 1)))
              }
            />
          </label>
          <label className="forge-field">
            <span className="forge-label">Spacing</span>
            <input
              type="number"
              className="forge-num wide"
              value={spacing}
              step={0.1}
              min={0.1}
              onChange={(e) => setSpacing(Number(e.target.value) || 1)}
            />
          </label>
          <label className="forge-field">
            <span className="forge-label">Seed</span>
            <span className="forge-seed-row">
              <input
                type="number"
                className="forge-num wide"
                value={genSeed}
                onChange={(e) => setGenSeed(Number(e.target.value) || 1)}
              />
              <button className="forge-btn small" onClick={diceSeed} type="button" title="Randomize seed">
                🎲
              </button>
            </span>
          </label>
          <div className="forge-count-presets">
            {[100, 1000, 5000, 10000].map((n) => (
              <button
                key={n}
                type="button"
                className="forge-btn small"
                onClick={() => setCount(n)}
              >
                {n.toLocaleString()}
              </button>
            ))}
          </div>
          <button className="forge-btn primary" onClick={bake} type="button">
            Generate {count.toLocaleString()} objects
          </button>
          <p className="forge-hint">
            Baked objects share an instancing key — 10k balls render as one
            draw call per material.
          </p>
        </div>
      )}
    </div>
  );
}

function labelFor(id: string): string {
  return id
    .split('-')
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(' ');
}

function iconFor(id: string): string {
  if (id.startsWith('ball')) return '⚪';
  if (id.startsWith('box') || id.startsWith('crate')) return '📦';
  if (id.startsWith('cone')) return '🔻';
  if (id.startsWith('field')) return '🌀';
  if (id.startsWith('emitter')) return '⛲';
  if (id.includes('press')) return '🗜️';
  if (id.includes('conveyor')) return '🎢';
  if (id.includes('spinner')) return '💿';
  if (id.includes('gate')) return '🚪';
  if (id.startsWith('balloon')) return '🎈';
  if (id.startsWith('glass')) return '🪟';
  if (id.startsWith('tank')) return '🧪';
  if (id.startsWith('ground')) return '🟫';
  if (id.startsWith('wall')) return '🧱';
  if (id.startsWith('ramp')) return '🛝';
  if (id.startsWith('domino')) return '🎲';
  return '📄';
}


/* ─── Rope / chain builder ───────────────────────────────────────────────── */

function NumField({ label, value, onChange, min, max, step }: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step?: number;
}) {
  return (
    <label className="forge-field">
      <span className="forge-label">{label}</span>
      <input
        type="number"
        className="forge-num wide"
        value={value}
        min={min}
        max={max}
        step={step ?? 1}
        onChange={(e) =>
          onChange(Math.max(min, Math.min(max, Number(e.target.value) || min)))
        }
      />
    </label>
  );
}

function RopeForm() {
  const addObjects = useForge((s) => s.addObjects);
  const addConstraints = useForge((s) => s.addConstraints);
  const addGenerator = useForge((s) => s.addGenerator);
  const [kind, setKind] = React.useState<'rope' | 'chain'>('rope');
  const [count, setCount] = React.useState(10);
  const [segLength, setSegLength] = React.useState(0.4);
  const [radius, setRadius] = React.useState(0.05);
  const [top, setTop] = React.useState(5);
  const [pinTop, setPinTop] = React.useState(true);
  const [breakForce, setBreakForce] = React.useState(0);
  const [templateId, setTemplateId] = React.useState('ball-rubber');

  const build = () => {
    const opts = {
      name: kind === 'rope' ? 'Rope' : 'Chain',
      count,
      segLength,
      radius,
      position: [0, top, 0] as [number, number, number],
      pinTop,
      breakForce,
      templateId,
    };
    const r = kind === 'rope' ? bakeRope(opts) : bakeChain(opts);
    addObjects(r.objects);
    addConstraints(r.joints);
    addGenerator(r.record);
  };

  return (
    <div className="forge-gen-form">
      <h4>Rope / chain</h4>
      <label className="forge-field">
        <span className="forge-label">Kind</span>
        <select
          className="forge-select"
          value={kind}
          onChange={(e) => setKind(e.target.value as 'rope' | 'chain')}
        >
          <option value="rope">Rope (capsule links)</option>
          <option value="chain">Chain (torus links)</option>
        </select>
      </label>
      <label className="forge-field">
        <span className="forge-label">Link material</span>
        <select
          className="forge-select"
          value={templateId}
          onChange={(e) => setTemplateId(e.target.value)}
        >
          {Object.keys(OBJECT_PRESETS).map((id) => (
            <option key={id} value={id}>
              {id}
            </option>
          ))}
        </select>
      </label>
      <NumField label="Links" value={count} onChange={setCount} min={2} max={200} />
      <NumField label="Segment length" value={segLength} onChange={setSegLength} min={0.05} max={5} step={0.05} />
      <NumField label="Link radius" value={radius} onChange={setRadius} min={0.01} max={1} step={0.01} />
      <NumField label="Top height" value={top} onChange={setTop} min={0} max={50} step={0.5} />
      <NumField label="Break force (0 ∞)" value={breakForce} onChange={setBreakForce} min={0} max={10000000} step={100} />
      <label className="forge-check">
        <input
          type="checkbox"
          checked={pinTop}
          onChange={(e) => setPinTop(e.target.checked)}
        />
        Pin top (static anchor)
      </label>
      <button type="button" className="forge-btn primary" onClick={build}>
        Build {kind === 'rope' ? 'rope' : 'chain'} ({count} links)
      </button>
      <p className="forge-hint">
        Links are rigid bodies joined by ball joints — tune them in the
        Inspector&apos;s Joints tab.
      </p>
    </div>
  );
}
