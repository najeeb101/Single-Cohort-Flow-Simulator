"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
//
// Static, not pannable/zoomable: the SVG's width/height attrs are scaled to fit the
// container (viewBox keeps the internal coordinate system fixed), so the whole graph is
// always visible at once. A ResizeObserver keeps that fit correct if the container's size
// changes later (window resize, sidebar toggle, etc.), unlike a one-shot mount-time fit.
export default function CurriculumGraph({ graph, courses }: Props) {
  const { positions, width, height } = useMemo(() => computeLayout(graph), [graph]);
  const containerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const fit = () => setScale(Math.min(el.clientWidth / width, el.clientHeight / height, 1) || 1);
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [width, height]);

  const nodeByCode = useMemo(() => {
    const m: Record<string, Graph["nodes"][number]> = {};
    graph.nodes.forEach((n) => (m[n.code] = n));
    return m;
  }, [graph]);
  const selectedNode = selected ? nodeByCode[selected] : null;
  const selectedStat = selected ? courses[selected] : undefined;
  const prereqsOf = (code: string) => graph.edges.filter((e) => e.to === code);
  const unlocksOf = (code: string) => graph.edges.filter((e) => e.from === code);

  return (
    <div
      ref={containerRef}
      data-testid="curriculum-graph-viewport"
      className="relative grid max-h-[72vh] min-h-[420px] flex-1 place-items-center overflow-hidden p-2"
    >
      <svg width={width * scale} height={height * scale} viewBox={`0 0 ${width} ${height}`}>
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
          const fill = offered ? utilColor(st.capacity ? st.granted / st.capacity : 0) : "var(--surface-2)";
          const textFill = offered ? "#10151d" : "var(--muted)";
          const statFill = offered ? "#1d2734" : "var(--muted)";

          let stat1 = "not offered";
          let stat2 = "";
          if (offered) {
            stat1 = `${st.granted}/${st.capacity}${st.sections ? ` · ${st.sections} sec` : ""}${st.full ? " ▣" : ""}`;
            const waiting = (st.prereq_waiting || 0) + (st.offering_blocked || 0);
            stat2 =
              (st.denied ? `−${st.denied} denied  ` : "") +
              (st.passed || st.failed ? `✓${st.passed} ✗${st.failed}` : waiting ? `${waiting} waiting` : "");
          }

          const isSelected = selected === n.code;
          return (
            <g
              key={n.code}
              transform={`translate(${p.x},${p.y})`}
              onClick={(e) => {
                e.stopPropagation();
                setSelected((cur) => (cur === n.code ? null : n.code));
              }}
              className="cursor-pointer"
            >
              <rect
                width={p.w}
                height={p.h}
                rx={7}
                fill={fill}
                stroke={isSelected ? "#5b9dff" : offered && st.full ? "#ff5d5d" : "rgba(0,0,0,.35)"}
                strokeWidth={isSelected ? 2.5 : offered && st.full ? 2.5 : 1.2}
              />
              <text x={8} y={17} fontSize={11} fontWeight={700} fill={textFill}>{n.code}</text>
              <text x={8} y={33} fontSize={9.5} fontWeight={600} fill={statFill}>{stat1}</text>
              <text x={8} y={44} fontSize={9.5} fontWeight={600} fill={statFill}>{stat2}</text>
              <title>{`${n.code} — ${n.title}\n${n.credits} CH · ${n.category} · ${n.offering.join("+")}`}</title>
            </g>
          );
        })}
      </svg>

      {selectedNode && (
        <div className="absolute bottom-3 left-3 z-10 w-72 rounded-xl border border-border-2 bg-surface-2 p-3 text-xs shadow-lg">
          <div className="mb-1.5 flex items-start justify-between gap-2">
            <div>
              <div className="text-[13px] font-bold text-ink">{selectedNode.code}</div>
              <div className="text-muted">{selectedNode.title}</div>
            </div>
            <button
              type="button"
              onClick={() => setSelected(null)}
              className="grid h-5 w-5 shrink-0 place-items-center rounded-md text-muted hover:bg-surface hover:text-ink"
              title="Close"
            >
              ×
            </button>
          </div>

          <div className="mb-2 flex flex-wrap gap-x-3 gap-y-0.5 text-muted">
            <span>{selectedNode.credits} CH</span>
            <span>{selectedNode.category}</span>
            <span>{selectedNode.offering.join(" + ")}</span>
          </div>

          {selectedStat?.offered ? (
            <div className="mb-2 grid grid-cols-2 gap-1 rounded-lg bg-surface p-2 text-ink">
              <span>Granted: {selectedStat.granted}/{selectedStat.capacity}</span>
              <span>Sections: {selectedStat.sections ?? "—"}</span>
              <span>Passed: {selectedStat.passed ?? 0}</span>
              <span>Failed: {selectedStat.failed ?? 0}</span>
              <span>Denied: {selectedStat.denied ?? 0}</span>
              <span>Waiting: {(selectedStat.prereq_waiting || 0) + (selectedStat.offering_blocked || 0)}</span>
            </div>
          ) : (
            <div className="mb-2 rounded-lg bg-surface p-2 text-muted">Not offered this term</div>
          )}

          <div className="mb-1">
            <span className="font-semibold text-ink">Prerequisites: </span>
            {prereqsOf(selectedNode.code).length
              ? prereqsOf(selectedNode.code).map((e) => `${e.from}${e.kind !== "prereq" ? ` (${e.kind})` : ""}`).join(", ")
              : "none"}
          </div>
          <div>
            <span className="font-semibold text-ink">Unlocks: </span>
            {unlocksOf(selectedNode.code).length
              ? unlocksOf(selectedNode.code).map((e) => e.to).join(", ")
              : "none"}
          </div>
        </div>
      )}
    </div>
  );
}
