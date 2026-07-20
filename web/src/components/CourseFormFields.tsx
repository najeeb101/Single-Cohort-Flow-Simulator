"use client";

import type { CourseRecord, RuleExpr } from "@/types/simulation";
import RuleExprEditor from "./settings/RuleExprEditor";

// The seasons a course may be offered in default to the legacy Fall/Spring cycle; callers that
// know the plan's real calendar pass its `terms_per_year` (Settings via `/meta`, Plan
// Builder via the plan being composed) so this list is never hardcoded to one season set.
const DEFAULT_SEASONS = ["Fall", "Spring"];

interface Props {
  value: CourseRecord;
  allCourseCodes: string[]; // should exclude value.code
  knownCategories?: string[]; // categories already used elsewhere in this plan, for autocomplete
  seasons?: string[]; // the plan's season cycle (terms_per_year); defaults to Fall/Spring
  onChange: (next: CourseRecord) => void;
  editableCode?: boolean; // true when creating a new course (code not yet fixed)
  hidePassRate?: boolean; // Settings edits pass rate inline in the curriculum table instead
  hideCapacity?: boolean; // Settings edits capacity inline in the curriculum table instead
  // Prerequisites/rule_expr are write-once: set only when a course is first created (here with
  // editableCode, or in Plan Builder's course step), then immutable — they define eligibility,
  // which drives the whole deterministic trajectory, so changing them on an existing course
  // would silently invalidate any run built on the old graph. When true, this renders the
  // current prerequisites/rule as read-only instead of editable checkboxes/rule builder. The
  // backend enforces the same lock independently (PUT /curriculum/{code} rejects a diff to
  // either field) — this prop is the UI-side mirror of that, not the only guard.
  lockPrerequisites?: boolean;
}

// Controlled course-field form shared by the Settings curriculum editor (editing/adding a
// row in the active plan) and the Plan Builder wizard (composing a brand-new plan client-side
// before anything is saved) — no server calls here, just `value`/`onChange`.
export default function CourseFormFields({ value, allCourseCodes, knownCategories, seasons, onChange, editableCode, hidePassRate, hideCapacity, lockPrerequisites }: Props) {
  const offerings = seasons && seasons.length ? seasons : DEFAULT_SEASONS;
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
    <div className="flex flex-col gap-3 text-sm">
      <div className="flex flex-wrap gap-3">
        {editableCode && (
          <label className="flex flex-col gap-1 text-muted">
            Code
            <input
              value={value.code}
              onChange={(e) => onChange({ ...value, code: e.target.value.trim() })}
              className="w-32 rounded-lg border border-border-2 bg-surface px-2.5 py-1.5 text-ink"
            />
          </label>
        )}
        <label className="flex flex-col gap-1 text-muted">
          Title
          <input
            value={value.title}
            onChange={(e) => onChange({ ...value, title: e.target.value })}
            className="rounded-lg border border-border-2 bg-surface px-2.5 py-1.5 text-ink"
          />
        </label>
        <label className="flex flex-col gap-1 text-muted">
          Category
          <input
            value={value.category}
            onChange={(e) => onChange({ ...value, category: e.target.value })}
            list="course-category-options"
            placeholder="e.g. core, elective"
            className="w-40 rounded-lg border border-border-2 bg-surface px-2.5 py-1.5 text-ink"
          />
          <datalist id="course-category-options">
            {(knownCategories ?? []).map((cat) => (
              <option key={cat} value={cat} />
            ))}
          </datalist>
        </label>
        <label className="flex flex-col gap-1 text-muted">
          Credits
          <input
            type="number"
            min={0}
            max={6}
            value={value.credits}
            onChange={(e) => onChange({ ...value, credits: Number(e.target.value) })}
            className="w-20 rounded-lg border border-border-2 bg-surface px-2.5 py-1.5 text-ink"
          />
        </label>
        {!hidePassRate && (
          <label className="flex flex-col gap-1 text-muted">
            Pass rate
            <input
              type="number"
              min={0}
              max={1}
              step={0.01}
              value={value.pass_rate}
              onChange={(e) => onChange({ ...value, pass_rate: Number(e.target.value) })}
              className="w-24 rounded-lg border border-border-2 bg-surface px-2.5 py-1.5 text-ink"
            />
          </label>
        )}
        {!hideCapacity && (
          <label className="flex flex-col gap-1 text-muted">
            Capacity / offering
            <input
              type="number"
              min={1}
              value={value.capacity}
              onChange={(e) => onChange({ ...value, capacity: Number(e.target.value) })}
              className="w-24 rounded-lg border border-border-2 bg-surface px-2.5 py-1.5 text-ink"
            />
          </label>
        )}
        <label className="flex flex-col gap-1 text-muted" title="Recommended semester column in the flow chart (0 = unscheduled)">
          Plan term
          <input
            type="number"
            min={0}
            max={20}
            value={value.study_plan_term}
            onChange={(e) => onChange({ ...value, study_plan_term: Number(e.target.value) })}
            className="w-20 rounded-lg border border-border-2 bg-surface px-2.5 py-1.5 text-ink"
          />
        </label>
      </div>

      <div className="flex flex-wrap gap-4">
        <div className="flex flex-col gap-1">
          <span className="text-muted">Offered</span>
          <div className="flex gap-3">
            {offerings.map((season) => (
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
          {lockPrerequisites ? (
            <div className="flex max-w-md flex-wrap gap-1.5">
              {value.prerequisites.length ? (
                value.prerequisites.map((c) => (
                  <span key={c} className="rounded-md border border-border-2 bg-surface-2 px-2 py-0.5 text-ink">
                    {c}
                  </span>
                ))
              ) : (
                <span className="text-muted">None</span>
              )}
            </div>
          ) : (
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
          )}
          {lockPrerequisites && (
            <span className="text-xs text-muted">Locked — set when a course is first created, not editable afterward.</span>
          )}
        </div>
      </div>

      <div>
        <div className="flex items-center gap-2">
          <span className="text-muted">Compound eligibility rule</span>
          {!lockPrerequisites && (
            value.rule_expr === null ? (
              <button type="button" onClick={addRule} className="text-xs font-semibold text-accent hover:underline">
                + Add rule
              </button>
            ) : (
              <button type="button" onClick={removeRule} className="text-xs font-semibold text-bad hover:underline">
                Remove rule
              </button>
            )
          )}
        </div>
        {value.rule_expr !== null && (
          lockPrerequisites ? (
            <p className="mt-1 text-xs text-muted">Uses a compound eligibility rule (locked — not editable).</p>
          ) : (
            <div className="mt-1 rounded-lg border border-border bg-surface p-3">
              <RuleExprEditor
                expr={value.rule_expr as RuleExpr}
                allCourseCodes={allCourseCodes}
                onChange={(next) => onChange({ ...value, rule_expr: next })}
              />
            </div>
          )
        )}
      </div>
    </div>
  );
}
