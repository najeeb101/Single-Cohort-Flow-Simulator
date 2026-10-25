"use client";

import Link from "next/link";
import { useSimulation } from "@/lib/SimulationContext";
import { useCheckpoint } from "@/lib/CheckpointContext";
import BottlenecksPanel from "@/components/BottlenecksPanel";
import CapacityRecommendations from "@/components/CapacityRecommendations";
import SeatPlanner from "@/components/intake/SeatPlanner";
import { Section } from "@/components/ui";

export default function BottlenecksPage() {
  const { data, meta } = useSimulation();
  const { session } = useCheckpoint();

  // Prefer the in-progress checkpoint session's own (partial, live) data over the invisible
  // full-horizon baseline run whenever a walkthrough is active — this page should reflect the
  // decisions being made on the Walkthrough, not a frozen snapshot from before they were made.
  // Falls back to the baseline the moment there's no active session (not yet started, or
  // discarded), so the page always has something to show.
  const summary = session ? session.flow_timeline.summary : data.flow_timeline.summary;
  const frames = session ? session.frames : data.flow_timeline.frames;
  const capacityMeta = session
    ? { graph: session.meta.graph, mandatory_terms: meta.mandatory_terms }
    : meta;
  const termsRun = session?.frames.length ?? 0;

  return (
    <main className="mx-auto w-full max-w-[1280px] px-5 pb-24 sm:px-8">
      <header className="pb-4 pt-8">
        <h1 className="text-[26px] font-semibold leading-tight tracking-[-0.02em] text-ink sm:text-[28px]">Bottlenecks</h1>
        <p className="mt-2 max-w-2xl text-[14px] leading-relaxed text-muted">
          Which courses limit how many students the department can admit: where students are turned away for lack of
          seats, wait for a course that isn&apos;t offered, or fail. The seat planner below works out the sections a
          larger intake would need.
        </p>
      </header>
      {session && (
        <p className="mt-4 rounded-xl border border-border-2 bg-surface-2 px-4 py-2.5 text-xs text-muted">
          Reflecting your in-progress walkthrough: {termsRun} term{termsRun === 1 ? "" : "s"} run so far, not the
          full horizon. Treat this as early signal; it updates as you advance on the{" "}
          <Link href="/walkthrough" className="font-semibold text-accent hover:underline">Walkthrough</Link>.
        </p>
      )}
      <BottlenecksPanel bottlenecks={summary.top_bottlenecks} frames={frames} />
      <CapacityRecommendations frames={frames} meta={capacityMeta} sectionSize={meta.section_size} />
      <Section title="Seat planner" meta={`Whole sections of ${meta.section_size} seats`} className="pb-6">
        <SeatPlanner />
      </Section>
    </main>
  );
}
