"use client";

import { useMemo, useState, type ReactNode } from "react";
import type { CourseRecord, DataSource } from "@/types/simulation";
import { NumberBox, SectionCard } from "@/components/scenario-builder/fields";
import ImportModal, { courseValueMapper } from "@/components/data/ImportModal";
import SourceTag from "@/components/data/SourceTag";

// One number per course (seats or pass rate) with a QU data / Estimate tag per course, import,
// and "mark all as QU data". Used by the Data page's Courses & seats and Pass rates tabs.
export default function CourseValuesTable({
  title,
  hint,
  courses,
  values,
  baseline,
  onChange,
  onBulkChange,
  sources,
  onSourcesChange,
  column,
  toDisplay,
  fromDisplay,
  step,
  min,
  max,
  extra,
  importHelp,
  sampleValue,
  parseCell,
}: {
  title: string;
  hint: string;
  courses: CourseRecord[];
  values: Record<string, number>;
  baseline: Record<string, number>;
  onChange: (code: string, v: number) => void;
  onBulkChange: (patch: Record<string, number>) => void;
  sources: Record<string, DataSource>;
  onSourcesChange: (next: Record<string, DataSource>) => void;
  column: string;
  toDisplay: (v: number) => number;
  fromDisplay: (v: number) => number;
  step: number;
  min: number;
  max: number;
  extra?: (code: string, v: number) => ReactNode;
  importHelp: string;
  sampleValue: string;
  parseCell: (cell: string) => number | string;
}) {
  const [importOpen, setImportOpen] = useState(false);
  const mapper = useMemo(() => courseValueMapper(courses, parseCell), [courses, parseCell]);
  const sorted = useMemo(
    () => [...courses].sort((a, b) => (a.study_plan_term || 99) - (b.study_plan_term || 99) || a.study_plan_order - b.study_plan_order),
    [courses],
  );
  const qu = courses.filter((c) => sources[c.code] === "qu").length;

  return (
    <SectionCard
      title={title}
      hint={`${qu} of ${courses.length} marked QU data`}
      actions={
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => onSourcesChange(Object.fromEntries(courses.map((c) => [c.code, "qu" as DataSource])))}
            className="rounded-md border border-border-2 px-2.5 py-1 text-xs font-semibold text-ink hover:bg-surface-2"
          >
            Mark all as QU data
          </button>
          <button type="button" onClick={() => setImportOpen(true)} className="rounded-md border border-border-2 px-2.5 py-1 text-xs font-semibold text-ink hover:bg-surface-2">
            Import from file
          </button>
        </div>
      }
    >
      <p className="mb-3 max-w-3xl text-xs text-muted">{hint}</p>
      <div className="max-h-[560px] overflow-auto rounded-lg border border-border">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr>
              {["Course", "Title", "Plan term", column, "", "Source"].map((h, i) => (
                <th key={i} className="sticky top-0 border-b border-border bg-surface px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((c) => {
              const v = values[c.code] ?? 0;
              const dirty = Math.abs(v - (baseline[c.code] ?? 0)) > 1e-9;
              return (
                <tr key={c.code} className={dirty ? "bg-accent/[0.07]" : ""}>
                  <td className="whitespace-nowrap border-b border-border px-3 py-1.5 font-semibold">{c.code}</td>
                  <td className="border-b border-border px-3 py-1.5 text-muted">{c.title}</td>
                  <td className="border-b border-border px-3 py-1.5 text-muted">{c.study_plan_term > 0 ? c.study_plan_term : "-"}</td>
                  <td className="border-b border-border px-3 py-1.5">
                    <div className="w-24">
                      <NumberBox value={toDisplay(v)} min={min} max={max} step={step} onChange={(d) => onChange(c.code, fromDisplay(d))} />
                    </div>
                  </td>
                  <td className="whitespace-nowrap border-b border-border px-3 py-1.5 text-xs text-muted">{extra?.(c.code, v)}</td>
                  <td className="border-b border-border px-3 py-1.5">
                    <SourceTag
                      value={sources[c.code] ?? "estimate"}
                      onChange={(next) => onSourcesChange({ ...sources, [c.code]: next })}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <ImportModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        title={`Import ${column.toLowerCase()}`}
        help={importHelp}
        sampleCsv={`code,value\n${sorted[0]?.code ?? "CMPS151"},${sampleValue}\n`}
        sampleName={`${column.toLowerCase().replace(/\s+/g, "-")}.csv`}
        mapRows={mapper}
        onApply={onBulkChange}
      />
    </SectionCard>
  );
}
