import type { BuilderState } from "@/lib/scenarioBuilder";
import { FieldRow, NumberBox, SectionCard } from "./fields";

interface Props {
  mode: "simple" | "advanced";
  state: BuilderState;
  baseline: BuilderState;
  setField: <K extends keyof BuilderState>(key: K, value: BuilderState[K]) => void;
  setRecordField: (key: "standing", code: string, value: number) => void;
}

const STANDING_NODES = ["Year2", "Year3", "Year4"] as const;

export default function AdmissionsTab({ mode, state, baseline, setField, setRecordField }: Props) {
  const dirty = (key: keyof BuilderState) => state[key] !== baseline[key];
  const standingDirty = (node: string) => (state.standing[node] ?? 0) !== (baseline.standing[node] ?? 0);

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

      <SectionCard
        title="Initial state — existing student body"
        hint="the university the first cohort walks into (replaces the old incumbent cohorts)"
      >
        <p className="mb-2.5 text-xs text-muted">
          Head-count of students already enrolled at each year-standing when the simulation
          starts. Added as a constant background to the flow chart so it isn&apos;t empty at term&nbsp;0.
          Per-course occupied seats are set under the <b>Capacity</b> tab.
        </p>
        <div className="flex flex-wrap gap-2">
          {STANDING_NODES.map((node) => (
            <FieldRow key={node} label={`${node} standing`} dirty={standingDirty(node)}>
              <NumberBox
                value={state.standing[node] ?? 0}
                onChange={(v) => setRecordField("standing", node, v)}
                min={0}
                max={5000}
                step={5}
              />
            </FieldRow>
          ))}
        </div>
      </SectionCard>
    </div>
  );
}
