"use client";

import { useState } from "react";
import { useSimulation } from "@/lib/SimulationContext";
import { useCheckpoint } from "@/lib/CheckpointContext";
import CheckpointEditPanel from "@/components/checkpoint/CheckpointEditPanel";
import CurriculumGraph from "@/components/CurriculumGraph";
import CollapsibleSection from "@/components/CollapsibleSection";
import HeadlineKpis from "@/components/HeadlineKpis";
import KpiStrip from "@/components/KpiStrip";
import AdmissionsRecommendation from "@/components/AdmissionsRecommendation";
import CohortsTable from "@/components/CohortsTable";
import PrerequisiteNetwork from "@/components/PrerequisiteNetwork";
import Modal from "@/components/Modal";
import type { CheckpointState, Headline } from "@/types/simulation";

// The Dashboard IS the Semester Checkpoint walkthrough: a turn-based, resumable re-run of the
// active plan, advanced one semester at a time with editable future-facing knobs in between —
// not a one-shot static run. The full-horizon baseline simulation still runs invisibly in the
// background (SimulationProvider, from the layout) so Advisor/Figures keep working unchanged;
// Bottlenecks/Auto-fill/Capacity recommendations instead prefer the
// checkpoint session's own (partial, live) data when one is in progress — see those pages.
// CheckpointProvider itself lives in layout.tsx, not here, so other pages can reach it too.
export default function Home() {
  return <DashboardBody />;
}

function DashboardBody() {
  const { meta, data } = useSimulation();
  const { session, viewing, loading, busy, error, start, advance, advanceToEnd, rewind, peek, returnToCurrent, discard } =
    useCheckpoint();

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
          viewing={viewing}
          busy={busy}
          onAdvance={advance}
          onAdvanceToEnd={advanceToEnd}
          onRewind={rewind}
          onPeek={peek}
          onReturnToCurrent={returnToCurrent}
          onDiscard={discard}
          onTimeTerms={meta.on_time_terms}
          baselineHeadline={data.flow_timeline.summary.headline}
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
  viewing,
  busy,
  onAdvance,
  onAdvanceToEnd,
  onRewind,
  onPeek,
  onReturnToCurrent,
  onDiscard,
  onTimeTerms,
  baselineHeadline,
}: {
  session: CheckpointState;
  viewing: CheckpointState | null;
  busy: boolean;
  onAdvance: () => Promise<void>;
  onAdvanceToEnd: () => Promise<void>;
  onRewind: (seq: number) => Promise<void>;
  onPeek: (seq: number) => Promise<void>;
  onReturnToCurrent: () => void;
  onDiscard: () => Promise<void>;
  onTimeTerms: number;
  baselineHeadline: Headline;
}) {
  const [editOpen, setEditOpen] = useState(false);
  const isPreviewing = viewing !== null;
  // `display` drives every read-only section below — the live session by default, or the
  // previewed step's own data while the user is just looking. `session` itself stays untouched
  // throughout, since it's what other pages (Bottlenecks, etc.) still read as "the real state."
  const display = viewing ?? session;
  const lastFrame = display.frames[display.frames.length - 1];
  const counts = display.counts_so_far;
  const summary = display.flow_timeline.summary;
  const termsRun = display.frames.length;
  const currentSeq = session.history[session.history.length - 1]?.seq ?? 0;
  const viewingLabel = isPreviewing
    ? session.history.find((h) => h.seq === viewing.viewed_seq)?.label ?? `term ${viewing.viewed_seq}`
    : null;

  const handleDiscard = () => {
    if (!window.confirm("Discard this checkpoint walkthrough? This cannot be undone.")) return;
    onDiscard();
  };

  const handleContinueFromHere = () => {
    if (viewing === null || viewing.viewed_seq === undefined) return;
    const confirmed = window.confirm(
      `Go back to ${viewingLabel}? Terms simulated after this point will be discarded. Any staged ` +
        "capacity/pass-rate/occupancy/intake edits are kept and will apply again from here. " +
        "This cannot be undone."
    );
    if (confirmed) onRewind(viewing.viewed_seq);
  };

  // A previewed term can never be safely edited/advanced in place — those actions always act on
  // the live session, not whatever's being previewed — so close the edit modal at the moment a
  // preview starts, right in the handlers that start one, rather than let it sit open showing
  // stale data next to live-mutating actions.
  const handlePeek = (seq: number) => {
    setEditOpen(false);
    return onPeek(seq);
  };

  const handleReturnToCurrent = () => {
    setEditOpen(false);
    onReturnToCurrent();
  };

  return (
    <div className="mt-5 flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-surface px-4 py-3">
        <div className="flex items-center gap-4 text-sm">
          <span className="font-semibold text-ink">
            {isPreviewing
              ? `Previewing: ${viewingLabel} (read-only)`
              : session.is_finished
              ? "Walkthrough finished"
              : `Next up: ${session.next_term_label ?? `term ${session.next_term}`}`}
          </span>
          <span className="text-muted">
            Active {counts.active} · Delayed {counts.delayed} · Graduated {counts.graduated} · Dropped{" "}
            {counts.dropped} · Censored {counts.censored}
          </span>
        </div>
        <div className="flex gap-2">
          {isPreviewing ? (
            <>
              <button
                type="button"
                onClick={handleReturnToCurrent}
                disabled={busy}
                className="rounded-xl border border-border-2 bg-surface px-4 py-2 text-sm font-semibold text-ink disabled:cursor-not-allowed disabled:opacity-50"
              >
                Return to current
              </button>
              <button
                type="button"
                onClick={handleContinueFromHere}
                disabled={busy}
                className="rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                Continue from here
              </button>
            </>
          ) : (
            <>
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
                onClick={onAdvanceToEnd}
                disabled={busy || session.is_finished}
                title="Run every remaining term to the end of the plan"
                className="rounded-xl border border-border-2 bg-surface px-4 py-2 text-sm font-semibold text-ink disabled:cursor-not-allowed disabled:opacity-50"
              >
                Simulate to end
              </button>
            </>
          )}
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

      {isPreviewing && (
        <p className="rounded-xl border border-accent/40 bg-accent/10 px-4 py-2.5 text-xs text-ink">
          You&apos;re previewing an earlier term — nothing has changed yet. Pick{" "}
          <strong>Continue from here</strong> to actually go back (this discards terms simulated
          after it), or <strong>Return to current</strong> to keep going from where you left off.
        </p>
      )}

      <KpiStrip
        current={summary.headline}
        baseline={baselineHeadline}
        graduatedSoFar={counts.graduated}
      />

      <TermHistoryStrip
        history={session.history}
        currentSeq={currentSeq}
        viewingSeq={viewing?.viewed_seq ?? null}
        busy={busy}
        onPeek={handlePeek}
        onReturnToCurrent={handleReturnToCurrent}
      />

      <section className="rounded-2xl border border-border bg-surface">
        <div className="flex items-baseline justify-between gap-3 border-b border-border px-4 py-2.5 text-sm font-semibold">
          <span>Results so far</span>
          <span className="text-xs font-normal text-muted">
            {termsRun} term{termsRun === 1 ? "" : "s"} run
          </span>
        </div>
        <CurriculumGraph graph={display.meta.graph} courses={lastFrame?.courses ?? {}} />
      </section>

      <p className="rounded-xl border border-border-2 bg-surface-2 px-4 py-2.5 text-xs text-muted">
        The sections below reflect only the {termsRun} term{termsRun === 1 ? "" : "s"} run so far in
        this walkthrough, not the full {display.is_finished ? "" : "eventual "}horizon — treat them as
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
        <PrerequisiteNetwork graph={display.meta.graph} frames={display.frames} />
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

// Look at any earlier point in the walkthrough (GET /checkpoint/peek) — read-only, costs nothing.
// Rendered only once there's more than one recorded step (nothing to go back to on term one).
// `currentSeq` is always the last entry in `history` — it mirrors the live session's own
// `next_term`/`frames`. `viewingSeq` (non-null while a past step is being previewed) is separate
// from `currentSeq`: it's tracked by the parent so both can be highlighted distinctly at once.
// Actually committing to an earlier point (discarding recorded steps after it) only happens via
// the "Continue from here" action in the status bar above, never from clicking a chip directly.
function TermHistoryStrip({
  history,
  currentSeq,
  viewingSeq,
  busy,
  onPeek,
  onReturnToCurrent,
}: {
  history: CheckpointState["history"];
  currentSeq: number;
  viewingSeq: number | null;
  busy: boolean;
  onPeek: (seq: number) => Promise<void>;
  onReturnToCurrent: () => void;
}) {
  if (history.length <= 1) return null;

  const handleClick = (seq: number) => {
    if (busy || seq === viewingSeq) return;
    if (seq === currentSeq) {
      if (viewingSeq !== null) onReturnToCurrent();
      return;
    }
    onPeek(seq);
  };

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-border bg-surface px-4 py-3">
      <span className="text-xs font-semibold text-muted">Term history:</span>
      {history.map((step) => {
        const label = step.label;
        const isCurrent = step.seq === currentSeq;
        const isViewing = step.seq === viewingSeq;
        const disabled = busy || isViewing || (isCurrent && viewingSeq === null);
        const title = isViewing
          ? "Currently previewing this term"
          : isCurrent
          ? "Current point in the walkthrough"
          : `Preview ${label}`;
        return (
          <button
            key={step.seq}
            type="button"
            onClick={() => handleClick(step.seq)}
            disabled={disabled}
            title={title}
            className={
              isViewing
                ? "rounded-full border-2 border-accent bg-surface px-3 py-1 text-xs font-semibold text-accent disabled:cursor-not-allowed"
                : isCurrent
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
