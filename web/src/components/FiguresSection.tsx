import type { CohortInfo, Frame, Graph, Histogram } from "@/types/simulation";
import UniversityEnrollmentChart from "@/components/UniversityEnrollmentChart";
import CohortFlowChart from "@/components/CohortFlowChart";
import GraduationHistogram from "@/components/GraduationHistogram";
import UtilizationHeatmap from "@/components/UtilizationHeatmap";
import PrerequisiteNetwork from "@/components/PrerequisiteNetwork";

interface Props {
  frames: Frame[];
  cohorts: CohortInfo[];
  graduationTimeDistribution: Histogram;
  graph: Graph;
}

// Ports the static figures from src/visualize.py (outputs/figures/*.png) as React/SVG —
// university_enrollment, cohort_flow, graduation_histogram, utilization_heatmap,
// curriculum_network (as PrerequisiteNetwork, using the layered layout already computed
// for the animated CurriculumGraph rather than re-deriving a spring layout). All are
// derived from `frames`/`graph`/`headline`, already in the /simulate response, so this
// is purely a new view over data the page already has.
export default function FiguresSection({ frames, cohorts, graduationTimeDistribution, graph }: Props) {
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
        <PrerequisiteNetwork graph={graph} frames={frames} />
      </div>
    </section>
  );
}
