"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSimulation } from "@/lib/SimulationContext";
import { ApiError, listCurriculum, listPlans, updateConfig, updateCourse } from "@/lib/api";
import { baselineFromMeta, buildOverrides, type BuilderState } from "@/lib/scenarioBuilder";
import type { CourseRecord, PlanRecord } from "@/types/simulation";
import CurriculumTable from "@/components/settings/CurriculumTable";
import AdmissionsTab from "@/components/scenario-builder/AdmissionsTab";
import InitialStateEditor from "@/components/scenario-builder/InitialStateEditor";
import { standingLevelsFromThresholds } from "@/components/scenario-builder/InitialStateImportModal";
import PassRatesDropoutTab from "@/components/scenario-builder/PassRatesDropoutTab";
import RegistrationPolicyTab from "@/components/scenario-builder/RegistrationPolicyTab";

// Reuses the Scenario Builder's tab components unchanged (they're pure presentational
// state -> onChange views) — only the Save handler here differs: it writes the new
// baseline via PUT /config (+ per-course PUT /curriculum for any pass_rate edits) instead
// of building a one-run /simulate override.
export default function SettingsPage() {
  const { meta, refreshBaseline } = useSimulation();
  const baseline = baselineFromMeta(meta);
  const [state, setState] = useState<BuilderState>(baseline);
  const [courses, setCourses] = useState<CourseRecord[] | null>(null);
  const [activePlan, setActivePlan] = useState<PlanRecord | null>(null);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [admissionTargets, setAdmissionTargets] = useState({ ...meta.admission_targets });
  // Deferred capacity edits, keyed by course code. Like pass rate, capacity is a per-course
  // Course field (not a BuilderState scalar), so its edits live here until "Save as new
  // baseline" writes each changed course via PUT /curriculum. Baseline = the loaded course's
  // current capacity, so a saved edit becomes the new baseline once `courses` updates.
  const [capacityEdits, setCapacityEdits] = useState<Record<string, number>>({});
  const baselineCapacities = Object.fromEntries((courses ?? []).map((c) => [c.code, c.capacity]));
  // Only count edits for courses that still exist and actually differ from their saved value —
  // so editing back to the original (or a deleted course) doesn't register as an unsaved change.
  const capacityChanges = Object.entries(capacityEdits).filter(
    ([code, v]) => code in baselineCapacities && v !== baselineCapacities[code],
  );

  const setAdmissionTarget = (key: keyof typeof admissionTargets, value: number) =>
    setAdmissionTargets((prev) => ({ ...prev, [key]: value }));

  // Everything on this page except Curriculum (which saves per-row, instantly) is deferred:
  // it sits in local state until "Save as new baseline" is clicked. isDirty is the single
  // source of truth for whether that button actually has anything to do — covers Initial
  // state/Baseline configuration (via buildOverrides) and Admissions targets.
  const isDirty =
    Object.keys(buildOverrides(state, baseline)).length > 0 ||
    JSON.stringify(admissionTargets) !== JSON.stringify(meta.admission_targets) ||
    capacityChanges.length > 0;

  const discardChanges = () => {
    setState(baseline);
    setAdmissionTargets({ ...meta.admission_targets });
    setCapacityEdits({});
    setStatus("idle");
    setError(null);
  };

  // The sticky bar's "Saved" confirmation is transient — auto-dismiss so it doesn't linger
  // once there's nothing left to act on. Errors stay until the user retries or discards.
  useEffect(() => {
    if (status !== "saved") return;
    const t = setTimeout(() => setStatus("idle"), 3000);
    return () => clearTimeout(t);
  }, [status]);

  useEffect(() => {
    listCurriculum().then(setCourses).catch(() => setCourses([]));
    listPlans()
      .then((plans) => setActivePlan(plans.find((p) => p.is_active) ?? null))
      .catch(() => setActivePlan(null));
  }, []);

  // CurriculumTable saves each add/edit/delete immediately (independent of the "Save as new
  // baseline" button below) — refresh the shared context the same way so those edits show up
  // on the Dashboard/Bottlenecks/Advisor/Student Trace/Figures pages right away instead of
  // after a reload.
  const handleCoursesChange = (next: CourseRecord[]) => {
    setCourses(next);
    refreshBaseline().catch(() => {});
  };

  const setField = <K extends keyof BuilderState>(key: K, value: BuilderState[K]) =>
    setState((prev) => ({ ...prev, [key]: value }));

  const setRecordField = (key: "passRates" | "standing" | "initialOccupancy", code: string, value: number) =>
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
    if (overrides.admission_terms !== undefined) configPatch.admission_terms = overrides.admission_terms;
    if (overrides.admission_sizes !== undefined) configPatch.admission_sizes = overrides.admission_sizes;
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

    // Pass rate and capacity are Course/curriculum fields, not baseline-config scalars — persist
    // each changed course individually via PUT /curriculum/{code}. Use allSettled rather than
    // aborting on the first failure: the config write above already committed, so a single bad
    // course shouldn't hide that the rest of the per-course edits saved fine.
    const passRateChanges = overrides.pass_rate_overrides ?? {};
    const prEntries = Object.entries(passRateChanges);
    const prResults = await Promise.allSettled(prEntries.map(([code, rate]) => updateCourse(code, { pass_rate: rate })));
    const capResults = await Promise.allSettled(capacityChanges.map(([code, cap]) => updateCourse(code, { capacity: cap })));

    const prOk = new Set(prEntries.filter((_, i) => prResults[i].status === "fulfilled").map(([code]) => code));
    const capOk = new Set(capacityChanges.filter((_, i) => capResults[i].status === "fulfilled").map(([code]) => code));
    if ((prOk.size > 0 || capOk.size > 0) && courses) {
      setCourses(
        courses.map((c) => {
          let next = c;
          if (prOk.has(c.code)) next = { ...next, pass_rate: passRateChanges[c.code] };
          if (capOk.has(c.code)) next = { ...next, capacity: capacityEdits[c.code] };
          return next;
        }),
      );
    }
    if (capOk.size > 0) {
      setCapacityEdits((prev) => {
        const nextEdits = { ...prev };
        capOk.forEach((code) => delete nextEdits[code]);
        return nextEdits;
      });
    }

    const prFailed = prEntries.filter((_, i) => prResults[i].status === "rejected");
    const capFailed = capacityChanges.filter((_, i) => capResults[i].status === "rejected");
    if (prFailed.length > 0 || capFailed.length > 0) {
      const firstError = [...prResults, ...capResults].find((r) => r.status === "rejected") as PromiseRejectedResult;
      const reason = firstError.reason instanceof ApiError ? firstError.reason.message : "save failed";
      const codes = [...prFailed, ...capFailed].map(([code]) => code);
      setStatus("error");
      setError(`Not saved for ${codes.join(", ")} (${reason})`);
      return;
    }

    // The saved rows above are the source of truth; re-fetch meta + re-run the baseline
    // simulation so the shared SimulationContext (Bottlenecks, Advisor, Student Trace, Figures)
    // reflects the new baseline immediately instead of only after a hard reload.
    try {
      await refreshBaseline();
    } catch {
      // Config/course rows already saved successfully — a refresh hiccup here shouldn't
      // be reported as a save failure. The next page load will pick up the new baseline.
    }

    setStatus("saved");
  };

  return (
    <main className="mx-auto w-full max-w-[1600px] px-7 pb-16">
      <header className="border-b border-border py-5">
        <h1 className="text-[19px] font-bold tracking-tight">Settings</h1>
        <p className="mt-0.5 text-sm text-muted">
          Edits here persist to the database as the new baseline — every future run starts from these
          values, unlike the Scenario Builder&apos;s per-run overrides.
        </p>
        {activePlan && (
          <p className="mt-2 text-sm">
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

      <nav className="sticky top-0 z-10 -mx-7 flex flex-wrap gap-x-5 gap-y-1 border-b border-border bg-bg/90 px-7 py-2.5 text-sm backdrop-blur-sm">
        {[
          { href: "#initial-state", label: "Initial state" },
          { href: "#curriculum", label: "Curriculum" },
          { href: "#admissions-targets", label: "Admissions targets" },
          { href: "#baseline-configuration", label: "Baseline configuration" },
        ].map((l) => (
          <a key={l.href} href={l.href} className="text-muted hover:text-ink">
            {l.label}
          </a>
        ))}
      </nav>

      <section id="initial-state" className="border-b border-border py-6">
        <h2 className="mb-1 text-[15px] font-bold">Initial state</h2>
        <p className="mb-3 max-w-2xl text-sm text-muted">
          The existing student body the first simulated cohort walks into: how many students are already at each
          year-standing, plus per-course occupied seats (edited in the{" "}
          <b className="font-semibold text-ink">Occupancy</b> column of the Curriculum table below). Use{" "}
          <b className="font-semibold text-ink">Import from file</b> to bulk-load either from a CSV or Excel sheet
          instead of typing each row. Saved with &ldquo;Save as new baseline&rdquo; below.
        </p>
        <InitialStateEditor
          courses={courses ?? []}
          occupancy={state.initialOccupancy}
          standing={state.standing}
          standingNodes={standingLevelsFromThresholds(meta.year_standing_thresholds)}
          baselineOccupancy={baseline.initialOccupancy}
          baselineStanding={baseline.standing}
          showOccupancyTable={false}
          onOccupancyChange={(code, v) => setRecordField("initialOccupancy", code, v)}
          onOccupancyBulkChange={(patch) => setField("initialOccupancy", { ...state.initialOccupancy, ...patch })}
          onStandingChange={(node, v) => setRecordField("standing", node, v)}
          onStandingBulkChange={(patch) => setField("standing", { ...state.standing, ...patch })}
        />
      </section>

      <section id="curriculum" className="py-6">
        <h2 className="mb-1 text-[15px] font-bold">Curriculum &amp; initial occupancy</h2>
        <p className="mb-3 max-w-2xl text-sm text-muted">
          Course structure (Edit / Add / Delete) saves instantly. The{" "}
          <b className="font-semibold text-ink">Pass rate</b>,{" "}
          <b className="font-semibold text-ink">Capacity</b> and{" "}
          <b className="font-semibold text-ink">Occupancy</b> columns are per-course tuning values, saved with
          &ldquo;Save as new baseline&rdquo; below.
        </p>
        {courses === null ? (
          <p className="text-sm text-muted">Loading…</p>
        ) : (
          <CurriculumTable
            courses={courses}
            onChange={handleCoursesChange}
            seasons={meta.terms_per_year}
            occupancy={state.initialOccupancy}
            baselineOccupancy={baseline.initialOccupancy}
            onOccupancyChange={(code, v) => setRecordField("initialOccupancy", code, v)}
            passRates={state.passRates}
            baselinePassRates={baseline.passRates}
            onPassRateChange={(code, v) => setRecordField("passRates", code, v)}
            capacities={{ ...baselineCapacities, ...capacityEdits }}
            baselineCapacities={baselineCapacities}
            onCapacityChange={(code, v) => setCapacityEdits((prev) => ({ ...prev, [code]: v }))}
          />
        )}
      </section>


      <section id="admissions-targets" className="py-6">
        <h2 className="mb-3 text-[15px] font-bold">Admissions health targets</h2>
        <p className="mb-4 max-w-2xl text-sm text-muted">
          The four pass/fail thresholds used by the Admissions recommendation on the Capacity Planning
          page. Slack ≥ 1 means the criterion is met; the worst slack determines the recommended intake.
        </p>
        <div className="rounded-2xl border border-border bg-surface p-5">
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
                  <span className={`text-xs font-semibold ${dirty ? "text-accent" : "text-muted"}`}>
                    {label}{dirty ? " *" : ""}
                  </span>
                  <input
                    type="number"
                    value={admissionTargets[key]}
                    min={min}
                    max={max}
                    step={step}
                    onChange={(e) => setAdmissionTarget(key, Number(e.target.value))}
                    className="w-full rounded-lg border border-border bg-surface-2 px-3 py-1.5 text-sm text-ink focus:outline-none focus:ring-1 focus:ring-accent"
                  />
                </label>
              );
            })}
          </div>
        </div>
      </section>

      <section id="baseline-configuration" className="py-6 pb-24">
        <h2 className="mb-3 text-[15px] font-bold">Baseline configuration</h2>
        <div className="flex flex-col gap-4">
          <AdmissionsTab
            mode="advanced"
            state={state}
            baseline={baseline}
            courses={courses ?? []}
            setField={setField}
            setRecordField={setRecordField}
            showInitialState={false}
            mandatoryTerms={meta.mandatory_terms}
          />
          <PassRatesDropoutTab mode="advanced" meta={meta} state={state} baseline={baseline} setField={setField} setRecordField={setRecordField} showAllCoursesTable={false} />
          <RegistrationPolicyTab mode="advanced" state={state} baseline={baseline} courses={courses ?? []} setField={setField} />
        </div>
      </section>

      {(isDirty || status === "saved" || status === "error") && (
        <div className="fixed bottom-5 left-1/2 z-20 flex w-[min(680px,calc(100%-2rem))] -translate-x-1/2 items-center justify-between gap-3 rounded-2xl border border-border-2 bg-surface px-5 py-3 shadow-xl">
          <span className="text-sm">
            {status === "saving" ? (
              <span className="text-accent">Saving…</span>
            ) : status === "saved" ? (
              <span className="text-good">Saved — new baseline in effect</span>
            ) : status === "error" ? (
              <span className="text-bad">{error}</span>
            ) : (
              <span className="font-semibold text-ink">Unsaved baseline changes</span>
            )}
          </span>
          <div className="flex items-center gap-2">
            {isDirty && status !== "saving" && (
              <button
                type="button"
                onClick={discardChanges}
                className="rounded-xl border border-border-2 px-3.5 py-1.5 text-sm font-semibold text-muted hover:text-ink"
              >
                Discard
              </button>
            )}
            <button
              type="button"
              onClick={saveConfig}
              disabled={status === "saving" || !isDirty}
              className="rounded-xl bg-accent px-4 py-1.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              {status === "saving" ? "Saving…" : "Save as new baseline"}
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
