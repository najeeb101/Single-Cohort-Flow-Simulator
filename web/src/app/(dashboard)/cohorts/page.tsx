"use client";

import { useSimulation } from "@/lib/SimulationContext";
import CohortsTable from "@/components/CohortsTable";

export default function CohortsPage() {
  const { data } = useSimulation();

  return (
    <main className="mx-auto w-full max-w-[1600px] px-7 pb-16">
      <CohortsTable cohorts={data.flow_timeline.summary.per_cohort} />
    </main>
  );
}
