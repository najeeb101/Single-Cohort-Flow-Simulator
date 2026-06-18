import type { CohortInfo, Frame, Histogram } from "@/types/simulation";
import UniversityEnrollmentChart from "@/components/UniversityEnrollmentChart";
import CohortFlowChart from "@/components/CohortFlowChart";
import GraduationHistogram from "@/components/GraduationHistogram";
import UtilizationHeatmap from "@/components/UtilizationHeatmap";

interface Props {
  frames: Frame[];
  cohorts: CohortInfo[];
  graduationTimeDistribution: Histogram;
}

// Ports the static figures from src/visualize.py (outputs/figures/*.png) as React/SVG —
// university_enrollment, cohort_flow, graduation_histogram, utilization_heatmap. All
// four are derived from `frames`/`headline`, already in the /simulate response, so this
// is purely a new view over data the page already has. curriculum_network.png is
// deliberately not ported: it's a static fail-count-colored layout of the same
// prerequisite graph the animated CurriculumGraph above already renders interactively.
export default function FiguresSection({ frames, cohorts, graduationTimeDistribution }: Props) {
  return (
    <section className="py-6">
      <h2 className="mb-4 flex items-center gap-2 text-[15px] font-bold">
        <span className="grid h-6 w-6 place-items-center rounded-[7px] border border-border-2 bg-surface-2 text-xs font-bold text-accent">6</span>
        Figures <span className="text-xs font-normal text-muted">— whole run</span>
      </h2>
      <div className="flex flex-col gap-4">
        <UniversityEnrollmentChart frames={frames} />
        <CohortFlowChart frames={frames} cohorts={cohorts} />
        <GraduationHistogram distribution={graduationTimeDistribution} />
        <UtilizationHeatmap frames={frames} />
      </div>
    </section>
  );
}
