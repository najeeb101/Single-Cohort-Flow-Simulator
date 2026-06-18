import { useMemo } from "react";
import type { MetaResponse } from "@/types/simulation";
import type { BuilderState } from "@/lib/scenarioBuilder";
import { FieldRow, NumberBox, SectionCard } from "./fields";

interface Props {
  mode: "simple" | "advanced";
  meta: MetaResponse;
  state: BuilderState;
  baseline: BuilderState;
  setRecordField: (key: "passRates", code: string, value: number) => void;
  setField: <K extends keyof BuilderState>(key: K, value: BuilderState[K]) => void;
}

export default function PassRatesDropoutTab({ mode, meta, state, baseline, setRecordField, setField }: Props) {
  const lowestPassRateCourses = useMemo(
    () => Object.entries(meta.course_pass_rates).sort((a, b) => a[1] - b[1]).slice(0, 3).map(([code]) => code),
    [meta.course_pass_rates],
  );

  const dirty = (key: keyof BuilderState) => state[key] !== baseline[key];

  return (
    <div className="flex flex-col gap-4">
      <SectionCard title="Lowest pass-rate courses" hint="probability a student passes on attempt">
        <div className="flex flex-wrap gap-2">
          {lowestPassRateCourses.map((code) => (
            <FieldRow key={code} label={code} dirty={Math.abs(state.passRates[code] - baseline.passRates[code]) > 1e-9}>
              <NumberBox value={state.passRates[code]} onChange={(v) => setRecordField("passRates", code, v)} min={0} max={1} step={0.01} />
            </FieldRow>
          ))}
        </div>
      </SectionCard>

      <SectionCard title="Dropout — headline knobs">
        <div className="flex flex-wrap gap-2">
          <FieldRow label="Base hazard / term" dirty={dirty("dropoutBaseHazard")}>
            <NumberBox value={state.dropoutBaseHazard} onChange={(v) => setField("dropoutBaseHazard", v)} min={0} max={1} step={0.01} />
          </FieldRow>
          <FieldRow label="GPA floor" dirty={dirty("dropoutGpaFloor")}>
            <NumberBox value={state.dropoutGpaFloor} onChange={(v) => setField("dropoutGpaFloor", v)} min={0} max={4} step={0.1} />
          </FieldRow>

          {mode === "advanced" && (
            <>
              <FieldRow label="Early-term multiplier" dirty={dirty("dropoutEarlyMultiplier")}>
                <NumberBox value={state.dropoutEarlyMultiplier} onChange={(v) => setField("dropoutEarlyMultiplier", v)} min={0} max={10} step={0.1} />
              </FieldRow>
              <FieldRow label="Early-term cutoff (sem)" dirty={dirty("dropoutEarlySemCutoff")}>
                <NumberBox value={state.dropoutEarlySemCutoff} onChange={(v) => setField("dropoutEarlySemCutoff", v)} min={0} max={20} step={1} />
              </FieldRow>
              <FieldRow label="Repeated-fail threshold" dirty={dirty("dropoutFailsThreshold")}>
                <NumberBox value={state.dropoutFailsThreshold} onChange={(v) => setField("dropoutFailsThreshold", v)} min={1} max={10} step={1} />
              </FieldRow>
              <FieldRow label="Prob. on repeated fail" dirty={dirty("dropoutProbOnRepeatedFail")}>
                <NumberBox value={state.dropoutProbOnRepeatedFail} onChange={(v) => setField("dropoutProbOnRepeatedFail", v)} min={0} max={1} step={0.01} />
              </FieldRow>
            </>
          )}
        </div>
      </SectionCard>

      {mode === "advanced" && (
        <SectionCard title="All courses — pass rate">
          <div className="max-h-[420px] overflow-auto rounded-lg border border-border">
            <table className="w-full border-collapse text-[12.5px]">
              <thead>
                <tr>
                  <th className="sticky top-0 border-b border-border bg-surface px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-muted">
                    Course
                  </th>
                  <th className="sticky top-0 border-b border-border bg-surface px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-muted">
                    Pass rate
                  </th>
                </tr>
              </thead>
              <tbody>
                {Object.keys(meta.course_pass_rates).sort().map((code) => (
                  <tr key={code} className={Math.abs(state.passRates[code] - baseline.passRates[code]) > 1e-9 ? "bg-accent/[0.07]" : ""}>
                    <td className="whitespace-nowrap border-b border-border px-3 py-1.5">{code}</td>
                    <td className="whitespace-nowrap border-b border-border px-3 py-1.5">
                      <div className="w-24">
                        <NumberBox value={state.passRates[code]} onChange={(v) => setRecordField("passRates", code, v)} min={0} max={1} step={0.01} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SectionCard>
      )}
    </div>
  );
}
