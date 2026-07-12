"use client";

import { useMemo, useRef, useState } from "react";
import type { CourseFrameStat, Graph } from "@/types/simulation";
import { categoryStyle, categoryStyleMap, computeSemesterLayout, utilColor } from "@/lib/graphLayout";
import CourseTooltip from "@/components/CourseTooltip";

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
// Static, not pannable/zoomable: the SVG renders at width:100% + height:auto over a fixed viewBox,
// so the whole roadmap (every course) always fits the container's width and scales with it — no
// zoom controls or scrolling. Boxes get smaller on narrow screens but everything stays visible.
function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

export default function CurriculumGraph({ graph, courses }: Props) {
  const { positions, width, height, columns, yearBands, colWidth } = useMemo(
    () => computeSemesterLayout(graph),
    [graph],
  );
  const catStyles = useMemo(() => categoryStyleMap(graph.nodes), [graph.nodes]);
  const [selected, setSelected] = useState<string | null>(null);
  const [focused, setFocused] = useState<string | null>(null);
  // maxX (the container width) is captured here, in the hover handler, so render never has to read
  // a ref — it clamps the tooltip to the container's right edge.
  const [tip, setTip] = useState<{ code: string; x: number; y: number; flip: boolean; maxX: number } | null>(null);

  const outerRef = useRef<HTMLDivElement>(null);

  const showTip = (code: string, el: SVGGElement) => {
    const outer = outerRef.current?.getBoundingClientRect();
    if (!outer) return;
    const r = el.getBoundingClientRect();
    // Flip the tooltip above the node when there isn't room below (bottom-row nodes), so the
    // container's overflow-hidden never clips it.
    const flip = outer.bottom - r.bottom < 110;
    setTip({ code, x: r.left - outer.left, y: flip ? r.top - outer.top - 6 : r.bottom - outer.top + 6, flip, maxX: outer.width });
  };
  const hideTip = (code: string) => setTip((t) => (t?.code === code ? null : t));
  const toggleSelect = (code: string) => setSelected((cur) => (cur === code ? null : code));

  const { activePrereqs, activeUnlocks } = useMemo(() => {
    if (!selected) return { activePrereqs: new Set<string>(), activeUnlocks: new Set<string>() };
    
    const prereqs = new Set<string>();
    const queue = [selected];
    while (queue.length > 0) {
      const current = queue.shift()!;
      graph.edges.forEach((e) => {
        if (e.to === current && !prereqs.has(e.from)) {
          prereqs.add(e.from);
          queue.push(e.from);
        }
      });
    }
    
    const unlocks = new Set<string>();
    const uQueue = [selected];
    while (uQueue.length > 0) {
      const current = uQueue.shift()!;
      graph.edges.forEach((e) => {
        if (e.from === current && !unlocks.has(e.to)) {
          unlocks.add(e.to);
          uQueue.push(e.to);
        }
      });
    }
    
    return { activePrereqs: prereqs, activeUnlocks: unlocks };
  }, [selected, graph]);

  const nodeByCode = useMemo(() => {
    const m: Record<string, Graph["nodes"][number]> = {};
    graph.nodes.forEach((n) => (m[n.code] = n));
    return m;
  }, [graph]);
  const selectedNode = selected ? nodeByCode[selected] : null;
  const selectedStat = selected ? courses[selected] : undefined;
  const tipNode = tip ? nodeByCode[tip.code] : null;
  const prereqsOf = (code: string) => graph.edges.filter((e) => e.to === code);
  const unlocksOf = (code: string) => graph.edges.filter((e) => e.from === code);

  return (
    <div
      ref={outerRef}
      data-testid="curriculum-graph-viewport"
      className="relative rounded-2xl border border-border bg-surface-2/40 p-4 shadow-inner"
    >
          <svg
            viewBox={`0 0 ${width} ${height}`}
            style={{ display: "block", width: "100%", height: "auto" }}
            role="group"
            aria-label="Curriculum roadmap. Tab to a course, Enter to open its details."
          >
        <defs>
          <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" fill="#d1453b" />
          </marker>
          <marker id="arrow-prereq" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" fill="var(--warn)" />
          </marker>
          <marker id="arrow-unlock" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" fill="var(--good)" />
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

        {/* Prerequisite arrows */}
        {graph.edges.map((e, i) => {
          const a = positions[e.from];
          const b = positions[e.to];
          if (!a || !b) return null;
          const x1 = a.x + a.w;
          const y1 = a.y + a.h / 2;
          const x2 = b.x;
          const y2 = b.y + b.h / 2;
          const mx = (x1 + x2) / 2;

          const isPrereqEdge = selected && (e.to === selected || activePrereqs.has(e.to)) && activePrereqs.has(e.from);
          const isUnlockEdge = selected && (e.from === selected || activeUnlocks.has(e.from)) && activeUnlocks.has(e.to);
          
          let strokeColor = "#d1453b";
          let strokeOpacity = 0.55;
          let strokeWidth = 1.3;
          let markerEnd = "url(#arrow)";

          if (selected) {
            if (isPrereqEdge) {
              strokeColor = "var(--warn)";
              strokeOpacity = 0.95;
              strokeWidth = 2.0;
              markerEnd = "url(#arrow-prereq)";
            } else if (isUnlockEdge) {
              strokeColor = "var(--good)";
              strokeOpacity = 0.95;
              strokeWidth = 2.0;
              markerEnd = "url(#arrow-unlock)";
            } else {
              strokeOpacity = 0.06;
            }
          }

          return (
            <path
              key={`${e.from}-${e.to}-${i}`}
              d={`M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`}
              fill="none"
              stroke={strokeColor}
              strokeOpacity={strokeOpacity}
              strokeWidth={strokeWidth}
              strokeDasharray={e.kind === "one_of" ? "4 3" : undefined}
              markerEnd={markerEnd}
              style={{ transition: "stroke 200ms, stroke-opacity 200ms, stroke-width 200ms" }}
            />
          );
        })}

        {/* Course boxes — coloured by requirement type, live stats overlaid */}
        {graph.nodes.map((n) => {
          const p = positions[n.code];
          if (!p) return null;
          const cat = catStyles.get(n.category)!;
          const st = courses[n.code];
          const offered = st?.offered ?? false;
          const util = offered && st.capacity ? st.granted / st.capacity : 0;
          const isSelected = selected === n.code;
          const isPrereqNode = activePrereqs.has(n.code);
          const isUnlockNode = activeUnlocks.has(n.code);
          const full = offered && st.full;

          const hasHighlight = selected !== null;
          const isHighlighted = isSelected || isPrereqNode || isUnlockNode;

          let statLine = "";
          if (offered) {
            const waiting = (st.prereq_waiting || 0) + (st.offering_blocked || 0);
            statLine =
              `${st.granted}/${st.capacity}${full ? " ▣" : ""}` +
              (st.passed || st.failed ? `  ✓${st.passed} ✗${st.failed}` : waiting ? `  ${waiting} wait` : "");
          }

          let strokeColor = cat.border;
          let strokeWidth = 1.3;
          
          if (isSelected) {
            strokeColor = "var(--accent)";
            strokeWidth = 2.5;
          } else if (isPrereqNode) {
            strokeColor = "var(--warn)";
            strokeWidth = 2.0;
          } else if (isUnlockNode) {
            strokeColor = "var(--good)";
            strokeWidth = 2.0;
          } else if (full) {
            strokeColor = "#d1453b";
            strokeWidth = 2.4;
          }

          return (
            <g
              key={n.code}
              tabIndex={0}
              role="button"
              aria-label={`${n.code} ${n.title}, ${n.credits} credit hours, ${cat.label}${
                offered ? `, ${st?.granted ?? 0} of ${st?.capacity ?? 0} seats taken` : ", not offered this term"
              }`}
              transform={`translate(${p.x},${p.y})`}
              onClick={(e) => {
                e.stopPropagation();
                toggleSelect(n.code);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  toggleSelect(n.code);
                }
              }}
              onMouseEnter={(e) => showTip(n.code, e.currentTarget)}
              onMouseLeave={() => hideTip(n.code)}
              onFocus={(e) => {
                setFocused(n.code);
                showTip(n.code, e.currentTarget);
              }}
              onBlur={() => {
                setFocused((f) => (f === n.code ? null : f));
                hideTip(n.code);
              }}
              className="cursor-pointer outline-none transition-opacity duration-200"
              style={{ opacity: hasHighlight && !isHighlighted ? 0.15 : 1 }}
            >
              <rect
                width={p.w}
                height={p.h}
                rx={7}
                fill={cat.fill}
                fillOpacity={offered ? 1 : 0.45}
                stroke={strokeColor}
                strokeWidth={strokeWidth}
                style={{ transition: "stroke 200ms, stroke-width 200ms" }}
              />
              {focused === n.code && (
                <rect
                  x={-2.5}
                  y={-2.5}
                  width={p.w + 5}
                  height={p.h + 5}
                  rx={9}
                  fill="none"
                  stroke="var(--accent)"
                  strokeWidth={2}
                  strokeDasharray="3 2"
                  className="pointer-events-none"
                />
              )}
              <text x={8} y={16} fontSize={11} fontWeight={800} fill={cat.text}>{n.code}</text>
              <text x={8} y={29} fontSize={8.5} fontWeight={600} fill={cat.text} fillOpacity={0.8}>{truncate(n.title, 26)}</text>
              <text x={8} y={43} fontSize={8.5} fontWeight={700} fill={offered ? cat.text : "var(--node-offered-muted)"}>
                {offered ? statLine : "not offered"}
              </text>
              {/* Seat-use bar along the bottom edge — keeps the live capacity signal without
                  overriding the requirement-type colour. */}
              {offered && (
                <rect x={6} y={p.h - 6} width={Math.max(0, (p.w - 12) * Math.min(1, util))} height={3} rx={1.5} fill={utilColor(util)} />
              )}
            </g>
          );
        })}
          </svg>

      {tip && tipNode && (
        <CourseTooltip
          node={tipNode}
          stat={courses[tip.code]}
          catLabel={catStyles.get(tipNode.category)?.label ?? tipNode.category}
          x={tip.x}
          y={tip.y}
          flip={tip.flip}
          maxX={tip.maxX}
        />
      )}

      {selectedNode && (
        <div className="absolute bottom-3 left-3 z-20 w-72 rounded-xl border border-border-2 bg-surface-2 p-3 text-xs shadow-lg">
          <div className="mb-1.5 flex items-start justify-between gap-2">
            <div>
              <div className="text-[13px] font-bold text-ink">{selectedNode.code}</div>
              <div className="text-muted">{selectedNode.title}</div>
            </div>
            <button
              type="button"
              onClick={() => setSelected(null)}
              className="grid h-5 w-5 shrink-0 place-items-center rounded-md text-muted hover:bg-surface hover:text-ink"
              aria-label="Close course details"
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
