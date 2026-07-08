"use client";

import { useSimulation } from "@/lib/SimulationContext";
import AnimationSection from "@/components/AnimationSection";
import AdvisorPanel from "@/components/AdvisorPanel";
import AdmissionsRecommendation from "@/components/AdmissionsRecommendation";
import HeadlineKpis from "@/components/HeadlineKpis";

const WHAT_YOU_CAN_DO = [
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
];

export default function Home() {
  const { meta, data, chartMeta } = useSimulation();
  const summary = data.flow_timeline.summary;
  const totalCH = chartMeta.graph.nodes.reduce((s, n) => s + (n.credits || 0), 0);

  return (
    <main className="mx-auto w-full max-w-[1600px] px-7 pb-16">
      <header className="border-b border-border py-5">
        <div className="mx-auto flex max-w-2xl flex-col items-center gap-1 text-center">
          <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-maroon text-[18px] font-extrabold text-white shadow-[0_10px_24px_-8px_rgba(165,28,69,0.6)]">
            CA
          </div>
          <h1 className="mt-2 text-[28px] font-extrabold tracking-tight text-ink">Cohort Flow Simulator</h1>
          <p className="mt-1 text-[13px] leading-relaxed text-muted">
            A discrete-term, agent-based model of students moving through a curriculum, term by
            term. Every student follows the real prerequisite chain, competes for the same
            limited seats, and can fail, repeat, or drop out — just like the real program.
          </p>
          <p className="text-[12.5px] text-muted">
            Baseline run complete — explore results below or go to{" "}
            <a href="/bottlenecks" className="font-semibold text-accent hover:underline">Bottlenecks</a>{" "}
            to identify and test fixes.
          </p>
        </div>
      </header>

      <section className="py-4">
        <div className="flex flex-wrap justify-center gap-2.5">
          {[
            ["Cohorts", data.flow_timeline.meta.num_cohorts],
            ["Cohort size", meta.cohort_size],
            ["Max semesters", data.flow_timeline.meta.max_terms],
            ["Courses", chartMeta.graph.nodes.length],
            ["Credit hours", totalCH],
            ["Prerequisite links", chartMeta.graph.edges.length],
          ].map(([k, v]) => (
            <div key={String(k)} className="rounded-[10px] border border-border bg-surface px-3.5 py-2 text-[12.5px] text-muted">
              {k}: <b className="ml-0.5 font-bold text-ink">{v}</b>
            </div>
          ))}
        </div>
      </section>

      <section className="pb-2">
        <div className="mx-auto grid max-w-4xl gap-3 sm:grid-cols-3">
          {WHAT_YOU_CAN_DO.map((c) => (
            <div key={c.label} className="rounded-2xl border border-border bg-surface px-4 py-3.5">
              <div className="mb-1 text-[12.5px] font-bold text-ink">{c.label}</div>
              <div className="text-[12px] text-muted">{c.desc}</div>
            </div>
          ))}
        </div>
      </section>

      <AnimationSection
        graph={chartMeta.graph}
        stageNodes={chartMeta.stageNodes}
        cohorts={chartMeta.cohorts}
        frames={data.flow_timeline.frames}
      />

      <AdvisorPanel summary={summary} />
      <AdmissionsRecommendation rec={summary.admissions_recommendation} />
      <HeadlineKpis headline={summary.headline} />
    </main>
  );
}
