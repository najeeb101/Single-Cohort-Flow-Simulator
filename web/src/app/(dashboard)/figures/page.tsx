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
      <section className="py-6">
        <h2 className="mb-4 text-[15px] font-bold">Figures <span className="text-xs font-normal text-muted">— whole run</span></h2>
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
