"use client";

import { useState } from "react";
import type { CourseRecord } from "@/types/simulation";
import { SectionCard } from "./fields";
import InitialOccupancyTable from "./InitialOccupancyTable";
import InitialStateImportModal from "./InitialStateImportModal";

interface Props {
  courses: CourseRecord[];
  occupancy: Record<string, number>;
  onOccupancyChange: (code: string, value: number) => void;
  onOccupancyBulkChange: (patch: Record<string, number>) => void;
  baselineOccupancy?: Record<string, number>;
  // Settings folds per-course occupancy into its Curriculum table instead, so it hides the
  // standalone occupancy table here (default true keeps Scenario/Plan Builder unchanged). Bulk
  // import + demo still populate occupancy via the callbacks above; it just renders elsewhere.
  showOccupancyTable?: boolean;
}

// The shared "initial state — existing student body" editor: per-course occupancy, plus one
// file import (CSV or Excel) that can bulk-fill it. Used by AdmissionsTab (Settings, Plan
// Builder) and the pre-simulation InitialStateGate. The starting student body is driven
// entirely by occupancy — there is no separate year-standing head-count.
export default function InitialStateEditor({
  courses,
  occupancy,
  onOccupancyChange,
  onOccupancyBulkChange,
  baselineOccupancy,
  showOccupancyTable = true,
}: Props) {
  const [importOpen, setImportOpen] = useState(false);

  // Fill the editor (not the DB) with a small, plausible existing-student-body so an admin can
  // preview the flow chart non-empty before entering real numbers. Plan-agnostic: occupancy goes
  // on this plan's earliest courses. Persisted only when the caller (gate / Settings) saves.
  const populateDemo = () => {
    const early = [...courses].sort((a, b) => a.study_plan_term - b.study_plan_term);
    const seatsByRank = [12, 8, 6, 5];
    const occ: Record<string, number> = {};
    early.slice(0, seatsByRank.length).forEach((c, i) => {
      occ[c.code] = seatsByRank[i];
    });
    if (Object.keys(occ).length > 0) onOccupancyBulkChange(occ);
  };

  return (
    <div className="flex flex-col gap-4">
      <SectionCard
        title="Initial state — existing student body"
        hint="the university the first cohort walks into (replaces the old incumbent cohorts)"
        actions={
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={populateDemo}
              className="rounded-md border border-border-2 px-2.5 py-1 text-xs font-semibold text-ink hover:bg-surface-2"
            >
              Populate demo data
            </button>
            <button
              type="button"
              onClick={() => setImportOpen(true)}
              className="rounded-md border border-border-2 px-2.5 py-1 text-xs font-semibold text-ink hover:bg-surface-2"
            >
              Import from file
            </button>
          </div>
        }
      >
        <p className="mb-2.5 text-xs text-muted">
          Seats already taken, per course, by students who aren&apos;t part of this simulation —
          added as a constant background load so the first simulated cohort competes for the
          remaining seats from term&nbsp;0.
          {showOccupancyTable
            ? " Entered in the table below."
            : " Entered in the Curriculum table below."}
        </p>
      </SectionCard>

      {showOccupancyTable && (
        <InitialOccupancyTable
          courses={courses}
          occupancy={occupancy}
          baselineOccupancy={baselineOccupancy}
          onChange={onOccupancyChange}
        />
      )}

      <InitialStateImportModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        courses={courses}
        onApply={(result) => {
          if (Object.keys(result.occupancy).length > 0) onOccupancyBulkChange(result.occupancy);
        }}
      />
    </div>
  );
}
