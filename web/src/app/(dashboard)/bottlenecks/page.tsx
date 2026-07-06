"use client";

import { useSimulation } from "@/lib/SimulationContext";
import BottlenecksPanel from "@/components/BottlenecksPanel";
import CapacityRecommendations from "@/components/CapacityRecommendations";
import AutofillPanel from "@/components/AutofillPanel";
import WhatIfPanel from "@/components/WhatIfPanel";

export default function BottlenecksPage() {
  const { data, meta } = useSimulation();
  const summary = data.flow_timeline.summary;
  const baselineGradRate = summary.headline.graduation_rate;
  const baselineSeatsPerStud =
    summary.admissions_recommendation?.criteria
      ?.find((c) => c.name === "seats_denied_per_stud")?.observed ?? null;

  return (
    <main className="mx-auto w-full max-w-[1600px] px-7 pb-16">
      <header className="border-b border-border py-5">
        <h1 className="text-[19px] font-bold tracking-tight">Bottlenecks</h1>
        <p className="mt-0.5 max-w-2xl text-[12.5px] text-muted">
          The top courses blocking student progress — split by the four block types. Use this to identify which courses need more seats, earlier offerings, or relaxed prerequisites.
        </p>
      </header>
      <BottlenecksPanel bottlenecks={summary.top_bottlenecks} />
      <CapacityRecommendations
        frames={data.flow_timeline.frames}
        meta={meta}
        baselineGradRate={baselineGradRate}
        baselineSeatsPerStud={baselineSeatsPerStud}
      />
      <AutofillPanel />
      <WhatIfPanel
        meta={meta}
        baseline={summary.headline}
        topCapacity={summary.top_bottlenecks.capacity}
        baselineSeatsPerStud={baselineSeatsPerStud}
      />
    </main>
  );
}
