"use client";

import { useEffect, useState } from "react";
import type { CourseRecord, MetaResponse } from "@/types/simulation";
import { ApiError, listCurriculum, updateConfig } from "@/lib/api";
import InitialStateEditor from "@/components/scenario-builder/InitialStateEditor";

interface Props {
  meta: MetaResponse;
  onComplete: () => Promise<void>;
}

export default function InitialStateGate({ meta, onComplete }: Props) {
  const [courses, setCourses] = useState<CourseRecord[] | null>(null);
  const [occupancy, setOccupancy] = useState<Record<string, number>>({ ...(meta.initial_state?.occupancy ?? {}) });
  const [saving, setSaving] = useState(false);
  const [skipping, setSkipping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busy = saving || skipping;

  useEffect(() => {
    listCurriculum().then(setCourses).catch(() => setCourses([]));
  }, []);

  const persistAndContinue = async (
    state: { occupancy: Record<string, number> },
    setBusy: (v: boolean) => void,
  ) => {
    setBusy(true);
    setError(null);
    try {
      await updateConfig({ initial_state: state });
      await onComplete();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not save the initial state");
      setBusy(false);
    }
  };

  const handleContinue = () => persistAndContinue({ occupancy }, setSaving);
  // Escape hatch: a department without the numbers yet can start empty and fill them in later
  // from Settings. Persists a blank state so the run has a clean, zeroed warm start.
  const handleSkip = () => persistAndContinue({ occupancy: {} }, setSkipping);

  return (
    <main className="mx-auto w-full max-w-[1600px] px-5 pb-10 sm:px-7">
      <div className="border-b border-border py-4">
        <div className="mx-auto flex max-w-3xl flex-col items-center gap-3 text-center sm:flex-row sm:items-center sm:gap-5 sm:text-left">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/qu-logo.png"
            alt="Qatar University"
            className="qu-mark h-16 w-auto shrink-0 object-contain sm:h-20"
          />
          <div className="max-w-2xl">
            <h1 className="text-[24px] font-extrabold leading-tight tracking-tight text-ink sm:text-[28px]">
              Set up today&apos;s department state
            </h1>
            <p className="mt-1.5 text-[13px] leading-5 text-muted sm:text-[14px]">
              Before the first simulation runs, enter the university this new cohort actually walks
              into: how many seats are already taken in each course by students who aren&apos;t part
              of this simulation. If the department is genuinely starting from zero, leave
              everything as 0 and continue.
            </p>
          </div>
        </div>
      </div>

      <div className="py-4">
        {courses === null ? (
          <p className="text-sm text-muted">Loading courses…</p>
        ) : (
          <InitialStateEditor
            courses={courses}
            occupancy={occupancy}
            onOccupancyChange={(code, v) => setOccupancy((prev) => ({ ...prev, [code]: v }))}
            onOccupancyBulkChange={(patch) => setOccupancy((prev) => ({ ...prev, ...patch }))}
          />
        )}
      </div>

      <div className="flex flex-col items-center gap-2 border-t border-border pt-6 text-center">
        <button
          type="button"
          onClick={handleContinue}
          disabled={busy || courses === null}
          className="rounded-xl bg-accent px-7 py-2.5 text-[14px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          {saving ? "Saving…" : "Continue"}
        </button>
        <button
          type="button"
          onClick={handleSkip}
          disabled={busy || courses === null}
          className="text-sm text-muted underline underline-offset-2 transition-colors hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"
        >
          {skipping ? "Starting empty…" : "Skip for now — start empty"}
        </button>
        <span className="mt-1 max-w-lg text-xs leading-relaxed text-muted">
          Change these anytime in <span className="font-medium text-ink/80">Settings</span> ·
          step through it term-by-term on the <span className="font-medium text-ink/80">Dashboard</span> ·
          find &amp; fix delays in <span className="font-medium text-ink/80">Bottlenecks</span>.
        </span>
        {error && <span className="text-xs text-bad">{error}</span>}
      </div>
    </main>
  );
}
