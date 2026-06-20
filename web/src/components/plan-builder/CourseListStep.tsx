"use client";

import { useState } from "react";
import CourseFormFields from "@/components/CourseFormFields";
import { emptyCourse, validateCourseDraft } from "@/lib/planBuilder";
import type { CourseRecord } from "@/types/simulation";

interface RowProps {
  course: CourseRecord;
  allCourseCodes: string[];
  onSave: (updated: CourseRecord) => void;
  onRemove: () => void;
}

// All edits here are purely local React state (no network calls) — the wizard only talks
// to the backend once, on the final "Save plan" step (POST /plans/import).
function CourseRow({ course, allCourseCodes, onSave, onRemove }: RowProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<CourseRecord>(course);

  if (!editing) {
    return (
      <tr>
        <td className="border-b border-border px-3 py-2 font-semibold">{course.code}</td>
        <td className="border-b border-border px-3 py-2">{course.title}</td>
        <td className="border-b border-border px-3 py-2 text-muted">{course.category}</td>
        <td className="border-b border-border px-3 py-2 text-muted">{course.pass_rate.toFixed(2)}</td>
        <td className="border-b border-border px-3 py-2">
          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={() => {
                setDraft(course);
                setEditing(true);
              }}
              className="font-semibold text-accent"
            >
              Edit
            </button>
            <button type="button" onClick={onRemove} className="font-semibold text-bad">
              Remove
            </button>
          </div>
        </td>
      </tr>
    );
  }

  return (
    <tr>
      <td colSpan={5} className="border-b border-border bg-surface-2 px-3 py-3">
        <CourseFormFields value={draft} allCourseCodes={allCourseCodes} onChange={setDraft} />
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            onClick={() => {
              onSave(draft);
              setEditing(false);
            }}
            className="rounded-[9px] bg-accent px-3.5 py-1.5 font-semibold text-white"
          >
            Save
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

export default function CourseListStep({
  courses,
  onChange,
}: {
  courses: CourseRecord[];
  onChange: (next: CourseRecord[]) => void;
}) {
  const [adding, setAdding] = useState(courses.length === 0);
  const [draft, setDraft] = useState<CourseRecord>(emptyCourse());
  const [error, setError] = useState<string | null>(null);

  const codes = courses.map((c) => c.code);

  const addCourse = () => {
    const validationError = validateCourseDraft(draft, codes);
    if (validationError) {
      setError(validationError);
      return;
    }
    onChange([...courses, { ...draft, code: draft.code.trim() }]);
    setDraft(emptyCourse());
    setError(null);
    setAdding(false);
  };

  return (
    <div className="flex flex-col gap-4">
      <p className="text-[12.5px] text-muted">
        {courses.length} course{courses.length === 1 ? "" : "s"} — at least one is required before continuing.
      </p>

      {courses.length > 0 && (
        <div className="max-h-[440px] overflow-auto rounded-lg border border-border">
          <table className="w-full border-collapse text-[12.5px]">
            <thead>
              <tr>
                {["Course", "Title", "Category", "Pass rate", ""].map((h) => (
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
                <CourseRow
                  key={course.code}
                  course={course}
                  allCourseCodes={codes.filter((c) => c !== course.code)}
                  onSave={(updated) => onChange(courses.map((c) => (c.code === course.code ? updated : c)))}
                  onRemove={() => onChange(courses.filter((c) => c.code !== course.code))}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {adding ? (
        <div className="rounded-lg border border-border bg-surface-2 p-4">
          <CourseFormFields value={draft} allCourseCodes={codes} onChange={setDraft} editableCode />
          {error && <p className="mt-2 text-[12.5px] text-bad">{error}</p>}
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={addCourse}
              className="rounded-[9px] bg-accent px-3.5 py-1.5 text-[12.5px] font-semibold text-white"
            >
              Add course
            </button>
            {courses.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  setAdding(false);
                  setError(null);
                }}
                className="rounded-[9px] border border-border-2 bg-surface px-3.5 py-1.5 text-[12.5px] font-semibold text-ink"
              >
                Cancel
              </button>
            )}
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="self-start font-semibold text-accent text-[12.5px]"
        >
          + Add course
        </button>
      )}
    </div>
  );
}
