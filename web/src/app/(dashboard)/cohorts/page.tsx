"use client";

import { useSimulation } from "@/lib/SimulationContext";
import CohortsTable from "@/components/CohortsTable";

export default function CohortsPage() {
  const { data } = useSimulation();

  return (
    <main className="mx-auto w-full max-w-[1600px] px-7 pb-16">
      <header className="border-b border-border py-5">
        <h1 className="text-[19px] font-bold tracking-tight">Cohorts</h1>
        <p className="mt-0.5 max-w-2xl text-[12.5px] text-muted">
          Graduation and delay outcomes broken down by entry cohort, with the specific courses that blocked each group the most.
        </p>
      </header>
      <CohortsTable cohorts={data.flow_timeline.summary.per_cohort} />
    </main>
  );
}
