"use client";

import { useMemo } from "react";
import type { CourseFrameStat, Graph } from "@/types/simulation";
import { computeLayout, utilColor } from "@/lib/graphLayout";

interface Props {
  graph: Graph; // frozen at initial load — see page.tsx; never changes across live updates
  courses: Record<string, CourseFrameStat>; // current frame only — this is what re-renders
}

// Faithful port of frontend/app.js::buildGraph() + render()'s per-node update loop.
// Layout (computeLayout) only re-runs when `graph` changes identity, i.e. never after the
// initial load, matching buildGraph() being called once in boot() and never again from
// applyLiveResult(). Per-frame visual state (fill color, stat text) is plain props, so
// React only touches the attributes that actually change between frames.
export default function CurriculumGraph({ graph, courses }: Props) {
  const { positions, width, height } = useMemo(() => computeLayout(graph), [graph]);

  return (
    <div className="max-h-[72vh] flex-1 overflow-auto p-2">
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
        <defs>
          <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" fill="#56607a" />
          </marker>
        </defs>

        {graph.edges.map((e, i) => {
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
              markerEnd="url(#arrow)"
            />
          );
        })}

        {graph.nodes.map((n) => {
          const p = positions[n.code];
          if (!p) return null;
          const st = courses[n.code];
          const offered = st?.offered ?? false;
          const fill = offered ? utilColor(st.capacity ? st.granted / st.capacity : 0) : "#2a3140";
          const textFill = offered ? "#10151d" : "#6b7689";
          const statFill = offered ? "#1d2734" : "#6b7689";

          let stat1 = "not offered";
          let stat2 = "";
          if (offered) {
            stat1 = `${st.granted}/${st.capacity}${st.sections ? ` · ${st.sections} sec` : ""}${st.full ? " ▣" : ""}`;
            const waiting = (st.prereq_waiting || 0) + (st.offering_blocked || 0);
            stat2 =
              (st.denied ? `−${st.denied} denied  ` : "") +
              (st.passed || st.failed ? `✓${st.passed} ✗${st.failed}` : waiting ? `${waiting} waiting` : "");
          }

          return (
            <g key={n.code} transform={`translate(${p.x},${p.y})`}>
              <rect
                width={p.w}
                height={p.h}
                rx={7}
                fill={fill}
                stroke={offered && st.full ? "#ff5d5d" : "rgba(0,0,0,.35)"}
                strokeWidth={offered && st.full ? 2.5 : 1.2}
              />
              <text x={8} y={17} fontSize={11} fontWeight={700} fill={textFill}>{n.code}</text>
              <text x={8} y={33} fontSize={9.5} fontWeight={600} fill={statFill}>{stat1}</text>
              <text x={8} y={44} fontSize={9.5} fontWeight={600} fill={statFill}>{stat2}</text>
              <title>{`${n.code} — ${n.title}\n${n.credits} CH · ${n.category} · ${n.offering.join("+")}`}</title>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
