"use client";

import { useMemo, useState } from "react";
import type { CourseRecord, DataSource } from "@/types/simulation";
import { SectionCard } from "./fields";
import InitialOccupancyTable from "./InitialOccupancyTable";
import ImportModal, { courseValueMapper, nonNegativeInt } from "@/components/data/ImportModal";
import SourceTag from "@/components/data/SourceTag";

interface Props {
  courses: CourseRecord[];
  occupancy: Record<string, number>;
  onOccupancyChange: (code: string, value: number) => void;
  onOccupancyBulkChange: (patch: Record<string, number>) => void;
  baselineOccupancy?: Record<string, number>;
  // Callers that show occupancy elsewhere (e.g. a combined course table) hide the table here
  // and keep only the import.
  showOccupancyTable?: boolean;
  // QU data vs estimate tag for the whole table (config.data_sources.occupancy).
  source?: DataSource;
  onSourceChange?: (next: DataSource) => void;
}

// The shared "seats used by other programs" editor (config.initial_state.occupancy): seats in
// each course taken by students outside this program, e.g. Computer Engineering students in
// CMPS151 or MATH101. A permanent background load subtracted from the free seats every regular
// term. Used by the first-run gate, the Data page, Plan Builder and the walkthrough editor.
export default function InitialStateEditor({
  courses,
  occupancy,
  onOccupancyChange,
  onOccupancyBulkChange,
  baselineOccupancy,
  showOccupancyTable = true,
  source,
  onSourceChange,
}: Props) {
  const [importOpen, setImportOpen] = useState(false);
  const mapper = useMemo(() => courseValueMapper(courses, nonNegativeInt), [courses]);
  const sample = useMemo(() => {
    const early = [...courses].sort((a, b) => a.study_plan_term - b.study_plan_term);
    return ["code,seats", ...early.slice(0, 2).map((c, i) => `${c.code},${i === 0 ? 20 : 0}`)].join("\n") + "\n";
  }, [courses]);

  return (
    <div className="flex flex-col gap-4">
      <SectionCard
        title="Seats used by other programs"
        hint="for example Computer Engineering students in shared courses"
        actions={
          <div className="flex items-center gap-2">
            {(source !== undefined || onSourceChange) && <SourceTag value={source} onChange={onSourceChange} />}
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
        <p className="text-xs text-muted">
          Seats in each course taken every regular term by students outside this program. They are subtracted from the
          free seats, so CS students compete for what is left. Leave a course at 0 if no other program uses it.
          {showOccupancyTable ? " Enter the numbers in the table below." : ""}
        </p>
      </SectionCard>

      {showOccupancyTable && (
        <InitialOccupancyTable courses={courses} occupancy={occupancy} baselineOccupancy={baselineOccupancy} onChange={onOccupancyChange} />
      )}

      <ImportModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        title="Import other-program seats"
        help="Two columns: a course code and the number of seats other programs use in it each term."
        sampleCsv={sample}
        sampleName="other-program-seats.csv"
        mapRows={mapper}
        onApply={(value) => onOccupancyBulkChange(value)}
      />
    </div>
  );
}
