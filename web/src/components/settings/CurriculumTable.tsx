"use client";

import { useState } from "react";
import { ApiError, updateCourse } from "@/lib/api";
import type { CourseRecord, CourseUpdate, RuleExpr } from "@/types/simulation";
import RuleExprEditor from "./RuleExprEditor";

const OFFERINGS = ["Fall", "Spring"] as const;

interface RowProps {
  course: CourseRecord;
  allCourseCodes: string[];
  onSaved: (updated: CourseRecord) => void;
}

function CurriculumRow({ course, allCourseCodes, onSaved }: RowProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<CourseRecord>(course);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const startEdit = () => {
    setDraft(course);
    setError(null);
    setEditing(true);
  };

  const toggleOffering = (season: string) => {
    const has = draft.offering.includes(season);
    setDraft({ ...draft, offering: has ? draft.offering.filter((o) => o !== season) : [...draft.offering, season] });
  };

  const togglePrereq = (code: string) => {
    const has = draft.prerequisites.includes(code);
    setDraft({
      ...draft,
      prerequisites: has ? draft.prerequisites.filter((c) => c !== code) : [...draft.prerequisites, code],
    });
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    const patch: CourseUpdate = {
      title: draft.title,
      credits: draft.credits,
      prerequisites: draft.prerequisites,
      pass_rate: draft.pass_rate,
      offering: draft.offering,
      category: draft.category,
      capacity: draft.capacity,
      rule_expr: draft.rule_expr,
      study_plan_order: draft.study_plan_order,
    };
    try {
      const updated = await updateCourse(course.code, patch);
      onSaved(updated);
      setEditing(false);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  if (!editing) {
    return (
      <tr>
        <td className="border-b border-border px-3 py-2 font-semibold">{course.code}</td>
        <td className="border-b border-border px-3 py-2">{course.title}</td>
        <td className="border-b border-border px-3 py-2 text-muted">{course.category}</td>
        <td className="border-b border-border px-3 py-2 text-muted">{course.pass_rate.toFixed(2)}</td>
        <td className="border-b border-border px-3 py-2 text-muted">{course.capacity}</td>
        <td className="border-b border-border px-3 py-2">
          <button type="button" onClick={startEdit} className="font-semibold text-accent">
            Edit
          </button>
        </td>
      </tr>
    );
  }

  return (
    <tr>
      <td colSpan={6} className="border-b border-border bg-surface-2 px-3 py-3">
        <div className="flex flex-col gap-3 text-[12.5px]">
          <div className="flex flex-wrap gap-3">
            <label className="flex flex-col gap-1 text-muted">
              Title
              <input
                value={draft.title}
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                className="rounded-[8px] border border-border-2 bg-surface px-2.5 py-1.5 text-ink"
              />
            </label>
            <label className="flex flex-col gap-1 text-muted">
              Category
              <select
                value={draft.category}
                onChange={(e) => setDraft({ ...draft, category: e.target.value })}
                className="rounded-[8px] border border-border-2 bg-surface px-2.5 py-1.5 text-ink"
              >
                {["cs_core", "cs_elective", "college_req", "math", "science", "english", "gen_ed"].map((cat) => (
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
                value={draft.credits}
                onChange={(e) => setDraft({ ...draft, credits: Number(e.target.value) })}
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
                value={draft.pass_rate}
                onChange={(e) => setDraft({ ...draft, pass_rate: Number(e.target.value) })}
                className="w-24 rounded-[8px] border border-border-2 bg-surface px-2.5 py-1.5 text-ink"
              />
            </label>
            <label className="flex flex-col gap-1 text-muted">
              Capacity / offering
              <input
                type="number"
                min={1}
                value={draft.capacity}
                onChange={(e) => setDraft({ ...draft, capacity: Number(e.target.value) })}
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
                      checked={draft.offering.includes(season)}
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
                {allCourseCodes
                  .filter((c) => c !== course.code)
                  .map((c) => (
                    <label key={c} className="flex items-center gap-1 text-ink">
                      <input
                        type="checkbox"
                        checked={draft.prerequisites.includes(c)}
                        onChange={() => togglePrereq(c)}
                        className="accent-[var(--accent)]"
                      />
                      {c}
                    </label>
                  ))}
              </div>
            </div>
          </div>

          {draft.rule_expr !== null && (
            <div>
              <span className="text-muted">Compound eligibility rule</span>
              <div className="mt-1 rounded-lg border border-border bg-surface p-3">
                <RuleExprEditor
                  expr={draft.rule_expr as RuleExpr}
                  allCourseCodes={allCourseCodes.filter((c) => c !== course.code)}
                  onChange={(next) => setDraft({ ...draft, rule_expr: next })}
                />
              </div>
            </div>
          )}

          {error && <p className="text-bad">{error}</p>}

          <div className="flex gap-2">
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="rounded-[9px] bg-accent px-3.5 py-1.5 font-semibold text-white disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="rounded-[9px] border border-border-2 bg-surface px-3.5 py-1.5 font-semibold text-ink"
            >
              Cancel
            </button>
          </div>
        </div>
      </td>
    </tr>
  );
}

export default function CurriculumTable({ courses, onChange }: { courses: CourseRecord[]; onChange: (next: CourseRecord[]) => void }) {
  const allCourseCodes = courses.map((c) => c.code);

  const handleSaved = (updated: CourseRecord) => {
    onChange(courses.map((c) => (c.code === updated.code ? updated : c)));
  };

  return (
    <div className="max-h-[560px] overflow-auto rounded-lg border border-border">
      <table className="w-full border-collapse text-[12.5px]">
        <thead>
          <tr>
            {["Course", "Title", "Category", "Pass rate", "Capacity", ""].map((h) => (
              <th
                key={h}
                className="sticky top-0 border-b border-border bg-surface px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-muted"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {courses.map((course) => (
            <CurriculumRow key={course.code} course={course} allCourseCodes={allCourseCodes} onSaved={handleSaved} />
          ))}
        </tbody>
      </table>
    </div>
  );
}
