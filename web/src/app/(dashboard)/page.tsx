"use client";

import { useSimulation } from "@/lib/SimulationContext";
import AnimationSection from "@/components/AnimationSection";
import AdmissionsRecommendation from "@/components/AdmissionsRecommendation";
import HeadlineKpis from "@/components/HeadlineKpis";
import WhatIfPanel from "@/components/WhatIfPanel";

export default function Home() {
  const { meta, data, chartMeta } = useSimulation();
  const summary = data.flow_timeline.summary;

  return (
    <main className="mx-auto w-full max-w-[1600px] px-7 pb-16">
      <header className="border-b border-border py-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3.5">
            <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-maroon text-[17px] font-extrabold text-white">
              QU
            </div>
            <div>
              <h1 className="text-[19px] font-bold tracking-tight">CS Curriculum Flow Simulator</h1>
              <p className="mt-0.5 text-[12.5px] text-muted">
                Baseline run complete — explore results below or go to{" "}
                <a href="/bottlenecks" className="font-semibold text-accent hover:underline">Bottlenecks</a>{" "}
                to identify and test fixes.
              </p>
            </div>
          </div>
        </div>
      </header>

      <section className="py-4">
        <div className="flex flex-wrap gap-2.5">
          {[
            ["Cohorts", data.flow_timeline.meta.num_cohorts],
            ["Cohort size", meta.cohort_size],
            ["Max semesters", data.flow_timeline.meta.max_terms],
            ["Seats / section", meta.seats_per_section],
            ["Courses", chartMeta.graph.nodes.length],
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
      />

      <AdmissionsRecommendation rec={summary.admissions_recommendation} />
      <HeadlineKpis headline={summary.headline} />
      <WhatIfPanel
        meta={meta}
        baseline={summary.headline}
        topCapacity={summary.top_bottlenecks.capacity}
        baselineSeatsPerStud={
          summary.admissions_recommendation?.criteria?.find(
            (c) => c.name === "seats_denied_per_stud"
          )?.observed ?? null
        }
      />
    </main>
  );
}
