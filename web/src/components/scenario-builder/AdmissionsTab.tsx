import type { CourseRecord } from "@/types/simulation";
import type { BuilderState } from "@/lib/scenarioBuilder";
import { FieldRow, NumberBox, SectionCard } from "./fields";
import InitialStateEditor from "./InitialStateEditor";

interface Props {
  mode: "simple" | "advanced";
  state: BuilderState;
  baseline: BuilderState;
  courses: CourseRecord[];
  setField: <K extends keyof BuilderState>(key: K, value: BuilderState[K]) => void;
  setRecordField: (key: "standing" | "initialOccupancy", code: string, value: number) => void;
  // Settings renders the initial-state editor as its own prominent top section, so it opts out
  // of the inline copy here to avoid two editors of the same state on one page. Defaults on for
  // every other caller (Scenario Builder, Plan Builder).
  showInitialState?: boolean;
  // The plan's year bands above Year1 for the standing editor; defaults to Year2/3/4.
  standingNodes?: string[];
}

export default function AdmissionsTab({ mode, state, baseline, courses, setField, setRecordField, showInitialState = true, standingNodes }: Props) {
  const dirty = (key: keyof BuilderState) => state[key] !== baseline[key];

  return (
    <div className="flex flex-col gap-4">
      <SectionCard title="Admissions & cohort structure">
        <div className="flex flex-wrap gap-2">
          <FieldRow label="Cohort size / year" dirty={dirty("cohortSize")}>
            <NumberBox value={state.cohortSize} onChange={(v) => setField("cohortSize", v)} min={10} max={1000} step={5} />
          </FieldRow>
          <FieldRow label="Study cohorts" dirty={dirty("numCohorts")}>
            <NumberBox value={state.numCohorts} onChange={(v) => setField("numCohorts", v)} min={1} max={20} step={1} />
          </FieldRow>

          {mode === "advanced" && (
            <>
              <FieldRow label="Admit interval (terms)" dirty={dirty("admitIntervalTerms")}>
                <NumberBox value={state.admitIntervalTerms} onChange={(v) => setField("admitIntervalTerms", v)} min={1} max={6} step={1} />
              </FieldRow>
              <FieldRow label="Max semesters / student" dirty={dirty("maxTerms")}>
                <NumberBox value={state.maxTerms} onChange={(v) => setField("maxTerms", v)} min={1} max={24} step={1} />
              </FieldRow>
              <FieldRow label="RNG seed" dirty={dirty("seed")}>
                <NumberBox value={state.seed} onChange={(v) => setField("seed", v)} step={1} />
              </FieldRow>
            </>
          )}
        </div>
      </SectionCard>

      {mode === "advanced" && showInitialState && (
        <InitialStateEditor
          courses={courses}
          occupancy={state.initialOccupancy}
          standing={state.standing}
          standingNodes={standingNodes}
          baselineOccupancy={baseline.initialOccupancy}
          baselineStanding={baseline.standing}
          onOccupancyChange={(code, v) => setRecordField("initialOccupancy", code, v)}
          onOccupancyBulkChange={(patch) => setField("initialOccupancy", { ...state.initialOccupancy, ...patch })}
          onStandingChange={(node, v) => setRecordField("standing", node, v)}
          onStandingBulkChange={(patch) => setField("standing", { ...state.standing, ...patch })}
        />
      )}
    </div>
  );
}
