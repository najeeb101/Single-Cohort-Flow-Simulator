"use client";

import { useEffect, useState } from "react";
import type { CourseRecord, MetaResponse } from "@/types/simulation";
import { ApiError, listCurriculum, updateConfig } from "@/lib/api";
import InitialStateEditor from "@/components/scenario-builder/InitialStateEditor";

interface Props {
  meta: MetaResponse;
  onComplete: () => Promise<void>;
}

const STANDING_DEFAULTS = { Year2: 0, Year3: 0, Year4: 0 };

export default function InitialStateGate({ meta, onComplete }: Props) {
  const [courses, setCourses] = useState<CourseRecord[] | null>(null);
  const [occupancy, setOccupancy] = useState<Record<string, number>>({ ...(meta.initial_state?.occupancy ?? {}) });
  const [standing, setStanding] = useState<Record<string, number>>({
    ...STANDING_DEFAULTS,
    ...(meta.initial_state?.standing ?? {}),
  });
  const [saving, setSaving] = useState(false);
  const [skipping, setSkipping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busy = saving || skipping;

  useEffect(() => {
    listCurriculum().then(setCourses).catch(() => setCourses([]));
  }, []);

  const persistAndContinue = async (
    state: { occupancy: Record<string, number>; standing: Record<string, number> },
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

  const handleContinue = () => persistAndContinue({ occupancy, standing }, setSaving);
  // Escape hatch: a department without the numbers yet can start empty and fill them in later
  // from Settings. Persists a blank state so the run has a clean, zeroed warm start.
  const handleSkip = () => persistAndContinue({ occupancy: {}, standing: {} }, setSkipping);

  return (
    <main className="mx-auto w-full max-w-[1600px] px-7 pb-16">
      <div className="border-b border-border py-10">
        <div className="mx-auto flex max-w-2xl flex-col items-center text-center">
          <div className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-maroon text-[18px] font-extrabold text-white">
            QU
          </div>
          <h1 className="mt-3 text-[28px] font-extrabold tracking-tight text-ink">
            Set up today&apos;s department state
          </h1>
          <p className="mt-1 text-[14px] leading-relaxed text-muted">
            Before the first simulation runs, enter the university this new cohort actually walks
            into: seats already taken in each course, and how many students are already at each
            year-standing. If the department is genuinely starting from zero, leave everything as
            0 and continue.
          </p>
        </div>
      </div>

      <div className="py-6">
        {courses === null ? (
          <p className="text-[12.5px] text-muted">Loading courses…</p>
        ) : (
          <InitialStateEditor
            courses={courses}
            occupancy={occupancy}
            standing={standing}
            onOccupancyChange={(code, v) => setOccupancy((prev) => ({ ...prev, [code]: v }))}
            onOccupancyBulkChange={(patch) => setOccupancy((prev) => ({ ...prev, ...patch }))}
            onStandingChange={(node, v) => setStanding((prev) => ({ ...prev, [node]: v }))}
            onStandingBulkChange={(patch) => setStanding((prev) => ({ ...prev, ...patch }))}
          />
        )}
      </div>

      <div className="flex flex-col items-center gap-2 border-t border-border pt-6 text-center">
        <button
          type="button"
          onClick={handleContinue}
          disabled={busy || courses === null}
          className="rounded-[10px] bg-accent px-7 py-2.5 text-[14px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          {saving ? "Saving…" : "Continue"}
        </button>
        <button
          type="button"
          onClick={handleSkip}
          disabled={busy || courses === null}
          className="text-[12px] text-muted underline underline-offset-2 transition-colors hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"
        >
          {skipping ? "Starting empty…" : "Skip for now — start empty"}
        </button>
        <span className="mt-1 max-w-lg text-[11.5px] leading-relaxed text-muted">
          Change these anytime in <span className="font-medium text-ink/80">Settings</span> ·
          step through it term-by-term in <span className="font-medium text-ink/80">Live</span> ·
          find &amp; fix delays in <span className="font-medium text-ink/80">Bottlenecks</span>.
        </span>
        {error && <span className="text-xs text-bad">{error}</span>}
      </div>
    </main>
  );
}
