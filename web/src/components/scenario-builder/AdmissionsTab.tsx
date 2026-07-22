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
  setRecordField: (key: "initialOccupancy", code: string, value: number) => void;
  // Settings renders the initial-state editor as its own prominent top section, so it opts out
  // of the inline copy here to avoid two editors of the same state on one page. Defaults on for
  // every other caller (Scenario Builder, Plan Builder).
  showInitialState?: boolean;
  // The plan's mandatory seasons (which seasons may admit). The first is the always-on
  // admission season (Fall); a second, if present, is the optional Spring intake. Defaults to
  // the QU Fall/Spring for a plan whose meta predates the field.
  mandatoryTerms?: string[];
}

export default function AdmissionsTab({
  mode, state, baseline, courses, setField, setRecordField,
  showInitialState = true, mandatoryTerms = ["Fall", "Spring"],
}: Props) {
  const dirty = (key: keyof BuilderState) => state[key] !== baseline[key];

  const primary = mandatoryTerms[0] ?? "Fall";
  const secondary = mandatoryTerms[1]; // e.g. "Spring" — undefined for a single-mandatory-season plan
  const springOn = secondary !== undefined && state.admissionTerms.includes(secondary);
  const termsDirty = JSON.stringify(state.admissionTerms) !== JSON.stringify(baseline.admissionTerms);
  const secondarySize = secondary !== undefined ? state.admissionSizes[secondary] ?? state.cohortSize : state.cohortSize;
  const sizeDirty = JSON.stringify(state.admissionSizes) !== JSON.stringify(baseline.admissionSizes);

  const chooseFallOnly = () => setField("admissionTerms", [primary]);
  const chooseFallSpring = () => secondary !== undefined && setField("admissionTerms", [primary, secondary]);
  const setSecondarySize = (v: number) =>
    secondary !== undefined && setField("admissionSizes", { ...state.admissionSizes, [secondary]: v });

  const segBtn = (active: boolean) =>
    `flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition ${
      active ? "bg-accent text-white shadow-sm" : "text-muted hover:text-ink"
    }`;

  return (
    <div className="flex flex-col gap-4">
      <SectionCard title="Admissions & cohort structure">
        <div className="flex flex-wrap gap-2">
          <FieldRow label={`${primary} cohort size`} dirty={dirty("cohortSize")}>
            <NumberBox value={state.cohortSize} onChange={(v) => setField("cohortSize", v)} min={10} max={1000} step={5} />
          </FieldRow>
          <FieldRow label="Study cohorts" dirty={dirty("numCohorts")}>
            <NumberBox value={state.numCohorts} onChange={(v) => setField("numCohorts", v)} min={1} max={20} step={1} />
          </FieldRow>

          {secondary !== undefined && (
            <FieldRow label="Admit in" dirty={termsDirty}>
              <div className="flex gap-1 rounded-lg border border-border-2 bg-surface-2 p-0.5">
                <button type="button" className={segBtn(!springOn)} onClick={chooseFallOnly}>
                  {primary} only
                </button>
                <button type="button" className={segBtn(springOn)} onClick={chooseFallSpring}>
                  {primary} &amp; {secondary}
                </button>
              </div>
            </FieldRow>
          )}

          {springOn && secondary !== undefined && (
            <FieldRow label={`${secondary} cohort size`} dirty={sizeDirty}>
              <NumberBox value={secondarySize} onChange={setSecondarySize} min={10} max={1000} step={5} />
            </FieldRow>
          )}

          {mode === "advanced" && (
            <>
              <FieldRow label="Max semesters / student" dirty={dirty("maxTerms")}>
                <NumberBox value={state.maxTerms} onChange={(v) => setField("maxTerms", v)} min={1} max={24} step={1} />
              </FieldRow>
              <FieldRow label="RNG seed" dirty={dirty("seed")}>
                <NumberBox value={state.seed} onChange={(v) => setField("seed", v)} step={1} />
              </FieldRow>
            </>
          )}
        </div>
        {secondary !== undefined && (
          <p className="mt-2 px-2.5 text-xs text-muted">
            {springOn
              ? `A new cohort enters each ${primary} and each ${secondary} — a second yearly intake. ${secondary} never falls on an optional term (e.g. Summer).`
              : `A new cohort enters once a year, in ${primary}.`}
          </p>
        )}
      </SectionCard>

      {mode === "advanced" && showInitialState && (
        <InitialStateEditor
          courses={courses}
          occupancy={state.initialOccupancy}
          baselineOccupancy={baseline.initialOccupancy}
          onOccupancyChange={(code, v) => setRecordField("initialOccupancy", code, v)}
          onOccupancyBulkChange={(patch) => setField("initialOccupancy", { ...state.initialOccupancy, ...patch })}
        />
      )}
    </div>
  );
}
