import type { EnrollmentPriorityTier } from "@/types/simulation";
import type { BuilderState } from "@/lib/scenarioBuilder";
import { CATEGORIES } from "@/lib/scenarioBuilder";
import { FieldRow, NumberBox, SectionCard } from "./fields";

interface Props {
  mode: "simple" | "advanced";
  state: BuilderState;
  baseline: BuilderState;
  setField: <K extends keyof BuilderState>(key: K, value: BuilderState[K]) => void;
}

function tiersDiffer(a: EnrollmentPriorityTier[], b: EnrollmentPriorityTier[]): boolean {
  return JSON.stringify(a) !== JSON.stringify(b);
}

export default function RegistrationPolicyTab({ mode, state, baseline, setField }: Props) {
  const setThreshold = (idx: number, value: number) => {
    const next = [...state.registrationTierThresholds];
    next[idx] = value;
    setField("registrationTierThresholds", next);
  };

  const updateTier = (idx: number, patch: Partial<EnrollmentPriorityTier>) => {
    const next = state.enrollmentPriorityTiers.map((t, i) => (i === idx ? { ...t, ...patch } : t));
    setField("enrollmentPriorityTiers", next);
  };

  const toggleCategory = (idx: number, category: string) => {
    const tier = state.enrollmentPriorityTiers[idx];
    const has = tier.categories.includes(category);
    updateTier(idx, { categories: has ? tier.categories.filter((c) => c !== category) : [...tier.categories, category] });
  };

  const addTier = () => setField("enrollmentPriorityTiers", [...state.enrollmentPriorityTiers, { categories: [] }]);
  const removeTier = (idx: number) =>
    setField("enrollmentPriorityTiers", state.enrollmentPriorityTiers.filter((_, i) => i !== idx));

  return (
    <div className="flex flex-col gap-4">
      <SectionCard
        title="Registration priority bands"
        hint="completed CH thresholds, registers-first to registers-last"
      >
        <div className="flex flex-wrap gap-2">
          {state.registrationTierThresholds.map((ch, idx) => (
            <FieldRow
              key={idx}
              label={`Tier ${idx + 1} (${idx === 0 ? "registers first" : idx === state.registrationTierThresholds.length - 1 ? "registers last" : "—"})`}
              dirty={ch !== baseline.registrationTierThresholds[idx]}
            >
              <NumberBox value={ch} onChange={(v) => setThreshold(idx, v)} min={0} max={120} step={1} />
            </FieldRow>
          ))}
        </div>
      </SectionCard>

      {mode === "advanced" && (
        <SectionCard
          title="Enrollment priority tiers"
          hint={tiersDiffer(state.enrollmentPriorityTiers, baseline.enrollmentPriorityTiers) ? "edited" : undefined}
        >
          <div className="flex flex-col gap-3">
            {state.enrollmentPriorityTiers.map((tier, idx) => (
              <div key={idx} className="rounded-lg border border-border-2 bg-surface-2 p-3">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-xs font-semibold text-muted">Tier {idx + 1}</span>
                  <button
                    type="button"
                    onClick={() => removeTier(idx)}
                    className="text-[11px] font-semibold text-bad hover:underline"
                  >
                    Remove
                  </button>
                </div>
                <div className="mb-2 flex flex-wrap gap-3">
                  {CATEGORIES.map((cat) => (
                    <label key={cat} className="flex items-center gap-1.5 text-[12.5px] text-ink">
                      <input
                        type="checkbox"
                        checked={tier.categories.includes(cat)}
                        onChange={() => toggleCategory(idx, cat)}
                        className="accent-[var(--accent)]"
                      />
                      {cat}
                    </label>
                  ))}
                </div>
                <div className="w-40">
                  <FieldRow label="min completed CH (optional)">
                    <NumberBox
                      value={tier.min_ch ?? 0}
                      onChange={(v) => updateTier(idx, { min_ch: v || undefined })}
                      min={0}
                      max={120}
                      step={1}
                    />
                  </FieldRow>
                </div>
              </div>
            ))}
            <button
              type="button"
              onClick={addTier}
              className="self-start rounded-[9px] border border-border-2 bg-surface-2 px-3.5 py-1.5 text-[13px] font-semibold text-ink"
            >
              + Add tier
            </button>
          </div>
        </SectionCard>
      )}
    </div>
  );
}
