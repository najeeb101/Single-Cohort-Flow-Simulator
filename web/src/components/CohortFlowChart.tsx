"use client";

import { useMemo } from "react";
import type { CohortInfo, Frame } from "@/types/simulation";
import { cohortActiveSeries, makeScales } from "@/lib/figures";

const COLORS = ["#1f77b4", "#ff7f0e", "#2ca02c", "#9467bd", "#8c564b"];
const W = 760;
const H = 200;

// Faithful port of src/visualize.py::plot_cohort_flow — one line per cohort, incumbents
// dashed and dimmed, showing how later cohorts progress slower under shared-seat
// congestion.
export default function CohortFlowChart({ frames, cohorts }: { frames: Frame[]; cohorts: CohortInfo[] }) {
  const series = useMemo(() => cohortActiveSeries(frames, cohorts), [frames, cohorts]);
  const terms = useMemo(() => frames.map((f) => f.term), [frames]);
  const termIndex = useMemo(() => new Map(terms.map((t, i) => [t, i])), [terms]);

  const maxY = Math.max(1, ...series.flatMap((s) => s.points.map(([, v]) => v)));
  const { x, y } = makeScales(terms, maxY, W, H);
  const tickEvery = Math.max(1, Math.ceil(terms.length / 14));
  const zeroIdx = terms.indexOf(0);

  return (
    <div className="rounded-2xl border border-border bg-surface p-4">
      <div className="mb-1 flex items-baseline justify-between gap-3 text-[13px] font-semibold">
        <span>Per-cohort flow</span>
        <span className="text-xs font-normal text-muted">still enrolled (active + delayed) vs. global term</span>
      </div>
      <p className="mb-3 text-[12px] text-muted">
        One line per cohort showing how many students are still enrolled over time. Lines that fall steeply signal early dropout; lines that stay high and flat signal students who are stuck — taking longer than expected to complete. Cohorts that finish fast (short lines) have clear prerequisite paths; slow-finishing ones face capacity or prerequisite bottlenecks.
      </p>
      <svg viewBox={`0 0 ${W + 16} ${H + 24}`} className="w-full" style={{ maxHeight: 260 }}>
        <g transform="translate(8,4)">
          {zeroIdx >= 0 && (
            <line x1={x(zeroIdx)} x2={x(zeroIdx)} y1={0} y2={H} stroke="rgba(255,255,255,0.4)" strokeDasharray="3 3" />
          )}
          {series.map((s, idx) => {
            if (!s.points.length) return null;
            const d = s.points.map(([t, v]) => `${x(termIndex.get(t) ?? 0)},${y(v)}`).join(" L ");
            const color = COLORS[idx % COLORS.length];
            return (
              <path
                key={s.id}
                d={`M ${d}`}
                fill="none"
                stroke={color}
                strokeWidth={2}
                strokeDasharray={s.isIncumbent ? "5 3" : undefined}
                opacity={s.isIncumbent ? 0.6 : 1}
              />
            );
          })}
          <line x1={0} x2={W} y1={H} y2={H} stroke="rgba(255,255,255,0.14)" />
          {terms.filter((_, i) => i % tickEvery === 0).map((t) => (
            <text key={t} x={x(terms.indexOf(t))} y={H + 16} fontSize={9} fill="#8b97ab" textAnchor="middle">{t}</text>
          ))}
        </g>
      </svg>
      <div className="mt-1 flex flex-wrap gap-3 text-xs text-muted">
        {series.map((s, idx) => (
          <span key={s.id}>
            <i
              className="mr-1 inline-block h-2.5 w-2.5 rounded-full align-[-1px]"
              style={{ background: COLORS[idx % COLORS.length], opacity: s.isIncumbent ? 0.6 : 1 }}
            />
            {s.isIncumbent ? `incumbent ${s.id}` : `cohort ${s.id}`}
          </span>
        ))}
      </div>
    </div>
  );
}
