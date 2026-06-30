"use client";

import { useSimulation } from "@/lib/SimulationContext";
import PrerequisiteNetwork from "@/components/PrerequisiteNetwork";

export default function PrerequisitesPage() {
  const { data, chartMeta } = useSimulation();

  return (
    <main className="mx-auto w-full max-w-[1600px] px-7 pb-16">
      <header className="border-b border-border py-5">
        <h1 className="text-[19px] font-bold tracking-tight">Prerequisites</h1>
        <p className="mt-0.5 max-w-2xl text-[12.5px] text-muted">
          The prerequisite dependency graph — each arrow means "must pass this before taking that." Courses with many outgoing arrows (high out-degree) are gateways: failing or being blocked on them delays every course downstream. Node colour reflects how often students were blocked on that course across the run.
        </p>
      </header>
      <section className="py-6">
        <PrerequisiteNetwork graph={chartMeta.graph} frames={data.flow_timeline.frames} />
      </section>
    </main>
  );
}
