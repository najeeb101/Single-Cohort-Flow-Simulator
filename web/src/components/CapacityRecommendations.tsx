"use client";

import Link from "next/link";
import { useMemo } from "react";
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

export default function CapacityRecommendations({
  frames,
  meta,
  baselineGradRate: _baselineGradRate,
  baselineSeatsPerStud: _baselineSeatsPerStud,
}: {
  frames: Frame[];
  meta: MetaResponse;
  baselineGradRate: number;
  baselineSeatsPerStud: number | null;
}) {
  const recs = useMemo(() => buildRecommendations(frames, meta), [frames, meta]);

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
        is an estimate from existing frame data. Use the what-if panel below to test the actual impact of
        adding sections. Go to{" "}
        <Link href="/settings" className="font-semibold text-accent">Settings</Link>{" "}
        to make any change permanent.
      </p>

      <div className="overflow-auto rounded-2xl border border-border bg-surface">
        <table className="w-full border-collapse text-[12.5px]">
          <thead>
            <tr>
              {["Course", "Sections", "Seats/term", "Total denied", "+1 relief (est.)"].map((h) => (
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
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
