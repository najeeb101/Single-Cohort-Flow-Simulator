"use client";

import { useSimulation } from "@/lib/SimulationContext";
import AnimationSection from "@/components/AnimationSection";
import AdmissionsRecommendation from "@/components/AdmissionsRecommendation";
import HeadlineKpis from "@/components/HeadlineKpis";

export default function Home() {
  const { meta, data, chartMeta } = useSimulation();
  const summary = data.flow_timeline.summary;

  return (
    <main className="mx-auto max-w-[1600px] px-7 pb-16">
      <header className="border-b border-border py-5">
        <div className="flex items-center gap-3.5">
          <div className="grid h-11 w-11 place-items-center rounded-xl bg-maroon text-[17px] font-extrabold text-white">
            QU
          </div>
          <div>
            <h1 className="text-[19px] font-bold tracking-tight">Computer Science — Flow Simulator</h1>
            <p className="mt-0.5 text-[12.5px] text-[#c9a6b2]">
              Multi-cohort, shared-seat university model — dashboard
            </p>
          </div>
        </div>
      </header>

      <section className="py-6">
        <h2 className="mb-4 flex items-center gap-2 text-[15px] font-bold">
          <span className="grid h-6 w-6 place-items-center rounded-[7px] border border-border-2 bg-surface-2 text-xs font-bold text-accent">0</span>
          Inputs <span className="text-xs font-normal text-muted">— this run, edit in Scenario Builder</span>
        </h2>
        <div className="flex flex-wrap gap-2.5">
          {[
            ["Study cohorts", data.flow_timeline.meta.num_cohorts],
            ["Incumbent cohorts", data.flow_timeline.meta.num_incumbent_cohorts],
            ["Cohort size", meta.cohort_size],
            ["Max semesters", data.flow_timeline.meta.max_terms],
            ["Seats / section", meta.seats_per_section],
            ["Courses", chartMeta.graph.nodes.length],
            ["Prerequisite links", chartMeta.graph.edges.length],
            ["Seed", data.flow_timeline.meta.seed],
          ].map(([k, v]) => (
            <div key={String(k)} className="rounded-[10px] border border-border bg-surface px-3.5 py-2.5 text-[12.5px] text-muted">
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
      />

      <AdmissionsRecommendation rec={summary.admissions_recommendation} />
      <HeadlineKpis headline={summary.headline} />
    </main>
  );
}
