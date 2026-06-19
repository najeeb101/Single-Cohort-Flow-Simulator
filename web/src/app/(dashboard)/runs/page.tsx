"use client";

import { Fragment, useEffect, useState } from "react";
import { listRuns } from "@/lib/api";
import { pct } from "@/lib/format";
import type { RunRecord } from "@/types/simulation";

export default function RunsPage() {
  const [runs, setRuns] = useState<RunRecord[] | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  useEffect(() => {
    listRuns().then(setRuns).catch(() => setRuns([]));
  }, []);

  return (
    <main className="mx-auto max-w-6xl px-7 pb-16">
      <header className="border-b border-border py-5">
        <h1 className="text-[19px] font-bold tracking-tight">Run History</h1>
      </header>

      <section className="py-6">
        {runs === null ? (
          <p className="text-[12.5px] text-muted">Loading…</p>
        ) : runs.length === 0 ? (
          <p className="text-[12.5px] text-muted">No runs yet — every Scenario Builder run is logged here.</p>
        ) : (
          <table className="w-full border-collapse text-[12.5px]">
            <thead>
              <tr>
                <th className="border-b border-border px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-muted">
                  When
                </th>
                <th className="border-b border-border px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-muted">
                  Scenario
                </th>
                <th className="border-b border-border px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-muted">
                  Graduation rate
                </th>
                <th className="border-b border-border px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-muted">
                  Academic dropout
                </th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => (
                <Fragment key={run.id}>
                  <tr
                    onClick={() => setExpandedId(expandedId === run.id ? null : run.id)}
                    className="cursor-pointer hover:bg-surface-2"
                  >
                    <td className="border-b border-border px-3 py-2 text-muted">
                      {new Date(run.requested_at).toLocaleString()}
                    </td>
                    <td className="border-b border-border px-3 py-2">
                      {run.scenario_id ? `#${run.scenario_id}` : "ad-hoc"}
                    </td>
                    <td className="border-b border-border px-3 py-2">
                      {pct(run.summary_json.metrics.graduation_rate)}
                    </td>
                    <td className="border-b border-border px-3 py-2">
                      {pct(run.summary_json.metrics.academic_dropout_rate)}
                    </td>
                  </tr>
                  {expandedId === run.id && (
                    <tr>
                      <td colSpan={4} className="border-b border-border bg-surface-2 px-3 py-3">
                        <pre className="overflow-x-auto text-[11px] text-muted">
                          {JSON.stringify(run.overrides_json, null, 2)}
                        </pre>
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
