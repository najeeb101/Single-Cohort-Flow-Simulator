"use client";

import { useSimulation } from "@/lib/SimulationContext";
import { CheckpointProvider, useCheckpoint } from "@/lib/CheckpointContext";
import CheckpointEditPanel from "@/components/checkpoint/CheckpointEditPanel";
import CurriculumGraph from "@/components/CurriculumGraph";
import type { CheckpointState } from "@/types/simulation";

// The Dashboard IS the Semester Checkpoint walkthrough: a turn-based, resumable re-run of the
// active plan, advanced one semester at a time with editable future-facing knobs in between —
// not a one-shot static run. The full-horizon baseline simulation still runs invisibly in the
// background (SimulationProvider, from the layout) purely so Bottlenecks/Advisor/Auto-fill/
// Figures/Student Trace keep working unchanged; it's just no longer shown as its own page.
export default function Home() {
  return (
    <CheckpointProvider>
      <DashboardBody />
    </CheckpointProvider>
  );
}

function DashboardBody() {
  const { meta } = useSimulation();
  const { session, busy, error, start, advance, discard } = useCheckpoint();

  return (
    <main className="mx-auto w-full max-w-[1600px] px-7 pb-16">
      <header className="border-b border-border py-5">
        <h1 className="text-[19px] font-bold tracking-tight">Dashboard</h1>
        <p className="mt-0.5 max-w-2xl text-sm text-muted">
          Advance the active plan one semester at a time and adjust capacity, pass rates,
          occupancy, and next intake between steps — future decisions only, never the courses
          already run. See{" "}
          <a href="/about" className="font-semibold text-accent hover:underline">About</a>{" "}
          for an overview of what this tool does, or{" "}
          <a href="/bottlenecks" className="font-semibold text-accent hover:underline">Bottlenecks</a>{" "}
          to identify and test fixes on a full-horizon run.
        </p>
      </header>

      {error && (
        <div className="mt-4 rounded-xl border border-bad/40 bg-bad/10 px-4 py-3 text-sm text-bad">
          {error}
        </div>
      )}

      {!session ? (
        <StartScreen busy={busy} onStart={start} />
      ) : (
        <SessionView
          session={session}
          busy={busy}
          onAdvance={advance}
          onDiscard={discard}
          yearStandingThresholds={meta.year_standing_thresholds}
        />
      )}
    </main>
  );
}

function StartScreen({ busy, onStart }: { busy: boolean; onStart: () => Promise<void> }) {
  return (
    <div className="mx-auto mt-10 flex max-w-lg flex-col items-center gap-4 rounded-2xl border border-border bg-surface px-6 py-10 text-center">
      <p className="text-sm text-muted">
        No walkthrough is in progress. Starting one begins simulating the active plan from term
        one, one semester at a time.
      </p>
      <button
        type="button"
        onClick={onStart}
        disabled={busy}
        className="rounded-xl bg-accent px-5 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
      >
        {busy ? "Starting…" : "Start checkpoint walkthrough"}
      </button>
    </div>
  );
}

function SessionView({
  session,
  busy,
  onAdvance,
  onDiscard,
  yearStandingThresholds,
}: {
  session: CheckpointState;
  busy: boolean;
  onAdvance: () => Promise<void>;
  onDiscard: () => Promise<void>;
  yearStandingThresholds?: number[];
}) {
  const lastFrame = session.frames[session.frames.length - 1];
  const counts = session.counts_so_far;

  const handleDiscard = () => {
    if (!window.confirm("Discard this checkpoint walkthrough? This cannot be undone.")) return;
    onDiscard();
  };

  return (
    <div className="mt-5 flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-surface px-4 py-3">
        <div className="flex items-center gap-4 text-sm">
          <span className="font-semibold text-ink">
            {session.is_finished ? "Walkthrough finished" : `Next up: term ${session.next_term}`}
          </span>
          <span className="text-muted">
            Active {counts.active} · Delayed {counts.delayed} · Graduated {counts.graduated} · Dropped{" "}
            {counts.dropped} · Censored {counts.censored}
          </span>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onAdvance}
            disabled={busy || session.is_finished}
            className="rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? "Advancing…" : "Advance one term"}
          </button>
          <button
            type="button"
            onClick={handleDiscard}
            disabled={busy}
            className="rounded-xl border border-border-2 bg-surface px-4 py-2 text-sm font-semibold text-bad disabled:cursor-not-allowed disabled:opacity-50"
          >
            Discard
          </button>
        </div>
      </div>

      <section className="rounded-2xl border border-border bg-surface">
        <div className="flex items-baseline justify-between gap-3 border-b border-border px-4 py-2.5 text-sm font-semibold">
          <span>Results so far</span>
          <span className="text-xs font-normal text-muted">
            {session.frames.length} term{session.frames.length === 1 ? "" : "s"} run
          </span>
        </div>
        <CurriculumGraph graph={session.meta.graph} courses={lastFrame?.courses ?? {}} />
      </section>

      <section>
        <h2 className="mb-1 text-[15px] font-bold">Edit future terms</h2>
        <p className="mb-3 max-w-2xl text-sm text-muted">
          Only capacity, pass rate, occupancy/standing, and next intake are editable here — course
          structure and prerequisites are fixed once a plan is authored. Saved edits take effect
          starting with the next Advance; already-run terms never change.
        </p>
        <CheckpointEditPanel key={session.id} session={session} yearStandingThresholds={yearStandingThresholds} />
      </section>
    </div>
  );
}
