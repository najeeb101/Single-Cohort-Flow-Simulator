"use client";

import type { MetaResponse } from "@/types/simulation";
import type { BuilderState } from "@/lib/scenarioBuilder";
import AdmissionsTab from "@/components/scenario-builder/AdmissionsTab";
import PassRatesDropoutTab from "@/components/scenario-builder/PassRatesDropoutTab";
import RegistrationPolicyTab from "@/components/scenario-builder/RegistrationPolicyTab";

// Reuses the Scenario Builder's tab components unchanged (mode="advanced") — same pattern
// as the Settings page (web/src/app/(dashboard)/settings/page.tsx), but seeded from the
// wizard's locally-cloned/blank config rather than the active plan's baseline.
export default function ConfigStep({
  meta,
  state,
  baseline,
  setField,
  setRecordField,
}: {
  meta: MetaResponse;
  state: BuilderState;
  baseline: BuilderState;
  setField: <K extends keyof BuilderState>(key: K, value: BuilderState[K]) => void;
  setRecordField: (key: "passRates", code: string, value: number) => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <AdmissionsTab mode="advanced" state={state} baseline={baseline} setField={setField} />
      <PassRatesDropoutTab
        mode="advanced"
        meta={meta}
        state={state}
        baseline={baseline}
        setField={setField}
        setRecordField={setRecordField}
      />
      <RegistrationPolicyTab mode="advanced" state={state} baseline={baseline} setField={setField} />
    </div>
  );
}
