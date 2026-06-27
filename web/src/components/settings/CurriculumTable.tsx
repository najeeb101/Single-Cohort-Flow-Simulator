"use client";

import { useState } from "react";
import { ApiError, createCourse, deleteCourse, updateCourse } from "@/lib/api";
import { validateCourseDraft } from "@/lib/planBuilder";
import type { CourseRecord, CourseUpdate } from "@/types/simulation";
import CourseFormFields from "@/components/CourseFormFields";

const BLANK_COURSE: CourseRecord = {
  code: "",
  title: "",
  credits: 3,
  prerequisites: [],
  pass_rate: 0.85,
  offering: ["Fall", "Spring"],
  category: "cs_elective",
  capacity: 30,
  rule_expr: null,
  study_plan_order: 99,
  study_plan_term: 0,
};

interface RowProps {
  course: CourseRecord;
  allCourseCodes: string[];
  onSaved: (updated: CourseRecord) => void;
  onDeleted: (code: string) => void;
}

function CurriculumRow({ course, allCourseCodes, onSaved, onDeleted }: RowProps) {
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

  if (!editing) {
    return (
      <tr>
        <td className="border-b border-border px-3 py-2 font-semibold">{course.code}</td>
        <td className="border-b border-border px-3 py-2">{course.title}</td>
        <td className="border-b border-border px-3 py-2 text-muted">{course.category}</td>
        <td className="border-b border-border px-3 py-2 text-muted">{course.pass_rate.toFixed(2)}</td>
        <td className="border-b border-border px-3 py-2 text-muted">{course.capacity}</td>
        <td className="border-b border-border px-3 py-2">
          <div className="flex justify-end gap-3">
            <button type="button" onClick={startEdit} disabled={busy} className="font-semibold text-accent disabled:opacity-50">
              Edit
            </button>
            <button type="button" onClick={remove} disabled={busy} className="font-semibold text-bad disabled:opacity-50">
              Delete
            </button>
          </div>
          {error && <p className="mt-1 text-right text-[11px] text-bad">{error}</p>}
        </td>
      </tr>
    );
  }

  return (
    <tr>
      <td colSpan={6} className="border-b border-border bg-surface-2 px-3 py-3">
        <CourseFormFields value={draft} allCourseCodes={allCourseCodes} onChange={setDraft} />

        {error && <p className="mt-2 text-bad">{error}</p>}

        <div className="mt-3 flex gap-2">
          <button
            type="button"
            onClick={save}
            disabled={busy}
            className="rounded-[9px] bg-accent px-3.5 py-1.5 font-semibold text-white disabled:opacity-50"
          >
            {busy ? "Saving…" : "Save"}
          </button>
          <button
            type="button"
            onClick={() => setEditing(false)}
            className="rounded-[9px] border border-border-2 bg-surface px-3.5 py-1.5 font-semibold text-ink"
          >
            Cancel
          </button>
        </div>
      </td>
    </tr>
  );
}

function AddCourseRow({ allCourseCodes, onAdded }: { allCourseCodes: string[]; onAdded: (created: CourseRecord) => void }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<CourseRecord>(BLANK_COURSE);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!open) {
    return (
      <tr>
        <td colSpan={6} className="px-3 py-2">
          <button type="button" onClick={() => setOpen(true)} className="font-semibold text-accent">
            + Add course
          </button>
        </td>
      </tr>
    );
  }

  const add = async () => {
    const validationError = validateCourseDraft(draft, allCourseCodes);
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
      <td colSpan={6} className="border-b border-border bg-surface-2 px-3 py-3">
        <CourseFormFields value={draft} allCourseCodes={allCourseCodes} onChange={setDraft} editableCode />

        {error && <p className="mt-2 text-bad">{error}</p>}

        <div className="mt-3 flex gap-2">
          <button
            type="button"
            onClick={add}
            disabled={busy}
            className="rounded-[9px] bg-accent px-3.5 py-1.5 font-semibold text-white disabled:opacity-50"
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
            className="rounded-[9px] border border-border-2 bg-surface px-3.5 py-1.5 font-semibold text-ink"
          >
            Cancel
          </button>
        </div>
      </td>
    </tr>
  );
}

export default function CurriculumTable({ courses, onChange }: { courses: CourseRecord[]; onChange: (next: CourseRecord[]) => void }) {
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
            <CurriculumRow
              key={course.code}
              course={course}
              allCourseCodes={courses.map((c) => c.code).filter((c) => c !== course.code)}
              onSaved={handleSaved}
              onDeleted={handleDeleted}
            />
          ))}
          <AddCourseRow allCourseCodes={courses.map((c) => c.code)} onAdded={handleAdded} />
        </tbody>
      </table>
    </div>
  );
}
