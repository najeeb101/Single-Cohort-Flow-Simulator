import type { CohortFlow, Frame } from "@/types/simulation";
import { aggFlows } from "@/lib/flows";

const STAGE_COLORS: Record<string, string> = {
  Admitted: "#6b7488", Year1: "#4878d0", Year2: "#5aa9e6", Year3: "#6acc65",
  Year4: "#e8b84b", Graduated: "#3ec46d", Dropped: "#d65f5f", Censored: "#b47cc7",
};

// Graduated/Dropped/Censored are all reachable from any "Year" stage, not just the one
// before them — so unlike Admitted→Year1→Year2..., they aren't a single-file column
// sequence. They share one terminal column instead, which is what actually makes this
// read as a funnel (one entry point, three possible exits) rather than a straight line.
const TERMINAL = new Set(["Graduated", "Dropped", "Censored"]);

const W = 300;
const H = 220;
const MARGIN_X = 22;
const MARGIN_Y = 10;
const BAR_W = 10;
const BAR_GAP = 4;
const MIN_BAR_H = 4;

interface Props {
  frame: Frame;
  stageNodes: string[];
  cohortSel: string; // "totals" or a cohort id, as a string
}

interface Rect { x: number; y: number; w: number; h: number }

// Sankey-style stage-flow diagram, replacing the old plain bar list — the underlying
// data (frame.stages) was always a node+flow graph, a Sankey just renders it as one
// instead of a bar chart plus a separate text list. Hand-rolled SVG (no charting
// library), matching CurriculumGraph.tsx's existing pattern: <g> per element with a
// <title> sibling for the hover tooltip, scaled via viewBox so it fits the bento cell.
export default function StageOverview({ frame, stageNodes, cohortSel }: Props) {
  const block = cohortSel === "totals"
    ? frame.stages.totals
    : frame.stages.cohorts[cohortSel] ?? { nodes: {}, seats_requested: 0, seats_denied: 0 };
  const nodes = block.nodes || {};

  const flows: CohortFlow[] = cohortSel === "totals"
    ? Object.entries(aggFlows(frame)).map(([k, count]) => {
        const [from, to] = k.split("→");
        return { from, to, count };
      })
    : frame.stages.cohorts[cohortSel]?.flows ?? [];

  // Column assignment: each non-terminal stage gets its own column in order; every
  // terminal stage shares the final column.
  const colOf: Record<string, number> = {};
  let col = 0;
  stageNodes.filter((n) => !TERMINAL.has(n)).forEach((n) => { colOf[n] = col++; });
  stageNodes.filter((n) => TERMINAL.has(n)).forEach((n) => { colOf[n] = col; });
  const numCols = col + 1;

  const byCol: Record<number, string[]> = {};
  stageNodes.forEach((n) => { (byCol[colOf[n]] ??= []).push(n); });

  // One shared px-per-student scale across all columns (not normalized per-column) —
  // a column with fewer total students should visibly look shorter. That narrowing is
  // the whole point: it's the attrition the simulation exists to explain.
  const usableH = H - MARGIN_Y * 2;
  const colTotal = (c: number) => (byCol[c] || []).reduce((s, n) => s + (nodes[n] || 0), 0);
  const maxColTotal = Math.max(1, ...Array.from({ length: numCols }, (_, c) => colTotal(c)));
  const pxPerUnit = usableH / maxColTotal;

  const rectOf: Record<string, Rect> = {};
  for (let c = 0; c < numCols; c++) {
    const names = byCol[c] || [];
    const heights = names.map((n) => Math.max(MIN_BAR_H, (nodes[n] || 0) * pxPerUnit));
    const totalH = heights.reduce((a, b) => a + b, 0) + BAR_GAP * Math.max(0, names.length - 1);
    let y = MARGIN_Y + (usableH - totalH) / 2;
    const x = MARGIN_X + (c / Math.max(1, numCols - 1)) * (W - MARGIN_X * 2) - BAR_W / 2;
    names.forEach((n, i) => {
      rectOf[n] = { x, y, w: BAR_W, h: heights[i] };
      y += heights[i] + BAR_GAP;
    });
  }

  // Multiple flows can leave/enter the same node — fan their anchor points evenly along
  // the bar's height instead of bunching them all at the midpoint.
  const outSeen: Record<string, number> = {};
  const outTotal: Record<string, number> = {};
  const inSeen: Record<string, number> = {};
  const inTotal: Record<string, number> = {};
  flows.forEach((f) => {
    outTotal[f.from] = (outTotal[f.from] || 0) + 1;
    inTotal[f.to] = (inTotal[f.to] || 0) + 1;
  });
  const anchorY = (name: string, seen: Record<string, number>, total: Record<string, number>) => {
    const r = rectOf[name];
    if (!r) return 0;
    const i = seen[name] || 0;
    seen[name] = i + 1;
    return r.y + ((i + 0.5) / (total[name] || 1)) * r.h;
  };

  const maxFlow = Math.max(1, ...flows.map((f) => f.count));

  return (
    <div>
      <div className="mt-3.5">
        <svg width="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet">
          {flows.map((f, i) => {
            const a = rectOf[f.from];
            const b = rectOf[f.to];
            if (!a || !b) return null;
            const y1 = anchorY(f.from, outSeen, outTotal);
            const y2 = anchorY(f.to, inSeen, inTotal);
            const x1 = a.x + a.w;
            const x2 = b.x;
            const mx = (x1 + x2) / 2;
            const strokeWidth = Math.max(1.2, (f.count / maxFlow) * 9);
            return (
              <g key={`${f.from}-${f.to}-${i}`}>
                <path
                  d={`M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`}
                  fill="none"
                  stroke={STAGE_COLORS[f.to] || "#8b97ab"}
                  strokeOpacity={0.4}
                  strokeWidth={strokeWidth}
                  strokeLinecap="round"
                />
                <title>{`${f.from} → ${f.to}: ${f.count}`}</title>
              </g>
            );
          })}
          {stageNodes.map((n) => {
            const r = rectOf[n];
            if (!r) return null;
            return (
              <g key={n}>
                <rect x={r.x} y={r.y} width={r.w} height={r.h} rx={2.5} fill={STAGE_COLORS[n]} />
                <title>{`${n}: ${nodes[n] || 0}`}</title>
              </g>
            );
          })}
        </svg>
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-muted">
        {stageNodes.map((n) => (
          <span key={n}>
            <i className="mr-1 inline-block h-2 w-2 rounded-sm align-[-1px]" style={{ background: STAGE_COLORS[n] }} />
            {n} <b className="text-ink">{nodes[n] || 0}</b>
          </span>
        ))}
      </div>
      <div className="mt-3.5 border-t border-border pt-3 text-xs text-muted">
        Seats this term — requested <b className="text-ink">{block.seats_requested || 0}</b>,{" "}
        denied <b className="text-bad">{block.seats_denied || 0}</b>
      </div>
    </div>
  );
}
