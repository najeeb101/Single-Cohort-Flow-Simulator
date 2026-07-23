import type { ReactNode } from "react";
import type { Headline } from "@/types/simulation";

// A pinned, always-visible row of headline KPIs for the checkpoint dashboard, each shown with a
// "vs baseline" delta chip. Inspired by the reference dashboard's top stat strip, but rendered in
// this app's own theme tokens — the point is the *comparison*, which this app is uniquely placed
// to show: `current` is the (partial) checkpoint session's headline, `baseline` is the
// full-horizon baseline run that SimulationProvider keeps in the background. The detailed
// HeadlineKpis card (featured graduation-rate cell + 95% CIs) still lives below in its
// collapsible section — this strip is the at-a-glance summary above it.

type Kind = "pct" | "sem" | "gpa";

interface MetricDef {
  key: "graduation_rate" | "avg_graduation_time" | "on_time_rate" | "academic_dropout_rate" | "censored_rate" | "mean_gpa_at_graduation";
  label: string;
  icon: ReactNode;
  kind: Kind;
  higherIsBetter: boolean;
  // Metrics derived from completed students (grad rate, time-to-degree, on-time, censored, GPA at
  // grad) read ~0 until cohorts start finishing, so their early delta-vs-full-baseline would be a
  // misleading cliff. When no one has graduated in the session yet, we show the baseline as a plain
  // reference instead of a signed delta. Dropout accrues from term one, so it's never gated.
  gradDependent: boolean;
}

function Svg({ children }: { children: ReactNode }) {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      {children}
    </svg>
  );
}

const METRICS: MetricDef[] = [
  {
    key: "graduation_rate",
    label: "Graduation rate",
    icon: <Svg><polyline points="3 17 9 11 13 15 21 7" /><polyline points="15 7 21 7 21 13" /></Svg>,
    kind: "pct",
    higherIsBetter: true,
    gradDependent: true,
  },
  {
    key: "avg_graduation_time",
    label: "Avg time to degree",
    icon: <Svg><circle cx="12" cy="12" r="9" /><path d="M12 8v4l3 2" /></Svg>,
    kind: "sem",
    higherIsBetter: false,
    gradDependent: true,
  },
  {
    key: "on_time_rate",
    label: "On-time rate",
    icon: <Svg><circle cx="12" cy="12" r="9" /><path d="M8.5 12.5l2.5 2.5 4.5-5" /></Svg>,
    kind: "pct",
    higherIsBetter: true,
    gradDependent: true,
  },
  {
    key: "academic_dropout_rate",
    label: "Academic dropout",
    icon: <Svg><path d="M12 4l9 15H3z" /><path d="M12 10v4" /><path d="M12 17h.01" /></Svg>,
    kind: "pct",
    higherIsBetter: false,
    gradDependent: false,
  },
  {
    key: "censored_rate",
    label: "Censored",
    icon: <Svg><path d="M6 4h12M6 20h12M6 4l6 8 6-8M6 20l6-8 6 8" /></Svg>,
    kind: "pct",
    higherIsBetter: false,
    gradDependent: true,
  },
  {
    key: "mean_gpa_at_graduation",
    label: "Mean GPA at grad",
    icon: <Svg><circle cx="12" cy="9" r="5" /><path d="M9 13l-2 7 5-3 5 3-2-7" /></Svg>,
    kind: "gpa",
    higherIsBetter: true,
    gradDependent: true,
  },
];

function fmtValue(kind: Kind, v: number): string {
  if (kind === "pct") return `${(v * 100).toFixed(1)}%`;
  if (kind === "sem") return `${v.toFixed(1)} sem`;
  return v.toFixed(2); // gpa
}

function fmtDelta(kind: Kind, absDelta: number): string {
  if (kind === "pct") return `${(absDelta * 100).toFixed(1)}pt`;
  if (kind === "sem") return `${absDelta.toFixed(1)} sem`;
  return absDelta.toFixed(2); // gpa
}

// Below this the two runs are effectively identical for that metric — don't dress up rounding
// noise as a change. Scaled to each metric's display precision.
function epsilon(kind: Kind): number {
  if (kind === "pct") return 0.001; // 0.1 percentage points
  if (kind === "sem") return 0.05;
  return 0.005; // gpa
}

export default function KpiStrip({
  current,
  baseline,
  graduatedSoFar,
}: {
  current: Headline;
  baseline: Headline;
  graduatedSoFar: number;
}) {
  return (
    <section>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {METRICS.map((m) => {
          const cur = (current[m.key] as number) || 0;
          const base = (baseline[m.key] as number) || 0;
          const delta = cur - base;
          const gated = m.gradDependent && graduatedSoFar === 0;

          let caption: ReactNode;
          if (gated) {
            caption = <span className="text-[11px] text-muted">baseline {fmtValue(m.kind, base)}</span>;
          } else if (Math.abs(delta) <= epsilon(m.kind)) {
            caption = <span className="text-[11px] text-muted">≈ baseline</span>;
          } else {
            const up = delta > 0;
            const favorable = m.higherIsBetter ? up : !up;
            caption = (
              <span
                title={`Baseline ${fmtValue(m.kind, base)} → now ${fmtValue(m.kind, cur)}`}
                className={
                  "inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[11px] font-semibold " +
                  (favorable ? "bg-good/10 text-good" : "bg-bad/10 text-bad")
                }
              >
                <span aria-hidden>{up ? "↑" : "↓"}</span>
                {fmtDelta(m.kind, Math.abs(delta))}
              </span>
            );
          }

          return (
            <div key={m.key} className="rounded-2xl border border-border bg-surface p-4">
              <div className="flex items-center gap-2">
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-surface-2 text-muted">
                  {m.icon}
                </span>
                <span className="text-[10.5px] font-semibold uppercase leading-tight tracking-wide text-muted">
                  {m.label}
                </span>
              </div>
              <div className="mt-2 text-[24px] font-extrabold tracking-tight text-ink">{fmtValue(m.kind, cur)}</div>
              <div className="mt-1 min-h-[20px]">{caption}</div>
            </div>
          );
        })}
      </div>
      <p className="mt-2 text-[11px] text-muted">
        Chips show the change versus the full-horizon baseline run. Graduation-based metrics read
        low until cohorts start finishing.
      </p>
    </section>
  );
}
