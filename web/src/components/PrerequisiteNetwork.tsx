"use client";

import { useMemo } from "react";
import type { Frame, Graph } from "@/types/simulation";
import { computeLayout, utilColor } from "@/lib/graphLayout";

const CS_CATEGORIES = new Set(["cs_core", "cs_elective"]);

interface Props {
  graph: Graph;
  frames: Frame[];
}

// Port of src/visualize.py::plot_curriculum_network — same CS-only subgraph, same
// fail-count shading, but laid out with the layered DAG positions from graphLayout.ts
// (computeLayout) instead of a spring layout, since that's already wired into this app
// and a forced layout adds nothing a reader couldn't get from the layered one.
function buildCsSubgraph(graph: Graph): Graph {
  const codes = new Set(graph.nodes.filter((n) => CS_CATEGORIES.has(n.category)).map((n) => n.code));
  return {
    nodes: graph.nodes.filter((n) => codes.has(n.code)),
    edges: graph.edges.filter((e) => codes.has(e.from) && codes.has(e.to)),
  };
}

function totalFailCounts(frames: Frame[], codes: Iterable<string>): Map<string, number> {
  const totals = new Map<string, number>();
  for (const code of codes) totals.set(code, 0);
  for (const f of frames) {
    for (const [code, stat] of Object.entries(f.courses)) {
      if (totals.has(code)) totals.set(code, totals.get(code)! + stat.failed);
    }
  }
  return totals;
}

export default function PrerequisiteNetwork({ graph, frames }: Props) {
  const subgraph = useMemo(() => buildCsSubgraph(graph), [graph]);
  const { positions, width, height } = useMemo(() => computeLayout(subgraph), [subgraph]);
  const fails = useMemo(
    () => totalFailCounts(frames, subgraph.nodes.map((n) => n.code)),
    [frames, subgraph],
  );
  const maxFails = Math.max(1, ...fails.values());

  return (
    <div className="rounded-2xl border border-border bg-surface p-4">
      <div className="mb-2 flex items-baseline justify-between gap-3 text-[13px] font-semibold">
        <span>Prerequisite network — failure hotspots</span>
        <span className="text-xs font-normal text-muted">CS courses only · shaded by total failures, whole run</span>
      </div>
      <div className="max-h-[72vh] overflow-auto rounded-lg border border-border p-2">
        <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
          <defs>
            <marker id="prereq-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0,0 L10,5 L0,10 z" fill="#56607a" />
            </marker>
          </defs>

          {subgraph.edges.map((e, i) => {
            const a = positions[e.from];
            const b = positions[e.to];
            if (!a || !b) return null;
            const x1 = a.x + a.w;
            const y1 = a.y + a.h / 2;
            const x2 = b.x;
            const y2 = b.y + b.h / 2;
            const mx = (x1 + x2) / 2;
            return (
              <path
                key={`${e.from}-${e.to}-${i}`}
                d={`M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`}
                fill="none"
                stroke="#46506a"
                strokeWidth={1.2}
                strokeDasharray={e.kind === "one_of" ? "4 3" : undefined}
                markerEnd="url(#prereq-arrow)"
              />
            );
          })}

          {subgraph.nodes.map((n) => {
            const p = positions[n.code];
            if (!p) return null;
            const f = fails.get(n.code) ?? 0;
            const fill = utilColor(f / maxFails);
            return (
              <g key={n.code} transform={`translate(${p.x},${p.y})`}>
                <rect width={p.w} height={p.h} rx={7} fill={fill} stroke="rgba(0,0,0,.35)" strokeWidth={1.2} />
                <text x={8} y={17} fontSize={11} fontWeight={700} fill="#10151d">{n.code}</text>
                <text x={8} y={33} fontSize={9.5} fontWeight={600} fill="#1d2734">{f} fail{f === 1 ? "" : "s"}</text>
                <title>{`${n.code} — ${n.title}\n${f} failures over the run`}</title>
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}
