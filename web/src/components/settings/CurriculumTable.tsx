"use client";

import { useState } from "react";
import { ApiError, createCourse, deleteCourse, updateCourse } from "@/lib/api";
import { validateCourseDraft } from "@/lib/planBuilder";
import type { CourseRecord, CourseUpdate } from "@/types/simulation";
import CourseFormFields from "@/components/CourseFormFields";
import { NumberBox } from "@/components/scenario-builder/fields";

const BLANK_COURSE: CourseRecord = {
  code: "",
  title: "",
  credits: 3,
  prerequisites: [],
  pass_rate: 0.85,
  offering: ["Fall", "Spring"],
  category: "",
  capacity: 30,
  rule_expr: null,
  study_plan_order: 99,
  study_plan_term: 0,
};

// A deferred, inline-editable numeric column threaded from Settings (occupancy, pass rate).
// These fold the old standalone "initial occupancy" and "all courses — pass rate" tables into
// this one table. Both are *deferred* — edits land in the parent's BuilderState and persist with
// "Save as new baseline" (occupancy → PUT /config initial_state; pass rate → per-course
// PUT /curriculum), exactly as the standalone tables did.
interface DeferredCol {
  value: number;
  baseline: number;
  onChange: (value: number) => void;
}

interface RowProps {
  course: CourseRecord;
  allCourseCodes: string[];
  knownCategories: string[];
  seasons: string[];
  colSpan: number;
  occupancy?: DeferredCol;
  passRate?: DeferredCol; // when set, Pass rate is inline-editable (and dropped from the edit form)
  capacity?: DeferredCol; // when set, Capacity is inline-editable (and dropped from the edit form)
  onSaved: (updated: CourseRecord) => void;
  onDeleted: (code: string) => void;
}

function OccupancyCells({ capacity, occ }: { capacity: number; occ: DeferredCol }) {
  const exceeds = occ.value > capacity;
  const free = Math.max(0, capacity - occ.value);
  const dirty = Math.abs(occ.value - occ.baseline) > 1e-9;
  return (
    <>
      <td className={`border-b border-border px-3 py-2 ${dirty ? "bg-accent/[0.07]" : ""}`}>
        <div className="w-20">
          <NumberBox value={occ.value} onChange={occ.onChange} min={0} step={1} />
        </div>
      </td>
      <td className={`whitespace-nowrap border-b border-border px-3 py-2 tabular-nums ${exceeds ? "text-bad" : "text-muted"}`}>
        {free}
        {exceeds && <span className="ml-1.5 text-xs">exceeds capacity</span>}
      </td>
    </>
  );
}

function PassRateCell({ pr }: { pr: DeferredCol }) {
  const dirty = Math.abs(pr.value - pr.baseline) > 1e-9;
  return (
    <td className={`border-b border-border px-3 py-2 ${dirty ? "bg-accent/[0.07]" : ""}`}>
      <div className="w-20">
        <NumberBox value={pr.value} onChange={pr.onChange} min={0} max={1} step={0.01} />
      </div>
    </td>
  );
}

function CapacityCell({ cap }: { cap: DeferredCol }) {
  const dirty = Math.abs(cap.value - cap.baseline) > 1e-9;
  return (
    <td className={`border-b border-border px-3 py-2 ${dirty ? "bg-accent/[0.07]" : ""}`}>
      <div className="w-20">
        <NumberBox value={cap.value} onChange={cap.onChange} min={1} step={1} />
      </div>
    </td>
  );
}

function CurriculumRow({ course, allCourseCodes, knownCategories, seasons, colSpan, occupancy, passRate, capacity, onSaved, onDeleted }: RowProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<CourseRecord>(course);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const startEdit = () => {
    setDraft(course);
    setError(null);
    setEditing(true);
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    // prerequisites/rule_expr are write-once (set only at course creation) — the backend
    // rejects a PUT that changes either, so they're never included in an edit patch here. The
    // edit form renders them read-only (CourseFormFields' lockPrerequisites) to match.
    const patch: CourseUpdate = {
      title: draft.title,
      credits: draft.credits,
      offering: draft.offering,
      category: draft.category,
      study_plan_order: draft.study_plan_order,
    };
    // Pass rate and capacity each have their own inline (deferred) column when set, so the edit
    // form neither shows nor saves them — leaving them to "Save as new baseline". Otherwise the
    // edit form owns the value and saves it here.
    if (!passRate) patch.pass_rate = draft.pass_rate;
    if (!capacity) patch.capacity = draft.capacity;
    try {
      const updated = await updateCourse(course.code, patch);
      onSaved(updated);
      setEditing(false);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!window.confirm(`Delete ${course.code}? This cannot be undone.`)) return;
    setBusy(true);
    setError(null);
    try {
      await deleteCourse(course.code);
      onDeleted(course.code);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Delete failed");
      setBusy(false);
    }
  };

  // The normal row (with its inline Pass rate / Capacity / Occupancy cells) stays rendered even
  // while editing — the structural form opens as an *expansion row* beneath it rather than
  // replacing it, so those inline columns don't vanish the moment you click Edit.
  return (
    <>
      <tr>
        <td className="border-b border-border px-3 py-2 font-semibold">{course.code}</td>
        <td className="border-b border-border px-3 py-2">{course.title}</td>
        <td className="border-b border-border px-3 py-2 text-muted">{course.category}</td>
        {passRate ? <PassRateCell pr={passRate} /> : <td className="border-b border-border px-3 py-2 text-muted">{course.pass_rate.toFixed(2)}</td>}
        {capacity ? <CapacityCell cap={capacity} /> : <td className="border-b border-border px-3 py-2 tabular-nums text-muted">{course.capacity}</td>}
        {occupancy && <OccupancyCells capacity={capacity ? capacity.value : course.capacity} occ={occupancy} />}
        <td className="border-b border-border px-3 py-2">
          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={editing ? () => setEditing(false) : startEdit}
              disabled={busy}
              className="font-semibold text-accent disabled:opacity-50"
            >
              {editing ? "Close" : "Edit"}
            </button>
            <button type="button" onClick={remove} disabled={busy} className="font-semibold text-bad disabled:opacity-50">
              Delete
            </button>
          </div>
          {error && !editing && <p className="mt-1 text-right text-sm text-bad">{error}</p>}
        </td>
      </tr>

      {editing && (
        <tr>
          <td colSpan={colSpan} className="border-b border-border bg-surface-2 px-3 py-3">
            <CourseFormFields value={draft} allCourseCodes={allCourseCodes} knownCategories={knownCategories} seasons={seasons} onChange={setDraft} hidePassRate={!!passRate} hideCapacity={!!capacity} lockPrerequisites />
            {(passRate || capacity) && (
              <p className="mt-1 text-xs text-muted">
                {[passRate && "Pass rate", capacity && "Capacity"].filter(Boolean).join(" and ")} {passRate && capacity ? "are" : "is"} edited in{" "}
                {passRate && capacity ? "their columns above" : "its column above"} and saved with &ldquo;Save as new baseline&rdquo;.
              </p>
            )}

            {error && <p className="mt-2 text-bad">{error}</p>}

            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={save}
                disabled={busy}
                className="rounded-xl bg-accent px-3.5 py-1.5 font-semibold text-white disabled:opacity-50"
              >
                {busy ? "Saving…" : "Save"}
              </button>
              <button
                type="button"
                onClick={() => setEditing(false)}
                className="rounded-xl border border-border-2 bg-surface px-3.5 py-1.5 font-semibold text-ink"
              >
                Cancel
              </button>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function AddCourseRow({
  allCourseCodes,
  knownCategories,
  seasons,
  colSpan,
  onAdded,
}: {
  allCourseCodes: string[];
  knownCategories: string[];
  seasons: string[];
  colSpan: number;
  onAdded: (created: CourseRecord) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<CourseRecord>(BLANK_COURSE);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!open) {
    return (
      <tr>
        <td colSpan={colSpan} className="px-3 py-2">
          <button type="button" onClick={() => setOpen(true)} className="font-semibold text-accent">
            + Add course
          </button>
        </td>
      </tr>
    );
  }

  const add = async () => {
    const validationError = validateCourseDraft(draft, allCourseCodes, seasons);
    if (validationError) {
      setError(validationError);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const created = await createCourse({ ...draft, code: draft.code.trim() });
      onAdded(created);
      setDraft(BLANK_COURSE);
      setOpen(false);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Create failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <tr>
      <td colSpan={colSpan} className="border-b border-border bg-surface-2 px-3 py-3">
        <CourseFormFields value={draft} allCourseCodes={allCourseCodes} knownCategories={knownCategories} seasons={seasons} onChange={setDraft} editableCode />

        {error && <p className="mt-2 text-bad">{error}</p>}

        <div className="mt-3 flex gap-2">
          <button
            type="button"
            onClick={add}
            disabled={busy}
            className="rounded-xl bg-accent px-3.5 py-1.5 font-semibold text-white disabled:opacity-50"
          >
            {busy ? "Adding…" : "Add course"}
          </button>
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              setDraft(BLANK_COURSE);
              setError(null);
            }}
            className="rounded-xl border border-border-2 bg-surface px-3.5 py-1.5 font-semibold text-ink"
          >
            Cancel
          </button>
        </div>
      </td>
    </tr>
  );
}

export default function CurriculumTable({
  courses,
  onChange,
  seasons,
  occupancy,
  baselineOccupancy,
  onOccupancyChange,
  passRates,
  baselinePassRates,
  onPassRateChange,
  capacities,
  baselineCapacities,
  onCapacityChange,
}: {
  courses: CourseRecord[];
  onChange: (next: CourseRecord[]) => void;
  seasons: string[]; // the active plan's season cycle (meta.terms_per_year)
  // When provided, the table shows an editable initial-occupancy column (deferred save).
  occupancy?: Record<string, number>;
  baselineOccupancy?: Record<string, number>;
  onOccupancyChange?: (code: string, value: number) => void;
  // When provided, the Pass rate column becomes inline-editable (deferred save).
  passRates?: Record<string, number>;
  baselinePassRates?: Record<string, number>;
  onPassRateChange?: (code: string, value: number) => void;
  // When provided, the Capacity column becomes inline-editable (deferred save).
  capacities?: Record<string, number>;
  baselineCapacities?: Record<string, number>;
  onCapacityChange?: (code: string, value: number) => void;
}) {
  const knownCategories = Array.from(new Set(courses.map((c) => c.category))).filter(Boolean).sort();
  const hasOccupancy = onOccupancyChange !== undefined;
  const hasPassRate = onPassRateChange !== undefined;
  const hasCapacity = onCapacityChange !== undefined;
  const headers = hasOccupancy
    ? ["Course", "Title", "Category", "Pass rate", "Capacity", "Occupancy", "Free / term", ""]
    : ["Course", "Title", "Category", "Pass rate", "Capacity", ""];
  const colSpan = headers.length;

  const handleSaved = (updated: CourseRecord) => {
    onChange(courses.map((c) => (c.code === updated.code ? updated : c)));
  };

  const handleDeleted = (code: string) => {
    onChange(courses.filter((c) => c.code !== code));
  };

  const handleAdded = (created: CourseRecord) => {
    onChange([...courses, created]);
  };

  return (
    <div className="max-h-[560px] overflow-auto rounded-lg border border-border">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr>
            {headers.map((h, i) => (
              <th
                key={h || `col-${i}`}
                className="sticky top-0 border-b border-border bg-surface px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {courses.map((course) => (
            <CurriculumRow
              key={course.code}
              course={course}
              allCourseCodes={courses.map((c) => c.code).filter((c) => c !== course.code)}
              knownCategories={knownCategories}
              seasons={seasons}
              colSpan={colSpan}
              occupancy={
                hasOccupancy
                  ? {
                      value: occupancy?.[course.code] ?? 0,
                      baseline: baselineOccupancy?.[course.code] ?? 0,
                      onChange: (v) => onOccupancyChange!(course.code, v),
                    }
                  : undefined
              }
              passRate={
                hasPassRate
                  ? {
                      value: passRates?.[course.code] ?? course.pass_rate,
                      baseline: baselinePassRates?.[course.code] ?? course.pass_rate,
                      onChange: (v) => onPassRateChange!(course.code, v),
                    }
                  : undefined
              }
              capacity={
                hasCapacity
                  ? {
                      value: capacities?.[course.code] ?? course.capacity,
                      baseline: baselineCapacities?.[course.code] ?? course.capacity,
                      onChange: (v) => onCapacityChange!(course.code, v),
                    }
                  : undefined
              }
              onSaved={handleSaved}
              onDeleted={handleDeleted}
            />
          ))}
          <AddCourseRow allCourseCodes={courses.map((c) => c.code)} knownCategories={knownCategories} seasons={seasons} colSpan={colSpan} onAdded={handleAdded} />
        </tbody>
      </table>
    </div>
  );
}
