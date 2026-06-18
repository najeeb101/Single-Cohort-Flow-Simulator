"use client";

import { useMemo } from "react";
import type { Frame } from "@/types/simulation";
import { aggregateEnrollment, makeScales } from "@/lib/figures";

type BandKey = "enrolled" | "graduated" | "dropped" | "censored";

const BANDS: { key: BandKey; label: string; color: string }[] = [
  { key: "enrolled", label: "Still enrolled", color: "#4878d0" },
  { key: "graduated", label: "Graduated", color: "#6acc65" },
  { key: "dropped", label: "Academic dropout", color: "#d65f5f" },
  { key: "censored", label: "Censored (hit horizon)", color: "#b47cc7" },
];

const W = 760;
const H = 200;

// Faithful port of src/visualize.py::plot_university_enrollment's stackplot, over the
// whole global timeline (including negative incumbent warm-up terms).
export default function UniversityEnrollmentChart({ frames }: { frames: Frame[] }) {
  const series = useMemo(() => aggregateEnrollment(frames), [frames]);
  const { terms } = series;
  const values: Record<BandKey, number[]> = series;

  const totals = terms.map((_, i) => BANDS.reduce((s, b) => s + values[b.key][i], 0));
  const maxY = Math.max(1, ...totals);
  const { x, y } = makeScales(terms, maxY, W, H);

  const zero = terms.map(() => 0);
  const stacked = BANDS.reduce<(typeof BANDS[number] & { low: number[]; high: number[] })[]>((acc, band) => {
    const low = acc.length ? acc[acc.length - 1].high : zero;
    const high = low.map((v, i) => v + values[band.key][i]);
    return [...acc, { ...band, low, high }];
  }, []);
  const paths = stacked.map(({ low, high, ...band }) => {
    const top = terms.map((_, i) => `${x(i)},${y(high[i])}`).join(" L ");
    const bottomRev = terms.map((_, i) => i).reverse().map((i) => `${x(i)},${y(low[i])}`).join(" L ");
    return { ...band, d: `M ${top} L ${bottomRev} Z` };
  });

  const zeroIdx = terms.indexOf(0);
  const tickEvery = Math.max(1, Math.ceil(terms.length / 14));

  return (
    <div className="rounded-2xl border border-border bg-surface p-4">
      <div className="mb-2 flex items-baseline justify-between gap-3 text-[13px] font-semibold">
        <span>University population over time</span>
        <span className="text-xs font-normal text-muted">global term · negative = incumbent warm-up</span>
      </div>
      <svg viewBox={`0 0 ${W + 16} ${H + 24}`} className="w-full" style={{ maxHeight: 260 }}>
        <g transform="translate(8,4)">
          {paths.map((p) => (
            <path key={p.key} d={p.d} fill={p.color} fillOpacity={0.85} />
          ))}
          {zeroIdx >= 0 && (
            <line x1={x(zeroIdx)} x2={x(zeroIdx)} y1={0} y2={H} stroke="rgba(255,255,255,0.4)" strokeDasharray="3 3" />
          )}
          <line x1={0} x2={W} y1={H} y2={H} stroke="rgba(255,255,255,0.14)" />
          {terms.filter((_, i) => i % tickEvery === 0).map((t) => (
            <text key={t} x={x(terms.indexOf(t))} y={H + 16} fontSize={9} fill="#8b97ab" textAnchor="middle">{t}</text>
          ))}
        </g>
      </svg>
      <div className="mt-1 flex flex-wrap gap-4 text-xs text-muted">
        {BANDS.map((b) => (
          <span key={b.key}>
            <i className="mr-1 inline-block h-3 w-3 rounded-sm align-[-2px]" style={{ background: b.color }} />
            {b.label}
          </span>
        ))}
      </div>
    </div>
  );
}
