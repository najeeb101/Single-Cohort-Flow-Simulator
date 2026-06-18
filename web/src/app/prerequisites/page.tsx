"use client";

import { useSimulation } from "@/lib/SimulationContext";
import PrerequisiteNetwork from "@/components/PrerequisiteNetwork";

export default function PrerequisitesPage() {
  const { data, chartMeta } = useSimulation();

  return (
    <main className="mx-auto max-w-6xl px-7 pb-16">
      <section className="py-6">
        <PrerequisiteNetwork graph={chartMeta.graph} frames={data.flow_timeline.frames} />
      </section>
    </main>
  );
}
