import type { Headline } from "@/types/simulation";
import { pct } from "@/lib/format";

// Faithful port of frontend/app.js::renderHeadline().
export default function HeadlineKpis({ headline }: { headline: Headline }) {
  const ci = headline.confidence_intervals ?? {};

  const kpis: { label: string; value: string; ciKey: string; isPct: boolean }[] = [
    { label: "Graduation rate", value: pct(headline.graduation_rate || 0), ciKey: "graduation_rate", isPct: true },
    { label: "Avg time to degree", value: `${(headline.avg_graduation_time || 0).toFixed(1)} sem`, ciKey: "avg_graduation_time", isPct: false },
    { label: "On-time (≤8 sem)", value: pct(headline.on_time_rate || 0), ciKey: "on_time_rate", isPct: true },
    { label: "Academic dropout", value: pct(headline.academic_dropout_rate || 0), ciKey: "academic_dropout_rate", isPct: true },
    { label: "Censored", value: pct(headline.censored_rate || 0), ciKey: "censored_rate", isPct: true },
    { label: "Probation (ever)", value: pct(headline.probation_rate || 0), ciKey: "probation_rate", isPct: true },
    { label: "Mean GPA at grad", value: (headline.mean_gpa_at_graduation || 0).toFixed(2), ciKey: "mean_gpa_at_graduation", isPct: false },
  ];

  const mcNote = ci.graduation_rate ? `(Monte Carlo, ${ci.graduation_rate.n_runs} seeds — 95% CI shown)` : null;

  return (
    <section className="py-6">
      <h2 className="mb-4 flex items-center gap-2 text-[15px] font-bold">
        <span className="grid h-6 w-6 place-items-center rounded-[7px] border border-border-2 bg-surface-2 text-xs font-bold text-accent">3</span>
        Headline results
        {mcNote && <span className="text-xs font-normal text-muted">{mcNote}</span>}
      </h2>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(168px,1fr))] gap-3">
        {kpis.map((k) => {
          const c = ci[k.ciKey];
          const ciTxt = c
            ? k.isPct
              ? `95% CI ${pct(c.ci_low)}–${pct(c.ci_high)}`
              : `95% CI ${c.ci_low.toFixed(1)}–${c.ci_high.toFixed(1)}`
            : "";
          return (
            <div key={k.label} className="rounded-2xl border border-border bg-surface p-4">
              <div className="text-[10.5px] uppercase tracking-wide text-muted">{k.label}</div>
              <div className="mt-1 text-[26px] font-extrabold tracking-tight">{k.value}</div>
              <div className="mt-1 min-h-[14px] text-[11px] text-faint">{ciTxt}</div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
