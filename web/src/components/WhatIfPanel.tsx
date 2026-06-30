"use client";

import { useState } from "react";
import { simulate } from "@/lib/api";
import { pct } from "@/lib/format";
import type { Headline, MetaResponse, TopBottlenecks } from "@/types/simulation";

interface WhatIfResult {
  metrics: Headline;
  seatsPerStud: number | null;
}

function Delta({ after, before, isPct = false, lowerIsBetter = false }: {
  after: number; before: number; isPct?: boolean; lowerIsBetter?: boolean;
}) {
  const d = after - before;
  if (Math.abs(d) < 1e-6) return <span className="text-muted">—</span>;
  const improved = lowerIsBetter ? d < 0 : d > 0;
  const sign = d > 0 ? "+" : "";
  const text = isPct ? `${sign}${(d * 100).toFixed(1)}pp` : `${sign}${d.toFixed(2)}`;
  return <span className={improved ? "font-semibold text-good" : "font-semibold text-bad"}>{text}</span>;
}

export default function WhatIfPanel({
  meta,
  baseline,
  topCapacity,
  baselineSeatsPerStud,
}: {
  meta: MetaResponse;
  baseline: Headline;
  topCapacity: TopBottlenecks["capacity"];
  baselineSeatsPerStud: number | null;
}) {
  const [open, setOpen] = useState(false);
  const [cohortSize, setCohortSize] = useState(meta.cohort_size);
  // Courses being tested: map of code → extra sections to add
  const [courseSections, setCourseSections] = useState<Record<string, number>>(
    () => Object.fromEntries(topCapacity.slice(0, 3).map(([code]) => [code, 0]))
  );
  const [search, setSearch] = useState("");
  const [result, setResult] = useState<WhatIfResult | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const allCodes = Object.keys(meta.course_sections).sort();
  const searchResults = search.trim()
    ? allCodes.filter(
        (c) => c.toLowerCase().includes(search.toLowerCase()) && !(c in courseSections)
      ).slice(0, 6)
    : [];

  const addCourse = (code: string) => {
    setCourseSections((prev) => ({ ...prev, [code]: 0 }));
    setSearch("");
  };

  const removeCourse = (code: string) => {
    setCourseSections((prev) => { const n = { ...prev }; delete n[code]; return n; });
  };

  const hasChanges =
    cohortSize !== meta.cohort_size ||
    Object.values(courseSections).some((v) => v > 0);

  const run = async () => {
    setRunning(true);
    setError(null);
    try {
      const overrides: Record<string, number> = {};
      for (const [code, extra] of Object.entries(courseSections)) {
        if (extra > 0) overrides[code] = (meta.course_sections[code] ?? 1) + extra;
      }
      const res = await simulate({
        ...(cohortSize !== meta.cohort_size ? { cohort_size: cohortSize } : {}),
        ...(Object.keys(overrides).length ? { course_sections_overrides: overrides } : {}),
      });
      const seatsPerStud =
        res.admissions_recommendation?.criteria?.find(
          (c) => c.name === "seats_denied_per_stud"
        )?.observed ?? null;
      setResult({ metrics: res.metrics, seatsPerStud });
    } catch {
      setError("Simulation failed — is the API running?");
    } finally {
      setRunning(false);
    }
  };

  const reset = () => {
    setCohortSize(meta.cohort_size);
    setCourseSections(Object.fromEntries(topCapacity.slice(0, 3).map(([code]) => [code, 0])));
    setResult(null);
    setError(null);
    setSearch("");
  };

  return (
    <section className="py-6">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 text-[15px] font-bold"
      >
        <span className="text-xs font-normal text-accent">{open ? "▾" : "▸"}</span>
        Try a what-if
        <span className="text-xs font-normal text-muted">— test changes without saving</span>
      </button>

      {open && (
        <div className="mt-4 flex flex-col gap-5">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-[200px_1fr]">
            {/* Cohort size */}
            <div className="rounded-2xl border border-border bg-surface p-4">
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted">
                Cohort size / year
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={10}
                  max={500}
                  step={5}
                  value={cohortSize}
                  onChange={(e) => { setCohortSize(Number(e.target.value)); setResult(null); }}
                  className="w-24 rounded-[7px] border border-border-2 bg-surface-2 px-2.5 py-1.5 text-[13px] text-ink focus:outline-none focus:ring-1 focus:ring-accent"
                />
                {cohortSize !== meta.cohort_size && (
                  <span className={`text-[11.5px] font-semibold ${cohortSize > meta.cohort_size ? "text-warn" : "text-good"}`}>
                    {cohortSize > meta.cohort_size ? "▲" : "▼"} was {meta.cohort_size}
                  </span>
                )}
              </div>
            </div>

            {/* Sections panel */}
            <div className="rounded-2xl border border-border bg-surface p-4">
              <div className="mb-3 flex items-center justify-between gap-2">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">
                  Extra sections per course
                </div>
                {/* Search to add a course */}
                <div className="relative">
                  <input
                    type="text"
                    placeholder="Add a course…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="w-36 rounded-[7px] border border-border-2 bg-surface-2 px-2.5 py-1 text-[12px] text-ink placeholder:text-faint focus:outline-none focus:ring-1 focus:ring-accent"
                  />
                  {searchResults.length > 0 && (
                    <div className="absolute right-0 top-full z-10 mt-1 w-44 rounded-[9px] border border-border-2 bg-surface py-1 shadow-lg">
                      {searchResults.map((code) => (
                        <button
                          key={code}
                          type="button"
                          onClick={() => addCourse(code)}
                          className="w-full px-3 py-1.5 text-left text-[12.5px] hover:bg-surface-2"
                        >
                          {code}
                          <span className="ml-2 text-[11px] text-muted">
                            {meta.course_sections[code] ?? "?"} sec
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                {Object.keys(courseSections).map((code) => {
                  const cur = meta.course_sections[code] ?? 1;
                  const extra = courseSections[code] ?? 0;
                  return (
                    <div key={code} className="flex items-center gap-1.5 rounded-[9px] border border-border bg-surface-2 px-2.5 py-1.5">
                      <span className="text-[12px] font-semibold text-ink">{code}</span>
                      <span className="text-[11px] text-muted">{cur}</span>
                      <span className="text-[11px] text-muted">+</span>
                      <input
                        type="number"
                        min={0}
                        max={10}
                        step={1}
                        value={extra}
                        onChange={(e) => {
                          setCourseSections((prev) => ({ ...prev, [code]: Math.max(0, Number(e.target.value)) }));
                          setResult(null);
                        }}
                        className="w-10 rounded-[5px] border border-border-2 bg-surface px-1.5 py-0.5 text-center text-[12px] text-ink focus:outline-none focus:ring-1 focus:ring-accent"
                      />
                      {extra > 0 && (
                        <span className="text-[10.5px] font-semibold text-good">
                          →{(cur + extra) * meta.seats_per_section}
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={() => { removeCourse(code); setResult(null); }}
                        className="ml-0.5 text-[11px] text-muted hover:text-bad"
                        title="Remove"
                      >
                        ×
                      </button>
                    </div>
                  );
                })}
                {Object.keys(courseSections).length === 0 && (
                  <span className="text-[12px] text-muted">Search above to add a course</span>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={run}
              disabled={running || !hasChanges}
              className="rounded-[10px] bg-accent px-5 py-2 text-[13px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              {running ? "Running…" : "▶ Run what-if"}
            </button>
            {(result !== null || hasChanges) && (
              <button type="button" onClick={reset} className="text-[12.5px] font-semibold text-muted hover:text-ink">
                Reset
              </button>
            )}
            {error && <span className="text-[12.5px] text-bad">{error}</span>}
          </div>

          {result && (
            <div className="overflow-auto rounded-2xl border border-border bg-surface">
              <table className="w-full border-collapse text-[12.5px]">
                <thead>
                  <tr>
                    {["Metric", "Baseline", "What-if", "Change"].map((h) => (
                      <th key={h} className="border-b border-border px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-muted">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[
                    { label: "Graduation rate", base: pct(baseline.graduation_rate), after: pct(result.metrics.graduation_rate), delta: <Delta after={result.metrics.graduation_rate} before={baseline.graduation_rate} isPct /> },
                    { label: "On-time (≤8 sem)", base: pct(baseline.on_time_rate), after: pct(result.metrics.on_time_rate), delta: <Delta after={result.metrics.on_time_rate} before={baseline.on_time_rate} isPct /> },
                    { label: "Avg time to degree", base: `${baseline.avg_graduation_time.toFixed(1)} sem`, after: `${result.metrics.avg_graduation_time.toFixed(1)} sem`, delta: <Delta after={result.metrics.avg_graduation_time} before={baseline.avg_graduation_time} lowerIsBetter /> },
                    { label: "Academic dropout", base: pct(baseline.academic_dropout_rate), after: pct(result.metrics.academic_dropout_rate), delta: <Delta after={result.metrics.academic_dropout_rate} before={baseline.academic_dropout_rate} isPct lowerIsBetter /> },
                    ...(baselineSeatsPerStud !== null && result.seatsPerStud !== null
                      ? [{ label: "Seats denied / student", base: baselineSeatsPerStud.toFixed(2), after: result.seatsPerStud.toFixed(2), delta: <Delta after={result.seatsPerStud} before={baselineSeatsPerStud} lowerIsBetter /> }]
                      : []),
                  ].map((row) => (
                    <tr key={row.label} className="border-b border-border last:border-0">
                      <td className="px-4 py-2.5 text-muted">{row.label}</td>
                      <td className="px-4 py-2.5 tabular-nums">{row.base}</td>
                      <td className="px-4 py-2.5 tabular-nums font-semibold">{row.after}</td>
                      <td className="px-4 py-2.5">{row.delta}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="px-4 py-2.5 text-[11px] text-muted">
                What-if only — not saved. Go to Settings to make any change permanent.
              </p>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
