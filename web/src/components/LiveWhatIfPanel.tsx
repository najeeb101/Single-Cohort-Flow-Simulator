"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MetaResponse, ScenarioRequest, SimulateResponse } from "@/types/simulation";
import { ApiError, simulate } from "@/lib/api";

const DEBOUNCE_MS = 300;

interface Props {
  meta: MetaResponse;
  topCapacityCourses: string[];
  onResult: (data: SimulateResponse) => void;
}

// Port of frontend/app.js's live what-if panel (§3.2): sliders commit on release (not
// every drag tick), debounce into one request, and a request-id guard discards a stale
// response if a newer one already landed. React's onChange fires like the native `input`
// event for range inputs (every tick), so the actual network trigger is wired to
// onMouseUp/onTouchEnd/onKeyUp instead — the React equivalent of listening for `change`.
export default function LiveWhatIfPanel({ meta, topCapacityCourses, onResult }: Props) {
  const baselineCohortSize = meta.cohort_size || 100;
  const defaultCapacity = useMemo(
    () => Object.fromEntries(topCapacityCourses.map((code) => [code, 1])),
    [topCapacityCourses],
  );

  const [capacity, setCapacity] = useState<Record<string, number>>(defaultCapacity);
  const [cohortSize, setCohortSize] = useState(baselineCohortSize);
  const [status, setStatus] = useState<"idle" | "running" | "updated">("idle");
  const [error, setError] = useState<string | null>(null);

  // Refs mirror the latest state so the debounced fetch always reads current values,
  // not a stale closure from whenever the timer was scheduled. Synced in an effect, not
  // during render — mutating a ref's .current while rendering breaks React's render
  // purity guarantees (flagged by the react-hooks/refs lint rule).
  const capacityRef = useRef(capacity);
  const cohortSizeRef = useRef(cohortSize);
  useEffect(() => {
    capacityRef.current = capacity;
  }, [capacity]);
  useEffect(() => {
    cohortSizeRef.current = cohortSize;
  }, [cohortSize]);

  const requestIdRef = useRef(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const runNow = useCallback(() => {
    const myId = ++requestIdRef.current;
    setStatus("running");
    setError(null);

    const capacity_overrides: Record<string, number> = {};
    for (const [code, v] of Object.entries(capacityRef.current)) {
      if (Math.abs(v - 1) > 1e-9) capacity_overrides[code] = v;
    }
    const body: ScenarioRequest = { capacity_overrides };
    if (cohortSizeRef.current !== baselineCohortSize) body.cohort_size = cohortSizeRef.current;

    simulate(body)
      .then((data) => {
        if (myId !== requestIdRef.current) return; // a newer request already landed
        onResult(data);
        setStatus("updated");
      })
      .catch((e: unknown) => {
        if (myId !== requestIdRef.current) return;
        setStatus("idle");
        setError(e instanceof ApiError ? e.message : "Live update failed");
      });
  }, [baselineCohortSize, onResult]);

  const scheduleRun = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(runNow, DEBOUNCE_MS);
  }, [runNow]);

  const handleReset = useCallback(() => {
    setCapacity(defaultCapacity);
    setCohortSize(baselineCohortSize);
    capacityRef.current = defaultCapacity;
    cohortSizeRef.current = baselineCohortSize;
    runNow();
  }, [defaultCapacity, baselineCohortSize, runNow]);

  const disabled = status === "running";
  const minCohort = Math.round(baselineCohortSize * 0.5);
  const maxCohort = Math.round(baselineCohortSize * 1.5);

  return (
    <div className="mt-3.5 rounded-2xl border border-border bg-surface">
      <div className="flex items-baseline justify-between gap-3 border-b border-border px-4 py-3">
        <span className="text-[13px] font-semibold">
          Live what-if <span className="text-xs font-normal text-muted">— drag, release, the dashboard re-runs</span>
        </span>
        <span
          data-testid="live-status"
          className={status === "running" ? "text-xs text-accent" : status === "updated" ? "text-xs text-good" : "text-xs text-muted"}
        >
          {status === "running" ? "Running…" : status === "updated" ? "Updated" : "Idle"}
        </span>
      </div>

      <div className="flex flex-wrap gap-4.5 p-4">
        {topCapacityCourses.map((code) => (
          <div key={code} className="flex min-w-[200px] flex-1 flex-col gap-1.5">
            <label className="flex justify-between gap-2 text-xs text-muted">
              <span>{code} sections</span>
              <b className="tabular-nums text-ink">{capacity[code].toFixed(1)}×</b>
            </label>
            <input
              type="range"
              min={0.5}
              max={3.0}
              step={0.1}
              value={capacity[code]}
              disabled={disabled}
              onChange={(e) => setCapacity((prev) => ({ ...prev, [code]: Number(e.target.value) }))}
              onMouseUp={scheduleRun}
              onTouchEnd={scheduleRun}
              onKeyUp={scheduleRun}
              className="accent-[var(--accent)]"
            />
          </div>
        ))}

        <div className="flex min-w-[200px] flex-1 flex-col gap-1.5">
          <label className="flex justify-between gap-2 text-xs text-muted">
            <span>Admit size</span>
            <b className="tabular-nums text-ink">{cohortSize}/yr</b>
          </label>
          <input
            type="range"
            min={minCohort}
            max={maxCohort}
            step={5}
            value={cohortSize}
            disabled={disabled}
            onChange={(e) => setCohortSize(Number(e.target.value))}
            onMouseUp={scheduleRun}
            onTouchEnd={scheduleRun}
            onKeyUp={scheduleRun}
            className="accent-[var(--accent)]"
          />
        </div>
      </div>

      <div className="flex items-center gap-3.5 px-4 pb-4">
        <button
          type="button"
          onClick={handleReset}
          disabled={disabled}
          className="rounded-[9px] border border-border-2 bg-surface-2 px-3.5 py-1.5 text-[13px] font-semibold text-ink disabled:cursor-not-allowed disabled:opacity-50"
        >
          Reset to baseline
        </button>
        {error && <span className="text-[12.5px] text-bad">Live update failed: {error}</span>}
      </div>
    </div>
  );
}
