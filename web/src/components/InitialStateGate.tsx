"use client";

import { useEffect, useState } from "react";
import type { CourseRecord, DataSource, MetaResponse, PastIntake } from "@/types/simulation";
import { ApiError, listCurriculum, updateConfig } from "@/lib/api";
import InitialStateEditor from "@/components/scenario-builder/InitialStateEditor";
import PastIntakesEditor from "@/components/data/PastIntakesEditor";

interface Props {
  meta: MetaResponse;
  onComplete: () => Promise<void>;
}

// First-run setup: the two inputs that most shape the answer, past intakes (which rebuild today's
// students) and seats used by other programs. Either can stay an estimate; every result says so.
export default function InitialStateGate({ meta, onComplete }: Props) {
  const [courses, setCourses] = useState<CourseRecord[] | null>(null);
  const [intakes, setIntakes] = useState<PastIntake[]>(() => (meta.current_students?.past_intakes ?? []).map((e) => ({ ...e })));
  const [intakeSrc, setIntakeSrc] = useState<DataSource>(meta.data_sources?.past_intakes ?? "estimate");
  const [occupancy, setOccupancy] = useState<Record<string, number>>({ ...(meta.initial_state?.occupancy ?? {}) });
  const [occSrc, setOccSrc] = useState<DataSource>(meta.data_sources?.occupancy ?? "estimate");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listCurriculum().then(setCourses).catch(() => setCourses([]));
  }, []);

  // `keepEstimates` saves nothing: the shipped estimates stay as they are.
  const save = async (keepEstimates: boolean) => {
    setSaving(true);
    setError(null);
    try {
      if (!keepEstimates) {
        await updateConfig({
          current_students: { past_intakes: intakes },
          initial_state: { occupancy },
          data_sources: { ...(meta.data_sources ?? {}), past_intakes: intakeSrc, occupancy: occSrc },
        });
      }
      await onComplete();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not save these numbers");
      setSaving(false);
    }
  };

  return (
    <main className="mx-auto w-full max-w-[1200px] px-5 pb-10 sm:px-7">
      <div className="border-b border-border py-4">
        <div className="mx-auto flex max-w-3xl flex-col items-center gap-3 text-center sm:flex-row sm:items-center sm:gap-5 sm:text-left">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/qu-logo.png" alt="Qatar University" className="qu-mark h-16 w-auto shrink-0 object-contain sm:h-20" />
          <div className="max-w-2xl">
            <h1 className="text-[24px] font-extrabold leading-tight tracking-tight text-ink sm:text-[28px]">
              Tell the planner about today&apos;s department
            </h1>
            <p className="mt-1.5 text-[13px] leading-5 text-muted sm:text-[14px]">
              Two things shape the answer: how many students were admitted in past intakes, and how many seats other
              programs (for example Computer Engineering) use in shared courses. Enter what you know. Anything you are
              unsure of can stay an estimate; it is labelled that way in every result.
            </p>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-6 py-5">
        <PastIntakesEditor
          intakes={intakes}
          onChange={setIntakes}
          source={intakeSrc}
          onSourceChange={setIntakeSrc}
          minYears={meta.intake_analysis?.min_history_years ?? 8}
        />
        {courses === null ? (
          <p className="text-sm text-muted">Loading courses...</p>
        ) : (
          <InitialStateEditor
            courses={courses}
            occupancy={occupancy}
            onOccupancyChange={(code, v) => setOccupancy((prev) => ({ ...prev, [code]: v }))}
            onOccupancyBulkChange={(patch) => setOccupancy((prev) => ({ ...prev, ...patch }))}
            source={occSrc}
            onSourceChange={setOccSrc}
          />
        )}
      </div>

      <div className="flex flex-col items-center gap-2 border-t border-border pt-6 text-center">
        <button
          type="button"
          onClick={() => void save(false)}
          disabled={saving || courses === null}
          className="rounded-xl bg-accent px-7 py-2.5 text-[14px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          {saving ? "Saving..." : "Save and continue"}
        </button>
        <button
          type="button"
          onClick={() => void save(true)}
          disabled={saving || courses === null}
          className="text-sm text-muted underline underline-offset-2 transition-colors hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"
        >
          Skip for now and use the estimates
        </button>
        <span className="mt-1 max-w-lg text-xs leading-relaxed text-muted">
          Change any of this later on the <span className="font-medium text-ink/80">Data</span> page.
        </span>
        {error && <span className="text-xs text-bad">{error}</span>}
      </div>
    </main>
  );
}
