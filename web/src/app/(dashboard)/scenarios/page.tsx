"use client";

import { Fragment, useEffect, useState } from "react";
import { ApiError, deleteScenario, listScenarios } from "@/lib/api";
import type { ScenarioRecord, ScenarioRequest } from "@/types/simulation";

// A one-line human summary of a scenario's override payload, so the list is scannable without
// expanding every row.
function summarize(o: ScenarioRequest): string {
  const parts: string[] = [];
  if (o.cohort_size != null) parts.push(`cohort ${o.cohort_size}/yr`);
  const capN = o.capacity_overrides ? Object.keys(o.capacity_overrides).length : 0;
  if (capN) parts.push(`${capN} capacity change${capN > 1 ? "s" : ""}`);
  const passN = o.pass_rate_overrides ? Object.keys(o.pass_rate_overrides).length : 0;
  if (passN) parts.push(`${passN} pass-rate change${passN > 1 ? "s" : ""}`);
  const offN = o.offering_overrides ? Object.keys(o.offering_overrides).length : 0;
  if (offN) parts.push(`${offN} offering change${offN > 1 ? "s" : ""}`);
  return parts.length ? parts.join(" · ") : "no overrides (baseline)";
}

export default function ScenariosPage() {
  const [scenarios, setScenarios] = useState<ScenarioRecord[] | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () => listScenarios().then(setScenarios).catch(() => setScenarios([]));
  useEffect(() => { load(); }, []);

  const remove = async (id: number) => {
    setError(null);
    try {
      await deleteScenario(id);
      setScenarios((prev) => (prev ? prev.filter((s) => s.id !== id) : prev));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not delete the scenario");
    }
  };

  return (
    <main className="mx-auto w-full max-w-[1600px] px-7 pb-16">
      <header className="border-b border-border py-5">
        <h1 className="text-[19px] font-bold tracking-tight">Scenarios</h1>
        <p className="mt-0.5 max-w-2xl text-[12.5px] text-muted">
          Saved override sets — named what-ifs you can revisit. Create one from the{" "}
          <span className="font-semibold text-ink">Try a what-if</span> panel on Bottlenecks
          (<span className="font-semibold text-ink">Save as scenario</span>). Click a row to see its full override payload.
        </p>
      </header>

      <section className="py-6">
        {error && <p className="mb-3 text-[12.5px] text-bad">{error}</p>}
        {scenarios === null ? (
          <p className="text-[12.5px] text-muted">Loading…</p>
        ) : scenarios.length === 0 ? (
          <p className="text-[12.5px] text-muted">
            No saved scenarios yet — save one from the What-If panel on the Bottlenecks page.
          </p>
        ) : (
          <table className="w-full border-collapse text-[12.5px]">
            <thead>
              <tr>
                {["Name", "Overrides", "Saved", ""].map((h) => (
                  <th
                    key={h}
                    className="border-b border-border px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-muted"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {scenarios.map((s) => (
                <Fragment key={s.id}>
                  <tr className="cursor-pointer hover:bg-surface-2" onClick={() => setExpandedId(expandedId === s.id ? null : s.id)}>
                    <td className="border-b border-border px-3 py-2 font-semibold">{s.name}</td>
                    <td className="border-b border-border px-3 py-2 text-muted">{summarize(s.overrides)}</td>
                    <td className="border-b border-border px-3 py-2 text-muted">{new Date(s.created_at).toLocaleString()}</td>
                    <td className="border-b border-border px-3 py-2 text-right">
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); remove(s.id); }}
                        aria-label={`Delete scenario ${s.name}`}
                        className="rounded-md px-2 py-1 text-[11.5px] font-semibold text-muted hover:bg-bad/10 hover:text-bad"
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                  {expandedId === s.id && (
                    <tr>
                      <td colSpan={4} className="border-b border-border bg-surface-2 px-3 py-3">
                        <pre className="overflow-x-auto text-[11px] text-muted">{JSON.stringify(s.overrides, null, 2)}</pre>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </main>
  );
}
