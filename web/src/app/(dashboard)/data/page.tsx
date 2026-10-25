"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSimulation } from "@/lib/SimulationContext";
import { ApiError, listCurriculum, listPlans, updateConfig, updateCourse } from "@/lib/api";
import { baselineFromMeta, buildOverrides, type BuilderState } from "@/lib/scenarioBuilder";
import type {
  CourseRecord,
  DataSource,
  DataSources,
  HistoricalOutcomes,
  IntakeAnalysisParams,
  IntakePolicy,
  PastIntake,
  Planning,
  PlanRecord,
} from "@/types/simulation";
import CurriculumTable from "@/components/settings/CurriculumTable";
import AdmissionsTab from "@/components/scenario-builder/AdmissionsTab";
import InitialStateEditor from "@/components/scenario-builder/InitialStateEditor";
import PassRatesDropoutTab from "@/components/scenario-builder/PassRatesDropoutTab";
import RegistrationPolicyTab from "@/components/scenario-builder/RegistrationPolicyTab";
import { FieldRow, NumberBox, SectionCard } from "@/components/scenario-builder/fields";
import CourseValuesTable from "@/components/data/CourseValuesTable";
import PastIntakesEditor from "@/components/data/PastIntakesEditor";
import PolicyFields from "@/components/data/PolicyFields";
import { nonNegativeInt, passRate } from "@/components/data/ImportModal";

// The Data page (formerly Settings): every input the Intake Planner uses, each tagged QU data or
// estimate. Edits are drafts until "Save changes", which writes PUT /curriculum per changed
// course and one PUT /config, then refreshes the shared baseline (refreshBaseline) so every page
// sees the new data. Course structure edits (Advanced tab) save immediately, as before.

const TABS = [
  { id: "seats", label: "Courses & seats" },
  { id: "pass", label: "Pass rates" },
  { id: "students", label: "Current students" },
  { id: "other", label: "Other-program seats" },
  { id: "policy", label: "Policy & analysis" },
  { id: "advanced", label: "Advanced" },
] as const;
type TabId = (typeof TABS)[number]["id"];

interface Draft {
  capacity: Record<string, number>;
  passRate: Record<string, number>;
  occupancy: Record<string, number>;
  pastIntakes: PastIntake[];
  sources: DataSources;
  policy: IntakePolicy;
  analysis: Pick<IntakeAnalysisParams, "grid_min" | "grid_max" | "grid_step" | "seeds">;
  sectionSize: number;
  planning: Planning;
  outcomes: HistoricalOutcomes;
}

function draftFrom(courses: CourseRecord[], meta: ReturnType<typeof useSimulation>["meta"]): Draft {
  const a = meta.intake_analysis;
  return {
    capacity: Object.fromEntries(courses.map((c) => [c.code, c.capacity])),
    passRate: Object.fromEntries(courses.map((c) => [c.code, c.pass_rate])),
    occupancy: { ...(meta.initial_state?.occupancy ?? {}) },
    pastIntakes: (meta.current_students?.past_intakes ?? []).map((e) => ({ ...e })),
    sources: {
      capacity: { ...(meta.data_sources?.capacity ?? {}) },
      pass_rate: { ...(meta.data_sources?.pass_rate ?? {}) },
      past_intakes: meta.data_sources?.past_intakes ?? "estimate",
      occupancy: meta.data_sources?.occupancy ?? "estimate",
    },
    policy: { ...meta.intake_policy },
    analysis: { grid_min: a.grid_min, grid_max: a.grid_max, grid_step: a.grid_step, seeds: a.seeds },
    sectionSize: meta.section_size,
    planning: { ...(meta.planning ?? {}) },
    outcomes: { ...(meta.historical_outcomes ?? {}) },
  };
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function initialTab(): TabId {
  if (typeof window === "undefined") return "seats";
  const t = new URLSearchParams(window.location.search).get("tab");
  return TABS.some((x) => x.id === t) ? (t as TabId) : "seats";
}

export default function DataPage() {
  const { meta, refreshBaseline } = useSimulation();
  const [tab, setTabState] = useState<TabId>(initialTab);
  const [courses, setCourses] = useState<CourseRecord[] | null>(null);
  const [activePlan, setActivePlan] = useState<PlanRecord | null>(null);

  useEffect(() => {
    listCurriculum().then(setCourses).catch(() => setCourses([]));
    listPlans()
      .then((plans) => setActivePlan(plans.find((p) => p.is_active) ?? null))
      .catch(() => setActivePlan(null));
  }, []);

  const setTab = (t: TabId) => {
    setTabState(t);
    window.history.replaceState(null, "", `/data?tab=${t}`);
  };

  const handleCoursesChange = (next: CourseRecord[]) => {
    setCourses(next);
    refreshBaseline().catch(() => {});
  };

  return (
    <main className="mx-auto w-full max-w-[1280px] px-5 pb-24 sm:px-8">
      <header className="pb-4 pt-8">
        <h1 className="text-[26px] font-semibold leading-tight tracking-[-0.02em] text-ink sm:text-[28px]">Data</h1>
        <p className="mt-2 max-w-3xl text-[14px] leading-relaxed text-muted">
          Everything the Intake Planner uses. Replace estimates with QU data as it becomes available and mark it so; results
          built mostly on estimates are labelled illustrative. Seats change every semester, so update them and re-run the
          analysis when the schedule changes.
        </p>
        {activePlan && (
          <p className="mt-2 text-sm">
            Program: <span className="font-semibold text-ink">{activePlan.name}</span>
            {activePlan.is_default && (
              <span className="ml-2 text-muted">
                (the shared default; create your own in{" "}
                <Link href="/plan-builder" className="text-accent">Plan Builder</Link> to keep edits separate)
              </span>
            )}
          </p>
        )}
      </header>

      <nav className="sticky top-0 z-10 -mx-5 flex flex-wrap gap-1 border-b border-border bg-bg/95 px-5 py-2 backdrop-blur-sm sm:-mx-7 sm:px-7" aria-label="Data sections">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            aria-current={tab === t.id ? "page" : undefined}
            className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${tab === t.id ? "bg-surface-2 text-ink" : "text-muted hover:text-ink"}`}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {courses === null ? (
        <p className="py-6 text-sm text-muted">Loading...</p>
      ) : (
        <DataEditor
          key={JSON.stringify(meta) + JSON.stringify(courses.map((c) => [c.code, c.capacity, c.pass_rate]))}
          tab={tab}
          courses={courses}
          onCoursesChange={handleCoursesChange}
          onSaved={async (next) => {
            setCourses(next);
            try {
              await refreshBaseline();
            } catch {
              // Saved; the next page load picks up the new baseline.
            }
          }}
        />
      )}
    </main>
  );
}

// Keyed on the loaded data so a save (or an outside change) re-seeds every draft cleanly.
function DataEditor({
  tab,
  courses,
  onCoursesChange,
  onSaved,
}: {
  tab: TabId;
  courses: CourseRecord[];
  onCoursesChange: (next: CourseRecord[]) => void;
  onSaved: (next: CourseRecord[]) => Promise<void>;
}) {
  const { meta } = useSimulation();
  const base = useMemo(() => draftFrom(courses, meta), [courses, meta]);
  const [draft, setDraft] = useState<Draft>(base);
  const builderBase = useMemo(() => baselineFromMeta(meta), [meta]);
  const [builder, setBuilder] = useState<BuilderState>(builderBase);
  const [status, setStatus] = useState<"idle" | "saving" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const setRec = (k: "capacity" | "passRate" | "occupancy", code: string, v: number) =>
    setDraft((d) => ({ ...d, [k]: { ...d[k], [code]: v } }));
  const setSources = (patch: Partial<DataSources>) => setDraft((d) => ({ ...d, sources: { ...d.sources, ...patch } }));
  const setBuilderField = <K extends keyof BuilderState>(key: K, value: BuilderState[K]) =>
    setBuilder((prev) => ({ ...prev, [key]: value }));
  const setBuilderRecord = (key: "passRates" | "initialOccupancy", code: string, value: number) =>
    setBuilder((prev) => ({ ...prev, [key]: { ...prev[key], [code]: value } }));

  const capChanges = courses.filter((c) => draft.capacity[c.code] !== c.capacity);
  const passChanges = courses.filter((c) => Math.abs((draft.passRate[c.code] ?? c.pass_rate) - c.pass_rate) > 1e-9);

  const configPatch = useMemo(() => {
    const patch: Record<string, unknown> = {};
    if (!same(draft.occupancy, base.occupancy)) patch.initial_state = { occupancy: draft.occupancy };
    if (!same(draft.pastIntakes, base.pastIntakes)) patch.current_students = { past_intakes: draft.pastIntakes };
    if (!same(draft.sources, base.sources)) patch.data_sources = draft.sources;
    if (!same(draft.policy, base.policy)) patch.intake_policy = draft.policy;
    if (!same(draft.analysis, base.analysis)) patch.intake_analysis = { ...meta.intake_analysis, ...draft.analysis };
    if (draft.sectionSize !== base.sectionSize) patch.section_size = draft.sectionSize;
    if (!same(draft.planning, base.planning)) patch.planning = draft.planning;
    if (!same(draft.outcomes, base.outcomes)) patch.historical_outcomes = draft.outcomes;
    // Advanced: simulation settings (cohort layout, dropout, registration), same keys as before.
    const o = buildOverrides(builder, builderBase);
    for (const [k, v] of Object.entries(o)) {
      if (k !== "pass_rate_overrides" && k !== "initial_state") patch[k] = v;
    }
    return patch;
  }, [draft, base, builder, builderBase, meta.intake_analysis]);

  const dirty = capChanges.length > 0 || passChanges.length > 0 || Object.keys(configPatch).length > 0;

  const save = async () => {
    setStatus("saving");
    setError(null);
    try {
      // Courses first: a raised capacity must exist before a larger other-program seat count
      // that depends on it is validated (seats used by others may not exceed a course's seats).
      for (const c of courses) {
        const patch: Record<string, number> = {};
        if (draft.capacity[c.code] !== c.capacity) patch.capacity = draft.capacity[c.code];
        if (Math.abs((draft.passRate[c.code] ?? c.pass_rate) - c.pass_rate) > 1e-9) patch.pass_rate = draft.passRate[c.code];
        if (Object.keys(patch).length) await updateCourse(c.code, patch);
      }
      if (Object.keys(configPatch).length) await updateConfig(configPatch);
      await onSaved(courses.map((c) => ({ ...c, capacity: draft.capacity[c.code], pass_rate: draft.passRate[c.code] ?? c.pass_rate })));
      setStatus("idle");
    } catch (e) {
      setStatus("error");
      setError(e instanceof ApiError ? e.message : "Could not save. Some changes may have been saved; reload to check.");
    }
  };

  const section = draft.sectionSize || 35;

  return (
    <div className="flex flex-col gap-4 py-5">
      {tab === "seats" && (
        <CourseValuesTable
          title="Seats per course"
          hint={`Seats offered in each course every regular term (all sections together). Sections hold ${section} seats; set the size on the Policy & analysis tab. For an elective slot, enter the total seats across every elective that can fill it.`}
          courses={courses}
          values={draft.capacity}
          baseline={base.capacity}
          onChange={(code, v) => setRec("capacity", code, Math.max(1, Math.round(v)))}
          onBulkChange={(patch) => set("capacity", { ...draft.capacity, ...patch })}
          sources={(draft.sources.capacity ?? {}) as Record<string, DataSource>}
          onSourcesChange={(next) => setSources({ capacity: next })}
          column="Seats"
          toDisplay={(v) => v}
          fromDisplay={(v) => v}
          step={1}
          min={1}
          max={2000}
          extra={(_code, v) => `${(v / section).toFixed(1).replace(/\.0$/, "")} sections of ${section}`}
          importHelp="Two columns: a course code and its total seats per regular term (all sections)."
          sampleValue="105"
          parseCell={nonNegativeInt}
        />
      )}

      {tab === "pass" && (
        <CourseValuesTable
          title="Pass rates"
          hint="The share of students who pass each course on an attempt (D or better), from past grade distributions."
          courses={courses}
          values={draft.passRate}
          baseline={base.passRate}
          onChange={(code, v) => setRec("passRate", code, Math.max(0, Math.min(1, v)))}
          onBulkChange={(patch) => set("passRate", { ...draft.passRate, ...patch })}
          sources={(draft.sources.pass_rate ?? {}) as Record<string, DataSource>}
          onSourcesChange={(next) => setSources({ pass_rate: next })}
          column="Pass rate %"
          toDisplay={(v) => Math.round(v * 1000) / 10}
          fromDisplay={(v) => v / 100}
          step={1}
          min={0}
          max={100}
          importHelp="Two columns: a course code and its pass rate (0.85, 85 or 85%)."
          sampleValue="85%"
          parseCell={passRate}
        />
      )}

      {tab === "students" && (
        <PastIntakesEditor
          intakes={draft.pastIntakes}
          onChange={(next) => set("pastIntakes", next)}
          source={draft.sources.past_intakes}
          onSourceChange={(next) => setSources({ past_intakes: next })}
          minYears={meta.intake_analysis?.min_history_years ?? 8}
        />
      )}

      {tab === "other" && (
        <InitialStateEditor
          courses={courses.map((c) => ({ ...c, capacity: draft.capacity[c.code] ?? c.capacity }))}
          occupancy={draft.occupancy}
          baselineOccupancy={base.occupancy}
          onOccupancyChange={(code, v) => setRec("occupancy", code, Math.max(0, Math.round(v)))}
          onOccupancyBulkChange={(patch) => set("occupancy", { ...draft.occupancy, ...patch })}
          source={draft.sources.occupancy}
          onSourceChange={(next) => setSources({ occupancy: next })}
        />
      )}

      {tab === "policy" && (
        <>
          <SectionCard title="Policy limits" hint="how much harm from seat shortages is acceptable">
            <PolicyFields value={draft.policy} baseline={base.policy} onChange={(p) => set("policy", p)} />
          </SectionCard>
          <SectionCard title="Planning" hint="shown on the Intake Planner and every saved analysis">
            <div className="flex flex-wrap gap-2">
              <FieldRow label="Next intake" dirty={draft.planning.next_intake_label !== base.planning.next_intake_label}>
                <TextBox value={draft.planning.next_intake_label ?? ""} placeholder="Fall 2027 intake" onChange={(v) => set("planning", { ...draft.planning, next_intake_label: v })} />
              </FieldRow>
              <FieldRow label="Data as of" dirty={draft.planning.data_as_of !== base.planning.data_as_of}>
                <TextBox value={draft.planning.data_as_of ?? ""} placeholder="Spring 2027 schedule" onChange={(v) => set("planning", { ...draft.planning, data_as_of: v })} />
              </FieldRow>
              <FieldRow label="Seats per section" dirty={draft.sectionSize !== base.sectionSize}>
                <NumberBox value={draft.sectionSize} min={1} max={500} step={1} onChange={(v) => set("sectionSize", Math.max(1, Math.round(v)))} />
              </FieldRow>
            </div>
          </SectionCard>
          <SectionCard title="Analysis range" hint="which intakes to try, and how many simulations per intake">
            <div className="flex flex-wrap gap-2">
              {(
                [
                  ["grid_min", "Smallest intake", 10, 1000, 10],
                  ["grid_max", "Largest intake", 10, 1000, 10],
                  ["grid_step", "Step between intakes", 1, 200, 5],
                  ["seeds", "Simulations per intake", 3, 100, 1],
                ] as const
              ).map(([k, label, lo, hi, step]) => (
                <FieldRow key={k} label={label} dirty={draft.analysis[k] !== base.analysis[k]}>
                  <NumberBox value={draft.analysis[k] as number} min={lo} max={hi} step={step} onChange={(v) => set("analysis", { ...draft.analysis, [k]: Math.round(v) })} />
                </FieldRow>
              ))}
            </div>
            <p className="mt-2 text-xs text-muted">More simulations give a firmer answer but take longer. The defaults (20 to 200 in steps of 10, 20 each) take about two to three minutes.</p>
          </SectionCard>
          <SectionCard title="Recorded outcomes" hint="used to check the model against reality">
            <div className="flex flex-wrap gap-2">
              <OptionalPct label="Graduated within 6 years (%)" value={draft.outcomes.grad_rate_6yr} base={base.outcomes.grad_rate_6yr} onChange={(v) => set("outcomes", { ...draft.outcomes, grad_rate_6yr: v })} />
              <OptionalPct label="Graduated on time, 4 years (%)" value={draft.outcomes.on_time_rate_4yr} base={base.outcomes.on_time_rate_4yr} onChange={(v) => set("outcomes", { ...draft.outcomes, on_time_rate_4yr: v })} />
              <OptionalInt label="Students these rates cover" value={draft.outcomes.n_students} base={base.outcomes.n_students} onChange={(v) => set("outcomes", { ...draft.outcomes, n_students: v })} />
              <OptionalInt label="CS students enrolled today" value={draft.outcomes.current_headcount} base={base.outcomes.current_headcount} onChange={(v) => set("outcomes", { ...draft.outcomes, current_headcount: v })} />
            </div>
            <p className="mt-2 text-xs text-muted">Leave blank what you don&apos;t know. Each analysis compares the model with these and flags a gap larger than noise explains.</p>
          </SectionCard>
        </>
      )}

      {tab === "advanced" && (
        <>
          <p className="max-w-3xl text-sm text-muted">
            Simulation settings that rarely change. The intake analysis sets the intake itself; the cohort settings below only
            shape the single baseline run used by Bottlenecks and the Advisor.
          </p>
          <AdmissionsTab
            mode="advanced"
            state={builder}
            baseline={builderBase}
            courses={courses}
            setField={setBuilderField}
            setRecordField={setBuilderRecord}
            showInitialState={false}
            mandatoryTerms={meta.mandatory_terms}
          />
          <PassRatesDropoutTab mode="advanced" meta={meta} state={builder} baseline={builderBase} setField={setBuilderField} setRecordField={setBuilderRecord} showAllCoursesTable={false} />
          <RegistrationPolicyTab mode="advanced" state={builder} baseline={builderBase} courses={courses} setField={setBuilderField} />
          <SectionCard title="Course structure" hint="add, edit or remove courses; saves immediately">
            <CurriculumTable courses={courses} onChange={onCoursesChange} seasons={meta.terms_per_year} />
          </SectionCard>
        </>
      )}

      {(dirty || status === "error") && (
        <div className="fixed bottom-5 left-1/2 z-20 flex w-[min(680px,calc(100%-2rem))] -translate-x-1/2 items-center justify-between gap-3 rounded-2xl border border-border-2 bg-surface px-5 py-3 shadow-xl">
          <span className="text-sm">
            {status === "saving" ? (
              <span className="text-accent">Saving...</span>
            ) : status === "error" ? (
              <span className="text-bad">{error}</span>
            ) : (
              <span className="font-semibold text-ink">Unsaved changes</span>
            )}
          </span>
          <div className="flex items-center gap-2">
            {status !== "saving" && (
              <button
                type="button"
                onClick={() => {
                  setDraft(base);
                  setBuilder(builderBase);
                  setStatus("idle");
                  setError(null);
                }}
                className="rounded-xl border border-border-2 px-3.5 py-1.5 text-sm font-semibold text-muted hover:text-ink"
              >
                Discard
              </button>
            )}
            <button
              type="button"
              onClick={save}
              disabled={status === "saving" || !dirty}
              className="rounded-xl bg-primary px-4 py-1.5 text-sm font-semibold text-primary-ink disabled:cursor-not-allowed disabled:opacity-50"
            >
              {status === "saving" ? "Saving..." : "Save changes"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function TextBox({ value, placeholder, onChange }: { value: string; placeholder?: string; onChange: (v: string) => void }) {
  return (
    <input
      type="text"
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      className="w-full rounded-lg border border-border-2 bg-surface-2 px-2.5 py-1.5 text-sm text-ink placeholder:text-faint focus:outline-none focus:ring-1 focus:ring-accent"
    />
  );
}

// Blank means "not known" (null), so the calibration check skips it.
function OptionalPct({ label, value, base, onChange }: { label: string; value?: number | null; base?: number | null; onChange: (v: number | null) => void }) {
  return (
    <FieldRow label={label} dirty={(value ?? null) !== (base ?? null)}>
      <input
        type="number"
        min={0}
        max={100}
        step={0.5}
        value={value == null ? "" : Math.round(value * 1000) / 10}
        onChange={(e) => onChange(e.target.value === "" ? null : Math.max(0, Math.min(100, Number(e.target.value))) / 100)}
        className="w-full rounded-lg border border-border-2 bg-surface-2 px-2.5 py-1.5 text-sm text-ink tabular-nums focus:outline-none focus:ring-1 focus:ring-accent"
      />
    </FieldRow>
  );
}

function OptionalInt({ label, value, base, onChange }: { label: string; value?: number | null; base?: number | null; onChange: (v: number | null) => void }) {
  return (
    <FieldRow label={label} dirty={(value ?? null) !== (base ?? null)}>
      <input
        type="number"
        min={0}
        step={1}
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value === "" ? null : Math.max(0, Math.round(Number(e.target.value))))}
        className="w-full rounded-lg border border-border-2 bg-surface-2 px-2.5 py-1.5 text-sm text-ink tabular-nums focus:outline-none focus:ring-1 focus:ring-accent"
      />
    </FieldRow>
  );
}
