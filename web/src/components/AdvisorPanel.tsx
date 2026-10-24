"use client";

import Link from "next/link";
import { useMemo } from "react";
import { pct } from "@/lib/format";
import { pts } from "@/lib/intakeUtils";
import type { FlowTimelineSummary, IntakeSweepResult } from "@/types/simulation";

// Rules-based advisor (Phase A of the hybrid advisor). Deterministically turns the latest intake
// analysis (src/intake.py) and the baseline run's summary (headline metrics, top bottlenecks)
// into a prioritized, plain-language list of what to do and what NOT to do. No LLM and no extra
// request: everything is read from data the site already holds. The optional chat box (Phase B)
// sits on top of this.

type Severity = "critical" | "warning" | "info" | "good";

interface Advice {
  id: string;
  severity: Severity;
  title: string;
  body: string;
  action?: { label: string; href: string };
}

const SEVERITY_RANK: Record<Severity, number> = { critical: 0, warning: 1, info: 2, good: 3 };

const SEVERITY_STYLE: Record<Severity, { dot: string; label: string; ring: string }> = {
  critical: { dot: "bg-bad", label: "text-bad", ring: "border-l-bad" },
  warning: { dot: "bg-warn", label: "text-warn", ring: "border-l-warn" },
  info: { dot: "bg-accent", label: "text-accent", ring: "border-l-accent" },
  good: { dot: "bg-good", label: "text-good", ring: "border-l-good" },
};

const SEVERITY_WORD: Record<Severity, string> = {
  critical: "Action needed",
  warning: "Watch",
  info: "Insight",
  good: "On track",
};

function buildAdvice(summary: FlowTimelineSummary, analysis: IntakeSweepResult | null): Advice[] {
  const h = summary.headline;
  const advice: Advice[] = [];

  // --- The intake verdict, straight from the analysis (the AI and these rules never compute it) ---
  if (!analysis) {
    advice.push({
      id: "no-analysis",
      severity: "warning",
      title: "No intake analysis yet",
      body: "Run the intake analysis to get a recommended next intake. The advice below comes only from one baseline run at today's intake.",
      action: { label: "Open the Intake Planner", href: "/" },
    });
  } else {
    const rec = analysis.recommendation;
    if (rec.recommended_intake == null) {
      advice.push({
        id: "infeasible",
        severity: "critical",
        title: "No intake meets your limits",
        body: `${rec.why} ${rec.binding_course ? `${rec.binding_course} is the tightest course. ` : ""}The seat planner shows how many sections would make room.`,
        action: { label: "Plan seats", href: "/" },
      });
    } else {
      advice.push({
        id: "recommended",
        severity: "good",
        title: `Recommended next intake: ${rec.recommended_intake}`,
        body: rec.why || "This is the largest intake that keeps every limit.",
        action: { label: "See the full result", href: "/" },
      });
    }
    if (rec.recommended_intake != null && rec.sustainable_intake != null && rec.sustainable_intake < rec.recommended_intake) {
      advice.push({
        id: "sustainable-lower",
        severity: "warning",
        title: `Only ${rec.sustainable_intake} a year is sustainable`,
        body: `You can take ${rec.recommended_intake} once, but admitting that every year would break the limits once those students fill the upper-year courses.`,
      });
    }
    if (rec.upper_limit != null) {
      advice.push({
        id: "upper",
        severity: "info",
        title: `Beyond ${rec.upper_limit}, extra students barely add graduates`,
        body: "Above the upper limit the seats are full, so more admissions mostly add delay. Growing past it needs more sections first.",
        action: { label: "Plan seats for a larger intake", href: "/bottlenecks" },
      });
    }
    if (analysis.data_quality.illustrative) {
      advice.push({
        id: "illustrative",
        severity: "warning",
        title: "Most inputs are still estimates",
        body: "Treat the number as illustrative until the seats, pass rates and past intakes are replaced with QU data on the Data page.",
        action: { label: "Update the data", href: "/data" },
      });
    }
    const flagged = analysis.calibration.checks.filter((c) => c.flag);
    if (flagged.length > 0) {
      advice.push({
        id: "calibration",
        severity: "warning",
        title: "The model doesn't match recorded outcomes",
        body: `Off on: ${flagged.map((c) => c.label).join(", ")}. Check the pass rates and dropout settings before relying on the number.`,
        action: { label: "Check the data", href: "/data" },
      });
    }
    const at = analysis.views.next.points.find((p) => p.intake === rec.recommended_intake);
    if (at && at.summer_denial_share > 0.5) {
      advice.push({
        id: "summer",
        severity: "info",
        title: "Most seat shortages are in Summer",
        body: `At ${at.intake} students, ${pct(at.summer_denial_share)} of seat denials happen in the small Summer catch-up sessions, which extra regular sections only partly relieve. On-time graduation lost: ${pts(at.on_time_loss_fit)}.`,
      });
    }
  }

  // --- Concrete levers from the baseline run: seat bottleneck vs failure (different fixes) ---
  const cap = h.top_capacity_blocks?.[0];
  if (cap && cap[1] > 0) {
    advice.push({
      id: "cap",
      severity: "info",
      title: `${cap[0]} turns away the most students`,
      body: `${cap[1].toLocaleString()} seat denials at today's intake. Adding a section here is the most direct relief. Ask the advisor below to test it before applying.`,
      action: { label: "See bottlenecks", href: "/bottlenecks" },
    });
  }

  const fail = h.top_fail_courses?.[0];
  if (fail && fail[1] > 0) {
    advice.push({
      id: "fail",
      severity: "info",
      title: `Don't add seats to ${fail[0]}`,
      body: `It drives the most failures (${fail[1].toLocaleString()}), not the most denials. Failures are a pass-rate and support problem; extra sections do nothing for them.`,
    });
  }

  const gap = h.graduation_rate - h.on_time_rate;
  if (gap > 0.25) {
    advice.push({
      id: "late",
      severity: "info",
      title: "They finish, just late",
      body: `${pct(h.graduation_rate)} graduate but only ${pct(h.on_time_rate)} finish on time. The problem is delay, not non-completion.`,
    });
  }

  // The intake verdict always leads; the rest follow by severity.
  const VERDICTS = new Set(["no-analysis", "infeasible", "recommended"]);
  const rank = (a: Advice) => (VERDICTS.has(a.id) ? -1 : SEVERITY_RANK[a.severity]);
  return advice.sort((a, b) => rank(a) - rank(b)).slice(0, 7);
}

export default function AdvisorPanel({
  summary,
  analysis,
  showHeading = true,
}: {
  summary: FlowTimelineSummary;
  analysis: IntakeSweepResult | null;
  // The dedicated /advisor page renders its own page-level <h1>/description, so it opts out
  // of this component's internal heading to avoid showing "Advisor" twice — same pattern as
  // AdmissionsTab's `showInitialState` prop.
  showHeading?: boolean;
}) {
  const advice = useMemo(() => buildAdvice(summary, analysis), [summary, analysis]);

  if (advice.length === 0) return null;

  return (
    <section className="py-6">
      {showHeading && (
        <>
          <div className="mb-1 flex items-baseline gap-2">
            <h2 className="text-[15px] font-bold">Advisor</h2>
            <span className="text-xs font-normal text-muted">what the results are telling you</span>
          </div>
          <p className="mb-4 max-w-3xl text-sm text-muted">
            An automatic reading of the latest intake analysis and the baseline run, most important first.
          </p>
        </>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        {advice.map((a) => {
          const style = SEVERITY_STYLE[a.severity];
          return (
            <div
              key={a.id}
              className={`rounded-2xl border border-border ${style.ring} border-l-[3px] bg-surface p-4`}
            >
              <div className="mb-1.5 flex items-center gap-2">
                <span className={`inline-block h-2 w-2 rounded-full ${style.dot}`} />
                <span className={`text-[10.5px] font-semibold uppercase tracking-wide ${style.label}`}>
                  {SEVERITY_WORD[a.severity]}
                </span>
              </div>
              <div className="text-sm font-bold text-ink">{a.title}</div>
              <p className="mt-1 text-sm leading-relaxed text-muted">{a.body}</p>
              {a.action && (
                <Link
                  href={a.action.href}
                  className="mt-2 inline-block text-sm font-semibold text-accent hover:underline"
                >
                  {a.action.label}
                </Link>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
