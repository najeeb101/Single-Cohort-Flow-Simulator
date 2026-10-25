"use client";

import { useState } from "react";
import { ApiError, updateCourse } from "@/lib/api";
import { useIntake } from "@/lib/IntakeContext";
import { useSimulation } from "@/lib/SimulationContext";
import { useCheckpoint } from "@/lib/CheckpointContext";
import { pct0, pts } from "@/lib/intakeUtils";
import ProgressBar from "@/components/intake/ProgressBar";
import type { SeatPlanOutcome, SeatPlanResult } from "@/types/simulation";

const LIMIT_NAME: Record<string, string> = {
  grad_rate_loss: "Graduation",
  on_time_loss: "On-time graduation",
  min_grad_rate: "Minimum graduation rate",
};

function OutcomeRow({ label, before, after }: { label: string; before: SeatPlanOutcome; after: SeatPlanOutcome }) {
  return (
    <tr className="border-b border-border last:border-0">
      <td className="px-3 py-2 font-semibold">{label}</td>
      <td className="px-3 py-2 tabular-nums">{pct0(before.grad_rate)} → <b>{pct0(after.grad_rate)}</b></td>
      <td className="px-3 py-2 tabular-nums">{pct0(before.on_time_rate)} → <b>{pct0(after.on_time_rate)}</b></td>
      <td className="px-3 py-2 tabular-nums">
        {before.avg_time_to_degree.toFixed(1)} → <b>{after.avg_time_to_degree.toFixed(1)}</b> sem
      </td>
      <td className="px-3 py-2 text-xs">
        {Object.entries(after.checks).map(([name, c]) => (
          <div key={name} className={c.met ? "text-good" : "text-bad"}>
            {LIMIT_NAME[name] ?? name}: {pts(c.loss)} lost {c.met ? "(within limit)" : `(limit ${c.tolerance} pts)`}
          </div>
        ))}
      </td>
    </tr>
  );
}

// "What would it take to admit N?": seats to add per course (rounded up to meta.seat_step, not
// whole sections: sections vary in size and can be widened), sized from demand and checked
// against the policy limits. Read-only until Apply, which writes capacities through PUT
// /curriculum (or, during a walkthrough, POST /checkpoint/edit so it applies from the next step).
export default function SeatPlanner({ defaultTarget }: { defaultTarget?: number }) {
  const { meta, refreshBaseline } = useSimulation();
  const { session, edit: editCheckpoint } = useCheckpoint();
  const { job, busy, latestSeatPlan, run, cancel } = useIntake();
  const checkpoint = !!session;
  const source = checkpoint ? "checkpoint" : "plan";
  const [target, setTarget] = useState(defaultTarget ?? 120);
  const [error, setError] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);
  const [applied, setApplied] = useState(false);
  const [showAll, setShowAll] = useState(false);

  const mine = busy && job?.kind === "seat_plan" ? job : null;
  const shown = latestSeatPlan?.source === source ? latestSeatPlan : null;
  const plan = (shown?.result as SeatPlanResult | undefined) ?? null;

  const start = async () => {
    setError(null);
    setApplied(false);
    try {
      const rec = await run({ kind: "seat_plan", target_intake: target, source });
      if (rec.status === "failed") setError(rec.error ?? "The seat plan failed.");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not start the seat plan.");
    }
  };

  const apply = async () => {
    if (!plan) return;
    const msg = checkpoint
      ? "Stage these seats in the walkthrough? They take effect from the next step."
      : `Add ${plan.total_seats_added.toLocaleString()} seats across ${plan.changes.length} course${plan.changes.length === 1 ? "" : "s"} to your live plan? This changes the seats every analysis uses.`;
    if (!window.confirm(msg)) return;
    setApplying(true);
    setError(null);
    try {
      if (checkpoint) {
        await editCheckpoint({ capacity: Object.fromEntries(plan.changes.map((c) => [c.code, c.recommended])) });
      } else {
        await Promise.all(plan.changes.map((c) => updateCourse(c.code, { capacity: c.recommended })));
        try {
          await refreshBaseline();
        } catch {
          // Seats are saved; a refresh hiccup only delays the other pages updating.
        }
      }
      setApplied(true);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not apply the seat plan.");
    } finally {
      setApplying(false);
    }
  };

  return (
    <section className="rounded-xl border border-border bg-surface p-6">
      <p className="mb-4 max-w-3xl text-sm text-muted">
        What would it take to admit more?
        Enter the intake you would like. The planner works out how many seats each course would need, checks the result
        against your limits, and shows the outcomes before and after. Suggestions are in seats, rounded up to{" "}
        {meta.seat_step}: a course can grow by widening its sections or by opening a new one.
        {checkpoint && " It uses your walkthrough's current settings, and Apply takes effect on the walkthrough's next step."}
      </p>

      <div className="no-print flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs font-semibold text-muted">
          Target intake
          <input
            type="number"
            min={10}
            max={1000}
            step={5}
            value={target}
            onChange={(e) => setTarget(Number(e.target.value))}
            className="w-28 rounded-lg border border-border-2 bg-surface-2 px-2.5 py-1.5 text-sm text-ink tabular-nums focus:outline-none focus:ring-1 focus:ring-accent"
          />
        </label>
        <button
          type="button"
          onClick={start}
          disabled={busy || target < 10 || target > 1000}
          className="rounded-xl bg-primary px-5 py-2 text-sm font-semibold text-primary-ink disabled:cursor-not-allowed disabled:opacity-50"
        >
          {mine ? "Planning..." : `Plan seats for ${target}`}
        </button>
        {busy && !mine && <span className="text-sm text-muted">Another analysis is running; wait for it to finish.</span>}
        {error && <span className="text-sm text-bad">{error}</span>}
      </div>

      {mine && (
        <div className="mt-3 max-w-xl">
          <ProgressBar job={mine} onCancel={cancel} />
        </div>
      )}

      {plan && !mine && (
        <div className="mt-4 flex flex-col gap-3">
          <div className={`rounded-lg border px-4 py-3 ${plan.feasible ? "border-good/25 bg-good/[0.07]" : "border-warn/25 bg-warn/[0.08]"}`}>
            <div className={`text-sm font-bold ${plan.feasible ? "text-good" : "text-warn"}`}>
              {plan.changes.length === 0
                ? `Today's seats already carry an intake of ${plan.target_intake}`
                : plan.feasible
                ? `Admitting ${plan.target_intake} needs ${plan.total_seats_added.toLocaleString()} more seats across ${plan.changes.length} course${plan.changes.length === 1 ? "" : "s"}`
                : `Even with ${plan.total_seats_added.toLocaleString()} more seats, ${plan.target_intake} still breaks a limit`}
            </div>
            <p className="mt-1 text-sm text-muted">
              {plan.feasible
                ? "With these seats the limits hold for both next year and the long run."
                : "Seats alone don't bring the outcomes inside the limits within the planner's budget of checks. The rest is likely pass rates or dropout, not seats."}
            </p>
          </div>

          {plan.changes.length > 0 && (
            <div className="overflow-auto rounded-xl border border-border">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr>
                    {["Course", "Seats now", "Seats needed", "Seats to add"].map((h) => (
                      <th key={h} className="whitespace-nowrap border-b border-border px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[...plan.changes]
                    .sort((a, b) => b.seats_added - a.seats_added || a.code.localeCompare(b.code))
                    .slice(0, showAll ? undefined : 8)
                    .map((c) => (
                    <tr key={c.code} className="border-b border-border last:border-0">
                      <td className="px-3 py-2">
                        <span className="font-semibold">{c.code}</span> <span className="text-muted">{c.title}</span>
                      </td>
                      <td className="px-3 py-2 tabular-nums text-muted">{c.current}</td>
                      <td className="px-3 py-2 font-semibold tabular-nums">{c.recommended}</td>
                      <td className="px-3 py-2 font-semibold tabular-nums">+{c.seats_added}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {plan.changes.length > 8 && (
                <button
                  type="button"
                  onClick={() => setShowAll((v) => !v)}
                  className="no-print w-full border-t border-border px-3 py-2 text-left text-[13px] font-medium text-accent hover:bg-surface-2"
                >
                  {showAll ? "Show fewer" : `Show all ${plan.changes.length} courses`}
                </button>
              )}
            </div>
          )}

          <div className="overflow-auto rounded-xl border border-border">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr>
                  {[`Outcome at ${plan.target_intake}`, "Graduate", "On time", "Avg time", "Limits after the change"].map((h) => (
                    <th key={h} className="whitespace-nowrap border-b border-border px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <OutcomeRow label="Next year" before={plan.before.next} after={plan.after.next} />
                <OutcomeRow label="Long run" before={plan.before.steady} after={plan.after.steady} />
              </tbody>
            </table>
          </div>

          {plan.changes.length > 0 && (
          <div className="no-print flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={apply}
              disabled={applying || applied}
              className="rounded-xl bg-primary px-5 py-2 text-sm font-semibold text-primary-ink disabled:cursor-not-allowed disabled:opacity-50"
            >
              {applying ? "Applying..." : checkpoint ? "Apply to walkthrough" : "Apply to plan"}
            </button>
            {applied && (
              <span className="text-sm font-semibold text-good">
                {checkpoint ? "Staged: takes effect on the next step" : "Applied. Re-run the analysis to see the new recommendation."}
              </span>
            )}
          </div>
          )}
          <p className="text-xs text-muted">{plan.note}</p>
        </div>
      )}
    </section>
  );
}
