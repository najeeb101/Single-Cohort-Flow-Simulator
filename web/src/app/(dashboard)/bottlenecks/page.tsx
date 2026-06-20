"use client";

import { useSimulation } from "@/lib/SimulationContext";
import BottlenecksPanel from "@/components/BottlenecksPanel";

export default function BottlenecksPage() {
  const { data } = useSimulation();

  return (
    <main className="mx-auto max-w-[1600px] px-7 pb-16">
      <BottlenecksPanel bottlenecks={data.flow_timeline.summary.top_bottlenecks} />
    </main>
  );
}
