import type { BuilderState } from "@/lib/scenarioBuilder";
import { FieldRow, NumberBox, SectionCard } from "./fields";

interface Props {
  mode: "simple" | "advanced";
  state: BuilderState;
  baseline: BuilderState;
  setField: <K extends keyof BuilderState>(key: K, value: BuilderState[K]) => void;
}

export default function AdmissionsTab({ mode, state, baseline, setField }: Props) {
  const dirty = (key: keyof BuilderState) => state[key] !== baseline[key];

  return (
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
            <FieldRow label="Incumbent cohorts (warm start)" dirty={dirty("numIncumbentCohorts")}>
              <NumberBox value={state.numIncumbentCohorts} onChange={(v) => setField("numIncumbentCohorts", v)} min={0} max={10} step={1} />
            </FieldRow>
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
  );
}
