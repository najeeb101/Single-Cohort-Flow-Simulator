"use client";

import Link from "next/link";
import { useSimulation } from "@/lib/SimulationContext";
import BottlenecksPanel from "@/components/BottlenecksPanel";
import CapacityRecommendations from "@/components/CapacityRecommendations";
import AutofillPanel from "@/components/AutofillPanel";

export default function BottlenecksPage() {
  const { data, meta } = useSimulation();
  const summary = data.flow_timeline.summary;
  const baselineGradRate = summary.headline.graduation_rate;
  const baselineSeatsPerStud =
    summary.admissions_recommendation?.criteria
      ?.find((c) => c.name === "seats_denied_per_stud")?.observed ?? null;

  return (
    <main className="mx-auto w-full max-w-[1600px] px-7 pb-16">
      <header className="border-b border-border py-5">
        <h1 className="text-[19px] font-bold tracking-tight">Bottlenecks</h1>
        <p className="mt-0.5 max-w-2xl text-[12.5px] text-muted">
          The top courses blocking student progress — split by the four block types. Use this to identify which courses need more seats, earlier offerings, or relaxed prerequisites.
        </p>
      </header>
      <BottlenecksPanel bottlenecks={summary.top_bottlenecks} frames={data.flow_timeline.frames} />
      <CapacityRecommendations
        frames={data.flow_timeline.frames}
        meta={meta}
        baselineGradRate={baselineGradRate}
        baselineSeatsPerStud={baselineSeatsPerStud}
      />
      <AutofillPanel />
      <p className="mt-6 rounded-2xl border border-dashed border-border-2 bg-surface p-4 text-[12.5px] text-muted">
        Want to try a specific change and see its effect first? Head to the{" "}
        <Link href="/advisor" className="font-semibold text-accent">Advisor</Link> — ask it something like
        &ldquo;what if I add 50 seats to CMPS323?&rdquo; and it will predict the impact, then let you apply it.
      </p>
    </main>
  );
}
