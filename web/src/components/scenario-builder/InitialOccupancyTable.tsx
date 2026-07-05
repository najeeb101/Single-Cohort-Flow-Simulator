"use client";

import { useMemo } from "react";
import type { CourseRecord } from "@/types/simulation";
import type { BuilderState } from "@/lib/scenarioBuilder";
import { NumberBox, SectionCard } from "./fields";

interface Props {
  courses: CourseRecord[];
  state: BuilderState;
  baseline: BuilderState;
  setRecordField: (key: "initialOccupancy", code: string, value: number) => void;
}

// Mirrors PassRatesDropoutTab's "All courses" table pattern — sorted the same way the
// program roadmap orders columns (study_plan_term ascending, unscheduled trailing; see
// web/src/lib/graphLayout.ts's computeSemesterLayout) so the row order matches what the
// admin already sees on the roadmap.
export default function InitialOccupancyTable({ courses, state, baseline, setRecordField }: Props) {
  const sorted = useMemo(() => {
    return [...courses].sort((a, b) => {
      const at = a.study_plan_term > 0 ? a.study_plan_term : Infinity;
      const bt = b.study_plan_term > 0 ? b.study_plan_term : Infinity;
      if (at !== bt) return at - bt;
      return a.study_plan_order - b.study_plan_order || a.code.localeCompare(b.code);
    });
  }, [courses]);

  return (
    <SectionCard
      title="All courses — initial occupancy"
      hint="seats already taken by the existing student body, subtracted from capacity every mandatory term"
    >
      <div className="max-h-[420px] overflow-auto rounded-lg border border-border">
        <table className="w-full border-collapse text-[12.5px]">
          <thead>
            <tr>
              {["Course", "Title", "Term", "Capacity", "Occupancy", "Free / term"].map((h) => (
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
            {sorted.map((course) => {
              const occupancy = state.initialOccupancy[course.code] ?? 0;
              const baselineOccupancy = baseline.initialOccupancy[course.code] ?? 0;
              const dirty = Math.abs(occupancy - baselineOccupancy) > 1e-9;
              const exceeds = occupancy > course.capacity;
              const free = Math.max(0, course.capacity - occupancy);
              return (
                <tr key={course.code} className={dirty ? "bg-accent/[0.07]" : ""}>
                  <td className="whitespace-nowrap border-b border-border px-3 py-1.5 font-semibold">{course.code}</td>
                  <td className="border-b border-border px-3 py-1.5 text-muted">{course.title}</td>
                  <td className="whitespace-nowrap border-b border-border px-3 py-1.5 text-muted">
                    {course.study_plan_term > 0 ? course.study_plan_term : "Unscheduled"}
                  </td>
                  <td className="whitespace-nowrap border-b border-border px-3 py-1.5 tabular-nums text-muted">{course.capacity}</td>
                  <td className="whitespace-nowrap border-b border-border px-3 py-1.5">
                    <div className="w-24">
                      <NumberBox value={occupancy} onChange={(v) => setRecordField("initialOccupancy", course.code, v)} min={0} step={1} />
                    </div>
                  </td>
                  <td className={`whitespace-nowrap border-b border-border px-3 py-1.5 tabular-nums ${exceeds ? "text-bad" : "text-muted"}`}>
                    {free}
                    {exceeds && <span className="ml-1.5 text-[11px]">exceeds capacity</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </SectionCard>
  );
}
