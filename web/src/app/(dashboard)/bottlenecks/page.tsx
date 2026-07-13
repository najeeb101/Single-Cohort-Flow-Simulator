"use client";

import { useSimulation } from "@/lib/SimulationContext";
import BottlenecksPanel from "@/components/BottlenecksPanel";
import CapacityRecommendations from "@/components/CapacityRecommendations";
import AutofillPanel from "@/components/AutofillPanel";

export default function BottlenecksPage() {
  const { data, meta } = useSimulation();
  const summary = data.flow_timeline.summary;

  return (
    <main className="mx-auto w-full max-w-[1600px] px-7 pb-16">
      <header className="border-b border-border py-5">
        <h1 className="text-[19px] font-bold tracking-tight">Bottlenecks</h1>
        <p className="mt-0.5 max-w-2xl text-sm text-muted">
          The top courses blocking student progress — split by block type. Use this to identify which courses need more seats or earlier offerings.
        </p>
      </header>
      <BottlenecksPanel bottlenecks={summary.top_bottlenecks} frames={data.flow_timeline.frames} />
      <CapacityRecommendations frames={data.flow_timeline.frames} meta={meta}>
        <AutofillPanel />
      </CapacityRecommendations>
    </main>
  );
}
