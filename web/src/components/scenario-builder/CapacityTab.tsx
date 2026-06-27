import type { MetaResponse } from "@/types/simulation";
import type { BuilderState } from "@/lib/scenarioBuilder";
import { FieldRow, NumberBox, SectionCard, SliderBox } from "./fields";

interface Props {
  mode: "simple" | "advanced";
  meta: MetaResponse;
  topCapacityCourses: string[];
  state: BuilderState;
  baseline: BuilderState;
  setRecordField: (key: "capacityMultipliers" | "courseSections" | "initialOccupancy", code: string, value: number) => void;
  setField: <K extends keyof BuilderState>(key: K, value: BuilderState[K]) => void;
}

export default function CapacityTab({ mode, meta, topCapacityCourses, state, baseline, setRecordField, setField }: Props) {
  const minCohort = Math.round(baseline.cohortSize * 0.5);
  const maxCohort = Math.round(baseline.cohortSize * 1.5);

  return (
    <div className="flex flex-col gap-4">
      <SectionCard title="Top bottleneck courses" hint="multiplier on effective seats (sections × seats/section)">
        <div className="flex flex-wrap gap-2">
          {topCapacityCourses.map((code) => (
            <FieldRow key={code} label={`${code} sections`} dirty={Math.abs(state.capacityMultipliers[code] - 1) > 1e-9}>
              <SliderBox
                value={state.capacityMultipliers[code]}
                onChange={(v) => setRecordField("capacityMultipliers", code, v)}
                min={0.5}
                max={3.0}
                step={0.1}
                display={`${state.capacityMultipliers[code].toFixed(1)}×`}
              />
            </FieldRow>
          ))}
          <FieldRow label="Admit size" dirty={state.cohortSize !== baseline.cohortSize}>
            <SliderBox
              value={state.cohortSize}
              onChange={(v) => setField("cohortSize", v)}
              min={minCohort}
              max={maxCohort}
              step={5}
              display={`${state.cohortSize}/yr`}
            />
          </FieldRow>
        </div>
      </SectionCard>

      {mode === "advanced" && (
        <SectionCard
          title="All courses — sections & initial occupancy"
          hint="sections = config course_sections; occupied = seats already taken by the existing student body (steady-state)"
        >
          <div className="max-h-[420px] overflow-auto rounded-lg border border-border">
            <table className="w-full border-collapse text-[12.5px]">
              <thead>
                <tr>
                  {["Course", "Sections", "Occupied seats"].map((h) => (
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
                {Object.keys(meta.course_sections).sort().map((code) => {
                  const occ = state.initialOccupancy[code] ?? 0;
                  const baseOcc = baseline.initialOccupancy[code] ?? 0;
                  const rowDirty =
                    state.courseSections[code] !== baseline.courseSections[code] || occ !== baseOcc;
                  return (
                    <tr key={code} className={rowDirty ? "bg-accent/[0.07]" : ""}>
                      <td className="whitespace-nowrap border-b border-border px-3 py-1.5">{code}</td>
                      <td className="whitespace-nowrap border-b border-border px-3 py-1.5">
                        <div className="w-24">
                          <NumberBox
                            value={state.courseSections[code]}
                            onChange={(v) => setRecordField("courseSections", code, v)}
                            min={1}
                            max={20}
                            step={1}
                          />
                        </div>
                      </td>
                      <td className="whitespace-nowrap border-b border-border px-3 py-1.5">
                        <div className="w-24">
                          <NumberBox
                            value={occ}
                            onChange={(v) => setRecordField("initialOccupancy", code, v)}
                            min={0}
                            max={2000}
                            step={1}
                          />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </SectionCard>
      )}
    </div>
  );
}
