"use client";

import type { CohortInfo } from "@/types/simulation";

interface Props {
  idx: number;
  frameCount: number;
  playing: boolean;
  speed: number;
  cohortSel: string;
  cohorts: CohortInfo[];
  termLabel: string;
  onScrub: (idx: number) => void;
  onTogglePlay: () => void;
  onStep: (delta: number) => void;
  onSpeedChange: (speed: number) => void;
  onCohortChange: (key: string) => void;
}

// Port of the <div class="controls"> toolbar in frontend/index.html + app.js::wireControls().
export default function AnimationControls({
  idx,
  frameCount,
  playing,
  speed,
  cohortSel,
  cohorts,
  termLabel,
  onScrub,
  onTogglePlay,
  onStep,
  onSpeedChange,
  onCohortChange,
}: Props) {
  return (
    <div className="sticky top-0 z-20 mb-3.5 flex flex-wrap items-center gap-3 rounded-xl border border-border bg-[rgba(20,26,36,0.92)] px-3.5 py-3 backdrop-blur">
      <div className="flex gap-1.5">
        <button type="button" onClick={() => onStep(-1)} className="rounded-[9px] border border-border-2 bg-surface-2 px-3 py-2 text-[13px] font-semibold text-ink" title="Previous semester">
          ⟨
        </button>
        <button type="button" onClick={onTogglePlay} className="min-w-[92px] rounded-[9px] border border-transparent bg-accent px-3.5 py-2 text-[13px] font-semibold text-white">
          {playing ? "⏸ Pause" : "▶ Play"}
        </button>
        <button type="button" onClick={() => onStep(1)} className="rounded-[9px] border border-border-2 bg-surface-2 px-3 py-2 text-[13px] font-semibold text-ink" title="Next semester">
          ⟩
        </button>
      </div>

      <input
        type="range"
        min={0}
        max={Math.max(0, frameCount - 1)}
        value={idx}
        onChange={(e) => onScrub(Number(e.target.value))}
        className="h-1 min-w-[200px] flex-1 accent-[var(--accent)]"
      />

      <span className="min-w-[168px] rounded-[9px] border border-border bg-surface-2 px-2.5 py-1.5 text-center text-sm font-bold">
        {termLabel}
      </span>

      <label className="flex items-center gap-1.5 text-xs text-muted">
        Speed
        <select
          value={speed}
          onChange={(e) => onSpeedChange(Number(e.target.value))}
          className="rounded-lg border border-border-2 bg-surface-2 px-2 py-1.5 text-[12.5px] text-ink"
        >
          <option value={1200}>Slow</option>
          <option value={700}>Normal</option>
          <option value={350}>Fast</option>
        </select>
      </label>

      <label className="flex items-center gap-1.5 text-xs text-muted">
        Stage view
        <select
          value={cohortSel}
          onChange={(e) => onCohortChange(e.target.value)}
          className="rounded-lg border border-border-2 bg-surface-2 px-2 py-1.5 text-[12.5px] text-ink"
        >
          <option value="totals">University total</option>
          {cohorts.map((c) => (
            <option key={c.id} value={String(c.id)}>
              {(c.is_incumbent ? "Incumbent " : "Cohort ") + c.id + ` (enters t=${c.entry_term})`}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
