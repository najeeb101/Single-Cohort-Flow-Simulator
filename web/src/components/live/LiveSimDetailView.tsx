"use client";

import { useMemo, useState } from "react";
import type { LiveSimDetail, MetaResponse } from "@/types/simulation";
import { advanceLiveSim, deleteLiveSim, ApiError } from "@/lib/api";
import CurriculumGraph from "@/components/CurriculumGraph";
import StageOverview from "@/components/StageOverview";
import LiveEditsPanel, { emptyPending, pendingToEdits } from "@/components/live/LiveEditsPanel";

interface Props {
  meta: MetaResponse;
  detail: LiveSimDetail;
  onChanged: () => Promise<void>;
  onDeleted: () => void;
}

export default function LiveSimDetailView({ meta, detail, onChanged, onDeleted }: Props) {
  const { live_sim: liveSim, meta: simMeta, snapshots } = detail;
  // null = "follow latest" (the default, and what we snap back to whenever the snapshot
  // list grows after Advance or a different live sim is selected) — explicit number = the
  // user dragged the history scrubber to review a past term. Derived during render instead
  // of via a useEffect+setState pair, so there's no extra render-then-correct cascade.
  const [scrubOverride, setScrubOverride] = useState<{ liveSimId: number; snapshotCount: number; index: number } | null>(null);
  const [pending, setPending] = useState(emptyPending());
  const [advancing, setAdvancing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const followsLatest =
    scrubOverride === null || scrubOverride.liveSimId !== liveSim.id || scrubOverride.snapshotCount !== snapshots.length;
  const scrubIndex = followsLatest ? snapshots.length - 1 : scrubOverride!.index;
  const setScrubIndex = (index: number) => setScrubOverride({ liveSimId: liveSim.id, snapshotCount: snapshots.length, index });

  const current = scrubIndex >= 0 ? snapshots[scrubIndex] : null;
  const isLatest = scrubIndex === snapshots.length - 1;
  const finished = liveSim.status === "finished";

  const courses = useMemo(() => current?.frame.courses ?? {}, [current]);

  const handleAdvance = async () => {
    setAdvancing(true);
    setError(null);
    try {
      const edits = pendingToEdits(pending);
      await advanceLiveSim(liveSim.id, Object.keys(edits).length ? edits : undefined);
      setPending(emptyPending());
      await onChanged();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not advance the simulation");
    } finally {
      setAdvancing(false);
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    setError(null);
    try {
      await deleteLiveSim(liveSim.id);
      onDeleted();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not delete this live simulation");
      setDeleting(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-surface px-4 py-3.5">
        <div>
          <h2 className="text-[15px] font-bold text-ink">{liveSim.name}</h2>
          <p className="mt-0.5 text-[12.5px] text-muted">
            {liveSim.current_term === null
              ? "Not started"
              : `Term ${liveSim.current_term} of ${liveSim.total_terms}`}
            {current && <> · viewing {current.label}</>}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span
            className={`rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide ${
              finished ? "bg-surface-2 text-muted" : "bg-good/15 text-good"
            }`}
          >
            {liveSim.status}
          </span>
          <button
            type="button"
            onClick={handleDelete}
            disabled={deleting}
            className="rounded-[9px] border border-border-2 bg-surface-2 px-3 py-1.5 text-[12.5px] font-semibold text-bad disabled:cursor-not-allowed disabled:opacity-50"
          >
            {deleting ? "Deleting…" : "Delete"}
          </button>
        </div>
      </header>

      {error && (
        <div className="rounded-xl border border-[#5a2c2c] bg-[#241516] px-4 py-3 text-[12.5px] text-[#f0c2c2]">
          {error}
        </div>
      )}

      <LiveEditsPanel meta={meta} pending={pending} setPending={setPending} />

      <div className="flex items-center justify-between gap-3 rounded-2xl border border-border bg-surface px-4 py-3">
        <div className="flex-1">
          {snapshots.length === 0 ? (
            <span className="text-[12.5px] text-muted">No terms simulated yet.</span>
          ) : (
            <div className="flex flex-col gap-1.5">
              <input
                type="range"
                min={0}
                max={snapshots.length - 1}
                step={1}
                value={scrubIndex}
                onChange={(e) => setScrubIndex(Number(e.target.value))}
                className="h-1 w-full rounded-full accent-[var(--accent)]"
              />
              <div className="flex items-center justify-between text-[11.5px] text-muted">
                <span>History — {current?.label ?? ""}</span>
                {!isLatest && (
                  <button type="button" onClick={() => setScrubIndex(snapshots.length - 1)} className="font-semibold text-accent">
                    Jump to latest
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={handleAdvance}
          disabled={advancing || finished}
          className="shrink-0 rounded-[10px] bg-accent px-5 py-2 text-[13px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          {advancing ? "Advancing…" : finished ? "Finished" : "▶ Advance to next term"}
        </button>
      </div>

      {!isLatest && (
        <div className="rounded-xl border border-border-2 bg-surface-2 px-4 py-2 text-[12px] text-muted">
          Viewing a past term read-only. Edits above apply on top of the latest term, not this one.
        </div>
      )}

      <section className="grid gap-4 lg:grid-cols-[1fr_360px]">
        <div className="rounded-2xl border border-border bg-surface">
          <div className="flex items-baseline justify-between gap-3 border-b border-border px-4 py-2.5 text-[13px] font-semibold">
            <span>Curriculum status</span>
            <span className="text-xs font-normal text-muted">
              {current ? current.label : "structure only — advance to see live stats"}
            </span>
          </div>
          <CurriculumGraph graph={simMeta.graph} courses={courses} />
        </div>

        <div className="rounded-2xl border border-border bg-surface p-4">
          <div className="mb-1 text-[13px] font-semibold">Stage overview</div>
          {current ? (
            <StageOverview frame={current.frame} stageNodes={simMeta.stage_nodes} cohortSel="totals" />
          ) : (
            <p className="text-[12.5px] text-muted">Advance a term to see stage flow.</p>
          )}
        </div>
      </section>
    </div>
  );
}
