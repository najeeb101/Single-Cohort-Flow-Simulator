"use client";

import Link from "next/link";
import type { IntakeSweepResult } from "@/types/simulation";
import { LIMIT_LABEL, pct0, pts, bestPointNear } from "@/lib/intakeUtils";
import { Pill } from "@/components/ui";

function Figure({ label, value, hint, tone = "ink" }: { label: string; value: string; hint: string; tone?: "ink" | "warn" | "info" }) {
  const color = tone === "warn" ? "text-warn" : tone === "info" ? "text-info" : "text-ink";
  return (
    <div className="rounded-lg bg-surface-2/70 px-4 py-3.5">
      <div className="text-[12px] font-medium uppercase tracking-[0.05em] text-muted">{label}</div>
      <div className={`mt-1 text-[24px] font-semibold leading-tight ${color}`}>{value}</div>
      <p className="mt-1 text-[13px] leading-snug text-muted">{hint}</p>
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
  const range = rec.robustness?.range;

  return (
    <div className="rounded-xl border border-border bg-surface p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-[13px] text-muted">Recommended for the {label}</div>
          {n != null ? (
            <div className="mt-1 flex flex-wrap items-baseline gap-x-2.5">
              <span className="text-[56px] font-semibold leading-none tracking-[-0.03em] text-ink">{n}</span>
              <span className="text-[17px] text-muted">students</span>
            </div>
          ) : (
            <div className="mt-1 text-[24px] font-semibold leading-tight text-ink">No intake meets the limits</div>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {n != null ? <Pill tone="good">Within your limits</Pill> : <Pill tone="warn">Seats are the constraint</Pill>}
          {range && range[0] !== range[1] && <Pill>Range {range[0]} to {range[1]}</Pill>}
        </div>
      </div>

      {rec.why && <p className="mt-4 max-w-3xl text-[15px] leading-relaxed text-ink">{rec.why}</p>}
      {atEdge && (
        <p className="mt-2 max-w-3xl text-sm text-muted">
          {n} is the largest intake this analysis tried, so the real limit may be higher. To test larger intakes, raise the
          largest intake on the{" "}
          <Link href="/data?tab=policy" className="font-medium text-accent hover:underline">Data page</Link> and run again.
        </p>
      )}
      {n == null && (
        <p className="mt-2 max-w-3xl text-sm text-muted">
          {rec.binding_course ? `The tightest course is ${rec.binding_course}. ` : ""}
          The seat planner below shows how many seats would make room, or you can relax the limits if the department
          accepts more delay.
        </p>
      )}
      {range && range[0] !== range[1] && (
        <p className="mt-2 max-w-3xl text-sm text-muted">
          The range shows where the answer moves if the three tightest courses lose 10% of their seats or pass rates are 5 pts lower.
        </p>
      )}

      <div className="mt-5 grid gap-3 sm:grid-cols-3">
        <Figure
          label="Next intake"
          value={n != null ? String(n) : "none"}
          hint={
            at
              ? `${pct0(at.grad_rate)} graduate, ${pct0(at.on_time_rate)} on time. Seat shortages cost ${pts(at.grad_rate_loss_fit)} of graduation and ${pts(at.on_time_loss_fit)} on time.`
              : "The largest next intake that keeps every limit, given today's students."
          }
        />
        <Figure
          label="Sustainable every year"
          value={rec.sustainable_intake != null ? String(rec.sustainable_intake) : "none"}
          tone="info"
          hint="What the department could admit year after year, once today's students have moved through."
        />
        <Figure
          label="Upper limit"
          value={rec.upper_limit != null ? String(rec.upper_limit) : "not reached"}
          tone="warn"
          hint="Beyond this, extra students add almost no graduates per year; they mostly add delay."
        />
      </div>

      <p className="mt-4 text-[13px] leading-relaxed text-muted">
        Compared with the same students given unlimited seats ({pct0(result.reference.grad_rate)} graduate,{" "}
        {pct0(result.reference.on_time_rate)} on time), seat shortages may cost at most {policy.max_grad_rate_loss_pts} pts of
        graduation and {policy.max_on_time_loss_pts} pts of on-time graduation
        {policy.min_grad_rate != null ? `, and graduation must stay above ${pct0(policy.min_grad_rate)}` : ""}.
        {rec.binding_limit ? ` The ${LIMIT_LABEL[rec.binding_limit] ?? rec.binding_limit} limit binds.` : ""}{" "}
        <Link href="/about" className="font-medium text-accent hover:underline">How this is worked out</Link>
      </p>

      {rec.warnings.length > 0 && (
        <ul className="mt-4 flex flex-col gap-1.5 border-t border-border pt-4">
          {rec.warnings.map((w) => (
            <li key={w} className="flex gap-2 text-[13px] text-muted">
              <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-warn" aria-hidden />
              {w}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
