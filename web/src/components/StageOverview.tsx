import type { Frame } from "@/types/simulation";

const STAGE_COLORS: Record<string, string> = {
  Admitted: "#6b7488", Year1: "#4878d0", Year2: "#5aa9e6", Year3: "#6acc65",
  Year4: "#e8b84b", Graduated: "#3ec46d", Dropped: "#d65f5f", Censored: "#b47cc7",
};

interface Props {
  frame: Frame;
  stageNodes: string[];
  cohortSel: string; // "totals" or a cohort id, as a string
}

// Port of frontend/app.js::renderStages() — stage bars + seatline, scoped to the
// selected cohort (or the university total).
export default function StageOverview({ frame, stageNodes, cohortSel }: Props) {
  const block = cohortSel === "totals"
    ? frame.stages.totals
    : frame.stages.cohorts[cohortSel] ?? { nodes: {}, seats_requested: 0, seats_denied: 0 };
  const nodes = block.nodes || {};
  const max = Math.max(1, ...stageNodes.map((n) => nodes[n] || 0));

  return (
    <div>
      <div className="mt-3.5 flex flex-col gap-1.5">
        {stageNodes.map((name) => {
          const v = nodes[name] || 0;
          return (
            <div key={name} className="flex items-center gap-2 text-xs">
              <span className="w-[74px] text-muted">{name}</span>
              <span className="h-[15px] flex-1 overflow-hidden rounded bg-[#0c121c]">
                <span
                  className="block h-full rounded transition-[width] duration-200"
                  style={{ width: `${(v / max) * 100}%`, background: STAGE_COLORS[name] }}
                />
              </span>
              <span className="w-[34px] text-right font-semibold tabular-nums">{v}</span>
            </div>
          );
        })}
      </div>
      <div className="mt-3.5 border-t border-border pt-3 text-xs text-muted">
        Seats this term — requested <b className="text-ink">{block.seats_requested || 0}</b>,{" "}
        denied <b className="text-bad">{block.seats_denied || 0}</b>
      </div>
    </div>
  );
}
