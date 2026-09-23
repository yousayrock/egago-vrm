import { useState, type ReactNode } from 'react';

export function Panel({
  title,
  children,
  collapsible = false,
  defaultOpen = false,
}: {
  title: string;
  children: ReactNode;
  collapsible?: boolean;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <section className={`panel${collapsible ? ' panel-collapsible' : ''}${collapsible && !open ? ' is-collapsed' : ''}`}>
      {collapsible ? (
        <button
          type="button"
          className="panel-trigger"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          <span>{title}</span>
          <span className="panel-chevron" aria-hidden="true" />
        </button>
      ) : (
        <h2>{title}</h2>
      )}
      {(!collapsible || open) && <div className="panel-content">{children}</div>}
    </section>
  );
}

export function Field({ label, children }: { label?: string; children: ReactNode }) {
  return (
    <div className="field">
      {label && <label>{label}</label>}
      {children}
    </div>
  );
}

export function Slider({
  label,
  value,
  min,
  max,
  step,
  digits = 2,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  digits?: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="field">
      <div className="slider-head">
        <span>{label}</span>
        <b>{value.toFixed(digits)}</b>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  );
}

export function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="toggle">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}
