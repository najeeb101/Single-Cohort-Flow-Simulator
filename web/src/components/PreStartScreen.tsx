"use client";

import CurriculumGraph from "@/components/CurriculumGraph";
import type { MetaResponse } from "@/types/simulation";

interface Props {
  meta: MetaResponse;
  onStart: () => void;
  starting: boolean;
  error: string | null;
}

export default function PreStartScreen({ meta, onStart, starting, error }: Props) {
  const totalCH = meta.graph.nodes.reduce((s, n) => s + (n.credits || 0), 0);
  const totalCourses = meta.graph.nodes.length;
  const totalPrereqs = meta.graph.edges.length;

  return (
    <main className="mx-auto w-full max-w-[1600px] px-7 pb-16">
      {/* Hero */}
      <div className="border-b border-border py-10">
        <div className="mx-auto flex max-w-2xl flex-col items-center text-center">
          <div className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-maroon text-[18px] font-extrabold text-white">
            QU
          </div>
          <h1 className="mt-3 text-[28px] font-extrabold tracking-tight text-ink">
            CS Curriculum Flow Simulator
          </h1>
          <p className="mt-1 text-[14px] leading-relaxed text-muted">
            A discrete-term, agent-based model of students progressing through Qatar University's
            Computer Science programme. Each student follows the real prerequisite chain, competes
            for the same limited seats, and can fail, repeat, or drop out — exactly as in the
            real university.
          </p>

          {/* Research question */}
          <div className="mt-6 w-full rounded-2xl border border-border bg-surface px-5 py-4 text-left">
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-accent">Research question</div>
            <p className="text-[13.5px] leading-relaxed text-ink">
              Which prerequisite chains and scheduling constraints contribute most to student delay
              and non-completion — and what does adding one course section actually do to graduation rates?
            </p>
          </div>

          {/* Key stats */}
          <div className="mt-5 flex flex-wrap justify-center gap-3">
            {[
              ["Courses", totalCourses],
              ["Credit hours", totalCH],
              ["Prerequisite links", totalPrereqs],
              ["Max semesters", meta.max_terms],
              ["Cohort size", meta.cohort_size],
            ].map(([k, v]) => (
              <div key={String(k)} className="rounded-[10px] border border-border bg-surface px-3.5 py-2 text-[12.5px] text-muted">
                {k}: <b className="ml-0.5 font-bold text-ink">{v}</b>
              </div>
            ))}
          </div>
        </div>

        {/* What you can do */}
        <div className="mx-auto mt-6 grid max-w-4xl gap-3 sm:grid-cols-3">
          {[
            {
              label: "Simulate",
              desc: "Run the full multi-cohort model and see term-by-term who progresses, who gets blocked, and why.",
            },
            {
              label: "Identify bottlenecks",
              desc: "Find which courses deny the most seats, block the most prerequisites, and delay graduation most.",
            },
            {
              label: "Test interventions",
              desc: "Add a section to a gateway course or change cohort size and immediately see the impact on graduation rate.",
            },
          ].map((c) => (
            <div key={c.label} className="rounded-2xl border border-border bg-surface px-4 py-3.5">
              <div className="mb-1 text-[12.5px] font-bold text-ink">{c.label}</div>
              <div className="text-[12px] text-muted">{c.desc}</div>
            </div>
          ))}
        </div>

        {/* Start */}
        <div className="mt-7 flex flex-col items-center gap-1.5 text-center">
          <button
            type="button"
            onClick={onStart}
            disabled={starting}
            className="rounded-[10px] bg-accent px-7 py-2.5 text-[14px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            {starting ? "Running simulation…" : "▶ Start simulation"}
          </button>
          <span className="text-[11.5px] text-muted">
            Runs the baseline scenario — takes a few seconds. Change any parameter in Settings first.
          </span>
          {error && <span className="text-xs text-bad">{error}</span>}
        </div>
      </div>

      {/* Curriculum roadmap preview */}
      <section className="mt-6 rounded-2xl border border-border bg-surface">
        <div className="flex items-baseline justify-between gap-3 border-b border-border px-4 py-2.5 text-[13px] font-semibold">
          <span>Programme roadmap — QU CS 2024</span>
          <span className="text-xs font-normal text-muted">
            {totalCourses} courses · {totalCH} CH · coloured by requirement type
          </span>
        </div>
        <CurriculumGraph graph={meta.graph} courses={{}} />
      </section>
    </main>
  );
}
