import type { Frame } from "@/types/simulation";

// Faithful port of frontend/app.js::aggFlows() — sums every cohort's stage-transition
// counts for a frame, regardless of which cohort is selected in the UI. Used as-is by
// NarrativePanel (always global) and by FlowsList/StageOverview when "totals" is selected.
export function aggFlows(frame: Frame): Record<string, number> {
  const agg: Record<string, number> = {};
  Object.values(frame.stages.cohorts).forEach((c) => {
    (c.flows || []).forEach((fl) => {
      const k = `${fl.from}→${fl.to}`;
      agg[k] = (agg[k] || 0) + fl.count;
    });
  });
  return agg;
}
