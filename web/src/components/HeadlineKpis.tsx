import type { Headline } from "@/types/simulation";
import { pct } from "@/lib/format";

// Faithful port of frontend/app.js::renderHeadline().
export default function HeadlineKpis({ headline }: { headline: Headline }) {
  const ci = headline.confidence_intervals ?? {};

  // Graduation rate is the headline's headline — the one number the whole simulation
  // exists to move — so it gets its own oversized bento cell instead of sitting in line
  // with six other equally-sized stats.
  const featured = { label: "Graduation rate", value: pct(headline.graduation_rate || 0), ciKey: "graduation_rate", isPct: true };
  const kpis: { label: string; value: string; ciKey: string; isPct: boolean }[] = [
    { label: "Avg time to degree", value: `${(headline.avg_graduation_time || 0).toFixed(1)} sem`, ciKey: "avg_graduation_time", isPct: false },
    { label: "On-time (≤8 sem)", value: pct(headline.on_time_rate || 0), ciKey: "on_time_rate", isPct: true },
    { label: "Academic dropout", value: pct(headline.academic_dropout_rate || 0), ciKey: "academic_dropout_rate", isPct: true },
    { label: "Censored", value: pct(headline.censored_rate || 0), ciKey: "censored_rate", isPct: true },
    { label: "Probation (ever)", value: pct(headline.probation_rate || 0), ciKey: "probation_rate", isPct: true },
    { label: "Mean GPA at grad", value: (headline.mean_gpa_at_graduation || 0).toFixed(2), ciKey: "mean_gpa_at_graduation", isPct: false },
  ];

  const ciText = (k: { ciKey: string; isPct: boolean }) => {
    const c = ci[k.ciKey];
    if (!c) return "";
    return k.isPct ? `95% CI ${pct(c.ci_low)}–${pct(c.ci_high)}` : `95% CI ${c.ci_low.toFixed(1)}–${c.ci_high.toFixed(1)}`;
  };
  const mcNote = ci.graduation_rate ? `(Monte Carlo, ${ci.graduation_rate.n_runs} seeds — 95% CI shown)` : null;

  return (
    <section className="py-6">
      <h2 className="mb-4 flex items-center gap-2 text-[15px] font-bold">
        <span className="grid h-6 w-6 place-items-center rounded-[7px] border border-border-2 bg-surface-2 text-xs font-bold text-accent">3</span>
        Headline results
        {mcNote && <span className="text-xs font-normal text-muted">{mcNote}</span>}
      </h2>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="col-span-2 row-span-2 flex flex-col justify-between rounded-2xl border border-l-[3px] border-border border-l-accent bg-surface p-5">
          <div className="text-[11px] uppercase tracking-wide text-muted">{featured.label}</div>
          <div className="mt-2 text-[48px] font-extrabold leading-none tracking-tight text-accent">{featured.value}</div>
          <div className="mt-2 min-h-[14px] text-[11px] text-faint">{ciText(featured)}</div>
        </div>
        {kpis.map((k) => (
          <div key={k.label} className="rounded-2xl border border-border bg-surface p-4">
            <div className="text-[10.5px] uppercase tracking-wide text-muted">{k.label}</div>
            <div className="mt-1 text-[26px] font-extrabold tracking-tight">{k.value}</div>
            <div className="mt-1 min-h-[14px] text-[11px] text-faint">{ciText(k)}</div>
          </div>
        ))}
      </div>
    </section>
  );
}
