"use client";

import { useState } from "react";
import { ApiError, simulate, updateConfig, updateCourse } from "@/lib/api";
import { pct } from "@/lib/format";
import type { AdvisorProposal, Headline, ScenarioRequest } from "@/types/simulation";

// One actionable change the advisor proposed, validated server-side against the real plan. Two
// guarded actions, both driven by the AI's suggestion — this is where the old manual What-if now
// lives:
//   • Test  — run one simulation with the proposed override and show the predicted before/after
//             (no write; the plan is untouched).
//   • Apply — write it into the active plan via the SAME endpoints Settings uses (PUT /curriculum /
//             PUT /config) + refreshBaseline, behind an explicit confirm.
// The LLM never writes anything itself; the human tests and confirms.

type ApplyState = "idle" | "confirm" | "applying" | "applied" | "error";
type TestResult = { metrics: Headline; seatsPerStud: number | null };

const TYPE_LABEL: Record<AdvisorProposal["type"], string> = {
  capacity: "Seats",
  offering: "Offering",
  pass_rate: "Pass rate",
  cohort_size: "Intake",
};

// The proposal, expressed as the ephemeral /simulate override the Test run uses (never persisted).
function buildOverride(p: AdvisorProposal): ScenarioRequest {
  if (p.type === "cohort_size") return { cohort_size: p.value as number };
  const code = p.code ?? "";
  if (p.type === "capacity") {
    const cur = typeof p.current === "number" ? p.current : 0;
    const target = p.value as number;
    // capacity_overrides is a multiplier on the course's base seats, so target/current lands on it.
    return cur > 0 ? { capacity_overrides: { [code]: target / cur } } : {};
  }
  if (p.type === "pass_rate") return { pass_rate_overrides: { [code]: p.value as number } };
  if (p.type === "offering") return { offering_overrides: { [code]: p.value as string[] } };
  return {};
}

function Delta({ after, before, isPct = false, lowerIsBetter = false }: {
  after: number; before: number; isPct?: boolean; lowerIsBetter?: boolean;
}) {
  const d = after - before;
  if (Math.abs(d) < 1e-6) return <span className="text-muted">—</span>;
  const improved = lowerIsBetter ? d < 0 : d > 0;
  const sign = d > 0 ? "+" : "";
  const text = isPct ? `${sign}${(d * 100).toFixed(1)}pp` : `${sign}${d.toFixed(2)}`;
  return <span className={improved ? "font-semibold text-good" : "font-semibold text-bad"}>{text}</span>;
}

export default function AdvisorProposalCard({
  proposal,
  baseline,
  baselineSeatsPerStud,
  onApplied,
}: {
  proposal: AdvisorProposal;
  baseline: Headline;
  baselineSeatsPerStud: number | null;
  onApplied: () => Promise<void> | void;
}) {
  const [state, setState] = useState<ApplyState>("idle");
  const [err, setErr] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [testErr, setTestErr] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<TestResult | null>(null);

  const test = async () => {
    setTesting(true);
    setTestErr(null);
    try {
      const res = await simulate(buildOverride(proposal));
      const seatsPerStud =
        res.admissions_recommendation?.criteria?.find((c) => c.name === "seats_denied_per_stud")?.observed ?? null;
      setTestResult({ metrics: res.metrics, seatsPerStud });
    } catch (e) {
      setTestErr(e instanceof ApiError ? e.message : "Test failed — is the API running?");
    } finally {
      setTesting(false);
    }
  };

  const apply = async () => {
    setState("applying");
    setErr(null);
    try {
      if (proposal.type === "cohort_size") {
        await updateConfig({ cohort_size: proposal.value as number });
      } else if (proposal.code) {
        const patch: Record<string, unknown> = {};
        if (proposal.type === "capacity") patch.capacity = proposal.value;
        else if (proposal.type === "pass_rate") patch.pass_rate = proposal.value;
        else if (proposal.type === "offering") patch.offering = proposal.value;
        await updateCourse(proposal.code, patch);
      }
      await onApplied();
      setState("applied");
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Couldn't apply — try again.");
      setState("error");
    }
  };

  const rows = testResult
    ? [
        { label: "Graduation rate", now: pct(baseline.graduation_rate), next: pct(testResult.metrics.graduation_rate),
          delta: <Delta after={testResult.metrics.graduation_rate} before={baseline.graduation_rate} isPct /> },
        { label: "On-time rate", now: pct(baseline.on_time_rate), next: pct(testResult.metrics.on_time_rate),
          delta: <Delta after={testResult.metrics.on_time_rate} before={baseline.on_time_rate} isPct /> },
        { label: "Avg time to degree", now: `${baseline.avg_graduation_time.toFixed(1)} sem`, next: `${testResult.metrics.avg_graduation_time.toFixed(1)} sem`,
          delta: <Delta after={testResult.metrics.avg_graduation_time} before={baseline.avg_graduation_time} lowerIsBetter /> },
        { label: "Academic dropout", now: pct(baseline.academic_dropout_rate), next: pct(testResult.metrics.academic_dropout_rate),
          delta: <Delta after={testResult.metrics.academic_dropout_rate} before={baseline.academic_dropout_rate} isPct lowerIsBetter /> },
        ...(baselineSeatsPerStud !== null && testResult.seatsPerStud !== null
          ? [{ label: "Seats denied / student", now: baselineSeatsPerStud.toFixed(2), next: testResult.seatsPerStud.toFixed(2),
              delta: <Delta after={testResult.seatsPerStud} before={baselineSeatsPerStud} lowerIsBetter /> }]
          : []),
      ]
    : [];

  return (
    <div className="rounded-xl border border-border-2 bg-surface px-3 py-2.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="rounded bg-accent/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-accent">
              {TYPE_LABEL[proposal.type]}
            </span>
            <span className="text-sm font-semibold text-ink">{proposal.label}</span>
          </div>
          {proposal.reason && <p className="mt-1 text-xs leading-snug text-muted">{proposal.reason}</p>}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={test}
            disabled={testing}
            className="rounded-lg border border-border-2 px-3 py-1 text-sm font-semibold text-ink hover:bg-surface-2 disabled:opacity-50"
          >
            {testing ? "Testing…" : testResult ? "Re-test" : "Test"}
          </button>
          {state === "idle" && (
            <button
              type="button"
              onClick={() => setState("confirm")}
              className="rounded-lg border border-accent px-3 py-1 text-sm font-semibold text-accent hover:bg-accent/10"
            >
              Apply
            </button>
          )}
          {state === "applying" && <span className="text-sm text-muted">Applying…</span>}
          {state === "applied" && <span className="text-sm font-semibold text-good">✓ Applied</span>}
        </div>
      </div>

      {testErr && <p className="mt-2 text-sm text-bad">{testErr}</p>}

      {testResult && (
        <div className="mt-2.5 overflow-x-auto rounded-lg border border-border bg-surface-2">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                {["Predicted effect", "Now", "If applied", "Δ"].map((h) => (
                  <th key={h} className="border-b border-border px-3 py-1.5 text-left text-[10px] font-semibold uppercase tracking-wide text-muted">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.label} className="group border-b border-border transition-colors hover:bg-surface-2 last:border-0">
                  <td className="px-3 py-1.5 text-muted">{r.label}</td>
                  <td className="px-3 py-1.5 tabular-nums">{r.now}</td>
                  <td className="px-3 py-1.5 font-semibold tabular-nums">{r.next}</td>
                  <td className="px-3 py-1.5">{r.delta}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="px-3 py-1.5 text-[10.5px] text-muted">
            Single-seed estimate on top of the current baseline — nothing was changed. Click Apply to commit it.
          </p>
        </div>
      )}

      {state === "confirm" && (
        <div className="mt-2 flex items-center justify-between gap-2 rounded-lg bg-surface-2 px-2.5 py-2">
          <span className="text-xs text-muted">This edits your live plan and re-runs the baseline.</span>
          <span className="flex shrink-0 gap-1.5">
            <button
              type="button"
              onClick={() => setState("idle")}
              className="rounded-lg px-2.5 py-1 text-sm text-muted hover:text-ink"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={apply}
              className="rounded-lg bg-accent px-3 py-1 text-sm font-semibold text-white hover:opacity-90"
            >
              Confirm
            </button>
          </span>
        </div>
      )}

      {state === "error" && (
        <div className="mt-2 flex items-center justify-between gap-2">
          <span className="text-sm text-bad">{err}</span>
          <button
            type="button"
            onClick={apply}
            className="rounded-lg border border-border-2 px-2.5 py-1 text-sm font-semibold text-ink hover:bg-surface-2"
          >
            Retry
          </button>
        </div>
      )}

    </div>
  );
}
