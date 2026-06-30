"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSimulation } from "@/lib/SimulationContext";
import { ApiError, listCurriculum, listPlans, updateConfig, updateCourse } from "@/lib/api";
import { baselineFromMeta, buildOverrides, type BuilderState } from "@/lib/scenarioBuilder";
import type { CourseRecord, PlanRecord } from "@/types/simulation";
import CurriculumTable from "@/components/settings/CurriculumTable";
import AdmissionsTab from "@/components/scenario-builder/AdmissionsTab";
import PassRatesDropoutTab from "@/components/scenario-builder/PassRatesDropoutTab";
import RegistrationPolicyTab from "@/components/scenario-builder/RegistrationPolicyTab";

// Reuses the Scenario Builder's tab components unchanged (they're pure presentational
// state -> onChange views) — only the Save handler here differs: it writes the new
// baseline via PUT /config (+ per-course PUT /curriculum for any pass_rate edits) instead
// of building a one-run /simulate override.
export default function SettingsPage() {
  const { meta } = useSimulation();
  const baseline = baselineFromMeta(meta);
  const [state, setState] = useState<BuilderState>(baseline);
  const [courses, setCourses] = useState<CourseRecord[] | null>(null);
  const [activePlan, setActivePlan] = useState<PlanRecord | null>(null);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [optionalTermsEnabled, setOptionalTermsEnabled] = useState(meta.optional_terms_enabled);
  const [admissionTargets, setAdmissionTargets] = useState({ ...meta.admission_targets });

  const setAdmissionTarget = (key: keyof typeof admissionTargets, value: number) =>
    setAdmissionTargets((prev) => ({ ...prev, [key]: value }));

  useEffect(() => {
    listCurriculum().then(setCourses).catch(() => setCourses([]));
    listPlans()
      .then((plans) => setActivePlan(plans.find((p) => p.is_active) ?? null))
      .catch(() => setActivePlan(null));
  }, []);

  const setField = <K extends keyof BuilderState>(key: K, value: BuilderState[K]) =>
    setState((prev) => ({ ...prev, [key]: value }));

  const setRecordField = (key: "passRates" | "standing", code: string, value: number) =>
    setState((prev) => ({ ...prev, [key]: { ...prev[key], [code]: value } }));

  const saveConfig = async () => {
    setStatus("saving");
    setError(null);
    const overrides = buildOverrides(state, baseline);
    const configPatch: Record<string, unknown> = {};
    if (overrides.cohort_size !== undefined) configPatch.cohort_size = overrides.cohort_size;
    if (overrides.num_cohorts !== undefined) configPatch.num_cohorts = overrides.num_cohorts;
    if (overrides.num_incumbent_cohorts !== undefined) configPatch.num_incumbent_cohorts = overrides.num_incumbent_cohorts;
    if (overrides.initial_state !== undefined) configPatch.initial_state = overrides.initial_state;
    if (overrides.admit_interval_terms !== undefined) configPatch.admit_interval_terms = overrides.admit_interval_terms;
    if (overrides.max_terms !== undefined) configPatch.max_terms = overrides.max_terms;
    if (overrides.seed !== undefined) configPatch.seed = overrides.seed;
    if (overrides.dropout_gpa_floor !== undefined) configPatch.dropout_gpa_floor = overrides.dropout_gpa_floor;
    if (overrides.dropout_base_hazard !== undefined) configPatch.dropout_base_hazard = overrides.dropout_base_hazard;
    if (overrides.dropout_early_multiplier !== undefined) configPatch.dropout_early_multiplier = overrides.dropout_early_multiplier;
    if (overrides.dropout_early_sem_cutoff !== undefined) configPatch.dropout_early_sem_cutoff = overrides.dropout_early_sem_cutoff;
    if (overrides.dropout_fails_threshold !== undefined) configPatch.dropout_fails_threshold = overrides.dropout_fails_threshold;
    if (overrides.dropout_prob_on_repeated_fail !== undefined) configPatch.dropout_prob_on_repeated_fail = overrides.dropout_prob_on_repeated_fail;
    if (overrides.registration_tier_thresholds !== undefined) configPatch.registration_tier_thresholds = overrides.registration_tier_thresholds;
    if (overrides.enrollment_priority_tiers !== undefined) configPatch.enrollment_priority_tiers = overrides.enrollment_priority_tiers;
    if (optionalTermsEnabled !== meta.optional_terms_enabled) configPatch.optional_terms_enabled = optionalTermsEnabled;
    if (JSON.stringify(admissionTargets) !== JSON.stringify(meta.admission_targets))
      configPatch.admission_targets = admissionTargets;

    try {
      if (Object.keys(configPatch).length > 0) {
        await updateConfig(configPatch);
      }
    } catch (e) {
      setStatus("error");
      setError(e instanceof ApiError ? e.message : "Could not save baseline configuration");
      return;
    }

    // Pass rate is a Course/curriculum field, not a baseline-config scalar — persist each
    // changed course individually via PUT /curriculum/{code}. Use allSettled rather than
    // aborting on the first failure: the config write above already committed, so a single
    // bad course shouldn't hide that the rest of the pass-rate edits saved fine.
    const passRateChanges = overrides.pass_rate_overrides ?? {};
    const entries = Object.entries(passRateChanges);
    const results = await Promise.allSettled(entries.map(([code, rate]) => updateCourse(code, { pass_rate: rate })));

    const succeededCodes = new Set(entries.filter((_, i) => results[i].status === "fulfilled").map(([code]) => code));
    if (succeededCodes.size > 0 && courses) {
      setCourses(courses.map((c) => (succeededCodes.has(c.code) ? { ...c, pass_rate: passRateChanges[c.code] } : c)));
    }

    const failed = entries.filter((_, i) => results[i].status === "rejected");
    if (failed.length > 0) {
      const firstError = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
      const reason = firstError.reason instanceof ApiError ? firstError.reason.message : "save failed";
      setStatus("error");
      setError(`Pass rate not saved for ${failed.map(([code]) => code).join(", ")} (${reason})`);
      return;
    }

    setStatus("saved");
  };

  return (
    <main className="mx-auto w-full max-w-[1600px] px-7 pb-16">
      <header className="border-b border-border py-5">
        <h1 className="text-[19px] font-bold tracking-tight">Settings</h1>
        <p className="mt-0.5 text-[12.5px] text-muted">
          Edits here persist to the database as the new baseline — every future run starts from these
          values, unlike the Scenario Builder&apos;s per-run overrides.
        </p>
        {activePlan && (
          <p className="mt-2 text-[12.5px]">
            Editing plan: <span className="font-semibold text-ink">{activePlan.name}</span>
            {activePlan.is_default && (
              <span className="ml-2 text-muted">
                — this is the shared default plan; create your own in{" "}
                <Link href="/plan-builder" className="text-accent">
                  Plan Builder
                </Link>{" "}
                to keep edits private.
              </span>
            )}
          </p>
        )}
      </header>

      <section className="py-6">
        <h2 className="mb-3 text-[15px] font-bold">Curriculum</h2>
        {courses === null ? (
          <p className="text-[12.5px] text-muted">Loading…</p>
        ) : (
          <CurriculumTable courses={courses} onChange={setCourses} />
        )}
      </section>

      <section className="py-6">
        <h2 className="mb-3 text-[15px] font-bold">Term calendar</h2>
        <label className="flex items-start gap-3 text-[12.5px]">
          <input
            type="checkbox"
            checked={optionalTermsEnabled}
            onChange={(e) => setOptionalTermsEnabled(e.target.checked)}
            className="mt-0.5"
          />
          <span>
            <span className="font-semibold text-ink">Enable optional Winter/Summer intersessions</span>
            <br />
            <span className="text-muted">
              Off by default: the university runs a 2-season Fall/Spring calendar only. Turning this on
              adds optional Winter/Summer terms (small bonus sections for a handful of CS courses,
              configured in <code>simulation_config.json</code>) that students can use to retake or get
              ahead without it costing a mandatory semester. Admission stays Fall-only either way.
            </span>
          </span>
        </label>
      </section>

      <section className="py-6">
        <h2 className="mb-3 text-[15px] font-bold">Admissions health targets</h2>
        <p className="mb-4 max-w-2xl text-[12.5px] text-muted">
          The four pass/fail thresholds used by the Admissions recommendation on the Capacity Planning
          page. Slack ≥ 1 means the criterion is met; the worst slack determines the recommended intake.
        </p>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {(
            [
              { key: "target_grad_rate", label: "Min graduation rate", min: 0, max: 1, step: 0.01 },
              { key: "max_avg_time_to_degree", label: "Max avg time (terms)", min: 1, max: 24, step: 0.5 },
              { key: "max_seats_denied_per_student", label: "Max seats denied / student", min: 0, max: 20, step: 0.1 },
              { key: "min_throughput_stability", label: "Min throughput stability", min: 0, max: 1, step: 0.01 },
            ] as const
          ).map(({ key, label, min, max, step }) => {
            const dirty = admissionTargets[key] !== meta.admission_targets[key];
            return (
              <label key={key} className="flex flex-col gap-1">
                <span className={`text-[11.5px] font-semibold ${dirty ? "text-accent" : "text-muted"}`}>
                  {label}{dirty ? " *" : ""}
                </span>
                <input
                  type="number"
                  value={admissionTargets[key]}
                  min={min}
                  max={max}
                  step={step}
                  onChange={(e) => setAdmissionTarget(key, parseFloat(e.target.value))}
                  className="w-full rounded-[8px] border border-border bg-surface-2 px-3 py-1.5 text-[13px] text-ink focus:outline-none focus:ring-1 focus:ring-accent"
                />
              </label>
            );
          })}
        </div>
      </section>

      <section className="py-6">
        <h2 className="mb-3 text-[15px] font-bold">Baseline configuration</h2>
        <div className="flex flex-col gap-4">
          <AdmissionsTab mode="advanced" state={state} baseline={baseline} setField={setField} setRecordField={setRecordField} />
          <PassRatesDropoutTab mode="advanced" meta={meta} state={state} baseline={baseline} setField={setField} setRecordField={setRecordField} />
          <RegistrationPolicyTab mode="advanced" state={state} baseline={baseline} setField={setField} />
        </div>

        <div className="mt-4 flex items-center gap-3 border-t border-border pt-4">
          <button
            type="button"
            onClick={saveConfig}
            disabled={status === "saving"}
            className="rounded-[9px] bg-accent px-4 py-1.5 text-[13px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            {status === "saving" ? "Saving…" : "Save as new baseline"}
          </button>
          <span
            className={
              status === "saving"
                ? "text-xs text-accent"
                : status === "saved"
                  ? "text-xs text-good"
                  : status === "error"
                    ? "text-xs text-bad"
                    : "text-xs text-muted"
            }
          >
            {status === "saving" ? "Saving…" : status === "saved" ? "Saved — new baseline in effect" : status === "error" ? error : "Idle"}
          </span>
        </div>
      </section>
    </main>
  );
}
