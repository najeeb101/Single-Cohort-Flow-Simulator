"use client";

import { useMemo, useState } from "react";
import type { CourseFrameStat, Graph } from "@/types/simulation";
import { categoryStyle, computeSemesterLayout, utilColor } from "@/lib/graphLayout";

interface Props {
  graph: Graph; // frozen at initial load — see page.tsx; never changes across live updates
  courses: Record<string, CourseFrameStat>; // current frame only — this is what re-renders
}

// University program-roadmap layout (modelled on Qatar University's printed CS roadmap):
// course boxes laid out in Year 1–4 columns split into Fall/Spring sub-columns, coloured by
// requirement type, with red prerequisite arrows crossing left→right. Layout (computeSemester-
// Layout) only re-runs when `graph` changes identity (never after initial load); per-frame live
// state (the seat-use bar, stat text, full border) is plain props so React only touches what
// changes between frames.
//
// Static, not pannable/zoomable: width/height attrs scale to fit the container (viewBox keeps
// the internal coordinate system fixed) so the whole roadmap is always visible. A ResizeObserver
// keeps that fit correct on later container resizes.
function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

export default function CurriculumGraph({ graph, courses }: Props) {
  const { positions, width, height, columns, yearBands, headerH, colWidth } = useMemo(
    () => computeSemesterLayout(graph),
    [graph],
  );
  const [selected, setSelected] = useState<string | null>(null);

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
      data-testid="curriculum-graph-viewport"
      className="relative max-h-[72vh] min-h-[420px] flex-1 overflow-auto p-2"
    >
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
        <defs>
          <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" fill="#d1453b" />
          </marker>
        </defs>

        {/* Year bands + per-column Fall/Spring + credit-hour headers */}
        {yearBands.map((b) => (
          <g key={`year-${b.year}`}>
            <rect x={b.x - 8} y={2} width={b.width + 16} height={16} rx={5} fill="var(--surface-2)" />
            <text x={b.cx} y={14} textAnchor="middle" fontSize={11} fontWeight={800} fill="var(--ink)">
              {b.label}
            </text>
          </g>
        ))}
        {columns.map((c) => (
          <g key={`col-${c.term}`}>
            <rect
              x={c.x - 8}
              y={22}
              width={colWidth + 16}
              height={height - 26}
              rx={10}
              fill="var(--surface-2)"
              fillOpacity={c.term % 2 === 0 ? 0.4 : 0.16}
            />
            <text x={c.cx} y={36} textAnchor="middle" fontSize={11} fontWeight={700} fill="var(--muted)">
              {c.season || "Unscheduled"}
              {c.creditHours ? `  ·  ${c.creditHours} hrs` : ""}
            </text>
          </g>
        ))}

        {/* Prerequisite arrows (red, like the printed roadmap) */}
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
              stroke="#d1453b"
              strokeOpacity={0.55}
              strokeWidth={1.3}
              strokeDasharray={e.kind === "one_of" ? "4 3" : undefined}
              markerEnd="url(#arrow)"
            />
          );
        })}

        {/* Course boxes — coloured by requirement type, live stats overlaid */}
        {graph.nodes.map((n) => {
          const p = positions[n.code];
          if (!p) return null;
          const cat = categoryStyle(n.category);
          const st = courses[n.code];
          const offered = st?.offered ?? false;
          const util = offered && st.capacity ? st.granted / st.capacity : 0;
          const isSelected = selected === n.code;
          const full = offered && st.full;

          let statLine = "";
          if (offered) {
            const waiting = (st.prereq_waiting || 0) + (st.offering_blocked || 0);
            statLine =
              `${st.granted}/${st.capacity}${full ? " ▣" : ""}` +
              (st.passed || st.failed ? `  ✓${st.passed} ✗${st.failed}` : waiting ? `  ${waiting} wait` : "");
          }

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
                fill={cat.fill}
                fillOpacity={offered ? 1 : 0.45}
                stroke={isSelected ? "#5b9dff" : full ? "#d1453b" : cat.border}
                strokeWidth={isSelected ? 2.5 : full ? 2.4 : 1.3}
              />
              <text x={8} y={16} fontSize={11} fontWeight={800} fill="#16202c">{n.code}</text>
              <text x={8} y={29} fontSize={8.5} fontWeight={600} fill="#3a4654">{truncate(n.title, 26)}</text>
              <text x={8} y={43} fontSize={8.5} fontWeight={700} fill={offered ? "#1d2734" : "#7c8694"}>
                {offered ? statLine : "not offered"}
              </text>
              {/* Seat-use bar along the bottom edge — keeps the live capacity signal without
                  overriding the requirement-type colour. */}
              {offered && (
                <rect x={6} y={p.h - 6} width={Math.max(0, (p.w - 12) * Math.min(1, util))} height={3} rx={1.5} fill={utilColor(util)} />
              )}
              <title>{`${n.code} — ${n.title}\n${n.credits} CH · ${cat.label} · ${n.offering.join("+")}`}</title>
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
            <span>{categoryStyle(selectedNode.category).label}</span>
            <span>{selectedNode.offering.join(" + ")}</span>
            {selectedNode.study_plan_term > 0 && <span>Term {selectedNode.study_plan_term}</span>}
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
