"use client";

import { useState } from "react";
import { ApiError, updateConfig, updateCourse } from "@/lib/api";
import type { AdvisorProposal } from "@/types/simulation";

// One actionable change the advisor proposed, validated server-side against the real plan. Applying
// routes through the SAME endpoints Settings uses (PUT /curriculum / PUT /config) and then re-runs
// the baseline via the parent's refreshBaseline — the LLM never writes anything itself, and the
// admin has to click through a confirm step, so a bad suggestion can't mutate the plan on its own.

type ApplyState = "idle" | "confirm" | "applying" | "applied" | "error";

const TYPE_LABEL: Record<AdvisorProposal["type"], string> = {
  capacity: "Seats",
  offering: "Offering",
  pass_rate: "Pass rate",
  cohort_size: "Intake",
};

export default function AdvisorProposalCard({
  proposal,
  onApplied,
}: {
  proposal: AdvisorProposal;
  onApplied: () => Promise<void> | void;
}) {
  const [state, setState] = useState<ApplyState>("idle");
  const [err, setErr] = useState<string | null>(null);

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

  return (
    <div className="rounded-xl border border-border-2 bg-surface px-3 py-2.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="rounded bg-accent/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-accent">
              {TYPE_LABEL[proposal.type]}
            </span>
            <span className="text-[12.5px] font-semibold text-ink">{proposal.label}</span>
          </div>
          {proposal.reason && <p className="mt-1 text-[11.5px] leading-snug text-muted">{proposal.reason}</p>}
        </div>

        <div className="shrink-0">
          {state === "idle" && (
            <button
              type="button"
              onClick={() => setState("confirm")}
              className="rounded-lg border border-accent px-3 py-1 text-[12px] font-semibold text-accent hover:bg-accent/10"
            >
              Apply
            </button>
          )}
          {state === "applying" && (
            <span className="text-[12px] text-muted">Applying…</span>
          )}
          {state === "applied" && (
            <span className="text-[12px] font-semibold text-good">✓ Applied</span>
          )}
        </div>
      </div>

      {state === "confirm" && (
        <div className="mt-2 flex items-center justify-between gap-2 rounded-lg bg-surface-2 px-2.5 py-2">
          <span className="text-[11px] text-muted">This edits your live plan and re-runs the baseline.</span>
          <span className="flex shrink-0 gap-1.5">
            <button
              type="button"
              onClick={() => setState("idle")}
              className="rounded-lg px-2.5 py-1 text-[12px] text-muted hover:text-ink"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={apply}
              className="rounded-lg bg-accent px-3 py-1 text-[12px] font-semibold text-white hover:opacity-90"
            >
              Confirm
            </button>
          </span>
        </div>
      )}

      {state === "error" && (
        <div className="mt-2 flex items-center justify-between gap-2">
          <span className="text-[11px] text-bad">{err}</span>
          <button
            type="button"
            onClick={apply}
            className="rounded-lg border border-border-2 px-2.5 py-1 text-[12px] font-semibold text-ink hover:bg-surface-2"
          >
            Retry
          </button>
        </div>
      )}
    </div>
  );
}
