"use client";

import type { IntakeSweepResult } from "@/types/simulation";

// Intake vs outcome for "admit N next year": graduation and on-time rates (shaded = 95% range),
// graduates per year on the right axis, and markers for the three headline numbers. Hand-built
// SVG like the app's other charts, coloured with theme tokens so it reads in light and dark.
const W = 760;
const H = 300;
const M = { top: 18, right: 56, bottom: 40, left: 48 };

const MARKERS = [
  { key: "recommended_intake", color: "var(--good)", label: "Recommended", dash: "" },
  { key: "sustainable_intake", color: "var(--info)", label: "Sustainable", dash: "6 3" },
  { key: "upper_limit", color: "var(--warn)", label: "Upper limit", dash: "2 3" },
] as const;

export default function IntakeChart({ result }: { result: IntakeSweepResult }) {
  const points = result.views.next.points;
  if (points.length < 2) return null;
  const xs = points.map((p) => p.intake);
  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);
  const gpyMax = Math.max(10, ...points.map((p) => p.graduates_per_year)) * 1.1;
  const iw = W - M.left - M.right;
  const ih = H - M.top - M.bottom;
  const x = (v: number) => M.left + ((v - xMin) / Math.max(1, xMax - xMin)) * iw;
  const y = (rate: number) => M.top + (1 - rate) * ih;
  const y2 = (g: number) => M.top + (1 - g / gpyMax) * ih;

  const line = (get: (i: number) => number) => points.map((p, i) => `${i ? "L" : "M"}${x(p.intake)},${get(i)}`).join(" ");
  const band = (mean: (i: number) => number, se: (i: number) => number) => {
    const up = points.map((p, i) => `${x(p.intake)},${y(Math.min(1, mean(i) + 1.96 * se(i)))}`);
    const down = points.map((p, i) => `${x(p.intake)},${y(Math.max(0, mean(i) - 1.96 * se(i)))}`).reverse();
    return `M${up.join(" L")} L${down.join(" L")} Z`;
  };

  const series = [
    { label: "Graduate", color: "var(--series-1)", mean: (i: number) => points[i].grad_rate, se: (i: number) => points[i].grad_se },
    { label: "On time", color: "var(--series-2)", mean: (i: number) => points[i].on_time_rate, se: (i: number) => points[i].on_time_se },
  ];
  const step = Math.max(1, Math.ceil(points.length / 10));
  const ticks = xs.filter((_, i) => i % step === 0 || i === xs.length - 1);
  const rec = result.recommendation;

  return (
    <section className="rounded-2xl border border-border bg-surface p-5">
      <h2 className="text-[15px] font-bold">What each intake would mean</h2>
      <p className="mt-1 max-w-3xl text-sm text-muted">
        If the department admits this many next year. Shaded bands show the range the simulations allow; the dotted line is
        graduates per year (right axis).
      </p>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
        {series.map((s) => (
          <span key={s.label} className="flex items-center gap-1.5">
            <span className="inline-block h-0.5 w-4" style={{ background: s.color }} /> {s.label}
          </span>
        ))}
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-4 border-t-2 border-dotted" style={{ borderColor: "var(--series-3)" }} /> Graduates / year
        </span>
        {MARKERS.filter((m) => rec[m.key] != null).map((m) => (
          <span key={m.key} className="flex items-center gap-1.5">
            <span className="inline-block h-3 w-0.5" style={{ background: m.color }} /> {m.label} ({rec[m.key]})
          </span>
        ))}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="mt-2 h-auto w-full" role="img" aria-label="Graduation and on-time rates by intake">
        {[0, 0.25, 0.5, 0.75, 1].map((t) => (
          <g key={t}>
            <line x1={M.left} x2={W - M.right} y1={y(t)} y2={y(t)} stroke="var(--border)" />
            <text x={M.left - 8} y={y(t) + 4} textAnchor="end" fontSize="11" fill="var(--muted)">{`${t * 100}%`}</text>
            <text x={W - M.right + 8} y={y(t) + 4} fontSize="11" fill="var(--muted)">{Math.round(gpyMax * t)}</text>
          </g>
        ))}
        {ticks.map((t) => (
          <text key={t} x={x(t)} y={H - M.bottom + 16} textAnchor="middle" fontSize="11" fill="var(--muted)">{t}</text>
        ))}
        <text x={M.left + iw / 2} y={H - 6} textAnchor="middle" fontSize="11" fill="var(--muted)">Students admitted next intake</text>
        {series.map((s) => (
          <g key={s.label}>
            <path d={band(s.mean, s.se)} fill={s.color} opacity={0.15} />
            <path d={line((i) => y(s.mean(i)))} fill="none" stroke={s.color} strokeWidth={2} />
            {points.map((p, i) => (
              <circle key={p.intake} cx={x(p.intake)} cy={y(s.mean(i))} r={2.5} fill={s.color} />
            ))}
          </g>
        ))}
        <path d={line((i) => y2(points[i].graduates_per_year))} fill="none" stroke="var(--series-3)" strokeWidth={2} strokeDasharray="2 4" />
        {MARKERS.map((m) => {
          const v = rec[m.key];
          if (v == null || v < xMin || v > xMax) return null;
          return <line key={m.key} x1={x(v)} x2={x(v)} y1={M.top} y2={M.top + ih} stroke={m.color} strokeWidth={2} strokeDasharray={m.dash} />;
        })}
      </svg>
    </section>
  );
}
