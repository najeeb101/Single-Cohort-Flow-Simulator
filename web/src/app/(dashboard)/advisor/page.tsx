"use client";

import { useSimulation } from "@/lib/SimulationContext";
import AdvisorPanel from "@/components/AdvisorPanel";
import AdvisorChat from "@/components/AdvisorChat";

export default function AdvisorPage() {
  const { data, meta } = useSimulation();
  const summary = data.flow_timeline.summary;
  const scenario = data.flow_timeline.meta?.scenario ?? "baseline";
  const frames = data.flow_timeline.frames;

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
      <AdvisorChat summary={summary} scenario={scenario} frames={frames} enabled={!!meta.llm_chat_enabled} />
    </main>
  );
}
