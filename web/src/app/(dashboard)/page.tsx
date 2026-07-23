"use client";

import { useState } from "react";
import { useSimulation } from "@/lib/SimulationContext";
import { useCheckpoint } from "@/lib/CheckpointContext";
import CheckpointEditPanel from "@/components/checkpoint/CheckpointEditPanel";
import CurriculumGraph from "@/components/CurriculumGraph";
import CollapsibleSection from "@/components/CollapsibleSection";
import HeadlineKpis from "@/components/HeadlineKpis";
import AdmissionsRecommendation from "@/components/AdmissionsRecommendation";
import CohortsTable from "@/components/CohortsTable";
import PrerequisiteNetwork from "@/components/PrerequisiteNetwork";
import Modal from "@/components/Modal";
import type { CheckpointState } from "@/types/simulation";

// The Dashboard IS the Semester Checkpoint walkthrough: a turn-based, resumable re-run of the
// active plan, advanced one semester at a time with editable future-facing knobs in between —
// not a one-shot static run. The full-horizon baseline simulation still runs invisibly in the
// background (SimulationProvider, from the layout) so Advisor/Figures/Student Trace keep
// working unchanged; Bottlenecks/Auto-fill/Capacity recommendations instead prefer the
// checkpoint session's own (partial, live) data when one is in progress — see those pages.
// CheckpointProvider itself lives in layout.tsx, not here, so other pages can reach it too.
export default function Home() {
  return <DashboardBody />;
}

function DashboardBody() {
  const { meta } = useSimulation();
  const { session, loading, busy, error, start, advance, rewind, discard } = useCheckpoint();

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
          to identify and test fixes.
        </p>
      </header>

      {error && (
        <div className="mt-4 rounded-xl border border-bad/40 bg-bad/10 px-4 py-3 text-sm text-bad">
          {error}
        </div>
      )}

      {loading ? (
        <p className="mt-10 text-center text-sm text-muted">Checking for an in-progress walkthrough…</p>
      ) : !session ? (
        <StartScreen busy={busy} onStart={start} />
      ) : (
        <SessionView
          session={session}
          busy={busy}
          onAdvance={advance}
          onRewind={rewind}
          onDiscard={discard}
          onTimeTerms={meta.on_time_terms}
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
  onRewind,
  onDiscard,
  onTimeTerms,
}: {
  session: CheckpointState;
  busy: boolean;
  onAdvance: () => Promise<void>;
  onRewind: (seq: number) => Promise<void>;
  onDiscard: () => Promise<void>;
  onTimeTerms: number;
}) {
  const [editOpen, setEditOpen] = useState(false);
  const lastFrame = session.frames[session.frames.length - 1];
  const counts = session.counts_so_far;
  const summary = session.flow_timeline.summary;
  const termsRun = session.frames.length;

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
            onClick={() => setEditOpen(true)}
            disabled={busy}
            className="rounded-xl border border-border-2 bg-surface px-4 py-2 text-sm font-semibold text-ink disabled:cursor-not-allowed disabled:opacity-50"
          >
            Edit term settings
          </button>
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

      <TermHistoryStrip history={session.history} busy={busy} onRewind={onRewind} />

      <section className="rounded-2xl border border-border bg-surface">
        <div className="flex items-baseline justify-between gap-3 border-b border-border px-4 py-2.5 text-sm font-semibold">
          <span>Results so far</span>
          <span className="text-xs font-normal text-muted">
            {termsRun} term{termsRun === 1 ? "" : "s"} run
          </span>
        </div>
        <CurriculumGraph graph={session.meta.graph} courses={lastFrame?.courses ?? {}} />
      </section>

      <p className="rounded-xl border border-border-2 bg-surface-2 px-4 py-2.5 text-xs text-muted">
        The sections below reflect only the {termsRun} term{termsRun === 1 ? "" : "s"} run so far in
        this walkthrough, not the full {session.is_finished ? "" : "eventual "}horizon — treat them as
        early signal, not a final result. They&apos;ll keep updating as you advance.
      </p>

      <CollapsibleSection title="Admissions recommendation" subtitle="heuristic, edit targets in Settings">
        <AdmissionsRecommendation rec={summary.admissions_recommendation} showHeading={false} />
      </CollapsibleSection>

      <CollapsibleSection title="Headline results">
        <HeadlineKpis headline={summary.headline} onTimeTerms={onTimeTerms} showHeading={false} />
      </CollapsibleSection>

      <CollapsibleSection title="Per-cohort outcomes">
        <CohortsTable cohorts={summary.per_cohort} showHeading={false} />
      </CollapsibleSection>

      <CollapsibleSection title="Prerequisites" subtitle="who's waiting on what">
        <p className="mb-4 max-w-3xl text-sm text-muted">
          The prerequisite dependency graph — each arrow means &quot;must pass this before taking that.&quot;
          Courses with many outgoing arrows (high out-degree) are gateways: failing or being blocked on
          them delays every course downstream. Node colour reflects how often students were blocked on
          that course so far.
        </p>
        <PrerequisiteNetwork graph={session.meta.graph} frames={session.frames} />
      </CollapsibleSection>

      <Modal open={editOpen} onClose={() => setEditOpen(false)} title="Edit future terms" size="wide">
        <p className="mb-3 max-w-2xl text-sm text-muted">
          Only capacity, pass rate, occupancy, and next intake are editable here — course
          structure and prerequisites are fixed once a plan is authored. Saved edits take effect
          starting with the next Advance; already-run terms never change.
        </p>
        <CheckpointEditPanel key={session.id} session={session} onSaved={() => setEditOpen(false)} />
      </Modal>
    </div>
  );
}

// Jump back to any earlier point in the walkthrough (POST /checkpoint/rewind). Rendered only
// once there's more than one recorded step (nothing to go back to on term one). The current step
// is always the last entry in `history` — it mirrors the session's own `next_term`/`frames`.
function TermHistoryStrip({
  history,
  busy,
  onRewind,
}: {
  history: CheckpointState["history"];
  busy: boolean;
  onRewind: (seq: number) => Promise<void>;
}) {
  if (history.length <= 1) return null;
  const currentSeq = history[history.length - 1].seq;

  const handleClick = (seq: number, label: string) => {
    if (busy || seq === currentSeq) return;
    const confirmed = window.confirm(
      `Go back to ${label}? Terms simulated after this point will be discarded. Any staged ` +
        "capacity/pass-rate/occupancy/intake edits are kept and will apply again from here. " +
        "This cannot be undone."
    );
    if (confirmed) onRewind(seq);
  };

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-border bg-surface px-4 py-3">
      <span className="text-xs font-semibold text-muted">Term history:</span>
      {history.map((step) => {
        const label = step.seq === 0 ? "Start" : `Term ${step.next_term}`;
        const isCurrent = step.seq === currentSeq;
        return (
          <button
            key={step.seq}
            type="button"
            onClick={() => handleClick(step.seq, label)}
            disabled={busy || isCurrent}
            title={isCurrent ? "Current point in the walkthrough" : `Go back to ${label}`}
            className={
              isCurrent
                ? "rounded-full bg-accent px-3 py-1 text-xs font-semibold text-white disabled:cursor-not-allowed"
                : "rounded-full border border-border-2 bg-surface px-3 py-1 text-xs font-semibold text-ink hover:border-accent disabled:cursor-not-allowed disabled:opacity-50"
            }
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
