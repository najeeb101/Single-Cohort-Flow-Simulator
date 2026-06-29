"use client";

import { useState } from "react";
import type { LiveEdits, MetaResponse } from "@/types/simulation";
import { FieldRow, NumberBox, SectionCard } from "@/components/scenario-builder/fields";

const SEASONS = ["Fall", "Spring", "Winter", "Summer"] as const;

interface PendingState {
  courseSections: Record<string, number>;
  passRates: Record<string, number>;
  offerings: Record<string, string[]>;
  cohortSize: number | null;
  capacityMultipliers: Record<string, number>;
}

export function emptyPending(): PendingState {
  return { courseSections: {}, passRates: {}, offerings: {}, cohortSize: null, capacityMultipliers: {} };
}

// Diff-style: only fields the admin actually touched end up in the LiveEdits payload sent
// to POST /livesim/{id}/advance, mirroring scenarioBuilder.ts::buildOverrides. Edits apply
// going forward only (never retroactive to past snapshots).
export function pendingToEdits(pending: PendingState): LiveEdits {
  const edits: LiveEdits = {};
  if (Object.keys(pending.courseSections).length) edits.course_sections = pending.courseSections;
  if (Object.keys(pending.passRates).length) edits.pass_rate_overrides = pending.passRates;
  if (Object.keys(pending.offerings).length) edits.offering_overrides = pending.offerings;
  if (pending.cohortSize !== null) edits.cohort_size = pending.cohortSize;
  if (Object.keys(pending.capacityMultipliers).length) edits.capacity_overrides = pending.capacityMultipliers;
  return edits;
}

interface Props {
  meta: MetaResponse;
  pending: PendingState;
  setPending: (next: PendingState) => void;
}

// Collapsible "what changes on the NEXT advance" form — the four knobs from the API
// contract's LiveEdits: per-course sections, admissions cohort_size, per-course offerings
// (Fall/Spring/Winter/Summer toggles), and per-course pass rates. Reuses the Scenario
// Builder's field primitives for visual consistency.
export default function LiveEditsPanel({ meta, pending, setPending }: Props) {
  const [open, setOpen] = useState(false);
  const courses = Object.keys(meta.course_sections).sort();

  const setSections = (code: string, value: number) =>
    setPending({ ...pending, courseSections: { ...pending.courseSections, [code]: value } });

  const setPassRate = (code: string, value: number) =>
    setPending({ ...pending, passRates: { ...pending.passRates, [code]: value } });

  const setCapacityMultiplier = (code: string, value: number) =>
    setPending({ ...pending, capacityMultipliers: { ...pending.capacityMultipliers, [code]: value } });

  const currentOffering = (code: string): string[] => pending.offerings[code] ?? [];

  const toggleSeason = (code: string, season: string) => {
    const base = pending.offerings[code] ?? [];
    const next = base.includes(season) ? base.filter((s) => s !== season) : [...base, season];
    setPending({ ...pending, offerings: { ...pending.offerings, [code]: next } });
  };

  const changeCount =
    Object.keys(pending.courseSections).length +
    Object.keys(pending.passRates).length +
    Object.keys(pending.offerings).length +
    Object.keys(pending.capacityMultipliers).length +
    (pending.cohortSize !== null ? 1 : 0);

  return (
    <div className="rounded-2xl border border-border bg-surface">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left text-[13px] font-semibold"
      >
        <span className="flex items-center gap-2">
          Edits for next term
          {changeCount > 0 && (
            <span className="rounded-full bg-accent/20 px-2 py-0.5 text-[11px] font-semibold text-accent">
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
            title="Per-course sections, capacity & pass rates"
            hint="sections = config course_sections; capacity = seat multiplier; pass rate 0..1"
          >
            <div className="max-h-[360px] overflow-auto rounded-lg border border-border">
              <table className="w-full border-collapse text-[12.5px]">
                <thead>
                  <tr>
                    {["Course", "Sections", "Capacity ×", "Pass rate", "Offered"].map((h) => (
                      <th
                        key={h}
                        className="sticky top-0 border-b border-border bg-surface px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-muted"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {courses.map((code) => {
                    const sectionsDirty = pending.courseSections[code] !== undefined;
                    const capDirty = pending.capacityMultipliers[code] !== undefined;
                    const passDirty = pending.passRates[code] !== undefined;
                    const offeringDirty = pending.offerings[code] !== undefined;
                    return (
                      <tr
                        key={code}
                        className={sectionsDirty || capDirty || passDirty || offeringDirty ? "bg-accent/[0.07]" : ""}
                      >
                        <td className="whitespace-nowrap border-b border-border px-3 py-1.5">{code}</td>
                        <td className="whitespace-nowrap border-b border-border px-3 py-1.5">
                          <div className="w-20">
                            <NumberBox
                              value={pending.courseSections[code] ?? meta.course_sections[code]}
                              onChange={(v) => setSections(code, v)}
                              min={1}
                              max={20}
                              step={1}
                            />
                          </div>
                        </td>
                        <td className="whitespace-nowrap border-b border-border px-3 py-1.5">
                          <div className="w-20">
                            <NumberBox
                              value={pending.capacityMultipliers[code] ?? 1}
                              onChange={(v) => setCapacityMultiplier(code, v)}
                              min={0.5}
                              max={3}
                              step={0.1}
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
                            {SEASONS.map((season) => {
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
              className="rounded-[9px] border border-border-2 bg-surface-2 px-3.5 py-1.5 text-[13px] font-semibold text-ink disabled:cursor-not-allowed disabled:opacity-50"
            >
              Clear pending edits
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
