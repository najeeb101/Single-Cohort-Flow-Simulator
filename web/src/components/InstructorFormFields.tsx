"use client";

import type { InstructorRecord } from "@/types/simulation";
import { CATEGORIES } from "./CourseFormFields";

interface Props {
  value: InstructorRecord;
  onChange: (next: InstructorRecord) => void;
  editableName?: boolean; // true when creating a new instructor (name not yet fixed)
}

// Controlled instructor-field form shared by the Settings instructor editor — no server
// calls here, just `value`/`onChange`, mirroring CourseFormFields.tsx's pattern.
export default function InstructorFormFields({ value, onChange, editableName }: Props) {
  const toggleCategory = (category: string) => {
    const has = value.categories.includes(category);
    onChange({
      ...value,
      categories: has ? value.categories.filter((c) => c !== category) : [...value.categories, category],
    });
  };

  return (
    <div className="flex flex-col gap-3 text-[12.5px]">
      <div className="flex flex-wrap gap-3">
        <label className="flex flex-col gap-1 text-muted">
          Name
          <input
            value={value.name}
            disabled={!editableName}
            onChange={(e) => onChange({ ...value, name: e.target.value })}
            className="w-56 rounded-[8px] border border-border-2 bg-surface px-2.5 py-1.5 text-ink disabled:opacity-60"
          />
        </label>
        <label className="flex flex-col gap-1 text-muted">
          Max sections / term
          <input
            type="number"
            min={0}
            value={value.max_sections_per_term}
            onChange={(e) => onChange({ ...value, max_sections_per_term: Number(e.target.value) })}
            className="w-32 rounded-[8px] border border-border-2 bg-surface px-2.5 py-1.5 text-ink"
          />
        </label>
      </div>

      <div className="flex flex-col gap-1">
        <span className="text-muted">Qualified categories</span>
        <div className="flex max-w-md flex-wrap gap-1.5">
          {CATEGORIES.map((cat) => (
            <label key={cat} className="flex items-center gap-1 text-ink">
              <input
                type="checkbox"
                checked={value.categories.includes(cat)}
                onChange={() => toggleCategory(cat)}
                className="accent-[var(--accent)]"
              />
              {cat}
            </label>
          ))}
        </div>
      </div>
    </div>
  );
}
