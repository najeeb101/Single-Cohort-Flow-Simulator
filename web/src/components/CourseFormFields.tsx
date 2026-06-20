"use client";

import type { CourseRecord, RuleExpr } from "@/types/simulation";
import RuleExprEditor from "./settings/RuleExprEditor";

export const CATEGORIES = ["cs_core", "cs_elective", "college_req", "math", "science", "english", "gen_ed"] as const;
const OFFERINGS = ["Fall", "Spring"] as const;

interface Props {
  value: CourseRecord;
  allCourseCodes: string[]; // should exclude value.code
  onChange: (next: CourseRecord) => void;
  editableCode?: boolean; // true when creating a new course (code not yet fixed)
}

// Controlled course-field form shared by the Settings curriculum editor (editing/adding a
// row in the active plan) and the Plan Builder wizard (composing a brand-new plan client-side
// before anything is saved) — no server calls here, just `value`/`onChange`.
export default function CourseFormFields({ value, allCourseCodes, onChange, editableCode }: Props) {
  const toggleOffering = (season: string) => {
    const has = value.offering.includes(season);
    onChange({ ...value, offering: has ? value.offering.filter((o) => o !== season) : [...value.offering, season] });
  };

  const togglePrereq = (code: string) => {
    const has = value.prerequisites.includes(code);
    onChange({
      ...value,
      prerequisites: has ? value.prerequisites.filter((c) => c !== code) : [...value.prerequisites, code],
    });
  };

  const addRule = () => onChange({ ...value, rule_expr: { all: [] } });
  const removeRule = () => onChange({ ...value, rule_expr: null });

  return (
    <div className="flex flex-col gap-3 text-[12.5px]">
      <div className="flex flex-wrap gap-3">
        {editableCode && (
          <label className="flex flex-col gap-1 text-muted">
            Code
            <input
              value={value.code}
              onChange={(e) => onChange({ ...value, code: e.target.value.trim() })}
              className="w-32 rounded-[8px] border border-border-2 bg-surface px-2.5 py-1.5 text-ink"
            />
          </label>
        )}
        <label className="flex flex-col gap-1 text-muted">
          Title
          <input
            value={value.title}
            onChange={(e) => onChange({ ...value, title: e.target.value })}
            className="rounded-[8px] border border-border-2 bg-surface px-2.5 py-1.5 text-ink"
          />
        </label>
        <label className="flex flex-col gap-1 text-muted">
          Category
          <select
            value={value.category}
            onChange={(e) => onChange({ ...value, category: e.target.value })}
            className="rounded-[8px] border border-border-2 bg-surface px-2.5 py-1.5 text-ink"
          >
            {CATEGORIES.map((cat) => (
              <option key={cat} value={cat}>
                {cat}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-muted">
          Credits
          <input
            type="number"
            min={0}
            max={6}
            value={value.credits}
            onChange={(e) => onChange({ ...value, credits: Number(e.target.value) })}
            className="w-20 rounded-[8px] border border-border-2 bg-surface px-2.5 py-1.5 text-ink"
          />
        </label>
        <label className="flex flex-col gap-1 text-muted">
          Pass rate
          <input
            type="number"
            min={0}
            max={1}
            step={0.01}
            value={value.pass_rate}
            onChange={(e) => onChange({ ...value, pass_rate: Number(e.target.value) })}
            className="w-24 rounded-[8px] border border-border-2 bg-surface px-2.5 py-1.5 text-ink"
          />
        </label>
        <label className="flex flex-col gap-1 text-muted">
          Capacity / offering
          <input
            type="number"
            min={1}
            value={value.capacity}
            onChange={(e) => onChange({ ...value, capacity: Number(e.target.value) })}
            className="w-24 rounded-[8px] border border-border-2 bg-surface px-2.5 py-1.5 text-ink"
          />
        </label>
      </div>

      <div className="flex flex-wrap gap-4">
        <div className="flex flex-col gap-1">
          <span className="text-muted">Offered</span>
          <div className="flex gap-3">
            {OFFERINGS.map((season) => (
              <label key={season} className="flex items-center gap-1.5 text-ink">
                <input
                  type="checkbox"
                  checked={value.offering.includes(season)}
                  onChange={() => toggleOffering(season)}
                  className="accent-[var(--accent)]"
                />
                {season}
              </label>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-1">
          <span className="text-muted">Prerequisites</span>
          <div className="flex max-w-md flex-wrap gap-1.5">
            {allCourseCodes.map((c) => (
              <label key={c} className="flex items-center gap-1 text-ink">
                <input
                  type="checkbox"
                  checked={value.prerequisites.includes(c)}
                  onChange={() => togglePrereq(c)}
                  className="accent-[var(--accent)]"
                />
                {c}
              </label>
            ))}
          </div>
        </div>
      </div>

      <div>
        <div className="flex items-center gap-2">
          <span className="text-muted">Compound eligibility rule</span>
          {value.rule_expr === null ? (
            <button type="button" onClick={addRule} className="text-[11px] font-semibold text-accent hover:underline">
              + Add rule
            </button>
          ) : (
            <button type="button" onClick={removeRule} className="text-[11px] font-semibold text-bad hover:underline">
              Remove rule
            </button>
          )}
        </div>
        {value.rule_expr !== null && (
          <div className="mt-1 rounded-lg border border-border bg-surface p-3">
            <RuleExprEditor
              expr={value.rule_expr as RuleExpr}
              allCourseCodes={allCourseCodes}
              onChange={(next) => onChange({ ...value, rule_expr: next })}
            />
          </div>
        )}
      </div>
    </div>
  );
}
