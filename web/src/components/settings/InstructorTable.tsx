"use client";

import { useState } from "react";
import { ApiError, createInstructor, deleteInstructor, updateInstructor } from "@/lib/api";
import type { InstructorRecord, InstructorUpdate } from "@/types/simulation";
import InstructorFormFields from "@/components/InstructorFormFields";

const BLANK_INSTRUCTOR: InstructorRecord = {
  id: 0,
  name: "",
  categories: [],
  max_sections_per_term: 3,
};

function validateInstructorDraft(draft: InstructorRecord): string | null {
  if (!draft.name.trim()) return "Name is required";
  if (draft.max_sections_per_term < 0) return "Max sections / term must be 0 or more";
  return null;
}

interface RowProps {
  instructor: InstructorRecord;
  onSaved: (updated: InstructorRecord) => void;
  onDeleted: (id: number) => void;
}

function InstructorRow({ instructor, onSaved, onDeleted }: RowProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<InstructorRecord>(instructor);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const startEdit = () => {
    setDraft(instructor);
    setError(null);
    setEditing(true);
  };

  const save = async () => {
    const validationError = validateInstructorDraft(draft);
    if (validationError) {
      setError(validationError);
      return;
    }
    setBusy(true);
    setError(null);
    const patch: InstructorUpdate = {
      name: draft.name,
      categories: draft.categories,
      max_sections_per_term: draft.max_sections_per_term,
    };
    try {
      const updated = await updateInstructor(instructor.id, patch);
      onSaved(updated);
      setEditing(false);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!window.confirm(`Delete ${instructor.name}? This cannot be undone.`)) return;
    setBusy(true);
    setError(null);
    try {
      await deleteInstructor(instructor.id);
      onDeleted(instructor.id);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Delete failed");
      setBusy(false);
    }
  };

  if (!editing) {
    return (
      <tr>
        <td className="border-b border-border px-3 py-2 font-semibold">{instructor.name}</td>
        <td className="border-b border-border px-3 py-2 text-muted">{instructor.categories.join(", ") || "—"}</td>
        <td className="border-b border-border px-3 py-2 text-muted">{instructor.max_sections_per_term}</td>
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
      <td colSpan={4} className="border-b border-border bg-surface-2 px-3 py-3">
        <InstructorFormFields value={draft} onChange={setDraft} />

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

function AddInstructorRow({ onAdded }: { onAdded: (created: InstructorRecord) => void }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<InstructorRecord>(BLANK_INSTRUCTOR);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!open) {
    return (
      <tr>
        <td colSpan={4} className="px-3 py-2">
          <button type="button" onClick={() => setOpen(true)} className="font-semibold text-accent">
            + Add instructor
          </button>
        </td>
      </tr>
    );
  }

  const add = async () => {
    const validationError = validateInstructorDraft(draft);
    if (validationError) {
      setError(validationError);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const created = await createInstructor({
        name: draft.name.trim(),
        categories: draft.categories,
        max_sections_per_term: draft.max_sections_per_term,
      });
      onAdded(created);
      setDraft(BLANK_INSTRUCTOR);
      setOpen(false);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Create failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <tr>
      <td colSpan={4} className="border-b border-border bg-surface-2 px-3 py-3">
        <InstructorFormFields value={draft} onChange={setDraft} editableName />

        {error && <p className="mt-2 text-bad">{error}</p>}

        <div className="mt-3 flex gap-2">
          <button
            type="button"
            onClick={add}
            disabled={busy}
            className="rounded-[9px] bg-accent px-3.5 py-1.5 font-semibold text-white disabled:opacity-50"
          >
            {busy ? "Adding…" : "Add instructor"}
          </button>
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              setDraft(BLANK_INSTRUCTOR);
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

export default function InstructorTable({
  instructors,
  onChange,
}: {
  instructors: InstructorRecord[];
  onChange: (next: InstructorRecord[]) => void;
}) {
  const handleSaved = (updated: InstructorRecord) => {
    onChange(instructors.map((i) => (i.id === updated.id ? updated : i)));
  };

  const handleDeleted = (id: number) => {
    onChange(instructors.filter((i) => i.id !== id));
  };

  const handleAdded = (created: InstructorRecord) => {
    onChange([...instructors, created]);
  };

  return (
    <div className="max-h-[560px] overflow-auto rounded-lg border border-border">
      <table className="w-full border-collapse text-[12.5px]">
        <thead>
          <tr>
            {["Name", "Qualified categories", "Max sections / term", ""].map((h) => (
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
          {instructors.map((instructor) => (
            <InstructorRow key={instructor.id} instructor={instructor} onSaved={handleSaved} onDeleted={handleDeleted} />
          ))}
          <AddInstructorRow onAdded={handleAdded} />
        </tbody>
      </table>
    </div>
  );
}
