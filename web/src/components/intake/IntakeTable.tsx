"use client";

import type { IntakeSweepResult } from "@/types/simulation";
import { downloadCsv, pct0, pts } from "@/lib/intakeUtils";

// Every intake the analysis tried ("admit N next year" view), with the CSV the committee can keep.
export default function IntakeTable({ result }: { result: IntakeSweepResult }) {
  const points = result.views.next.points;
  const rec = result.recommendation;
  const policy = result.policy;

  const exportCsv = () =>
    downloadCsv(`${(result.label || "intake-analysis").replace(/\s+/g, "-").toLowerCase()}.csv`, [
      ["intake", "graduation_rate", "on_time_rate", "avg_semesters_to_degree", "graduates_per_year",
       "graduation_loss_pts", "graduation_loss_upper_pts", "on_time_loss_pts", "on_time_loss_upper_pts",
       "summer_share_of_denials", "current_students_graduation_rate", "most_short_course", "simulations"],
      ...points.map((p) => [
        p.intake, p.grad_rate.toFixed(4), p.on_time_rate.toFixed(4), p.avg_time_to_degree.toFixed(2),
        p.graduates_per_year.toFixed(1), p.grad_rate_loss_fit.toFixed(2), p.grad_rate_loss_upper.toFixed(2),
        p.on_time_loss_fit.toFixed(2), p.on_time_loss_upper.toFixed(2), p.summer_denial_share.toFixed(3),
        p.current_students_grad_rate?.toFixed(4) ?? "", p.top_courses[0]?.code ?? "", p.seeds,
      ]),
    ]);

  return (
    <section className="rounded-2xl border border-border bg-surface">
      <div className="flex flex-wrap items-baseline justify-between gap-3 p-5 pb-3">
        <div>
          <p className="max-w-3xl text-sm text-muted">
            If the department admits this many next year. Harm from seat shortages is the best estimate, with the cautious
            upper value in brackets. Red means over your limit; amber means it might be, so the limit can&apos;t be confirmed there. &quot;Today&apos;s students graduate&quot; is the effect on
            students already enrolled.
          </p>
        </div>
        <button
          type="button"
          onClick={exportCsv}
          className="no-print rounded-lg border border-border-2 px-3 py-1.5 text-xs font-semibold text-ink hover:bg-surface-2"
        >
          Download CSV
        </button>
      </div>
      <div className="overflow-auto border-t border-border">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr>
              {["Intake", "Graduate", "On time", "Avg time", "Graduates / year", "Graduation lost", "On-time lost", "Denials in Summer", "Today's students graduate", "Most short of seats"].map((h) => (
                <th key={h} className="whitespace-nowrap border-b border-border px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {points.map((p) => {
              // Red: the best estimate is over the limit. Amber: only the cautious value is, so the
              // limit can't be confirmed at this intake.
              const tone = (fit: number, upper: number, limit: number) =>
                fit > limit ? "font-semibold text-bad" : upper > limit ? "font-semibold text-warn" : "";
              const isRec = p.intake === rec.recommended_intake;
              return (
                <tr key={p.intake} className={`border-b border-border last:border-0 ${isRec ? "bg-good/10" : ""}`}>
                  <td className="whitespace-nowrap px-3 py-2 font-semibold tabular-nums">
                    {p.intake}
                    {isRec && <span className="ml-2 text-xs font-semibold text-good">recommended</span>}
                    {p.intake === rec.sustainable_intake && <span className="ml-2 text-xs font-semibold text-info">sustainable</span>}
                  </td>
                  <td className="px-3 py-2 tabular-nums">{pct0(p.grad_rate)}</td>
                  <td className="px-3 py-2 tabular-nums">{pct0(p.on_time_rate)}</td>
                  <td className="whitespace-nowrap px-3 py-2 tabular-nums">{p.avg_time_to_degree.toFixed(1)} sem</td>
                  <td className="px-3 py-2 tabular-nums">{p.graduates_per_year.toFixed(0)}</td>
                  <td className={`whitespace-nowrap px-3 py-2 tabular-nums ${tone(p.grad_rate_loss_fit, p.grad_rate_loss_upper, policy.max_grad_rate_loss_pts)}`}>
                    {pts(p.grad_rate_loss_fit)} <span className="text-xs text-muted">({pts(p.grad_rate_loss_upper)})</span>
                  </td>
                  <td className={`whitespace-nowrap px-3 py-2 tabular-nums ${tone(p.on_time_loss_fit, p.on_time_loss_upper, policy.max_on_time_loss_pts)}`}>
                    {pts(p.on_time_loss_fit)} <span className="text-xs text-muted">({pts(p.on_time_loss_upper)})</span>
                  </td>
                  <td className="px-3 py-2 tabular-nums text-muted">{pct0(p.summer_denial_share)}</td>
                  <td className="px-3 py-2 tabular-nums">{p.current_students_grad_rate != null ? pct0(p.current_students_grad_rate) : "-"}</td>
                  <td className="px-3 py-2 text-muted">{p.top_courses[0]?.code ?? "-"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
