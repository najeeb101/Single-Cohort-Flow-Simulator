"use client";

import Link from "next/link";
import { useSimulation } from "@/lib/SimulationContext";
import AdmissionsRecommendation from "@/components/AdmissionsRecommendation";
import CapacityPlanningPanel from "@/components/CapacityPlanningPanel";

export default function CapacityPlanningPage() {
  const { data } = useSimulation();
  const capacityPlanning = data.flow_timeline.summary.capacity_planning;

  return (
    <main className="mx-auto w-full max-w-[1600px] px-7 pb-16">
      <header className="border-b border-border py-5">
        <h1 className="text-[19px] font-bold tracking-tight">Capacity Planning</h1>
        <p className="mt-0.5 text-[12.5px] text-muted">
          One report for a department head: how many seats and instructors does this run actually need,
          and how many should next year&apos;s class be? Edit the instructor roster in{" "}
          <Link href="/settings" className="text-accent">
            Settings
          </Link>
          .
        </p>
      </header>

      <section className="py-6">
        <CapacityPlanningPanel capacityPlanning={capacityPlanning} />
      </section>

      <AdmissionsRecommendation rec={capacityPlanning.admissions_recommendation} />
    </main>
  );
}
