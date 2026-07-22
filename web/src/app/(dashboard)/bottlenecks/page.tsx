"use client";

import Link from "next/link";
import { useSimulation } from "@/lib/SimulationContext";
import { useCheckpoint } from "@/lib/CheckpointContext";
import BottlenecksPanel from "@/components/BottlenecksPanel";
import CapacityRecommendations from "@/components/CapacityRecommendations";
import AutofillPanel from "@/components/AutofillPanel";

export default function BottlenecksPage() {
  const { data, meta } = useSimulation();
  const { session } = useCheckpoint();

  // Prefer the in-progress checkpoint session's own (partial, live) data over the invisible
  // full-horizon baseline run whenever a walkthrough is active — this page should reflect the
  // decisions being made on the Dashboard, not a frozen snapshot from before they were made.
  // Falls back to the baseline the moment there's no active session (not yet started, or
  // discarded), so the page always has something to show.
  const summary = session ? session.flow_timeline.summary : data.flow_timeline.summary;
  const frames = session ? session.frames : data.flow_timeline.frames;
  const capacityMeta = session
    ? { graph: session.meta.graph, mandatory_terms: meta.mandatory_terms }
    : meta;
  const termsRun = session?.frames.length ?? 0;

  return (
    <main className="mx-auto w-full max-w-[1600px] px-7 pb-16">
      <header className="border-b border-border py-5">
        <h1 className="text-[19px] font-bold tracking-tight">Bottlenecks</h1>
        <p className="mt-0.5 max-w-2xl text-sm text-muted">
          The top courses blocking student progress — split by block type. Use this to identify which courses need more seats or earlier offerings.
        </p>
      </header>
      {session && (
        <p className="mt-4 rounded-xl border border-border-2 bg-surface-2 px-4 py-2.5 text-xs text-muted">
          Reflecting your in-progress checkpoint walkthrough — {termsRun} term{termsRun === 1 ? "" : "s"} run
          so far, not the full horizon. Treat this as early signal; it updates as you advance on the{" "}
          <Link href="/" className="font-semibold text-accent hover:underline">Dashboard</Link>.
        </p>
      )}
      <BottlenecksPanel bottlenecks={summary.top_bottlenecks} frames={frames} />
      <CapacityRecommendations frames={frames} meta={capacityMeta}>
        <AutofillPanel />
      </CapacityRecommendations>
    </main>
  );
}
