"use client";

import Link from "next/link";
import { useMemo } from "react";
import type { Frame, MetaResponse } from "@/types/simulation";

// Only these two fields are actually read below — narrowed so callers can pass either the
// baseline MetaResponse or a lightweight stand-in built from an in-progress checkpoint session
// (see web/src/app/(dashboard)/bottlenecks/page.tsx).
type CapacityMeta = Pick<MetaResponse, "graph" | "mandatory_terms">;

interface CourseRec {
  code: string;
  currentCapacity: number;
  totalDenied: number;
  oversubscribedTerms: number;
  peakShortfall: number;
  seatsToAdd: number;
  recommendedCapacity: number;
}

function buildRecommendations(frames: Frame[], meta: CapacityMeta, seatStep: number): CourseRec[] {
  const capacityByCode: Record<string, number> = {};
  for (const node of meta.graph.nodes) capacityByCode[node.code] = node.capacity;

  // Only regular (mandatory) terms count toward capacity planning: optional-term (Summer/Winter)
  // seat denials come from a deliberately small bonus pool and don't block graduation. Matches the
  // engine's capacity_block_counts_mandatory ranking, so this table and the "Capacity blocks" card
  // list the same courses.
  const mandatory = new Set(meta.mandatory_terms ?? ["Fall", "Spring"]);
  const denied: Record<string, number[]> = {};

  for (const frame of frames) {
    if (!mandatory.has(frame.season)) continue;
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

    const currentCapacity = capacityByCode[code] ?? 0;
    const peakShortfall = Math.max(...termDenials);
    // Enough seats to clear the worst term, rounded up to the seat step. Seats, not sections:
    // sections vary in size and a course can grow by widening the ones it has.
    const seatsToAdd = Math.ceil(peakShortfall / seatStep) * seatStep;

    recs.push({
      code,
      currentCapacity,
      totalDenied,
      oversubscribedTerms: termDenials.length,
      peakShortfall,
      seatsToAdd,
      recommendedCapacity: currentCapacity + seatsToAdd,
    });
  }

  return recs.sort((a, b) => b.totalDenied - a.totalDenied).slice(0, 8);
}

export default function CapacityRecommendations({
  frames,
  meta,
  seatStep,
}: {
  frames: Frame[];
  meta: CapacityMeta;
  seatStep: number;
}) {
  const recs = useMemo(() => buildRecommendations(frames, meta, seatStep), [frames, meta, seatStep]);

  if (recs.length === 0) {
    return (
      <section className="py-6">
        <div className="rounded-2xl border border-border bg-surface p-5">
          <h2 className="mb-1 text-[15px] font-bold">Capacity recommendations</h2>
          <p className="text-sm text-muted">No seat denials recorded in this run. Current seats are enough at the current intake.</p>
        </div>
      </section>
    );
  }

  return (
    <section className="py-6">
      <div className="rounded-2xl border border-border bg-surface">
        <div className="p-5">
          <h2 className="mb-1 text-[15px] font-bold">Capacity recommendations</h2>
          <p className="max-w-3xl text-sm text-muted">
            Courses ranked by total seat denials at the current intake. The suggestion adds enough seats (rounded up
            to {seatStep}) to clear the worst single term&apos;s shortfall seen in this run, by widening sections or
            opening one. For the seats a <i>larger</i> intake needs, use the seat planner below; to test one change first, ask the{" "}
            <Link href="/advisor" className="font-semibold text-accent">Advisor</Link>; to change seats for good, edit the{" "}
            <Link href="/data" className="font-semibold text-accent">Data</Link> page.
          </p>
        </div>

        <div className="overflow-auto border-t border-border">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                {["Course", "Seats", "Total denied", "Suggested seats"].map((h) => (
                  <th
                    key={h}
                    className="whitespace-nowrap border-b border-border bg-surface px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {recs.map((r) => (
                <tr key={r.code} className="group border-b border-border transition-colors hover:bg-surface-2 last:border-0">
                  <td className="whitespace-nowrap px-3 py-2.5 font-semibold">{r.code}</td>
                  <td className="whitespace-nowrap px-3 py-2.5 tabular-nums text-muted">{r.currentCapacity}</td>
                  <td className="whitespace-nowrap px-3 py-2.5 tabular-nums font-bold text-ink">
                    {r.totalDenied.toLocaleString()}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5 tabular-nums font-bold text-ink">
                    {r.recommendedCapacity.toLocaleString()}{" "}
                    <span className="ml-1 rounded bg-surface-2 px-1.5 py-0.5 text-xs font-medium text-muted">
                      +{r.seatsToAdd} seats
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

      </div>
    </section>
  );
}
