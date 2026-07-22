"use client";

import Link from "next/link";
import { useMemo, type ReactNode } from "react";
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
  recommendedCapacity: number;
}

function buildRecommendations(frames: Frame[], meta: CapacityMeta): CourseRec[] {
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

    recs.push({
      code,
      currentCapacity,
      totalDenied,
      oversubscribedTerms: termDenials.length,
      peakShortfall,
      recommendedCapacity: currentCapacity + peakShortfall,
    });
  }

  return recs.sort((a, b) => b.totalDenied - a.totalDenied).slice(0, 8);
}

export default function CapacityRecommendations({
  frames,
  meta,
  children,
}: {
  frames: Frame[];
  meta: CapacityMeta;
  // Optional slot rendered under a divider at the bottom of the section — used on the
  // Bottlenecks page to group the Auto-fill solver together with these recommendations,
  // since both are capacity tools.
  children?: ReactNode;
}) {
  const recs = useMemo(() => buildRecommendations(frames, meta), [frames, meta]);

  if (recs.length === 0) {
    return (
      <section className="py-6">
        <div className="rounded-2xl border border-border bg-surface p-5">
          <h2 className="mb-1 text-[15px] font-bold">Capacity recommendations</h2>
          <p className="text-sm text-muted">No seat denials recorded — current capacity is sufficient.</p>
          {children && <div className="mt-5 border-t border-border pt-5">{children}</div>}
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
            Courses ranked by total seat denials. <span className="font-semibold text-ink">Recommended capacity</span>{" "}
            is current capacity plus the worst single term&apos;s shortfall — enough to clear every denial seen in
            this run. To test the actual impact of raising capacity, ask the{" "}
            <Link href="/advisor" className="font-semibold text-accent">Advisor</Link>{" "}
            (it predicts the effect, then lets you apply it), or edit{" "}
            <Link href="/settings" className="font-semibold text-accent">Settings</Link>{" "}
            to make a change permanent.
          </p>
        </div>

        <div className="overflow-auto border-t border-border">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                {["Course", "Capacity", "Total denied", "Recommended capacity"].map((h) => (
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
                      +{r.peakShortfall.toLocaleString()}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {children && <div className="border-t border-border p-5">{children}</div>}
      </div>
    </section>
  );
}
