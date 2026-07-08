"use client";

import { useSimulation } from "@/lib/SimulationContext";
import AdvisorPanel from "@/components/AdvisorPanel";

export default function AdvisorPage() {
  const { data } = useSimulation();
  const summary = data.flow_timeline.summary;

  return (
    <main className="mx-auto w-full max-w-[1600px] px-7 pb-16">
      <header className="border-b border-border py-5">
        <h1 className="text-[19px] font-bold tracking-tight">Advisor</h1>
        <p className="mt-0.5 max-w-2xl text-[12.5px] text-muted">
          A plain-language read of this run&apos;s results — headline metrics, health targets, and
          the top bottlenecks, turned into a prioritized list of what to do and what not to do.
        </p>
      </header>
      <AdvisorPanel summary={summary} showHeading={false} />
    </main>
  );
}
