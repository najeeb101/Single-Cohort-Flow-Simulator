"use client";

import Link from "next/link";
import { useMemo } from "react";
import { pct } from "@/lib/format";
import type { Criterion, FlowTimelineSummary } from "@/types/simulation";

// Rules-based advisor (Phase A of the hybrid advisor). Deterministically turns the run's
// already-computed summary — headline metrics, the four health criteria + their slack, and the
// top bottlenecks — into a prioritized, plain-language list of what to do and what NOT to do.
// No LLM, no API key, no extra request: everything here is read straight off `data.summary`,
// which the /simulate payload already carries. The optional Claude chat box (Phase B) layers on
// top of this later once an Anthropic API key is available.

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
  good: "On target",
};

function criterionMap(criteria: Criterion[]): Record<string, Criterion> {
  return Object.fromEntries(criteria.map((c) => [c.name, c]));
}

function buildAdvice(summary: FlowTimelineSummary): Advice[] {
  const h = summary.headline;
  const rec = summary.admissions_recommendation;
  const criteria = rec.criteria ?? [];
  const byName = criterionMap(criteria);
  const advice: Advice[] = [];

  const allMet = criteria.length > 0 && criteria.every((c) => c.slack >= 1);

  // --- Health-target verdicts (grounded in the exact same criteria the Settings targets drive) ---
  const g = byName["graduation_rate"];
  if (g && g.slack < 1) {
    advice.push({
      id: "grad",
      severity: "critical",
      title: "Graduation rate below target",
      body: `${pct(g.observed)} graduate vs a ${pct(g.target)} target. Seats alone rarely fix this — it is usually driven by failures/dropout, so look at the top failure courses and dropout settings, not just capacity.`,
    });
  }

  const d = byName["seats_denied_per_stud"];
  if (d && d.slack < 1) {
    advice.push({
      id: "denied",
      severity: "warning",
      title: "Too many students denied seats",
      body: `${d.observed.toFixed(2)} seat denials per student vs a ${d.target} ceiling. This one is capacity-driven — Auto-fill can search the smallest capacity additions that clear it at the current intake.`,
      action: { label: "Auto-fill capacities →", href: "/bottlenecks" },
    });
  }

  const t = byName["time_to_degree"];
  if (t && t.slack < 1) {
    advice.push({
      id: "time",
      severity: "warning",
      title: "Students take too long to graduate",
      body: `Average ${t.observed.toFixed(1)} semesters vs a ${t.target}-semester ceiling. Relieving the gateway seat bottlenecks usually shortens this the most.`,
      action: { label: "See bottlenecks →", href: "/bottlenecks" },
    });
  }

  const s = byName["throughput_stability"];
  if (s && s.slack < 1) {
    advice.push({
      id: "stability",
      severity: "info",
      title: "Uneven graduate throughput",
      body: `Throughput stability ${s.observed.toFixed(2)} vs a ${s.target} target — the number of graduates swings term to term, which strains steady-state planning.`,
    });
  }

  // --- Narrative insight: finishing but late is a delay story, not a completion story ---
  const gap = h.graduation_rate - h.on_time_rate;
  if (gap > 0.25) {
    advice.push({
      id: "late",
      severity: "info",
      title: "They finish — just late",
      body: `${pct(h.graduation_rate)} graduate but only ${pct(h.on_time_rate)} finish on time. The problem is delay, not non-completion, so the payoff is in unblocking the prerequisite/seat chain earlier.`,
    });
  }

  // --- Concrete levers: the loudest seat bottleneck vs the loudest failure (different fixes) ---
  const cap = h.top_capacity_blocks?.[0];
  if (cap && cap[1] > 0) {
    advice.push({
      id: "cap",
      severity: "info",
      title: `${cap[0]} is the biggest seat bottleneck`,
      body: `${cap[1].toLocaleString()} seat denials. Raising its capacity is the most direct relief — but check the what-if first, since some bottlenecks saturate quickly and stop helping.`,
      action: { label: "Test in what-if →", href: "/bottlenecks" },
    });
  }

  const fail = h.top_fail_courses?.[0];
  if (fail && fail[1] > 0) {
    advice.push({
      id: "fail",
      severity: "info",
      title: `Don't add seats to ${fail[0]}`,
      body: `It drives the most failures (${fail[1].toLocaleString()}), not the most denials. Failures are a pass-rate/support problem — extra sections do nothing for them.`,
    });
  }

  // --- Lead with a clear verdict card ---
  if (allMet) {
    advice.unshift({
      id: "verdict-good",
      severity: "good",
      title: "All admission targets are met",
      body: "The current configuration satisfies every health target. You have room to push intake up or test tighter targets in the what-if.",
      action: { label: "Try a what-if →", href: "/bottlenecks" },
    });
  }

  return advice
    .sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity])
    .slice(0, 6);
}

export default function AdvisorPanel({
  summary,
  showHeading = true,
}: {
  summary: FlowTimelineSummary;
  // The dedicated /advisor page renders its own page-level <h1>/description, so it opts out
  // of this component's internal heading to avoid showing "Advisor" twice — same pattern as
  // AdmissionsTab's `showInitialState` prop.
  showHeading?: boolean;
}) {
  const advice = useMemo(() => buildAdvice(summary), [summary]);

  if (advice.length === 0) return null;

  return (
    <section className="py-6">
      {showHeading && (
        <>
          <div className="mb-1 flex items-baseline gap-2">
            <h2 className="text-[15px] font-bold">Advisor</h2>
            <span className="text-xs font-normal text-muted">— what this run is telling you</span>
          </div>
          <p className="mb-4 max-w-3xl text-[12.5px] text-muted">
            Automatic reading of the results against your admission targets. Each card is grounded in this
            run&apos;s numbers — most important first.
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
              <div className="text-[13.5px] font-bold text-ink">{a.title}</div>
              <p className="mt-1 text-[12.5px] leading-relaxed text-muted">{a.body}</p>
              {a.action && (
                <Link
                  href={a.action.href}
                  className="mt-2 inline-block text-[12px] font-semibold text-accent hover:underline"
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
