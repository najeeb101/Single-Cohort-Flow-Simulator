"use client";

import type { AnalysisRecord } from "@/types/simulation";

// Progress of the running analysis (src/jobs.py writes progress + a short note about once a second).
export default function ProgressBar({ job, onCancel }: { job: AnalysisRecord; onCancel?: () => void }) {
  const pctDone = Math.round((job.progress ?? 0) * 100);
  const what = job.kind === "seat_plan" ? `Seat plan for ${job.params?.target_intake ?? ""}` : "Intake analysis";
  return (
    <div className="no-print rounded-xl border border-border bg-surface-2 px-4 py-3">
      <div className="mb-1.5 flex items-center justify-between gap-3 text-sm">
        <span className="font-semibold text-ink">
          {what} running{job.status === "queued" ? " (starting)" : ""}: {pctDone}%
        </span>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-border-2 px-3 py-1 text-xs font-semibold text-muted hover:text-ink"
          >
            Cancel
          </button>
        )}
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-border-2" role="progressbar" aria-valuenow={pctDone} aria-valuemin={0} aria-valuemax={100}>
        <div className="h-full rounded-full bg-accent transition-[width] duration-500" style={{ width: `${pctDone}%` }} />
      </div>
      {job.progress_note && <p className="mt-1.5 text-xs text-muted">{job.progress_note}</p>}
    </div>
  );
}
