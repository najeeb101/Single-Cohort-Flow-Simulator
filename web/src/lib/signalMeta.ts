import type { BlockSignal } from "@/types/simulation";

// The four "why a student got stuck" signals, kept SEPARATE by design (they use different units
// and must never be summed — see CLAUDE.md "Four Block Signals"). This is the single source of
// truth for how each signal is labelled and coloured across the dashboard: the Student Trace
// pills consume it today, and the planned Bottlenecks SignalLegend (#2) can render the same map.
//
// `fail` isn't a per-term BlockSignal in the trace (a failed course is a transcript row, not a
// block), but it's part of the same conceptual family, so the legend includes it.
export type SignalKey = BlockSignal | "fail";

export interface SignalInfo {
  label: string; // short pill label
  unit: string; // tooltip: what the signal means + the unit it's counted in
  pill: string; // pill classes (border/bg/text), theme-token based so light+dark both work
  dot: string; // solid swatch for a legend dot (used by the future SignalLegend)
}

export const SIGNAL_META: Record<SignalKey, SignalInfo> = {
  fail: {
    label: "Failed",
    unit: "Attempted the course and did not pass (grade F). Counted once per attempt.",
    pill: "border-bad/50 bg-bad/5 text-bad",
    dot: "bg-bad",
  },
  capacity: {
    label: "No seat",
    unit: "Requested a seat this term but lost the allocation — the course was full. Counted per term.",
    pill: "border-warn/50 bg-warn/5 text-warn",
    dot: "bg-warn",
  },
  offering: {
    label: "Not offered",
    unit: "Eligible to take it, but the course wasn't taught this term. Counted per eligible student, per term.",
    pill: "border-accent/50 bg-accent/5 text-accent",
    dot: "bg-accent",
  },
  prereq: {
    label: "Prereqs pending",
    unit: "Prerequisites not yet satisfied — still waiting before this course can be taken. Counted per eligible-or-waiting student, per term.",
    pill: "border-good/50 bg-good/5 text-good",
    dot: "bg-good",
  },
};

// Fixed display order (matches the per-term loop's signal ordering, most-actionable first).
export const SIGNAL_ORDER: SignalKey[] = ["fail", "capacity", "offering", "prereq"];
