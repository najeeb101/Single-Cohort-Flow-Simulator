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
  const text = isPct
    ? `${sign}${(d * 100).toFixed(1)}pp`
    : `${sign}${d.toFixed(2)}`;
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
  // extra sections to add per course (0 = unchanged)
  const topCodes = topCapacity.slice(0, 3).map(([code]) => code);
  const [extraSections, setExtraSections] = useState<Record<string, number>>(
    Object.fromEntries(topCodes.map((c) => [c, 0]))
  );
  const [result, setResult] = useState<WhatIfResult | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasChanges =
    cohortSize !== meta.cohort_size ||
    topCodes.some((c) => (extraSections[c] ?? 0) > 0);

  const run = async () => {
    setRunning(true);
    setError(null);
    try {
      const overrides: Record<string, number> = {};
      for (const code of topCodes) {
        const extra = extraSections[code] ?? 0;
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
    setExtraSections(Object.fromEntries(topCodes.map((c) => [c, 0])));
    setResult(null);
    setError(null);
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
        <span className="text-xs font-normal text-muted">— test changes without saving them</span>
      </button>

      {open && (
        <div className="mt-4 flex flex-col gap-5">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
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
                  onChange={(e) => setCohortSize(Number(e.target.value))}
                  className="w-24 rounded-[7px] border border-border-2 bg-surface-2 px-2.5 py-1.5 text-[13px] text-ink focus:outline-none focus:ring-1 focus:ring-accent"
                />
                <span className="text-[12px] text-muted">
                  {cohortSize !== meta.cohort_size && (
                    <span className={cohortSize > meta.cohort_size ? "text-warn" : "text-good"}>
                      {cohortSize > meta.cohort_size ? "▲" : "▼"} was {meta.cohort_size}
                    </span>
                  )}
                </span>
              </div>
            </div>

            {/* Top capacity courses */}
            {topCodes.map((code) => (
              <div key={code} className="rounded-2xl border border-border bg-surface p-4">
                <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted">
                  {code} sections
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[13px] text-muted">{meta.course_sections[code] ?? "?"}</span>
                  <span className="text-[11px] text-muted">+</span>
                  <input
                    type="number"
                    min={0}
                    max={10}
                    step={1}
                    value={extraSections[code] ?? 0}
                    onChange={(e) =>
                      setExtraSections((prev) => ({ ...prev, [code]: Math.max(0, Number(e.target.value)) }))
                    }
                    className="w-16 rounded-[7px] border border-border-2 bg-surface-2 px-2.5 py-1.5 text-[13px] text-ink focus:outline-none focus:ring-1 focus:ring-accent"
                  />
                  {(extraSections[code] ?? 0) > 0 && (
                    <span className="text-[11px] text-good">
                      → {((meta.course_sections[code] ?? 1) + (extraSections[code] ?? 0)) * meta.seats_per_section} seats
                    </span>
                  )}
                </div>
              </div>
            ))}
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
            {(result || hasChanges) && (
              <button
                type="button"
                onClick={reset}
                className="text-[12.5px] font-semibold text-muted hover:text-ink"
              >
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
                      <th
                        key={h}
                        className="border-b border-border px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-muted"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[
                    {
                      label: "Graduation rate",
                      base: pct(baseline.graduation_rate),
                      after: pct(result.metrics.graduation_rate),
                      delta: <Delta after={result.metrics.graduation_rate} before={baseline.graduation_rate} isPct />,
                    },
                    {
                      label: "On-time (≤8 sem)",
                      base: pct(baseline.on_time_rate),
                      after: pct(result.metrics.on_time_rate),
                      delta: <Delta after={result.metrics.on_time_rate} before={baseline.on_time_rate} isPct />,
                    },
                    {
                      label: "Avg time to degree",
                      base: `${baseline.avg_graduation_time.toFixed(1)} sem`,
                      after: `${result.metrics.avg_graduation_time.toFixed(1)} sem`,
                      delta: <Delta after={result.metrics.avg_graduation_time} before={baseline.avg_graduation_time} lowerIsBetter />,
                    },
                    {
                      label: "Academic dropout",
                      base: pct(baseline.academic_dropout_rate),
                      after: pct(result.metrics.academic_dropout_rate),
                      delta: <Delta after={result.metrics.academic_dropout_rate} before={baseline.academic_dropout_rate} isPct lowerIsBetter />,
                    },
                    ...(baselineSeatsPerStud !== null && result.seatsPerStud !== null
                      ? [{
                          label: "Seats denied / student",
                          base: baselineSeatsPerStud.toFixed(2),
                          after: result.seatsPerStud.toFixed(2),
                          delta: <Delta after={result.seatsPerStud} before={baselineSeatsPerStud} lowerIsBetter />,
                        }]
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
                What-if run only — not saved. Go to Settings to make any change permanent.
              </p>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
