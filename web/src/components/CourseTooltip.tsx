"use client";

import type { CourseFrameStat, GraphNode } from "@/types/simulation";

// Lightweight hover/focus tooltip for a curriculum-graph node. Positioned in the graph's outer
// (non-scrolling) container coordinates and clamped so it never spills off the right edge.
// pointer-events:none so it never eats the mouse. Shows the fields available in the graph
// contract (GraphNode has no pass_rate, so live seat use stands in as the dynamic stat).
interface Props {
  node: GraphNode;
  stat?: CourseFrameStat;
  catLabel: string;
  x: number;
  y: number;
  flip?: boolean; // when true, anchor the tooltip's bottom at y (shown above the node)
  maxX: number; // outer container width, for horizontal clamping
}

const TIP_W = 210;

export default function CourseTooltip({ node, stat, catLabel, x, y, flip = false, maxX }: Props) {
  const left = Math.max(6, Math.min(x, maxX - TIP_W - 6));
  return (
    <div
      role="tooltip"
      className="pointer-events-none absolute z-30 rounded-lg border border-border-2 bg-surface-2 px-2.5 py-2 text-[11px] shadow-lg"
      style={{ left, top: y, width: TIP_W, transform: flip ? "translateY(-100%)" : undefined }}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[12px] font-bold text-ink">{node.code}</span>
        <span className="text-muted">{node.credits} CH</span>
      </div>
      <div className="mt-0.5 text-muted">{node.title}</div>
      <div className="mt-1.5 flex flex-wrap gap-x-2 gap-y-0.5 text-muted">
        <span className="text-ink/80">{catLabel}</span>
        <span>· {node.offering.join(" + ") || "unscheduled"}</span>
        <span>· cap {node.capacity}</span>
      </div>
      <div className="mt-1 border-t border-border pt-1 text-[10.5px]">
        {stat?.offered ? (
          <span className="text-ink">
            This term: <b>{stat.granted}</b>/{stat.capacity} seats
            {stat.full ? <span className="text-bad"> · full</span> : null}
            {stat.denied ? <span className="text-warn"> · {stat.denied} denied</span> : null}
          </span>
        ) : (
          <span className="text-muted">Not offered this term</span>
        )}
      </div>
    </div>
  );
}
