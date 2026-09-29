/**
 * Inspector form primitives — compact, level-gated controls.
 * Every control writes straight through to the scene model.
 */
import React from 'react';
import type { UiLevel, Vec3 } from '../core/types';

const LEVEL_RANK: Record<UiLevel, number> = { basic: 0, advanced: 1, expert: 2 };

export function visible(min: UiLevel, current: UiLevel): boolean {
  return LEVEL_RANK[current] >= LEVEL_RANK[min];
}

export function Section(props: {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = React.useState(props.defaultOpen ?? true);
  return (
    <div className="forge-section">
      <button
        className="forge-section-head"
        onClick={() => setOpen(!open)}
        type="button"
      >
        <span className={`forge-caret ${open ? 'open' : ''}`}>▸</span>
        {props.title}
      </button>
      {open && <div className="forge-section-body">{props.children}</div>}
    </div>
  );
}

export function Row(props: { children: React.ReactNode }) {
  return <div className="forge-row">{props.children}</div>;
}

export function Num(props: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
}) {
  const { label, value, onChange, min, max, step = 0.1, unit } = props;
  const hasRange = min !== undefined && max !== undefined;
  return (
    <label className="forge-field">
      <span className="forge-label">
        {label}
        {unit && <em>{unit}</em>}
      </span>
      <span className="forge-control">
        {hasRange && (
          <input
            type="range"
            className="forge-slider"
            min={min}
            max={max}
            step={step}
            value={value}
            onChange={(e) => onChange(Number(e.target.value))}
          />
        )}
        <input
          type="number"
          className="forge-num"
          value={Number.isFinite(value) ? Number(value.toFixed(4)) : 0}
          step={step}
          onChange={(e) => {
            const v = Number(e.target.value);
            if (Number.isFinite(v)) onChange(v);
          }}
        />
      </span>
    </label>
  );
}

export function Vec3Input(props: {
  label: string;
  value: Vec3;
  onChange: (v: Vec3) => void;
  step?: number;
}) {
  const { label, value, onChange, step = 0.1 } = props;
  const set = (i: number, n: number) => {
    const v: Vec3 = [...value] as Vec3;
    v[i] = n;
    onChange(v);
  };
  return (
    <div className="forge-field">
      <span className="forge-label">{label}</span>
      <span className="forge-vec3">
        {(['X', 'Y', 'Z'] as const).map((axis, i) => (
          <span key={axis} className="forge-vec-cell">
            <em className={`axis-${axis.toLowerCase()}`}>{axis}</em>
            <input
              type="number"
              value={Number((value[i] ?? 0).toFixed(3))}
              step={step}
              onChange={(e) => {
                const n = Number(e.target.value);
                if (Number.isFinite(n)) set(i, n);
              }}
            />
          </span>
        ))}
      </span>
    </div>
  );
}

export function Select(props: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string } | string>;
  onChange: (v: string) => void;
}) {
  return (
    <label className="forge-field">
      <span className="forge-label">{props.label}</span>
      <select
        className="forge-select"
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
      >
        {props.options.map((o) =>
          typeof o === 'string' ? (
            <option key={o} value={o}>
              {o}
            </option>
          ) : (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ),
        )}
      </select>
    </label>
  );
}

export function Toggle(props: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="forge-field forge-toggle-row">
      <span className="forge-label">{props.label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={props.checked}
        className={`forge-switch ${props.checked ? 'on' : ''}`}
        onClick={() => props.onChange(!props.checked)}
      >
        <span className="forge-knob" />
      </button>
    </label>
  );
}

export function ColorInput(props: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="forge-field">
      <span className="forge-label">{props.label}</span>
      <span className="forge-color-wrap">
        <input
          type="color"
          className="forge-color"
          value={props.value}
          onChange={(e) => props.onChange(e.target.value)}
        />
        <code>{props.value}</code>
      </span>
    </label>
  );
}

export function TextInput(props: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="forge-field">
      <span className="forge-label">{props.label}</span>
      <input
        type="text"
        className="forge-text"
        value={props.value}
        placeholder={props.placeholder}
        onChange={(e) => props.onChange(e.target.value)}
      />
    </label>
  );
}

export function ActionRow(props: { children: React.ReactNode }) {
  return <div className="forge-actions">{props.children}</div>;
}
