import type { BlockSignal } from "@/types/simulation";

// The four "why a student got stuck" signals, kept SEPARATE by design (they use different units
// and must never be summed — see CLAUDE.md "Four Block Signals"). This is the single source of
// truth for how each signal is labelled and coloured across the dashboard: the Student Trace
// pills, the Bottlenecks legend + cards, and the Details mini-charts all read it, so they can
// never drift apart.
//
// `fail` isn't a per-term BlockSignal in the trace (a failed course is a transcript row, not a
// block), but it's part of the same conceptual family, so the legend includes it.
export type SignalKey = BlockSignal | "fail";

// The matching per-term field in Frame.courses[code] (CourseFrameStat), so a signal's timeline
// series can be pulled without a second lookup table.
export type CourseStatField = "failed" | "denied" | "offering_blocked" | "prereq_waiting";

export interface SignalInfo {
  label: string; // short pill label
  unit: string; // tooltip / legend: what the signal means + the unit it's counted in
  pill: string; // pill classes (border/bg/text), theme-token based so light+dark both work
  dot: string; // solid swatch for a legend dot
  border: string; // left-accent border for a card
  fill: string; // SVG fill for the Details mini-chart bars
  field: CourseStatField; // the per-term CourseFrameStat field this signal counts
}

// Four maximally-distinct hues (red / amber / blue / green) so the legend is unambiguous and
// each signal reads as its own kind of problem.
export const SIGNAL_META: Record<SignalKey, SignalInfo> = {
  fail: {
    label: "Failed",
    unit: "Attempted the course and did not pass (grade F). Counted once per attempt.",
    pill: "border-bad/50 bg-bad/5 text-bad",
    dot: "bg-bad",
    border: "border-l-bad",
    fill: "fill-bad",
    field: "failed",
  },
  capacity: {
    label: "No seat",
    unit: "Requested a seat this term but lost the allocation — the course was full. Counted per term.",
    pill: "border-warn/50 bg-warn/5 text-warn",
    dot: "bg-warn",
    border: "border-l-warn",
    fill: "fill-warn",
    field: "denied",
  },
  offering: {
    label: "Not offered",
    unit: "Eligible to take it, but the course wasn't taught this term. Counted per eligible student, per term.",
    pill: "border-info/50 bg-info/5 text-info",
    dot: "bg-info",
    border: "border-l-info",
    fill: "fill-info",
    field: "offering_blocked",
  },
  prereq: {
    label: "Prereqs pending",
    unit: "Prerequisites not yet satisfied — still waiting before this course can be taken. Counted per eligible-or-waiting student, per term.",
    pill: "border-good/50 bg-good/5 text-good",
    dot: "bg-good",
    border: "border-l-good",
    fill: "fill-good",
    field: "prereq_waiting",
  },
};

// Fixed DISPLAY order, most-actionable first. `prereq` is intentionally omitted: the prerequisite
// signal is still computed by the engine and kept in SIGNAL_META (so the trace/types stay valid),
// but it's no longer surfaced anywhere in the dashboard — it's a passive per-term sweep that's hard
// to act on and was removed from the visuals per product decision. Add it back here to re-surface it.
export const SIGNAL_ORDER: SignalKey[] = ["fail", "capacity", "offering"];
