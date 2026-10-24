"use client";

import { useMemo, useState } from "react";
import type { DataSource, PastIntake } from "@/types/simulation";
import { NumberBox, SectionCard } from "@/components/scenario-builder/fields";
import ImportModal, { nonNegativeInt, withoutHeader, type RowMapper } from "@/components/data/ImportModal";
import SourceTag from "@/components/data/SourceTag";

// "label,size" rows, most recent first, in file order.
const intakeMapper: RowMapper<PastIntake[]> = (raw) => {
  const value: PastIntake[] = [];
  const rows = withoutHeader(raw).map((cells) => {
    const key = (cells[0] ?? "").trim();
    const cell = (cells[1] ?? "").trim();
    const n = nonNegativeInt(cell);
    if (cells.length < 2 || typeof n === "string") {
      return { key, value: cell, status: "skipped" as const, note: typeof n === "string" ? n : "missing size" };
    }
    value.push({ label: key, size: n });
    return { key, value: cell, status: "ok" as const, note: `${n} students` };
  });
  return { value, count: value.length, rows };
};

// Today's CS student body is rebuilt from these: each past intake becomes a cohort that entered
// that many years ago (src/intake.py::resolve_incumbent_sizes pads older years with estimates).
export default function PastIntakesEditor({
  intakes,
  onChange,
  source,
  onSourceChange,
  minYears,
}: {
  intakes: PastIntake[];
  onChange: (next: PastIntake[]) => void;
  source: DataSource | undefined;
  onSourceChange: (next: DataSource) => void;
  minYears: number;
}) {
  const [importOpen, setImportOpen] = useState(false);
  const entered = intakes.filter((e) => e.size > 0);
  const mean = entered.length ? Math.round(entered.reduce((s, e) => s + e.size, 0) / entered.length) : null;
  const padded = Math.max(0, minYears - intakes.length);
  const nextLabel = useMemo(() => {
    const last = intakes[intakes.length - 1]?.label ?? "";
    const m = last.match(/^(.*?)(\d{4})$/);
    return m ? `${m[1]}${Number(m[2]) - 1}` : "";
  }, [intakes]);

  const set = (i: number, patch: Partial<PastIntake>) => onChange(intakes.map((e, j) => (j === i ? { ...e, ...patch } : e)));

  return (
    <SectionCard
      title="Past intakes"
      hint="most recent first"
      actions={
        <div className="flex items-center gap-2">
          <SourceTag value={source} onChange={onSourceChange} />
          <button type="button" onClick={() => setImportOpen(true)} className="rounded-md border border-border-2 px-2.5 py-1 text-xs font-semibold text-ink hover:bg-surface-2">
            Import from file
          </button>
        </div>
      }
    >
      <p className="mb-3 max-w-3xl text-xs text-muted">
        How many students each past CS intake admitted. The planner rebuilds today&apos;s students from these, so the next
        intake competes with the real student body. It uses at least {minYears} years
        {padded > 0 && (mean != null ? `; the ${padded} older year${padded === 1 ? "" : "s"} not listed are estimated at ${mean} (the average of these)` : "; years not listed are estimated")}.
      </p>
      <div className="overflow-auto rounded-lg border border-border">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr>
              {["Intake", "Students admitted", ""].map((h) => (
                <th key={h} className="border-b border-border bg-surface px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {intakes.map((e, i) => (
              <tr key={i} className="border-b border-border last:border-0">
                <td className="px-3 py-1.5">
                  <input
                    type="text"
                    value={e.label ?? ""}
                    aria-label={`Intake ${i + 1} label`}
                    onChange={(ev) => set(i, { label: ev.target.value })}
                    className="w-40 rounded-lg border border-border-2 bg-surface-2 px-2.5 py-1.5 text-sm text-ink focus:outline-none focus:ring-1 focus:ring-accent"
                  />
                </td>
                <td className="px-3 py-1.5">
                  <div className="w-28">
                    <NumberBox value={e.size} min={0} max={2000} step={1} onChange={(v) => set(i, { size: Math.max(0, Math.round(v)) })} />
                  </div>
                </td>
                <td className="px-3 py-1.5 text-right">
                  <button type="button" onClick={() => onChange(intakes.filter((_, j) => j !== i))} className="text-xs font-semibold text-muted hover:text-bad">
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button
        type="button"
        onClick={() => onChange([...intakes, { label: nextLabel, size: mean ?? 0 }])}
        disabled={intakes.length >= 30}
        className="mt-2 rounded-md border border-border-2 px-2.5 py-1 text-xs font-semibold text-ink hover:bg-surface-2 disabled:opacity-50"
      >
        Add an older intake
      </button>
      <ImportModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        title="Import past intakes"
        help="Two columns: the intake's name (e.g. Fall 2026) and the number admitted, most recent first. This replaces the list."
        sampleCsv={"intake,students\nFall 2026,100\nFall 2025,95\n"}
        sampleName="past-intakes.csv"
        mapRows={intakeMapper}
        onApply={onChange}
      />
    </SectionCard>
  );
}
