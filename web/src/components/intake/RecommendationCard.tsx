"use client";

import Link from "next/link";
import type { IntakeSweepResult } from "@/types/simulation";
import { LIMIT_LABEL, pct0, pts, bestPointNear } from "@/lib/intakeUtils";

function Figure({ label, value, hint, tone = "ink" }: { label: string; value: string; hint: string; tone?: "ink" | "warn" | "info" }) {
  const color = tone === "warn" ? "text-warn" : tone === "info" ? "text-info" : "text-ink";
  return (
    <div className="rounded-xl border border-border bg-surface-2 px-4 py-3">
      <div className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</div>
      <div className={`mt-0.5 text-[26px] font-extrabold tabular-nums leading-tight ${color}`}>{value}</div>
      <p className="mt-1 text-xs leading-snug text-muted">{hint}</p>
    </div>
  );
}

// The answer to "how many should we admit next?", in plain words, with the honest cases spelled
// out: no feasible intake, an imprecise estimate, and the long-run vs next-year distinction.
export default function RecommendationCard({ result }: { result: IntakeSweepResult }) {
  const rec = result.recommendation;
  const label = result.label || "next intake";
  const n = rec.recommended_intake;
  const at = bestPointNear(result.views.next.points, n);
  const policy = result.policy;
  const largestTried = Math.max(...result.views.next.points.map((p) => p.intake));
  const atEdge = n != null && n >= largestTried;

  return (
    <section
      className={`rounded-2xl border border-border border-l-[4px] bg-surface p-5 ${
        n == null ? "border-l-warn" : "border-l-good"
      }`}
    >
      <div className="text-xs font-semibold uppercase tracking-wide text-muted">Recommended for the {label}</div>
      {n != null ? (
        <div className="mt-1 flex flex-wrap items-baseline gap-x-3">
          <span className="text-[48px] font-extrabold leading-none tabular-nums text-good">{n}</span>
          <span className="text-lg font-semibold text-ink">students</span>
          {rec.robustness?.range && rec.robustness.range[0] !== rec.robustness.range[1] && (
            <span className="text-sm text-muted">
              (range {rec.robustness.range[0]} to {rec.robustness.range[1]} if seats or pass rates turn out a little worse)
            </span>
          )}
        </div>
      ) : (
        <div className="mt-1 text-[22px] font-extrabold leading-tight text-warn">No intake meets the limits</div>
      )}

      {rec.why && <p className="mt-3 max-w-3xl text-sm leading-relaxed text-ink">{rec.why}</p>}
      {atEdge && (
        <p className="mt-2 max-w-3xl text-sm text-ink">
          {n} is the largest intake this analysis tried, so the real limit may be higher. To test larger intakes, raise
          the largest intake on the{" "}
          <Link href="/data?tab=policy" className="font-semibold text-accent hover:underline">Data page</Link> and run again.
        </p>
      )}

      {n == null && (
        <p className="mt-2 max-w-3xl text-sm text-muted">
          {rec.binding_course ? `The tightest course is ${rec.binding_course}. ` : ""}
          Use the seat planner below to see how many sections would make room, or relax the limits in the
          policy above if the department accepts more delay.
        </p>
      )}

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <Figure
          label="Next intake"
          value={n != null ? String(n) : "none"}
          hint={
            at
              ? `At this intake: ${pct0(at.grad_rate)} graduate, ${pct0(at.on_time_rate)} on time. Seat shortages cost ${pts(at.grad_rate_loss_fit)} of graduation and ${pts(at.on_time_loss_fit)} of on-time graduation.`
              : "The largest next intake that keeps every limit, given today's students."
          }
        />
        <Figure
          label="Sustainable every year"
          value={rec.sustainable_intake != null ? String(rec.sustainable_intake) : "none"}
          tone="info"
          hint="The intake the department could admit year after year, once today's students have moved through."
        />
        <Figure
          label="Upper limit"
          value={rec.upper_limit != null ? String(rec.upper_limit) : "not reached"}
          tone="warn"
          hint="Beyond this, each extra student adds almost no graduates per year: the seats are full, so more admissions mostly add delay."
        />
      </div>

      <p className="mt-3 text-xs text-muted">
        Limits: seat shortages may cost at most {policy.max_grad_rate_loss_pts} pts of graduation and{" "}
        {policy.max_on_time_loss_pts} pts of on-time graduation
        {policy.min_grad_rate != null ? `, and graduation must stay above ${pct0(policy.min_grad_rate)}` : ""}, compared with the
        same students given unlimited seats ({pct0(result.reference.grad_rate)} graduate, {pct0(result.reference.on_time_rate)} on time).
        {rec.binding_limit ? ` The ${LIMIT_LABEL[rec.binding_limit] ?? rec.binding_limit} limit is the one that binds.` : ""}{" "}
        <Link href="/about" className="font-semibold text-accent hover:underline">How this is worked out</Link>
      </p>

      {rec.warnings.length > 0 && (
        <ul className="mt-3 flex flex-col gap-1.5">
          {rec.warnings.map((w) => (
            <li key={w} className="rounded-lg bg-warn/10 px-3 py-1.5 text-xs text-ink">
              {w}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
