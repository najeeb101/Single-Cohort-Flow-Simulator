"use client";

import { useState } from "react";
import { useCheckpoint } from "@/lib/CheckpointContext";
import { standingLevelsFromThresholds } from "@/components/scenario-builder/InitialStateImportModal";
import InitialStateEditor from "@/components/scenario-builder/InitialStateEditor";
import { FieldRow, NumberBox, SectionCard } from "@/components/scenario-builder/fields";
import CurriculumTable from "@/components/settings/CurriculumTable";
import type { CheckpointEdit, CheckpointState } from "@/types/simulation";

// The checkpoint editor, composed entirely from existing Settings/Scenario Builder pieces —
// no new form widgets. Deliberately narrower than either of those: only future-facing knobs
// (capacity, pass rate, occupancy/standing, next intake) are editable here. Prerequisites,
// offering, category, admission_terms, num_cohorts, max_terms, and seed are NOT exposed —
// structural/horizon knobs stay off this page entirely (CurriculumTable's
// structuralEditsDisabled hides Add/Delete/structural-edit; there is simply no field for the
// rest on CheckpointEdit, so there's nothing to wire up even if we wanted to).
//
// Mirrors Settings' deferred-edit pattern: local state holds the *current desired* absolute
// values, seeded once from the session on mount; "Save changes" sends only what differs from
// the session's own baseline via POST /checkpoint/edit. A parent that renders this with
// `key={session.id}` gets a fresh local state whenever a new session starts.
export default function CheckpointEditPanel({
  session,
  yearStandingThresholds,
}: {
  session: CheckpointState;
  yearStandingThresholds?: number[];
}) {
  const { edit, busy, error } = useCheckpoint();
  const courses = session.working_curriculum;
  const config = session.working_config;
  const seasons = (config.terms_per_year as string[] | undefined) ?? ["Fall", "Spring"];
  const admissionTerms = (config.admission_terms as string[] | undefined) ?? ["Fall"];
  const primary = admissionTerms[0] ?? "Fall";
  const secondary = admissionTerms[1]; // e.g. "Spring" for a second yearly intake

  const baselineCohortSize = (config.cohort_size as number | undefined) ?? 100;
  const baselineAdmissionSizes = (config.admission_sizes as Record<string, number> | undefined) ?? {};
  const baselineOccupancy = config.initial_state?.occupancy ?? {};
  const baselineStanding = config.initial_state?.standing ?? {};
  const baselineCapacities = Object.fromEntries(courses.map((c) => [c.code, c.capacity]));
  const baselinePassRates = Object.fromEntries(courses.map((c) => [c.code, c.pass_rate]));
  const standingNodes = standingLevelsFromThresholds(yearStandingThresholds);

  const [cohortSize, setCohortSize] = useState(baselineCohortSize);
  const [admissionSizes, setAdmissionSizes] = useState(baselineAdmissionSizes);
  const [occupancy, setOccupancy] = useState(baselineOccupancy);
  const [standing, setStanding] = useState(baselineStanding);
  const [capacities, setCapacities] = useState<Record<string, number>>(baselineCapacities);
  const [passRates, setPassRates] = useState<Record<string, number>>(baselinePassRates);
  const [saved, setSaved] = useState(false);

  const capacityChanges = Object.entries(capacities).filter(([code, v]) => v !== baselineCapacities[code]);
  const passRateChanges = Object.entries(passRates).filter(([code, v]) => v !== baselinePassRates[code]);
  const occupancyChanged = JSON.stringify(occupancy) !== JSON.stringify(baselineOccupancy);
  const standingChanged = JSON.stringify(standing) !== JSON.stringify(baselineStanding);
  const cohortSizeChanged = cohortSize !== baselineCohortSize;
  const admissionSizesChanged = JSON.stringify(admissionSizes) !== JSON.stringify(baselineAdmissionSizes);
  const isDirty =
    capacityChanges.length > 0 || passRateChanges.length > 0 || occupancyChanged || standingChanged ||
    cohortSizeChanged || admissionSizesChanged;

  const secondarySize = secondary !== undefined ? admissionSizes[secondary] ?? cohortSize : cohortSize;
  const setSecondarySize = (v: number) =>
    secondary !== undefined && setAdmissionSizes((prev) => ({ ...prev, [secondary]: v }));

  const save = async () => {
    setSaved(false);
    const patch: CheckpointEdit = {};
    if (capacityChanges.length > 0) patch.capacity = Object.fromEntries(capacityChanges);
    if (passRateChanges.length > 0) patch.pass_rate = Object.fromEntries(passRateChanges);
    if (occupancyChanged || standingChanged) patch.initial_state = { occupancy, standing };
    if (cohortSizeChanged) patch.cohort_size = cohortSize;
    if (admissionSizesChanged) patch.admission_sizes = admissionSizes;
    try {
      await edit(patch);
      setSaved(true);
    } catch {
      // Failure is surfaced via the shared `error` from useCheckpoint(); edits stay pending
      // (not cleared) so the head doesn't lose them and can retry.
    }
  };

  const discard = () => {
    setCohortSize(baselineCohortSize);
    setAdmissionSizes(baselineAdmissionSizes);
    setOccupancy(baselineOccupancy);
    setStanding(baselineStanding);
    setCapacities(baselineCapacities);
    setPassRates(baselinePassRates);
    setSaved(false);
  };

  return (
    <div className="flex flex-col gap-4">
      <SectionCard title="Next intake" hint="applies from the next not-yet-admitted cohort onward">
        <div className="flex flex-wrap gap-2">
          <FieldRow label={`${primary} cohort size`} dirty={cohortSizeChanged}>
            <NumberBox value={cohortSize} onChange={setCohortSize} min={1} max={1000} step={5} />
          </FieldRow>
          {secondary !== undefined && (
            <FieldRow label={`${secondary} cohort size`} dirty={admissionSizesChanged}>
              <NumberBox value={secondarySize} onChange={setSecondarySize} min={1} max={1000} step={5} />
            </FieldRow>
          )}
        </div>
      </SectionCard>

      <InitialStateEditor
        courses={courses}
        occupancy={occupancy}
        standing={standing}
        standingNodes={standingNodes}
        baselineOccupancy={baselineOccupancy}
        baselineStanding={baselineStanding}
        showOccupancyTable={false}
        onOccupancyChange={(code, v) => setOccupancy((prev) => ({ ...prev, [code]: v }))}
        onOccupancyBulkChange={(p) => setOccupancy((prev) => ({ ...prev, ...p }))}
        onStandingChange={(node, v) => setStanding((prev) => ({ ...prev, [node]: v }))}
        onStandingBulkChange={(p) => setStanding((prev) => ({ ...prev, ...p }))}
      />

      <SectionCard title="Curriculum — capacity, pass rate & occupancy">
        <CurriculumTable
          courses={courses}
          onChange={() => {}}
          seasons={seasons}
          structuralEditsDisabled
          occupancy={occupancy}
          baselineOccupancy={baselineOccupancy}
          onOccupancyChange={(code, v) => setOccupancy((prev) => ({ ...prev, [code]: v }))}
          passRates={passRates}
          baselinePassRates={baselinePassRates}
          onPassRateChange={(code, v) => setPassRates((prev) => ({ ...prev, [code]: v }))}
          capacities={capacities}
          baselineCapacities={baselineCapacities}
          onCapacityChange={(code, v) => setCapacities((prev) => ({ ...prev, [code]: v }))}
        />
      </SectionCard>

      {error && <p className="text-sm text-bad">{error}</p>}
      {saved && !isDirty && <p className="text-sm text-good">Saved — takes effect on the next Advance.</p>}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={save}
          disabled={!isDirty || busy}
          className="rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? "Saving…" : "Save changes"}
        </button>
        {isDirty && (
          <button
            type="button"
            onClick={discard}
            className="rounded-xl border border-border-2 bg-surface px-4 py-2 text-sm font-semibold text-ink"
          >
            Discard edits
          </button>
        )}
      </div>
    </div>
  );
}
