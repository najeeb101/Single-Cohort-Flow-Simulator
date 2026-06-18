"use client";

import type { ReactNode } from "react";

// Shared dirty-highlight wrapper: a left accent bar + dot when a field's value has
// diverged from the baseline, so edits are visible at a glance across ~30 fields.
export function FieldRow({ label, dirty, children }: { label: string; dirty?: boolean; children: ReactNode }) {
  return (
    <div
      className={`flex min-w-[180px] flex-1 flex-col gap-1.5 rounded-lg border-l-2 px-2.5 py-1.5 ${
        dirty ? "border-l-accent bg-accent/[0.07]" : "border-l-transparent"
      }`}
    >
      <label className="flex items-center gap-1.5 text-xs text-muted">
        {label}
        {dirty && <span className="h-1.5 w-1.5 rounded-full bg-accent" />}
      </label>
      {children}
    </div>
  );
}

interface NumberBoxProps {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
}

export function NumberBox({ value, onChange, min, max, step }: NumberBoxProps) {
  return (
    <input
      type="number"
      value={value}
      min={min}
      max={max}
      step={step}
      onChange={(e) => onChange(Number(e.target.value))}
      className="w-full rounded-[8px] border border-border-2 bg-surface-2 px-2.5 py-1.5 text-[13px] text-ink tabular-nums focus:outline-none focus:ring-1 focus:ring-accent"
    />
  );
}

interface SliderBoxProps extends NumberBoxProps {
  min: number;
  max: number;
  step: number;
  display: string;
}

export function SliderBox({ value, onChange, min, max, step, display }: SliderBoxProps) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex justify-end">
        <b className="tabular-nums text-[12.5px] text-ink">{display}</b>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="accent-[var(--accent)]"
      />
    </div>
  );
}

export function SectionCard({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <div className="rounded-2xl border border-border bg-surface p-4">
      <div className="mb-3 flex items-baseline justify-between gap-3 text-[13px] font-semibold">
        <span>{title}</span>
        {hint && <span className="text-xs font-normal text-muted">{hint}</span>}
      </div>
      {children}
    </div>
  );
}
