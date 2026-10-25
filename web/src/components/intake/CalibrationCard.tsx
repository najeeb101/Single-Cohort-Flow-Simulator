"use client";

import Link from "next/link";
import type { IntakeSweepResult } from "@/types/simulation";

function show(name: string, v: number): string {
  return name === "current_headcount" ? Math.round(v).toLocaleString() : `${(v * 100).toFixed(1)}%`;
}

// Compares the model at the usual intake with outcomes the department actually saw (Data page,
// Policy & analysis tab). A flagged row means the gap is bigger than sampling noise explains.
export default function CalibrationCard({ calibration }: { calibration: IntakeSweepResult["calibration"] }) {
  return (
    <section className="rounded-xl border border-border bg-surface p-6">
      <p className="max-w-3xl text-sm text-muted">
        Does the model match what you know?
        The model at the usual intake of {calibration.usual_intake} compared with outcomes the department has
        recorded. {calibration.note}
      </p>
      {calibration.checks.length === 0 ? (
        <p className="mt-3 text-sm text-muted">
          No recorded outcomes yet. Add them on the{" "}
          <Link href="/data?tab=policy" className="font-semibold text-accent hover:underline">Data page</Link>.
        </p>
      ) : (
        <div className="mt-3 overflow-auto rounded-lg border border-border">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                {["Measure", "Actual", "Model", "Gap", "Within expected noise?"].map((h) => (
                  <th key={h} className="border-b border-border px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {calibration.checks.map((c) => (
                <tr key={c.name} className="border-b border-border last:border-0">
                  <td className="px-3 py-2 font-semibold">{c.label}</td>
                  <td className="px-3 py-2 tabular-nums">{show(c.name, c.actual)}</td>
                  <td className="px-3 py-2 tabular-nums">{show(c.name, c.simulated)}</td>
                  <td className="px-3 py-2 tabular-nums text-muted">
                    {c.name === "current_headcount" ? Math.round(c.gap).toLocaleString() : `${(c.gap * 100).toFixed(1)} pts`}
                  </td>
                  <td className={`px-3 py-2 font-semibold ${c.flag ? "text-bad" : "text-good"}`}>
                    {c.flag ? "No, check the inputs" : "Yes"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
