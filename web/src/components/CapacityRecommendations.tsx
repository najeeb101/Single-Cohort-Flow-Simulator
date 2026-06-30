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
  // Per-course totals across mandatory (Fall/Spring) terms only — optional term capacity
  // is a separate, smaller model and shouldn't inflate these numbers.
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

export default function CapacityRecommendations({ frames, meta }: { frames: Frame[]; meta: MetaResponse }) {
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
        Courses ranked by total seat denials across the run. The{" "}
        <span className="font-semibold text-ink">+1 section relief</span> column estimates how many of those
        denials would be absorbed by opening one extra section ({meta.seats_per_section} seats) every mandatory
        term. Go to{" "}
        <Link href="/settings" className="font-semibold text-accent">
          Settings → Baseline configuration → Admissions
        </Link>{" "}
        to adjust sections.
      </p>

      <div className="overflow-auto rounded-2xl border border-border bg-surface">
        <table className="w-full border-collapse text-[12.5px]">
          <thead>
            <tr>
              {[
                "Course",
                "Current sections",
                "Seats / term",
                "Total denied",
                "Oversubscribed terms",
                "+1 section relief",
                "Terms fully resolved",
                "Still over after +1",
              ].map((h) => (
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
              // Green if +1 section resolves ≥80% of denials, amber if 40–80%, red if <40%
              const reliefColor =
                r.pctRelief >= 0.8 ? "text-good" : r.pctRelief >= 0.4 ? "text-warn" : "text-bad";

              return (
                <tr key={r.code} className="border-b border-border last:border-0">
                  <td className="whitespace-nowrap px-3 py-2 font-semibold">{r.code}</td>
                  <td className="whitespace-nowrap px-3 py-2 tabular-nums">{r.currentSections}</td>
                  <td className="whitespace-nowrap px-3 py-2 tabular-nums text-muted">{r.seatsPerTerm}</td>
                  <td className="whitespace-nowrap px-3 py-2 tabular-nums font-semibold text-bad">
                    {r.totalDenied.toLocaleString()}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 tabular-nums text-muted">
                    {r.oversubscribedTerms}
                  </td>
                  <td className={`whitespace-nowrap px-3 py-2 tabular-nums font-semibold ${reliefColor}`}>
                    ~{r.totalRelief.toLocaleString()} ({Math.round(r.pctRelief * 100)}%)
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 tabular-nums">
                    {r.termsFullyResolved > 0 ? (
                      <span className="text-good">{r.termsFullyResolved} term{r.termsFullyResolved !== 1 ? "s" : ""}</span>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 tabular-nums">
                    {r.termsImproved > 0 ? (
                      <span className="text-warn">{r.termsImproved} term{r.termsImproved !== 1 ? "s" : ""} still over</span>
                    ) : (
                      <span className="text-good">fully resolved</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="mt-2 text-[11px] text-muted">
        Relief estimate assumes one additional section of {meta.seats_per_section} seats runs every
        mandatory term. Actual impact depends on whether the freed students were already eligible and
        whether downstream courses have capacity for them.
      </p>
    </section>
  );
}
