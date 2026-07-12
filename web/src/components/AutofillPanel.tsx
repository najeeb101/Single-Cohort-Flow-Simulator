"use client";

import { useState } from "react";
import { ApiError, autofill, updateConfig, updateCourse } from "@/lib/api";
import { useSimulation } from "@/lib/SimulationContext";
import { formatCriterionValue, pct } from "@/lib/format";
import type { AutofillResult } from "@/types/simulation";

// Auto-fill to targets: one click runs the backend solver (POST /autofill), which searches the
// smallest capacity additions that meet the admission health targets at the current intake, then
// lets the admin apply the result. "Apply" reuses the existing per-course PUT /curriculum + PUT
// /config writes and then refreshBaseline(), so there is no new persistence path — the whole app
// picks up the change immediately, same as a Settings edit.

const CRITERION_LABEL: Record<string, string> = {
  graduation_rate: "Graduation rate",
  time_to_degree: "Time to degree",
  seats_denied_per_stud: "Seats denied / student",
  throughput_stability: "Throughput stability",
};

export default function AutofillPanel() {
  const { refreshBaseline } = useSimulation();
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<AutofillResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showTrace, setShowTrace] = useState(false);
  const [applyIntake, setApplyIntake] = useState(false);
  const [applying, setApplying] = useState(false);
  const [applied, setApplied] = useState(false);

  const run = async () => {
    setRunning(true);
    setError(null);
    setApplied(false);
    setResult(null);
    try {
      const res = await autofill();
      setResult(res);
      setApplyIntake(false);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Auto-fill failed — is the API running?");
    } finally {
      setRunning(false);
    }
  };

  const apply = async () => {
    if (!result) return;
    setApplying(true);
    setError(null);
    try {
      await Promise.all(
        Object.entries(result.recommended).map(([code, rec]) =>
          updateCourse(code, { capacity: rec.recommended })
        )
      );
      const intake = result.intake_suggestion?.recommended_intake;
      if (applyIntake && intake != null) {
        await updateConfig({ cohort_size: intake });
      }
      await refreshBaseline();
      setApplied(true);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not apply the changes");
    } finally {
      setApplying(false);
    }
  };

  const recEntries = result ? Object.entries(result.recommended) : [];
  const intake = result?.intake_suggestion?.recommended_intake ?? null;

  return (
    <section className="py-6">
      <div className="mb-1 flex items-baseline gap-2">
        <h2 className="text-[15px] font-bold">Auto-fill to targets</h2>
        <span className="text-xs font-normal text-muted">— solve for the seats that hit your targets</span>
      </div>
      <p className="mb-4 max-w-3xl text-sm text-muted">
        Searches the smallest capacity additions that meet every admission health target at the current
        intake. Runs a series of simulations (a few seconds), then lets you apply the result.
      </p>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={run}
          disabled={running || applying}
          className={`rounded-xl px-5 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50 ${
            result && !running
              ? "border border-border bg-surface-2 text-ink hover:border-accent/50"
              : "bg-accent text-white"
          }`}
        >
          {running ? "Searching…" : result ? "↻ Run again" : "▶ Auto-fill to hit targets"}
        </button>
        {running && <span className="text-sm text-muted">running simulations…</span>}
        {error && <span className="text-sm text-bad">{error}</span>}
      </div>

      {result && (
        <div className="mt-4 flex flex-col gap-4">
          {/* Verdict banner */}
          <div
            className={`rounded-2xl border border-l-[3px] p-4 ${
              result.feasible
                ? "border-border border-l-good bg-surface"
                : "border-border border-l-warn bg-surface"
            }`}
          >
            <div className={`text-sm font-bold ${result.feasible ? "text-good" : "text-warn"}`}>
              {result.feasible
                ? "All targets can be met by adding seats"
                : "Capacity alone can't meet every target"}
            </div>
            <p className="mt-1 text-sm text-muted">
              {result.feasible
                ? `Adding ${result.total_seats_added.toLocaleString()} seats across ${recEntries.length} course(s) meets every target at the current intake of ${result.current_intake}.`
                : `Even after ${result.total_seats_added.toLocaleString()} added seats, some targets stay breached — those aren't seat-driven. ${result.intake_suggestion?.note ?? ""}`}
            </p>
          </div>

          {/* Target pass/fail chips */}
          <div className="flex flex-wrap gap-2">
            {result.criteria.map((c) => (
              <div
                key={c.name}
                className={`rounded-xl border border-border px-3 py-1.5 text-sm ${
                  c.met ? "text-good" : "text-bad"
                }`}
              >
                <span className="font-semibold">{CRITERION_LABEL[c.name] ?? c.name}</span>{" "}
                <span className="text-muted">
                  {formatCriterionValue(c.name, c.observed)} / {formatCriterionValue(c.name, c.target)} {c.met ? "✓" : "✗"}
                </span>
              </div>
            ))}
          </div>

          {/* Recommended capacities */}
          {recEntries.length > 0 && (
            <div className="overflow-auto rounded-2xl border border-border bg-surface">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr>
                    {["Course", "Current", "Recommended capacity"].map((h) => (
                      <th
                        key={h}
                        className="whitespace-nowrap border-b border-border bg-surface px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {recEntries.map(([code, rec]) => (
                    <tr key={code} className="group border-b border-border transition-colors hover:bg-surface-2 last:border-0">
                      <td className="whitespace-nowrap px-3 py-2.5 font-semibold">{code}</td>
                      <td className="whitespace-nowrap px-3 py-2.5 tabular-nums text-muted">{rec.current}</td>
                      <td className="whitespace-nowrap px-3 py-2.5 tabular-nums font-bold text-ink">
                        {rec.recommended}{" "}
                        <span className="ml-1 rounded bg-surface-2 px-1.5 py-0.5 text-xs font-medium text-muted">
                          +{rec.added}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Resulting metrics */}
          <div className="flex flex-wrap gap-2 text-sm">
            {[
              ["Graduation", pct(result.final_metrics.graduation_rate)],
              ["On-time", pct(result.final_metrics.on_time_rate)],
              ["Avg time", `${result.final_metrics.avg_graduation_time.toFixed(1)} sem`],
              ["Dropout", pct(result.final_metrics.academic_dropout_rate)],
            ].map(([k, v]) => (
              <div key={k} className="rounded-xl border border-border bg-surface px-3 py-1.5 text-muted">
                {k}: <b className="text-ink">{v}</b>
              </div>
            ))}
          </div>

          {/* Optional intake fallback */}
          {intake != null && (
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={applyIntake}
                onChange={(e) => setApplyIntake(e.target.checked)}
                className="mt-0.5"
              />
              <span className="text-muted">
                Also reduce intake to <b className="text-ink">{intake}/year</b> (needed to meet the
                targets capacity alone couldn&apos;t).
              </span>
            </label>
          )}

          {/* Apply + trace */}
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={apply}
              disabled={applying || recEntries.length === 0}
              className="rounded-xl bg-accent px-5 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              {applying ? "Applying…" : "Apply these changes"}
            </button>
            {applied && <span className="text-sm font-semibold text-good">Applied — new baseline in effect</span>}
            <button
              type="button"
              onClick={() => setShowTrace((v) => !v)}
              className="text-sm font-semibold text-muted hover:text-ink"
            >
              {showTrace ? "Hide search steps" : "Show search steps"}
            </button>
          </div>

          {showTrace && (
            <div className="overflow-auto rounded-2xl border border-border bg-surface">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr>
                    {["#", "Action", "Course", "Seats", "Worst target", "Slack"].map((h) => (
                      <th key={h} className="border-b border-border px-3 py-1.5 text-left text-xs font-semibold uppercase tracking-wide text-muted">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {result.trace.map((t) => (
                    <tr key={t.iteration} className="group border-b border-border transition-colors hover:bg-surface-2 last:border-0">
                      <td className="whitespace-nowrap px-3 py-2.5 tabular-nums text-muted">{t.iteration}</td>
                      <td className="whitespace-nowrap px-3 py-2.5">{t.action}</td>
                      <td className="whitespace-nowrap px-3 py-2.5 font-semibold">{t.course ?? "—"}</td>
                      <td className="whitespace-nowrap px-3 py-2.5 tabular-nums text-muted">
                        {t.from != null && t.to != null ? `${t.from} → ${t.to}` : "—"}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-muted">{t.worst_criterion ? (CRITERION_LABEL[t.worst_criterion] ?? t.worst_criterion) : "—"}</td>
                      <td className="whitespace-nowrap px-3 py-2.5 tabular-nums text-muted">{t.worst_slack ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <p className="text-xs text-muted">{result.note}</p>
        </div>
      )}
    </section>
  );
}
