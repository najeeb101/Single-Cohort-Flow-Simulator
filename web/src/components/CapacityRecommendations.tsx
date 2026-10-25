"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useIntake } from "@/lib/IntakeContext";
import type { Frame, MetaResponse, SeatPlanResult } from "@/types/simulation";

// Only these two fields are actually read below — narrowed so callers can pass either the
// baseline MetaResponse or a lightweight stand-in built from an in-progress checkpoint session
// (see web/src/app/(dashboard)/bottlenecks/page.tsx).
type CapacityMeta = Pick<MetaResponse, "graph" | "mandatory_terms">;

interface CourseRow {
  code: string;
  currentCapacity: number;
  totalDenied: number;
}

function rankDenials(frames: Frame[], meta: CapacityMeta): CourseRow[] {
  const capacityByCode: Record<string, number> = {};
  for (const node of meta.graph.nodes) capacityByCode[node.code] = node.capacity;

  // Only regular (mandatory) terms count toward capacity planning: optional-term (Summer/Winter)
  // seat denials come from a deliberately small bonus pool and don't block graduation. Matches the
  // engine's capacity_block_counts_mandatory ranking, so this table and the "Capacity blocks" card
  // list the same courses.
  const mandatory = new Set(meta.mandatory_terms ?? ["Fall", "Spring"]);
  const denied: Record<string, number> = {};
  for (const frame of frames) {
    if (!mandatory.has(frame.season)) continue;
    for (const [code, stat] of Object.entries(frame.courses)) {
      if (stat.denied > 0) denied[code] = (denied[code] ?? 0) + stat.denied;
    }
  }

  return Object.entries(denied)
    .map(([code, totalDenied]) => ({ code, totalDenied, currentCapacity: capacityByCode[code] ?? 0 }))
    .sort((a, b) => b.totalDenied - a.totalDenied)
    .slice(0, 8);
}

// Which courses turn students away, and how many seats they would need. The ranking comes from
// this run's seat denials; the seat numbers come from the latest seat plan (the planner below:
// demand at the planned intake, rounded to the seat step, checked against the policy limits), so
// this card and the planner always agree. It used to size each course to clear its worst single
// term here instead, which also counts students turned away earlier who asked again, so it
// overstated (+105 seats for CSEL2 where the planner said +45 even for an intake of 120).
export default function CapacityRecommendations({
  frames,
  meta,
  source,
}: {
  frames: Frame[];
  meta: CapacityMeta;
  source: "plan" | "checkpoint";
}) {
  const { latestSeatPlan } = useIntake();
  const rows = useMemo(() => rankDenials(frames, meta), [frames, meta]);
  const plan =
    latestSeatPlan?.source === source && latestSeatPlan.status === "done"
      ? ((latestSeatPlan.result as SeatPlanResult | undefined) ?? null)
      : null;
  const needed = useMemo(
    () => Object.fromEntries((plan?.changes ?? []).map((c) => [c.code, c.recommended])) as Record<string, number>,
    [plan],
  );

  if (rows.length === 0) {
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
            Courses ranked by how many students they turned away for lack of seats in this run.{" "}
            {plan ? (
              <>
                The seat numbers are the seat planner&apos;s plan for an intake of {plan.target_intake} (below): what each
                course needs, rounded up and checked against your limits, by widening sections or opening one.
              </>
            ) : (
              <>Plan seats below to see how many seats each course would need for the intake you want.</>
            )}{" "}
            To test one change first, ask the <Link href="/advisor" className="font-semibold text-accent">Advisor</Link>; to
            change seats for good, edit the <Link href="/data" className="font-semibold text-accent">Data</Link> page.
          </p>
        </div>

        <div className="overflow-auto border-t border-border">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                {["Course", "Seats now", "Turned away", plan ? `Seats for ${plan.target_intake}` : "Seats needed"].map((h) => (
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
              {rows.map((r) => {
                const need = needed[r.code];
                return (
                  <tr key={r.code} className="group border-b border-border transition-colors hover:bg-surface-2 last:border-0">
                    <td className="whitespace-nowrap px-3 py-2.5 font-semibold">{r.code}</td>
                    <td className="whitespace-nowrap px-3 py-2.5 tabular-nums text-muted">{r.currentCapacity}</td>
                    <td className="whitespace-nowrap px-3 py-2.5 tabular-nums font-bold text-ink">
                      {r.totalDenied.toLocaleString()}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 tabular-nums">
                      {!plan ? (
                        <span className="text-muted">-</span>
                      ) : need != null && need > r.currentCapacity ? (
                        <span className="font-bold text-ink">
                          {need.toLocaleString()}
                          <span className="ml-2 rounded bg-surface-2 px-1.5 py-0.5 text-xs font-medium text-muted">
                            +{need - r.currentCapacity} seats
                          </span>
                        </span>
                      ) : (
                        <span className="text-muted">enough</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
