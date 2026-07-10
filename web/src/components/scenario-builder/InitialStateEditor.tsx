"use client";

import { useState } from "react";
import type { CourseRecord } from "@/types/simulation";
import { FieldRow, NumberBox, SectionCard } from "./fields";
import InitialOccupancyTable from "./InitialOccupancyTable";
import InitialStateImportModal, { STANDING_NODES } from "./InitialStateImportModal";

interface Props {
  courses: CourseRecord[];
  occupancy: Record<string, number>;
  standing: Record<string, number>;
  standingNodes?: string[]; // the plan's year bands above Year1; defaults to Year2/3/4
  onOccupancyChange: (code: string, value: number) => void;
  onOccupancyBulkChange: (patch: Record<string, number>) => void;
  onStandingChange: (node: string, value: number) => void;
  onStandingBulkChange: (patch: Record<string, number>) => void;
  baselineOccupancy?: Record<string, number>;
  baselineStanding?: Record<string, number>;
}

// The shared "initial state — existing student body" editor: year-standing head-counts +
// per-course occupancy, plus one file import (CSV or Excel) that can bulk-fill both at once.
// Used by AdmissionsTab (Settings, Plan Builder) and the pre-simulation InitialStateGate.
export default function InitialStateEditor({
  courses,
  occupancy,
  standing,
  standingNodes,
  onOccupancyChange,
  onOccupancyBulkChange,
  onStandingChange,
  onStandingBulkChange,
  baselineOccupancy,
  baselineStanding,
}: Props) {
  const [importOpen, setImportOpen] = useState(false);
  const nodes = standingNodes && standingNodes.length ? standingNodes : [...STANDING_NODES];

  return (
    <div className="flex flex-col gap-4">
      <SectionCard
        title="Initial state — existing student body"
        hint="the university the first cohort walks into (replaces the old incumbent cohorts)"
        actions={
          <button
            type="button"
            onClick={() => setImportOpen(true)}
            className="rounded-md border border-border-2 px-2.5 py-1 text-[11px] font-semibold text-ink hover:bg-surface-2"
          >
            Import from file
          </button>
        }
      >
        <p className="mb-2.5 text-xs text-muted">
          Head-count of students already enrolled at each year-standing when the simulation
          starts. Added as a constant background to the flow chart so it isn&apos;t empty at term&nbsp;0.
          Per-course occupied seats are entered in the table below.
        </p>
        <div className="flex flex-wrap gap-2">
          {nodes.map((node) => {
            const value = standing[node] ?? 0;
            const dirty = baselineStanding !== undefined && value !== (baselineStanding[node] ?? 0);
            return (
              <FieldRow key={node} label={`${node} standing`} dirty={dirty}>
                <NumberBox value={value} onChange={(v) => onStandingChange(node, v)} min={0} max={5000} step={5} />
              </FieldRow>
            );
          })}
        </div>
      </SectionCard>

      <InitialOccupancyTable
        courses={courses}
        occupancy={occupancy}
        baselineOccupancy={baselineOccupancy}
        onChange={onOccupancyChange}
      />

      <InitialStateImportModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        courses={courses}
        standingNodes={nodes}
        onApply={(result) => {
          if (Object.keys(result.occupancy).length > 0) onOccupancyBulkChange(result.occupancy);
          if (Object.keys(result.standing).length > 0) onStandingBulkChange(result.standing);
        }}
      />
    </div>
  );
}
