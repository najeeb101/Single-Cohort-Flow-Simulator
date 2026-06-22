"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { CourseFrameStat, Graph } from "@/types/simulation";
import { computeLayout, utilColor } from "@/lib/graphLayout";

interface Props {
  graph: Graph; // frozen at initial load — see page.tsx; never changes across live updates
  courses: Record<string, CourseFrameStat>; // current frame only — this is what re-renders
}

const MIN_SCALE = 0.25;
const MAX_SCALE = 2.5;

// Faithful port of frontend/app.js::buildGraph() + render()'s per-node update loop.
// Layout (computeLayout) only re-runs when `graph` changes identity, i.e. never after the
// initial load, matching buildGraph() being called once in boot() and never again from
// applyLiveResult(). Per-frame visual state (fill color, stat text) is plain props, so
// React only touches the attributes that actually change between frames.
export default function CurriculumGraph({ graph, courses }: Props) {
  const { positions, width, height } = useMemo(() => computeLayout(graph), [graph]);
  const containerRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ x: 0, y: 0, k: 1 });
  const dragRef = useRef<{ startX: number; startY: number; x: number; y: number } | null>(null);

  // Initial fit: whole graph width visible, never upscaled past 1x.
  const fit = () => {
    const el = containerRef.current;
    if (!el) return;
    const k = Math.min(el.clientWidth / width, 1) || 1;
    setView({ x: (el.clientWidth - width * k) / 2, y: 12, k });
  };

  useEffect(fit, [width, height]);

  const zoomAt = (factor: number, cx: number, cy: number) => {
    setView((v) => {
      const k = Math.min(MAX_SCALE, Math.max(MIN_SCALE, v.k * factor));
      return { k, x: cx - ((cx - v.x) / v.k) * k, y: cy - ((cy - v.y) / v.k) * k };
    });
  };

  // The +/- buttons always re-center the graph's own midpoint in the viewport at the
  // new zoom level — unlike a content-anchored zoom (which just preserves whatever
  // point was already on screen), this also recovers from a drag that panned the
  // graph mostly or fully out of view, where an anchored zoom would otherwise keep
  // zooming around an off-screen point forever.
  const zoomButton = (factor: number) => {
    const el = containerRef.current;
    setView((v) => {
      const k = Math.min(MAX_SCALE, Math.max(MIN_SCALE, v.k * factor));
      const cw = el?.clientWidth ?? width * k;
      const ch = el?.clientHeight ?? height * k;
      return { k, x: (cw - width * k) / 2, y: (ch - height * k) / 2 };
    });
  };

  // React attaches "wheel" as a passive listener (for scroll-perf reasons unrelated to
  // this component), so a JSX onWheel can't preventDefault — the page would scroll behind
  // the graph while zooming. A native listener added directly to the element can opt out.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      zoomAt(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX - rect.left, e.clientY - rect.top);
    };
    el.addEventListener("wheel", handler, { passive: false });
    return () => el.removeEventListener("wheel", handler);
  }, []);

  const onPointerDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest("button")) return;
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    dragRef.current = { startX: e.clientX, startY: e.clientY, x: view.x, y: view.y };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    setView((v) => ({ ...v, x: d.x + (e.clientX - d.startX), y: d.y + (e.clientY - d.startY) }));
  };
  const endDrag = () => {
    dragRef.current = null;
  };

  return (
    <div
      ref={containerRef}
      data-testid="curriculum-graph-viewport"
      className="relative max-h-[72vh] min-h-[420px] flex-1 touch-none overflow-hidden p-2 active:cursor-grabbing"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerLeave={endDrag}
    >
      <div
        className="absolute left-0 top-0 origin-top-left cursor-grab"
        style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})` }}
      >
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

      <div className="absolute right-3 top-3 flex flex-col gap-1">
        <button
          type="button"
          onClick={() => zoomButton(1.25)}
          className="h-7 w-7 rounded-[8px] border border-border-2 bg-surface-2 text-[15px] font-bold text-ink hover:bg-surface"
          title="Zoom in"
        >
          +
        </button>
        <button
          type="button"
          onClick={() => zoomButton(1 / 1.25)}
          className="h-7 w-7 rounded-[8px] border border-border-2 bg-surface-2 text-[15px] font-bold text-ink hover:bg-surface"
          title="Zoom out"
        >
          −
        </button>
        <button
          type="button"
          onClick={fit}
          className="h-7 w-7 rounded-[8px] border border-border-2 bg-surface-2 text-[11px] font-bold text-ink hover:bg-surface"
          title="Reset to fit"
        >
          ⤢
        </button>
      </div>
    </div>
  );
}
