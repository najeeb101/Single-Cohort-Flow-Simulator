"use client";

import { useSimulation } from "@/lib/SimulationContext";
import AnimationSection from "@/components/AnimationSection";
import TopKpis from "@/components/TopKpis";
import AdmissionsRecommendation from "@/components/AdmissionsRecommendation";
import HeadlineKpis from "@/components/HeadlineKpis";
import CohortsTable from "@/components/CohortsTable";
import PrerequisiteNetwork from "@/components/PrerequisiteNetwork";
import CollapsibleSection from "@/components/CollapsibleSection";

export default function Home() {
  const { meta, data, chartMeta } = useSimulation();
  const summary = data.flow_timeline.summary;
  const totalCH = chartMeta.graph.nodes.reduce((s, n) => s + (n.credits || 0), 0);

  return (
    <main className="mx-auto w-full max-w-[1600px] px-7 pb-16">
      <header className="border-b border-border py-5">
        <h1 className="text-[19px] font-bold tracking-tight">Dashboard</h1>
        <p className="mt-0.5 max-w-2xl text-sm text-muted">
          Live roadmap and results for the active plan — see{" "}
          <a href="/about" className="font-semibold text-accent hover:underline">About</a>{" "}
          for an overview of what this tool does, or{" "}
          <a href="/bottlenecks" className="font-semibold text-accent hover:underline">Bottlenecks</a>{" "}
          to identify and test fixes.
        </p>
      </header>

      <TopKpis
        headline={summary.headline}
        onTimeTerms={meta.on_time_terms}
        config={[
          { label: "Cohorts", value: data.flow_timeline.meta.num_cohorts },
          { label: "Cohort size", value: meta.cohort_size },
          { label: "Max semesters", value: data.flow_timeline.meta.max_terms },
          { label: "Courses", value: chartMeta.graph.nodes.length },
          { label: "Credit hours", value: totalCH },
          { label: "Prerequisite links", value: chartMeta.graph.edges.length },
        ]}
      />

      <AnimationSection
        graph={chartMeta.graph}
        stageNodes={chartMeta.stageNodes}
        cohorts={chartMeta.cohorts}
        frames={data.flow_timeline.frames}
        maxTerms={meta.max_terms}
      />

      <CollapsibleSection title="Admissions recommendation" subtitle="heuristic, edit targets in Settings">
        <AdmissionsRecommendation rec={summary.admissions_recommendation} showHeading={false} />
      </CollapsibleSection>

      <CollapsibleSection title="Headline results">
        <HeadlineKpis headline={summary.headline} onTimeTerms={meta.on_time_terms} showHeading={false} />
      </CollapsibleSection>

      <CollapsibleSection title="Per-cohort outcomes">
        <CohortsTable cohorts={summary.per_cohort} showHeading={false} />
      </CollapsibleSection>

      <CollapsibleSection title="Prerequisites" subtitle="who's waiting on what">
        <p className="mb-4 max-w-3xl text-sm text-muted">
          The prerequisite dependency graph — each arrow means &quot;must pass this before taking that.&quot; Courses with many outgoing arrows (high out-degree) are gateways: failing or being blocked on them delays every course downstream. Node colour reflects how often students were blocked on that course across the run.
        </p>
        <PrerequisiteNetwork graph={chartMeta.graph} frames={data.flow_timeline.frames} />
      </CollapsibleSection>
    </main>
  );
}
