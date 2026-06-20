"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { activatePlan, ApiError, exportPlan, importPlan, listPlans } from "@/lib/api";
import { baselineFromMeta, type BuilderState } from "@/lib/scenarioBuilder";
import { BLANK_CONFIG, composePlanPayload, metaFromPlanExport } from "@/lib/planBuilder";
import type { CourseRecord } from "@/types/simulation";
import CourseListStep from "./CourseListStep";
import ConfigStep from "./ConfigStep";

type Step = "seed" | "courses" | "config" | "review";
type SeedChoice = "clone" | "blank";

export default function PlanBuilderWizard() {
  const router = useRouter();

  const [step, setStep] = useState<Step>("seed");
  const [name, setName] = useState("");
  const [seedChoice, setSeedChoice] = useState<SeedChoice>("clone");
  const [loadingSeed, setLoadingSeed] = useState(false);
  const [seedError, setSeedError] = useState<string | null>(null);

  const [courses, setCourses] = useState<CourseRecord[]>([]);
  const [baseConfig, setBaseConfig] = useState<Record<string, unknown>>({});
  const [builderState, setBuilderState] = useState<BuilderState | null>(null);
  const [baselineState, setBaselineState] = useState<BuilderState | null>(null);

  const [activateAfterSave, setActivateAfterSave] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const loadSeedAndContinue = async () => {
    setLoadingSeed(true);
    setSeedError(null);
    try {
      let seedCourses: CourseRecord[];
      let seedConfig: Record<string, unknown>;
      if (seedChoice === "clone") {
        const plans = await listPlans();
        const defaultPlan = plans.find((p) => p.is_default);
        if (!defaultPlan) throw new Error("Could not find the default plan to clone");
        const exported = await exportPlan(defaultPlan.id);
        seedCourses = exported.curriculum;
        seedConfig = exported.config;
      } else {
        seedCourses = [];
        seedConfig = { ...BLANK_CONFIG };
      }
      const seeded = baselineFromMeta(metaFromPlanExport(seedCourses, seedConfig), []);
      setCourses(seedCourses);
      setBaseConfig(seedConfig);
      setBuilderState(seeded);
      setBaselineState(seeded);
      setStep("courses");
    } catch (e) {
      setSeedError(e instanceof Error ? e.message : "Could not load plan data");
    } finally {
      setLoadingSeed(false);
    }
  };

  // Pass-rate dicts are seeded once (at clone/blank time) but courses can be added/removed
  // afterward in the Courses step — re-derive defaults for any new/removed code before the
  // Config step renders, preserving whatever the user already edited for existing ones.
  const goToConfigStep = () => {
    if (!builderState || !baselineState) return;
    const defaults = Object.fromEntries(courses.map((c) => [c.code, c.pass_rate]));
    setBuilderState({ ...builderState, passRates: { ...defaults, ...builderState.passRates } });
    setBaselineState({ ...baselineState, passRates: { ...defaults, ...baselineState.passRates } });
    setStep("config");
  };

  const setField = <K extends keyof BuilderState>(key: K, value: BuilderState[K]) =>
    setBuilderState((prev) => (prev ? { ...prev, [key]: value } : prev));

  const setRecordField = (key: "passRates", code: string, value: number) =>
    setBuilderState((prev) => (prev ? { ...prev, [key]: { ...prev[key], [code]: value } } : prev));

  const save = async () => {
    if (!builderState) return;
    setSaving(true);
    setSaveError(null);
    try {
      const payload = composePlanPayload(name.trim(), courses, baseConfig, builderState);
      const plan = await importPlan(payload);
      if (activateAfterSave) {
        await activatePlan(plan.id);
      }
      router.push("/plans");
    } catch (e) {
      setSaveError(e instanceof ApiError ? e.message : "Could not save plan");
    } finally {
      setSaving(false);
    }
  };

  const STEP_LABELS: Record<Step, string> = {
    seed: "1. Name & starting point",
    courses: "2. Courses",
    config: "3. Configuration",
    review: "4. Review & save",
  };

  return (
    <div className="flex flex-col gap-6">
      <header className="border-b border-border py-5">
        <h1 className="text-[19px] font-bold tracking-tight">Plan Builder</h1>
        <p className="mt-0.5 text-[12.5px] text-muted">
          Build a new curriculum + configuration plan — clone the default to tweak it, or start
          from nothing and enter everything by hand.
        </p>
      </header>

      <div className="flex gap-4 text-[12.5px]">
        {(Object.keys(STEP_LABELS) as Step[]).map((s) => (
          <span key={s} className={s === step ? "font-semibold text-accent" : "text-muted"}>
            {STEP_LABELS[s]}
          </span>
        ))}
      </div>

      {step === "seed" && (
        <section className="flex flex-col gap-4">
          <label className="flex flex-col gap-1.5 text-[12.5px] text-muted">
            Plan name
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Revised CS curriculum 2027"
              className="max-w-md rounded-[9px] border border-border-2 bg-surface-2 px-3 py-2 text-[13px] text-ink outline-none focus:border-accent"
            />
          </label>

          <div className="flex flex-col gap-2 text-[12.5px]">
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="seed"
                checked={seedChoice === "clone"}
                onChange={() => setSeedChoice("clone")}
                className="accent-[var(--accent)]"
              />
              Clone the default plan (recommended) — start from the QU CS curriculum + config and edit from there
            </label>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="seed"
                checked={seedChoice === "blank"}
                onChange={() => setSeedChoice("blank")}
                className="accent-[var(--accent)]"
              />
              Start blank — no courses, default config scalars, enter everything manually
            </label>
          </div>

          {seedError && <p className="text-[12.5px] text-bad">{seedError}</p>}

          <button
            type="button"
            onClick={loadSeedAndContinue}
            disabled={!name.trim() || loadingSeed}
            className="self-start rounded-[9px] bg-accent px-4 py-2 text-[13px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loadingSeed ? "Loading…" : "Continue"}
          </button>
        </section>
      )}

      {step === "courses" && (
        <section className="flex flex-col gap-4">
          <CourseListStep courses={courses} onChange={setCourses} />
          <div className="flex gap-2 border-t border-border pt-4">
            <button
              type="button"
              onClick={() => setStep("seed")}
              className="rounded-[9px] border border-border-2 bg-surface px-4 py-2 text-[13px] font-semibold text-ink"
            >
              Back
            </button>
            <button
              type="button"
              onClick={goToConfigStep}
              disabled={courses.length === 0}
              className="rounded-[9px] bg-accent px-4 py-2 text-[13px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              Continue
            </button>
          </div>
        </section>
      )}

      {step === "config" && builderState && baselineState && (
        <section className="flex flex-col gap-4">
          <ConfigStep
            meta={metaFromPlanExport(courses, baseConfig)}
            state={builderState}
            baseline={baselineState}
            setField={setField}
            setRecordField={setRecordField}
          />
          <div className="flex gap-2 border-t border-border pt-4">
            <button
              type="button"
              onClick={() => setStep("courses")}
              className="rounded-[9px] border border-border-2 bg-surface px-4 py-2 text-[13px] font-semibold text-ink"
            >
              Back
            </button>
            <button
              type="button"
              onClick={() => setStep("review")}
              className="rounded-[9px] bg-accent px-4 py-2 text-[13px] font-semibold text-white"
            >
              Continue
            </button>
          </div>
        </section>
      )}

      {step === "review" && builderState && (
        <section className="flex flex-col gap-4">
          <div className="rounded-2xl border border-border bg-surface p-4 text-[12.5px]">
            <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              <div>
                <dt className="text-muted">Name</dt>
                <dd className="font-semibold text-ink">{name}</dd>
              </div>
              <div>
                <dt className="text-muted">Courses</dt>
                <dd className="font-semibold text-ink">{courses.length}</dd>
              </div>
              <div>
                <dt className="text-muted">Cohort size / year</dt>
                <dd className="font-semibold text-ink">{builderState.cohortSize}</dd>
              </div>
              <div>
                <dt className="text-muted">Study cohorts</dt>
                <dd className="font-semibold text-ink">{builderState.numCohorts}</dd>
              </div>
              <div>
                <dt className="text-muted">Max semesters</dt>
                <dd className="font-semibold text-ink">{builderState.maxTerms}</dd>
              </div>
              <div>
                <dt className="text-muted">Dropout base hazard</dt>
                <dd className="font-semibold text-ink">{builderState.dropoutBaseHazard}</dd>
              </div>
            </dl>
          </div>

          <label className="flex items-center gap-2 text-[12.5px]">
            <input
              type="checkbox"
              checked={activateAfterSave}
              onChange={(e) => setActivateAfterSave(e.target.checked)}
              className="accent-[var(--accent)]"
            />
            Activate this plan immediately after saving
          </label>

          {saveError && <p className="text-[12.5px] text-bad">{saveError}</p>}

          <div className="flex gap-2 border-t border-border pt-4">
            <button
              type="button"
              onClick={() => setStep("config")}
              disabled={saving}
              className="rounded-[9px] border border-border-2 bg-surface px-4 py-2 text-[13px] font-semibold text-ink disabled:opacity-50"
            >
              Back
            </button>
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="rounded-[9px] bg-accent px-4 py-2 text-[13px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save plan"}
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
