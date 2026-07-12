"use client";

import { useState } from "react";
import type { LiveEdits, MetaResponse } from "@/types/simulation";
import { FieldRow, NumberBox, SectionCard } from "@/components/scenario-builder/fields";

interface PendingState {
  capacity: Record<string, number>; // desired new per-term capacity per course
  passRates: Record<string, number>;
  offerings: Record<string, string[]>;
  cohortSize: number | null;
}

export function emptyPending(): PendingState {
  return { capacity: {}, passRates: {}, offerings: {}, cohortSize: null };
}

// Diff-style: only fields the admin actually touched end up in the LiveEdits payload sent
// to POST /livesim/{id}/advance, mirroring scenarioBuilder.ts::buildOverrides. Edits apply
// going forward only (never retroactive to past snapshots).
//
// `capacity` is edited as an absolute seat count in the UI but sent as `capacity_overrides`
// — a per-course multiplier on top of the course's own `capacity` (src/simulator.py's
// _effective_capacity) — so a touched course's multiplier is derived here from
// (desired capacity / current capacity).
export function pendingToEdits(pending: PendingState, meta: MetaResponse): LiveEdits {
  const edits: LiveEdits = {};
  const capacityOverrides: Record<string, number> = {};
  for (const [code, desired] of Object.entries(pending.capacity)) {
    const current = meta.graph.nodes.find((n) => n.code === code)?.capacity ?? 0;
    if (current > 0) capacityOverrides[code] = desired / current;
  }
  if (Object.keys(capacityOverrides).length) edits.capacity_overrides = capacityOverrides;
  if (Object.keys(pending.passRates).length) edits.pass_rate_overrides = pending.passRates;
  if (Object.keys(pending.offerings).length) edits.offering_overrides = pending.offerings;
  if (pending.cohortSize !== null) edits.cohort_size = pending.cohortSize;
  return edits;
}

interface Props {
  meta: MetaResponse;
  pending: PendingState;
  setPending: (next: PendingState) => void;
}

// Collapsible "what changes on the NEXT advance" form — the knobs from the API contract's
// LiveEdits: per-course capacity, admissions cohort_size, per-course offerings (Fall/Spring/
// Winter/Summer toggles), and per-course pass rates. Reuses the Scenario Builder's field
// primitives for visual consistency.
export default function LiveEditsPanel({ meta, pending, setPending }: Props) {
  const [open, setOpen] = useState(false);
  // The offering toggles show the active plan's own season cycle, not a hardcoded list.
  const seasons = meta.terms_per_year?.length ? meta.terms_per_year : ["Fall", "Spring"];
  const capacityByCode: Record<string, number> = {};
  for (const node of meta.graph.nodes) capacityByCode[node.code] = node.capacity;
  const courses = Object.keys(capacityByCode).sort();

  const setCapacity = (code: string, value: number) =>
    setPending({ ...pending, capacity: { ...pending.capacity, [code]: value } });

  const setPassRate = (code: string, value: number) =>
    setPending({ ...pending, passRates: { ...pending.passRates, [code]: value } });

  const capacityFor = (code: string) => pending.capacity[code] ?? capacityByCode[code];

  const currentOffering = (code: string): string[] => pending.offerings[code] ?? [];

  const toggleSeason = (code: string, season: string) => {
    const base = pending.offerings[code] ?? [];
    const next = base.includes(season) ? base.filter((s) => s !== season) : [...base, season];
    setPending({ ...pending, offerings: { ...pending.offerings, [code]: next } });
  };

  const changeCount =
    Object.keys(pending.capacity).length +
    Object.keys(pending.passRates).length +
    Object.keys(pending.offerings).length +
    (pending.cohortSize !== null ? 1 : 0);

  return (
    <div className="rounded-2xl border border-border bg-surface">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left text-sm font-semibold"
      >
        <span className="flex items-center gap-2">
          Edits for next term
          {changeCount > 0 && (
            <span className="rounded-full bg-accent/20 px-2 py-0.5 text-xs font-semibold text-accent">
              {changeCount} pending
            </span>
          )}
        </span>
        <span className="text-xs font-normal text-muted">{open ? "▾ collapse" : "▸ expand"}</span>
      </button>

      {open && (
        <div className="flex flex-col gap-4 border-t border-border p-4">
          <p className="text-xs text-muted">
            These changes apply starting with the next advanced term only — past terms are not recomputed.
          </p>

          <SectionCard title="Admissions" hint="cohort size for future intakes">
            <div className="flex flex-wrap gap-2">
              <FieldRow label="Cohort size / year" dirty={pending.cohortSize !== null}>
                <NumberBox
                  value={pending.cohortSize ?? meta.cohort_size}
                  onChange={(v) => setPending({ ...pending, cohortSize: v })}
                  min={10}
                  max={1000}
                  step={5}
                />
              </FieldRow>
            </div>
          </SectionCard>

          <SectionCard
            title="Per-course capacity & pass rates"
            hint="capacity = seats per term; pass rate 0..1"
          >
            <div className="max-h-[360px] overflow-auto rounded-lg border border-border">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr>
                    {["Course", "Capacity", "Pass rate", "Offered"].map((h) => (
                      <th
                        key={h}
                        className="sticky top-0 border-b border-border bg-surface px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {courses.map((code) => {
                    const capacityDirty = pending.capacity[code] !== undefined;
                    const passDirty = pending.passRates[code] !== undefined;
                    const offeringDirty = pending.offerings[code] !== undefined;
                    return (
                      <tr
                        key={code}
                        className={capacityDirty || passDirty || offeringDirty ? "bg-accent/[0.07]" : ""}
                      >
                        <td className="whitespace-nowrap border-b border-border px-3 py-1.5">{code}</td>
                        <td className="whitespace-nowrap border-b border-border px-3 py-1.5">
                          <div className="w-24">
                            <NumberBox
                              value={capacityFor(code)}
                              onChange={(v) => setCapacity(code, v)}
                              min={1}
                              max={2000}
                              step={5}
                            />
                          </div>
                        </td>
                        <td className="whitespace-nowrap border-b border-border px-3 py-1.5">
                          <div className="w-20">
                            <NumberBox
                              value={pending.passRates[code] ?? meta.course_pass_rates[code]}
                              onChange={(v) => setPassRate(code, v)}
                              min={0}
                              max={1}
                              step={0.01}
                            />
                          </div>
                        </td>
                        <td className="whitespace-nowrap border-b border-border px-3 py-1.5">
                          <div className="flex gap-1">
                            {seasons.map((season) => {
                              const active = currentOffering(code).includes(season);
                              return (
                                <button
                                  key={season}
                                  type="button"
                                  onClick={() => toggleSeason(code, season)}
                                  className={`rounded-md border px-1.5 py-0.5 text-[10.5px] font-semibold ${
                                    active
                                      ? "border-accent bg-accent/20 text-accent"
                                      : "border-border-2 text-muted"
                                  }`}
                                  title={`Toggle ${season}`}
                                >
                                  {season.slice(0, 2)}
                                </button>
                              );
                            })}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </SectionCard>

          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => setPending(emptyPending())}
              disabled={changeCount === 0}
              className="rounded-xl border border-border-2 bg-surface-2 px-3.5 py-1.5 text-sm font-semibold text-ink disabled:cursor-not-allowed disabled:opacity-50"
            >
              Clear pending edits
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
