"use client";

import { useMemo, useState } from "react";
import { ApiError, getStudentTrace, searchStudents } from "@/lib/api";
import { useSimulation } from "@/lib/SimulationContext";
import { SIGNAL_META } from "@/lib/signalMeta";
import { exportTraceJson, exportTracePrintable } from "@/lib/traceExport";
import type {
  StudentCandidate,
  StudentProfileFilter,
  StudentTrace,
  StudentTraceTerm,
} from "@/types/simulation";

// Trace one synthetic student's term-by-term journey. Both the candidate search and the trace
// re-run the deterministic engine (CRN) from the dashboard baseline (overrides {}), so what you
// see here matches the aggregate numbers on the rest of the dashboard. See
// src/analytics.py::find_students_matching / compute_student_trace.

type StatusKey = "GRADUATED" | "DROPPED" | "CENSORED" | "DELAYED" | "ACTIVE";

const STATUS_STYLE: Record<StatusKey, string> = {
  GRADUATED: "border-good/40 bg-good/10 text-good",
  DROPPED: "border-bad/40 bg-bad/10 text-bad",
  CENSORED: "border-warn/40 bg-warn/10 text-warn",
  DELAYED: "border-warn/40 bg-warn/10 text-warn",
  ACTIVE: "border-border-2 bg-surface-2 text-muted",
};

const STATUS_LABEL: Record<StatusKey, string> = {
  GRADUATED: "Graduated",
  DROPPED: "Dropped out",
  CENSORED: "Ran out of time",
  DELAYED: "Delayed",
  ACTIVE: "On track",
};

function StatusPill({ status }: { status: StatusKey }) {
  return (
    <span className={`inline-block rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${STATUS_STYLE[status]}`}>
      {STATUS_LABEL[status]}
    </span>
  );
}

function OutcomeFilter({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="rounded-[9px] border border-border-2 bg-surface px-3 py-1.5 text-[12.5px] text-ink"
    >
      <option value="">Any outcome</option>
      <option value="graduated">Graduated</option>
      <option value="dropped">Dropped out</option>
      <option value="censored">Ran out of time</option>
    </select>
  );
}

// A tiny inline GPA line — no chart lib, matches the app's SVG-first figures. Domain 0..4.
function GpaSparkline({ terms }: { terms: StudentTraceTerm[] }) {
  const pts = terms.map((t) => t.gpa);
  if (pts.length < 2) return null;
  const w = 220;
  const h = 44;
  const pad = 4;
  const maxGpa = 4;
  const x = (i: number) => pad + (i * (w - 2 * pad)) / (pts.length - 1);
  const y = (g: number) => h - pad - (g / maxGpa) * (h - 2 * pad);
  const path = pts.map((g, i) => `${i === 0 ? "M" : "L"} ${x(i).toFixed(1)} ${y(g).toFixed(1)}`).join(" ");
  const floorY = y(2.0); // 2.0 probation/graduation floor reference line

  return (
    <svg width={w} height={h} className="overflow-visible" role="img" aria-label="GPA over time">
      <line x1={pad} y1={floorY} x2={w - pad} y2={floorY} className="stroke-warn/40" strokeDasharray="3 3" strokeWidth={1} />
      <path d={path} className="fill-none stroke-accent" strokeWidth={1.75} strokeLinejoin="round" strokeLinecap="round" />
      {pts.map((g, i) => (
        <circle key={i} cx={x(i)} cy={y(g)} r={2} className={g < 2 ? "fill-warn" : "fill-accent"} />
      ))}
    </svg>
  );
}

function CandidateCard({
  c,
  selected,
  onClick,
}: {
  c: StudentCandidate;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex flex-col items-start gap-1 rounded-[11px] border px-3.5 py-2.5 text-left transition-colors ${
        selected
          ? "border-accent bg-accent/5"
          : "border-border-2 bg-surface hover:border-accent/50 hover:bg-surface-2"
      }`}
    >
      <div className="flex items-center gap-2">
        <span className="text-[13px] font-bold text-ink">Student #{c.student_id}</span>
        <StatusPill status={c.final_status} />
      </div>
      <div className="text-[11.5px] text-muted">
        Cohort {c.cohort_id} · GPA {c.gpa.toFixed(2)} · {c.completed_ch} CH
        {c.grad_semester != null ? ` · ${c.grad_semester} sems` : ""}
      </div>
      <div className="flex flex-wrap gap-1.5 text-[10.5px] text-muted">
        {c.ever_probation && <span className="rounded bg-warn/10 px-1.5 py-0.5 text-warn">was on probation</span>}
        {c.total_fails > 0 && <span className="rounded bg-bad/10 px-1.5 py-0.5 text-bad">{c.total_fails} failed attempt{c.total_fails > 1 ? "s" : ""}</span>}
      </div>
    </button>
  );
}

function TermRow({ t }: { t: StudentTraceTerm }) {
  // Capacity/offering blocks are the actionable "eligible but stuck" signals — show them.
  // Prereq blocks are still computed by the engine but no longer surfaced anywhere in the UI, so
  // they're dropped here (they were noise per-student — a whole-curriculum sweep every term).
  const notable = t.blocked.filter((b) => b.signal !== "prereq");

  return (
    <div className="relative pl-6">
      {/* timeline rail dot */}
      <span
        className={`absolute left-[5px] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-surface ${
          t.status === "GRADUATED" ? "bg-good" : t.status === "DROPPED" ? "bg-bad" : t.status === "CENSORED" || t.status === "DELAYED" ? "bg-warn" : "bg-accent"
        }`}
      />
      <div className="rounded-[11px] border border-border bg-surface px-3.5 py-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="text-[13px] font-bold text-ink">
            Sem {t.personal_semester} · {t.label}
          </span>
          {(t.status === "GRADUATED" || t.status === "DROPPED" || t.status === "CENSORED" || t.status === "DELAYED") && (
            <StatusPill status={t.status} />
          )}
          <span className="ml-auto text-[11.5px] text-muted">
            GPA <b className={t.gpa < 2 ? "text-warn" : "text-ink"}>{t.gpa.toFixed(2)}</b> · {t.completed_ch} CH
            {t.on_probation && <span className="ml-2 text-warn">• on probation</span>}
          </span>
        </div>

        {t.courses.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {t.courses.map((c) => (
              <span
                key={c.code}
                title={`${c.title}${c.attempt_no > 1 ? ` — attempt ${c.attempt_no}` : ""}`}
                className={`rounded-[7px] border px-2 py-0.5 text-[11.5px] ${
                  c.passed ? "border-good/40 bg-good/5 text-ink" : "border-bad/50 bg-bad/5 text-ink"
                }`}
              >
                {c.code} <b className={c.passed ? "text-good" : "text-bad"}>{c.grade}</b>
                {c.attempt_no > 1 && <span className="text-muted"> · retake #{c.attempt_no}</span>}
              </span>
            ))}
          </div>
        )}

        {notable.length > 0 && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px]">
            {notable.map((b) => (
              <span
                key={b.code}
                title={`${b.title} — ${SIGNAL_META[b.signal].unit}`}
                className={`rounded-[7px] border px-2 py-0.5 ${SIGNAL_META[b.signal].pill}`}
              >
                {b.code} · {SIGNAL_META[b.signal].label}
              </span>
            ))}
          </div>
        )}

        {t.courses.length === 0 && notable.length === 0 && (
          <div className="mt-1.5 text-[11.5px] text-muted">No courses this term.</div>
        )}
      </div>
    </div>
  );
}

export default function StudentTracePanel() {
  const { meta } = useSimulation();
  const cohortOptions = useMemo(
    () => Array.from({ length: meta.num_cohorts }, (_, i) => i),
    [meta.num_cohorts]
  );

  const [cohort, setCohort] = useState<string>("");
  const [outcome, setOutcome] = useState<string>("");
  const [probation, setProbation] = useState<string>("");

  const [candidates, setCandidates] = useState<StudentCandidate[] | null>(null);
  const [totalMatched, setTotalMatched] = useState(0);
  const [searching, setSearching] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [trace, setTrace] = useState<StudentTrace | null>(null);
  const [tracing, setTracing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runSearch = async () => {
    setSearching(true);
    setError(null);
    setTrace(null);
    setSelectedId(null);
    const filter: StudentProfileFilter = { limit: 8 };
    if (cohort !== "") filter.filter_cohort_id = Number(cohort);
    if (outcome !== "") filter.filter_final_status = outcome as StudentProfileFilter["filter_final_status"];
    if (probation !== "") filter.filter_ever_probation = probation === "yes";
    try {
      const res = await searchStudents(filter);
      setCandidates(res.candidates);
      setTotalMatched(res.total_matched);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Search failed — is the API running?");
    } finally {
      setSearching(false);
    }
  };

  const pick = async (id: number) => {
    setSelectedId(id);
    setTracing(true);
    setError(null);
    setTrace(null);
    try {
      const t = await getStudentTrace(id);
      setTrace(t);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not load this student's trace");
    } finally {
      setTracing(false);
    }
  };

  return (
    <div className="mt-5 flex flex-col gap-5">
      {/* Profile picker */}
      <section className="rounded-2xl border border-border bg-surface p-4">
        <h2 className="text-[14px] font-bold text-ink">Find a student to trace</h2>
        <p className="mt-0.5 text-[12px] text-muted">
          Students are synthetic, so pick by profile. We&apos;ll surface a few representative matches from the
          current baseline run — most-delayed and most-struggling first.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <select
            value={cohort}
            onChange={(e) => setCohort(e.target.value)}
            className="rounded-[9px] border border-border-2 bg-surface px-3 py-1.5 text-[12.5px] text-ink"
          >
            <option value="">Any cohort</option>
            {cohortOptions.map((c) => (
              <option key={c} value={c}>
                Cohort {c}
              </option>
            ))}
          </select>
          <OutcomeFilter value={outcome} onChange={setOutcome} />
          <select
            value={probation}
            onChange={(e) => setProbation(e.target.value)}
            className="rounded-[9px] border border-border-2 bg-surface px-3 py-1.5 text-[12.5px] text-ink"
          >
            <option value="">Probation: any</option>
            <option value="yes">Was on probation</option>
            <option value="no">Never on probation</option>
          </select>
          <button
            type="button"
            onClick={runSearch}
            disabled={searching}
            className="rounded-[10px] bg-accent px-5 py-1.5 text-[13px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            {searching ? "Searching…" : "Find students"}
          </button>
          {error && <span className="text-[12px] text-bad">{error}</span>}
        </div>

        {candidates && (
          <div className="mt-4">
            {candidates.length === 0 ? (
              <p className="text-[12.5px] text-muted">No students match that profile in this run.</p>
            ) : (
              <>
                <p className="mb-2 text-[11.5px] text-muted">
                  Showing {candidates.length} of {totalMatched} matching · click one to trace their path
                </p>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {candidates.map((c) => (
                    <CandidateCard
                      key={c.student_id}
                      c={c}
                      selected={c.student_id === selectedId}
                      onClick={() => pick(c.student_id)}
                    />
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </section>

      {/* Trace */}
      {tracing && (
        <div className="flex items-center gap-2 text-[13px] text-muted">
          <span className="inline-block h-2.5 w-2.5 animate-ping rounded-full bg-accent" />
          Tracing student #{selectedId}…
        </div>
      )}

      {trace && !tracing && <TraceView trace={trace} />}
    </div>
  );
}

function TraceView({ trace }: { trace: StudentTrace }) {
  const abilityLabel =
    trace.ability_score > 0.03 ? "above-average aptitude" : trace.ability_score < -0.03 ? "below-average aptitude" : "average aptitude";
  const progress = Math.round((trace.completed_ch / trace.total_program_ch) * 100);

  return (
    <section className="rounded-2xl border border-border bg-surface">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border px-5 py-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-[17px] font-bold text-ink">Student #{trace.student_id}</h2>
            <StatusPill status={trace.final_status} />
          </div>
          <p className="mt-0.5 text-[12px] text-muted">
            Cohort {trace.cohort_id} · {abilityLabel} · {trace.final_reason}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => exportTracePrintable(trace)}
              title="Download a print-ready HTML page (open it and Ctrl+P → Save as PDF)"
              className="rounded-md border border-border-2 px-2.5 py-1 text-[11px] font-semibold text-ink hover:bg-surface-2"
            >
              Export printable
            </button>
            <button
              type="button"
              onClick={() => exportTraceJson(trace)}
              title="Download this trace as JSON (matches the API payload)"
              className="rounded-md border border-border-2 px-2.5 py-1 text-[11px] font-semibold text-ink hover:bg-surface-2"
            >
              Export JSON
            </button>
          </div>
        </div>
        <div className="ml-auto flex items-center gap-5">
          <div className="text-right">
            <div className="text-[11px] uppercase tracking-wide text-muted">Final GPA</div>
            <div className={`text-[18px] font-bold ${trace.gpa < 2 ? "text-warn" : "text-ink"}`}>{trace.gpa.toFixed(2)}</div>
          </div>
          <div className="text-right">
            <div className="text-[11px] uppercase tracking-wide text-muted">Progress</div>
            <div className="text-[18px] font-bold text-ink">{progress}%</div>
            <div className="text-[10.5px] text-muted">{trace.completed_ch}/{trace.total_program_ch} CH</div>
          </div>
          <div>
            <div className="mb-1 text-[11px] uppercase tracking-wide text-muted">GPA over time</div>
            <GpaSparkline terms={trace.terms} />
          </div>
        </div>
      </div>

      {/* Term-by-term timeline */}
      <div className="px-5 py-4">
        <div className="relative flex flex-col gap-2.5 before:absolute before:left-[9px] before:top-1 before:bottom-1 before:w-px before:bg-border-2">
          {trace.terms.map((t) => (
            <TermRow key={t.term} t={t} />
          ))}
        </div>
      </div>
    </section>
  );
}
