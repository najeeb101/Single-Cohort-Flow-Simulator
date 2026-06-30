"use client";

import { useSimulation } from "@/lib/SimulationContext";
import UniversityEnrollmentChart from "@/components/UniversityEnrollmentChart";
import CohortFlowChart from "@/components/CohortFlowChart";
import GraduationHistogram from "@/components/GraduationHistogram";
import UtilizationHeatmap from "@/components/UtilizationHeatmap";

export default function FiguresPage() {
  const { data, chartMeta } = useSimulation();
  const frames = data.flow_timeline.frames;

  return (
    <main className="mx-auto w-full max-w-[1600px] px-7 pb-16">
      <header className="border-b border-border py-5">
        <h1 className="text-[19px] font-bold tracking-tight">Figures</h1>
        <p className="mt-0.5 max-w-2xl text-[12.5px] text-muted">
          Four views across the full simulation run — population trends, per-cohort survival, graduation timing, and where seats ran out.
        </p>
      </header>
      <section className="py-6">
        <div className="flex flex-col gap-4">
          <UniversityEnrollmentChart frames={frames} />
          <CohortFlowChart frames={frames} cohorts={chartMeta.cohorts} />
          <GraduationHistogram distribution={data.flow_timeline.summary.headline.graduation_time_distribution} />
          <UtilizationHeatmap frames={frames} />
        </div>
      </section>
    </main>
  );
}
