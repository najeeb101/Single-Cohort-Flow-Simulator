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
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listCurriculum().then(setCourses).catch(() => setCourses([]));
  }, []);

  const handleContinue = async () => {
    setSaving(true);
    setError(null);
    try {
      await updateConfig({ initial_state: { occupancy, standing } });
      await onComplete();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not save the initial state");
      setSaving(false);
    }
  };

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

      <div className="flex flex-col items-center gap-1.5 border-t border-border pt-6 text-center">
        <button
          type="button"
          onClick={handleContinue}
          disabled={saving || courses === null}
          className="rounded-[10px] bg-accent px-7 py-2.5 text-[14px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          {saving ? "Saving…" : "Continue"}
        </button>
        <span className="text-[11.5px] text-muted">
          Saves as the starting baseline — you can edit it again any time in Settings.
        </span>
        {error && <span className="text-xs text-bad">{error}</span>}
      </div>
    </main>
  );
}
