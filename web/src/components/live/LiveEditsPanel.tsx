"use client";

import { useState } from "react";
import type { LiveEdits, MetaResponse } from "@/types/simulation";
import { FieldRow, NumberBox, SectionCard } from "@/components/scenario-builder/fields";

const SEASONS = ["Fall", "Spring", "Winter", "Summer"] as const;

interface PendingState {
  courseSections: Record<string, number>;
  seatsPerSection: Record<string, number>;
  passRates: Record<string, number>;
  offerings: Record<string, string[]>;
  cohortSize: number | null;
}

export function emptyPending(): PendingState {
  return { courseSections: {}, seatsPerSection: {}, passRates: {}, offerings: {}, cohortSize: null };
}

// Diff-style: only fields the admin actually touched end up in the LiveEdits payload sent
// to POST /livesim/{id}/advance, mirroring scenarioBuilder.ts::buildOverrides. Edits apply
// going forward only (never retroactive to past snapshots).
//
// `course_sections` is the one exception to diff-style: the engine overlay replaces the
// whole map (src/simulator.py's _apply_overlay), and a course missing from it falls back to
// its curriculum-derived section count, not the calibrated value — so we send the full
// baseline map with the touched courses merged in. `seats_per_section_overrides` is safe to
// send as a pure diff: a course absent from it correctly falls back to the global
// seats_per_section.
export function pendingToEdits(pending: PendingState, meta: MetaResponse): LiveEdits {
  const edits: LiveEdits = {};
  if (Object.keys(pending.courseSections).length)
    edits.course_sections = { ...meta.course_sections, ...pending.courseSections };
  if (Object.keys(pending.seatsPerSection).length) edits.seats_per_section_overrides = pending.seatsPerSection;
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
// LiveEdits: per-course sections + seats/section (total seats = the product), admissions
// cohort_size, per-course offerings (Fall/Spring/Winter/Summer toggles), and per-course pass
// rates. Reuses the Scenario Builder's field primitives for visual consistency.
export default function LiveEditsPanel({ meta, pending, setPending }: Props) {
  const [open, setOpen] = useState(false);
  const courses = Object.keys(meta.course_sections).sort();

  const setSections = (code: string, value: number) =>
    setPending({ ...pending, courseSections: { ...pending.courseSections, [code]: value } });

  const setPassRate = (code: string, value: number) =>
    setPending({ ...pending, passRates: { ...pending.passRates, [code]: value } });

  const setSeatsPerSection = (code: string, value: number) =>
    setPending({ ...pending, seatsPerSection: { ...pending.seatsPerSection, [code]: value } });

  const sectionsFor = (code: string) => pending.courseSections[code] ?? meta.course_sections[code];
  const seatsPerSectionFor = (code: string) => pending.seatsPerSection[code] ?? meta.seats_per_section;

  const currentOffering = (code: string): string[] => pending.offerings[code] ?? [];

  const toggleSeason = (code: string, season: string) => {
    const base = pending.offerings[code] ?? [];
    const next = base.includes(season) ? base.filter((s) => s !== season) : [...base, season];
    setPending({ ...pending, offerings: { ...pending.offerings, [code]: next } });
  };

  const changeCount =
    Object.keys(pending.courseSections).length +
    Object.keys(pending.seatsPerSection).length +
    Object.keys(pending.passRates).length +
    Object.keys(pending.offerings).length +
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
            title="Per-course sections, seats & pass rates"
            hint="total seats = sections × seats/section; pass rate 0..1"
          >
            <div className="max-h-[360px] overflow-auto rounded-lg border border-border">
              <table className="w-full border-collapse text-[12.5px]">
                <thead>
                  <tr>
                    {["Course", "Sections", "Seats/section", "Total seats", "Pass rate", "Offered"].map((h) => (
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
                    const seatsDirty = pending.seatsPerSection[code] !== undefined;
                    const passDirty = pending.passRates[code] !== undefined;
                    const offeringDirty = pending.offerings[code] !== undefined;
                    const totalSeats = sectionsFor(code) * seatsPerSectionFor(code);
                    return (
                      <tr
                        key={code}
                        className={sectionsDirty || seatsDirty || passDirty || offeringDirty ? "bg-accent/[0.07]" : ""}
                      >
                        <td className="whitespace-nowrap border-b border-border px-3 py-1.5">{code}</td>
                        <td className="whitespace-nowrap border-b border-border px-3 py-1.5">
                          <div className="w-20">
                            <NumberBox
                              value={sectionsFor(code)}
                              onChange={(v) => setSections(code, v)}
                              min={1}
                              max={20}
                              step={1}
                            />
                          </div>
                        </td>
                        <td className="whitespace-nowrap border-b border-border px-3 py-1.5">
                          <div className="w-24">
                            <NumberBox
                              value={seatsPerSectionFor(code)}
                              onChange={(v) => setSeatsPerSection(code, v)}
                              min={5}
                              max={300}
                              step={5}
                            />
                          </div>
                        </td>
                        <td className="whitespace-nowrap border-b border-border px-3 py-1.5 tabular-nums text-muted">
                          {totalSeats}
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
