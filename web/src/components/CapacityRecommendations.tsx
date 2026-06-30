"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { simulate } from "@/lib/api";
import type { Frame, MetaResponse } from "@/types/simulation";

interface CourseRec {
  code: string;
  currentSections: number;
  seatsPerTerm: number;
  totalDenied: number;
  oversubscribedTerms: number;
  totalRelief: number;
  termsFullyResolved: number;
  termsImproved: number;
  pctRelief: number;
}

interface TestResult {
  gradRate: number;
  baselineGradRate: number;
  seatsPerStud: number | null;
  baselineSeatsPerStud: number | null;
}

function buildRecommendations(frames: Frame[], meta: MetaResponse): CourseRec[] {
  const sps = meta.seats_per_section;
  const denied: Record<string, number[]> = {};

  for (const frame of frames) {
    if (frame.season !== "Fall" && frame.season !== "Spring") continue;
    for (const [code, stat] of Object.entries(frame.courses)) {
      if (!denied[code]) denied[code] = [];
      if (stat.denied > 0) denied[code].push(stat.denied);
    }
  }

  const recs: CourseRec[] = [];
  for (const [code, termDenials] of Object.entries(denied)) {
    if (termDenials.length === 0) continue;
    const totalDenied = termDenials.reduce((s, d) => s + d, 0);
    if (totalDenied === 0) continue;

    const totalRelief = termDenials.reduce((s, d) => s + Math.min(d, sps), 0);
    const termsFullyResolved = termDenials.filter((d) => d <= sps).length;
    const termsImproved = termDenials.filter((d) => d > sps).length;

    recs.push({
      code,
      currentSections: meta.course_sections[code] ?? 1,
      seatsPerTerm: (meta.course_sections[code] ?? 1) * sps,
      totalDenied,
      oversubscribedTerms: termDenials.length,
      totalRelief,
      termsFullyResolved,
      termsImproved,
      pctRelief: totalRelief / totalDenied,
    });
  }

  return recs.sort((a, b) => b.totalDenied - a.totalDenied).slice(0, 8);
}

function delta(after: number, before: number, isPct = false): string {
  const d = after - before;
  const sign = d >= 0 ? "+" : "";
  return isPct
    ? `${sign}${(d * 100).toFixed(1)}pp`
    : `${sign}${d.toFixed(1)}`;
}

export default function CapacityRecommendations({
  frames,
  meta,
  baselineGradRate,
  baselineSeatsPerStud,
}: {
  frames: Frame[];
  meta: MetaResponse;
  baselineGradRate: number;
  baselineSeatsPerStud: number | null;
}) {
  const recs = useMemo(() => buildRecommendations(frames, meta), [frames, meta]);
  const [testing, setTesting] = useState<Record<string, boolean>>({});
  const [results, setResults] = useState<Record<string, TestResult>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  const runTest = async (r: CourseRec) => {
    setTesting((t) => ({ ...t, [r.code]: true }));
    setErrors((e) => ({ ...e, [r.code]: "" }));
    try {
      const res = await simulate({
        course_sections_overrides: { [r.code]: r.currentSections + 1 },
      });
      const seatsPerStud = res.admissions_recommendation?.criteria
        ?.find((c) => c.name === "seats_denied_per_stud")?.observed ?? null;
      setResults((prev) => ({
        ...prev,
        [r.code]: {
          gradRate: res.metrics.graduation_rate,
          baselineGradRate,
          seatsPerStud,
          baselineSeatsPerStud,
        },
      }));
    } catch {
      setErrors((e) => ({ ...e, [r.code]: "Run failed" }));
    } finally {
      setTesting((t) => ({ ...t, [r.code]: false }));
    }
  };

  if (recs.length === 0) {
    return (
      <section className="py-6">
        <h2 className="mb-1 text-[15px] font-bold">Section recommendations</h2>
        <p className="text-[12.5px] text-muted">No seat denials recorded — current capacity is sufficient.</p>
      </section>
    );
  }

  return (
    <section className="py-6">
      <h2 className="mb-1 text-[15px] font-bold">Section recommendations</h2>
      <p className="mb-4 max-w-3xl text-[12.5px] text-muted">
        Courses ranked by total seat denials. <span className="font-semibold text-ink">+1 section relief</span>{" "}
        is an estimate from existing frame data. <span className="font-semibold text-ink">Test +1 section</span>{" "}
        runs a full simulation with one extra section on that course and shows the actual impact on graduation
        rate and seat pressure. Go to{" "}
        <Link href="/settings" className="font-semibold text-accent">Settings</Link>{" "}
        to make the change permanent.
      </p>

      <div className="overflow-auto rounded-2xl border border-border bg-surface">
        <table className="w-full border-collapse text-[12.5px]">
          <thead>
            <tr>
              {["Course", "Sections", "Seats/term", "Total denied", "+1 relief (est.)", "Test +1 section"].map((h) => (
                <th
                  key={h}
                  className="whitespace-nowrap border-b border-border bg-surface px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-muted"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {recs.map((r) => {
              const reliefColor = r.pctRelief >= 0.8 ? "text-good" : r.pctRelief >= 0.4 ? "text-warn" : "text-bad";
              const result = results[r.code];
              const isTesting = testing[r.code];
              const err = errors[r.code];

              return (
                <tr key={r.code} className="border-b border-border last:border-0">
                  <td className="whitespace-nowrap px-3 py-2.5 font-semibold">{r.code}</td>
                  <td className="whitespace-nowrap px-3 py-2.5 tabular-nums">{r.currentSections}</td>
                  <td className="whitespace-nowrap px-3 py-2.5 tabular-nums text-muted">{r.seatsPerTerm}</td>
                  <td className="whitespace-nowrap px-3 py-2.5 tabular-nums font-semibold text-bad">
                    {r.totalDenied.toLocaleString()}
                  </td>
                  <td className={`whitespace-nowrap px-3 py-2.5 tabular-nums font-semibold ${reliefColor}`}>
                    ~{r.totalRelief.toLocaleString()} ({Math.round(r.pctRelief * 100)}%)
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5">
                    {result ? (
                      <div className="flex items-center gap-3">
                        <span className="text-[11.5px]">
                          Grad{" "}
                          <b className={result.gradRate >= baselineGradRate ? "text-good" : "text-bad"}>
                            {delta(result.gradRate, baselineGradRate, true)}
                          </b>
                          {result.seatsPerStud !== null && baselineSeatsPerStud !== null && (
                            <>
                              {" · "}Seats/std{" "}
                              <b className={result.seatsPerStud <= baselineSeatsPerStud ? "text-good" : "text-bad"}>
                                {delta(result.seatsPerStud, baselineSeatsPerStud)}
                              </b>
                            </>
                          )}
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            setResults((prev) => { const n = { ...prev }; delete n[r.code]; return n; });
                          }}
                          className="text-[11px] text-muted hover:text-ink"
                        >
                          clear
                        </button>
                      </div>
                    ) : err ? (
                      <span className="text-[11.5px] text-bad">{err}</span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => runTest(r)}
                        disabled={isTesting}
                        className="rounded-[7px] border border-border-2 bg-surface-2 px-2.5 py-1 text-[11.5px] font-semibold text-ink disabled:cursor-not-allowed disabled:opacity-50 hover:border-accent hover:text-accent"
                      >
                        {isTesting ? "Running…" : "▶ Test +1 section"}
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="mt-2 text-[11px] text-muted">
        Each test is a full simulation run with +1 section on that course only, everything else unchanged.
        Results are not saved — go to Settings to make any change permanent.
      </p>
    </section>
  );
}
