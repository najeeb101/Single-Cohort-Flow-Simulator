import type { AnalysisRecord, IntakePoint, IntakeSweepResult, MetaResponse } from "@/types/simulation";

// Losses below zero are a small model quirk at low intakes (real seats can beat the
// unlimited-seat reference by a point or two, see docs/methodology.md), so they read as
// "no measurable loss" instead of a negative harm.
export function pts(x: number): string {
  return x <= 0.05 ? "none" : `${x.toFixed(1)} pts`;
}

export function pct0(x: number): string {
  return `${(x * 100).toFixed(0)}%`;
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "";
  // The backend stores naive UTC timestamps; mark them UTC so the browser shows local time.
  const d = new Date(/[zZ]|[+-]\d\d:\d\d$/.test(iso) ? iso : `${iso}Z`);
  return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export const LIMIT_LABEL: Record<string, string> = {
  grad_rate_loss: "graduation rate",
  on_time_loss: "on-time graduation",
  min_grad_rate: "minimum graduation rate",
};

export function isSweep(record: AnalysisRecord | null | undefined): record is AnalysisRecord & { result: IntakeSweepResult } {
  return !!record && record.kind === "intake_sweep" && record.status === "done" && !!record.result;
}

// JSON.stringify depends on key order, and the snapshot (built from DB rows) and /meta list
// courses in different orders, so compare with sorted keys.
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    return `{${Object.keys(obj).sort().map((k) => `${JSON.stringify(k)}:${stable(obj[k])}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

function roundRates(rates: Record<string, number>): Record<string, number> {
  return Object.fromEntries(Object.entries(rates).map(([k, v]) => [k, Math.round(v * 10000) / 10000]));
}

// Which inputs differ between the data an analysis ran on and the data in the plan now. Empty
// list = the result still describes today's data.
export function changedInputs(record: AnalysisRecord, meta: MetaResponse): string[] {
  const snap = record.inputs_snapshot;
  if (!snap) return [];
  const cfg = snap.config as Record<string, unknown>;
  const changed: string[] = [];

  const snapCap = Object.fromEntries(snap.curriculum.map((c) => [c.code, c.capacity]));
  const nowCap = Object.fromEntries(meta.graph.nodes.map((n) => [n.code, n.capacity]));
  if (stable(snapCap) !== stable(nowCap)) changed.push("seats");

  const snapPass = roundRates(Object.fromEntries(snap.curriculum.map((c) => [c.code, c.pass_rate])));
  if (stable(snapPass) !== stable(roundRates(meta.course_pass_rates))) changed.push("pass rates");

  const snapOcc = (cfg.initial_state as { occupancy?: Record<string, number> } | undefined)?.occupancy ?? {};
  if (stable(snapOcc) !== stable(meta.initial_state?.occupancy ?? {})) changed.push("other-program seats");

  const snapPast = ((cfg.current_students as { past_intakes?: unknown[] } | undefined)?.past_intakes ?? []);
  if (stable(snapPast) !== stable(meta.current_students?.past_intakes ?? [])) changed.push("past intakes");

  if ((cfg.section_size ?? 35) !== meta.section_size) changed.push("section size");
  return changed;
}

export function bestPointNear(points: IntakePoint[], n: number | null): IntakePoint | null {
  if (n == null || points.length === 0) return null;
  return points.reduce((best, p) => (Math.abs(p.intake - n) < Math.abs(best.intake - n) ? p : best), points[0]);
}

export function downloadCsv(filename: string, rows: (string | number)[][]): void {
  const esc = (v: string | number) => {
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const text = rows.map((r) => r.map(esc).join(",")).join("\n") + "\n";
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
