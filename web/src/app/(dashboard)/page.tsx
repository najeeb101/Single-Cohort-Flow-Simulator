"use client";

import { useSimulation } from "@/lib/SimulationContext";
import AnimationSection from "@/components/AnimationSection";
import AdmissionsRecommendation from "@/components/AdmissionsRecommendation";
import HeadlineKpis from "@/components/HeadlineKpis";
import CohortsTable from "@/components/CohortsTable";

export default function Home() {
  const { meta, data, chartMeta } = useSimulation();
  const summary = data.flow_timeline.summary;
  const totalCH = chartMeta.graph.nodes.reduce((s, n) => s + (n.credits || 0), 0);

  return (
    <main className="mx-auto w-full max-w-[1600px] px-7 pb-16">
      <header className="border-b border-border py-5">
        <h1 className="text-[19px] font-bold tracking-tight">Dashboard</h1>
        <p className="mt-0.5 max-w-2xl text-[12.5px] text-muted">
          Live roadmap and results for the active plan — see{" "}
          <a href="/about" className="font-semibold text-accent hover:underline">About</a>{" "}
          for an overview of what this tool does, or{" "}
          <a href="/bottlenecks" className="font-semibold text-accent hover:underline">Bottlenecks</a>{" "}
          to identify and test fixes.
        </p>
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

      <AnimationSection
        graph={chartMeta.graph}
        stageNodes={chartMeta.stageNodes}
        cohorts={chartMeta.cohorts}
        frames={data.flow_timeline.frames}
        maxTerms={meta.max_terms}
      />

      <AdmissionsRecommendation rec={summary.admissions_recommendation} />
      <HeadlineKpis headline={summary.headline} onTimeTerms={meta.on_time_terms} />
      <CohortsTable cohorts={summary.per_cohort} />
    </main>
  );
}
