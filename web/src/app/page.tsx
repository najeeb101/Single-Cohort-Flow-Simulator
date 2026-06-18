"use client";

import { useCallback, useEffect, useState } from "react";
import { getMeta, simulate } from "@/lib/api";
import type { CohortInfo, Graph, MetaResponse, SimulateResponse } from "@/types/simulation";
import LiveWhatIfPanel from "@/components/LiveWhatIfPanel";
import AnimationSection from "@/components/AnimationSection";
import AdmissionsRecommendation from "@/components/AdmissionsRecommendation";
import HeadlineKpis from "@/components/HeadlineKpis";
import CohortsTable from "@/components/CohortsTable";
import BottlenecksPanel from "@/components/BottlenecksPanel";
import FiguresSection from "@/components/FiguresSection";

type Phase = "loading" | "ready" | "error";

interface ChartMeta {
  graph: Graph;
  stageNodes: string[];
  cohorts: CohortInfo[];
}

export default function Home() {
  const [meta, setMeta] = useState<MetaResponse | null>(null);
  const [data, setData] = useState<SimulateResponse | null>(null);
  // Fixed once from the baseline load, like frontend/app.js::buildLiveControls() /
  // buildGraph() — these must NOT be recomputed from live results: the curriculum graph
  // structure, stage-node order, and cohort roster are scenario-invariant, and
  // AnimationSection's child components key state off them positionally.
  const [topCapacityCourses, setTopCapacityCourses] = useState<string[]>([]);
  const [chartMeta, setChartMeta] = useState<ChartMeta | null>(null);
  const [phase, setPhase] = useState<Phase>("loading");

  useEffect(() => {
    Promise.all([getMeta(), simulate({})])
      .then(([m, d]) => {
        setMeta(m);
        setData(d);
        setTopCapacityCourses(d.flow_timeline.summary.top_bottlenecks.capacity.slice(0, 3).map(([code]) => code));
        setChartMeta({
          graph: d.flow_timeline.meta.graph,
          stageNodes: d.flow_timeline.meta.stage_nodes,
          cohorts: d.flow_timeline.meta.cohorts,
        });
        setPhase("ready");
      })
      .catch(() => setPhase("error"));
  }, []);

  const handleResult = useCallback((d: SimulateResponse) => setData(d), []);

  if (phase === "loading") {
    return (
      <main className="mx-auto max-w-5xl px-7 py-16 text-muted">
        Loading the simulation dashboard…
      </main>
    );
  }

  if (phase === "error" || !meta || !data || !chartMeta) {
    return (
      <main className="mx-auto max-w-xl px-7 py-16">
        <div className="rounded-2xl border border-[#5a2c2c] bg-[#241516] px-6 py-5 text-[#f0c2c2]">
          Could not reach the simulation API. Start it with{" "}
          <code className="rounded bg-black/35 px-1.5 py-0.5">py -m uvicorn src.api:app --port 8001</code>{" "}
          (from the repo root) and reload.
        </div>
      </main>
    );
  }

  const summary = data.flow_timeline.summary;

  return (
    <main className="mx-auto max-w-6xl px-7 pb-16">
      <header className="border-b border-border py-5">
        <div className="flex items-center gap-3.5">
          <div className="grid h-11 w-11 place-items-center rounded-xl bg-maroon text-[17px] font-extrabold text-white">
            QU
          </div>
          <div>
            <h1 className="text-[19px] font-bold tracking-tight">Computer Science — Flow Simulator</h1>
            <p className="mt-0.5 text-[12.5px] text-[#c9a6b2]">
              Multi-cohort, shared-seat university model — dashboard (slice 2, web/)
            </p>
          </div>
        </div>
      </header>

      <section className="py-6">
        <h2 className="mb-4 flex items-center gap-2 text-[15px] font-bold">
          <span className="grid h-6 w-6 place-items-center rounded-[7px] border border-border-2 bg-surface-2 text-xs font-bold text-accent">0</span>
          Inputs <span className="text-xs font-normal text-muted">— this run</span>
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

        <LiveWhatIfPanel meta={meta} topCapacityCourses={topCapacityCourses} onResult={handleResult} />
      </section>

      <AnimationSection
        graph={chartMeta.graph}
        stageNodes={chartMeta.stageNodes}
        cohorts={chartMeta.cohorts}
        frames={data.flow_timeline.frames}
      />

      <AdmissionsRecommendation rec={summary.admissions_recommendation} />
      <HeadlineKpis headline={summary.headline} />
      <CohortsTable cohorts={summary.per_cohort} />
      <BottlenecksPanel bottlenecks={summary.top_bottlenecks} />
      <FiguresSection
        frames={data.flow_timeline.frames}
        cohorts={chartMeta.cohorts}
        graduationTimeDistribution={summary.headline.graduation_time_distribution}
        graph={chartMeta.graph}
      />
    </main>
  );
}
