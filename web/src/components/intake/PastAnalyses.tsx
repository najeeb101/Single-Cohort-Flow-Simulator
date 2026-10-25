"use client";

import type { AnalysisRecord } from "@/types/simulation";
import { fmtDate } from "@/lib/intakeUtils";

function describe(r: AnalysisRecord): string {
  const s = r.summary ?? {};
  if (r.status !== "done") return r.status === "failed" ? "Failed" : r.status === "cancelled" ? "Cancelled" : "Running";
  if (r.kind === "seat_plan") {
    return `Seat plan for ${s.target_intake}: +${s.total_sections_added ?? 0} sections${s.feasible ? "" : " (limits not met)"}`;
  }
  if (s.recommended_intake == null) return "No intake meets the limits";
  return `Recommended ${s.recommended_intake}${s.sustainable_intake != null ? `, sustainable ${s.sustainable_intake}` : ""}${s.upper_limit != null ? `, upper limit ${s.upper_limit}` : ""}`;
}

// The record of past analyses (replaces Run History). Clicking a finished intake analysis shows it.
export default function PastAnalyses({
  history,
  selectedId,
  onSelect,
}: {
  history: AnalysisRecord[];
  selectedId: number | null;
  onSelect: (id: number) => void;
}) {
  if (history.length === 0) return null;
  return (
    <section className="no-print rounded-xl border border-border bg-surface p-6">
      <p className="text-sm text-muted">Every analysis keeps a copy of the data it ran on, so you can see what a decision was based on.</p>
      <ul className="mt-3 divide-y divide-border">
        {history.map((r) => {
          const clickable = r.kind === "intake_sweep" && r.status === "done";
          return (
            <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
              <div className="min-w-0">
                <span className="font-semibold text-ink">{r.label || (r.kind === "seat_plan" ? "Seat plan" : "Intake analysis")}</span>
                {r.source === "checkpoint" && <span className="ml-2 rounded bg-surface-2 px-1.5 py-0.5 text-[10.5px] text-muted">walkthrough</span>}
                {r.summary?.illustrative && <span className="ml-2 rounded bg-warn/15 px-1.5 py-0.5 text-[10.5px] font-semibold text-warn">illustrative</span>}
                <div className="text-xs text-muted">{fmtDate(r.finished_at ?? r.created_at)} · {describe(r)}</div>
              </div>
              {clickable && (
                <button
                  type="button"
                  onClick={() => onSelect(r.id)}
                  disabled={r.id === selectedId}
                  className="rounded-lg border border-border-2 px-3 py-1 text-xs font-semibold text-ink hover:bg-surface-2 disabled:opacity-50"
                >
                  {r.id === selectedId ? "Showing" : "View"}
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
