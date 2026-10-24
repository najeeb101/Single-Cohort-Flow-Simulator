"use client";

import type { IntakePolicy } from "@/types/simulation";
import { FieldRow, NumberBox } from "@/components/scenario-builder/fields";

// Ready-made limit sets. "Balanced" is the default (config intake_policy).
export const POLICY_PRESETS: { name: string; policy: IntakePolicy }[] = [
  { name: "Cautious", policy: { max_grad_rate_loss_pts: 1, max_on_time_loss_pts: 5, min_grad_rate: null } },
  { name: "Balanced", policy: { max_grad_rate_loss_pts: 2, max_on_time_loss_pts: 10, min_grad_rate: null } },
  { name: "Growth", policy: { max_grad_rate_loss_pts: 4, max_on_time_loss_pts: 20, min_grad_rate: null } },
];

// How much harm from seat shortages the department accepts, in percentage points, plus an
// optional floor on the graduation rate itself.
export default function PolicyFields({
  value,
  baseline,
  onChange,
}: {
  value: IntakePolicy;
  baseline?: IntakePolicy;
  onChange: (next: IntakePolicy) => void;
}) {
  const set = <K extends keyof IntakePolicy>(k: K, v: IntakePolicy[K]) => onChange({ ...value, [k]: v });
  const floorOn = value.min_grad_rate != null;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        {POLICY_PRESETS.map((p) => {
          const active =
            p.policy.max_grad_rate_loss_pts === value.max_grad_rate_loss_pts &&
            p.policy.max_on_time_loss_pts === value.max_on_time_loss_pts;
          return (
            <button
              key={p.name}
              type="button"
              onClick={() => onChange({ ...p.policy, min_grad_rate: value.min_grad_rate })}
              className={`rounded-full border px-3 py-1 text-xs font-semibold ${
                active ? "border-accent bg-accent/10 text-ink" : "border-border-2 text-muted hover:text-ink"
              }`}
            >
              {p.name} ({p.policy.max_grad_rate_loss_pts} / {p.policy.max_on_time_loss_pts} pts)
            </button>
          );
        })}
      </div>
      <div className="flex flex-wrap gap-2">
        <FieldRow
          label="Graduation rate lost to seat shortages, at most (pts)"
          dirty={baseline && baseline.max_grad_rate_loss_pts !== value.max_grad_rate_loss_pts}
        >
          <NumberBox value={value.max_grad_rate_loss_pts} min={0.5} max={50} step={0.5} onChange={(v) => set("max_grad_rate_loss_pts", v)} />
        </FieldRow>
        <FieldRow
          label="On-time graduation lost, at most (pts)"
          dirty={baseline && baseline.max_on_time_loss_pts !== value.max_on_time_loss_pts}
        >
          <NumberBox value={value.max_on_time_loss_pts} min={0.5} max={100} step={0.5} onChange={(v) => set("max_on_time_loss_pts", v)} />
        </FieldRow>
        <FieldRow label="Graduation rate must stay above (%)" dirty={baseline && baseline.min_grad_rate !== value.min_grad_rate}>
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={floorOn}
              aria-label="Use a minimum graduation rate"
              onChange={(e) => set("min_grad_rate", e.target.checked ? 0.6 : null)}
            />
            <NumberBox
              value={floorOn ? Math.round((value.min_grad_rate ?? 0) * 100) : 0}
              min={0}
              max={100}
              step={1}
              onChange={(v) => set("min_grad_rate", Math.max(0, Math.min(100, v)) / 100)}
            />
          </div>
        </FieldRow>
      </div>
    </div>
  );
}
