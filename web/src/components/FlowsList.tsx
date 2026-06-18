import type { Frame } from "@/types/simulation";
import { aggFlows } from "@/lib/flows";

interface Props {
  frame: Frame;
  cohortSel: string;
}

// Port of frontend/app.js::renderFlows() — "biggest moves this term", scoped to the
// selected cohort (or aggregated across all cohorts when "totals" is selected).
export default function FlowsList({ frame, cohortSel }: Props) {
  let flows: { from: string; to: string; count: number }[];
  if (cohortSel === "totals") {
    flows = Object.entries(aggFlows(frame)).map(([k, count]) => {
      const [from, to] = k.split("→");
      return { from, to, count };
    });
  } else {
    flows = frame.stages.cohorts[cohortSel]?.flows ?? [];
  }
  flows = [...flows].sort((a, b) => b.count - a.count).slice(0, 6);

  return (
    <div>
      <h3 className="mb-2 mt-4 text-[11px] uppercase tracking-wide text-muted">Biggest moves this term</h3>
      {flows.length ? (
        <ul className="m-0 list-none p-0 text-[12.5px]">
          {flows.map((fl, i) => (
            <li key={i} className="flex justify-between border-b border-border py-1.5 last:border-b-0">
              <span>{fl.from} → {fl.to}</span>
              <span className="font-bold text-accent">{fl.count}</span>
            </li>
          ))}
        </ul>
      ) : (
        <span className="text-xs text-muted">no movement</span>
      )}
    </div>
  );
}
