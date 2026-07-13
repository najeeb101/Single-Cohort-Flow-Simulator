import type { Headline } from "@/types/simulation";
import { pct } from "@/lib/format";

// The dashboard's permanent, always-visible summary strip. Two tiers, deliberately weighted:
//  1. Real *outcome* KPIs (the numbers the whole simulation exists to move) as big cards, so the
//     graduation/on-time/time/dropout story is visible without expanding the "Headline results"
//     accordion below (which still holds the full 7-metric + confidence-interval detail).
//  2. The static *configuration* constants (cohorts, courses, credit hours…) demoted to a thin
//     secondary pill row — kept for reference, but no longer competing with the outcomes for the
//     eye the way the old flat metadata bar did.
interface Props {
  headline: Headline;
  onTimeTerms: number;
  config: { label: string; value: number | string }[];
}

export default function TopKpis({ headline, onTimeTerms, config }: Props) {
  const kpis: { label: string; value: string; featured?: boolean }[] = [
    { label: "Graduation rate", value: pct(headline.graduation_rate || 0), featured: true },
    { label: `On-time (≤${onTimeTerms} sem)`, value: pct(headline.on_time_rate || 0) },
    { label: "Avg time to degree", value: `${(headline.avg_graduation_time || 0).toFixed(1)} sem` },
    { label: "Academic dropout", value: pct(headline.academic_dropout_rate || 0) },
  ];

  return (
    <section className="py-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {kpis.map((k) => (
          <div
            key={k.label}
            className={`rounded-2xl border border-border bg-surface p-4 shadow-sm ${
              k.featured ? "border-l-[4px] border-l-accent" : ""
            }`}
          >
            <div
              className={`text-[28px] font-extrabold leading-none tracking-tight ${
                k.featured ? "text-accent" : "text-ink"
              }`}
            >
              {k.value}
            </div>
            <div className="mt-2 text-[11px] uppercase tracking-wide text-muted">{k.label}</div>
          </div>
        ))}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1.5 rounded-xl border border-border bg-surface-2 px-4 py-2 text-xs text-muted">
        {config.map((c) => (
          <span key={c.label}>
            {c.label}: <b className="font-semibold text-ink">{c.value}</b>
          </span>
        ))}
      </div>
    </section>
  );
}
