import type { StudentTrace, StudentTraceTerm } from "@/types/simulation";
import { SIGNAL_META } from "@/lib/signalMeta";

// Export a single student's trace for meeting notes: raw JSON (matches the API payload) and a
// self-contained, print-friendly HTML page (open it and Ctrl+P → Save as PDF). No dependencies —
// everything is inlined so the .html file works offline.

function downloadTextFile(filename: string, mime: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: `${mime};charset=utf-8` }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function exportTraceJson(trace: StudentTrace) {
  downloadTextFile(`student-${trace.student_id}-trace.json`, "application/json", JSON.stringify(trace, null, 2));
}

export function exportTracePrintable(trace: StudentTrace) {
  downloadTextFile(`student-${trace.student_id}-trace.html`, "text/html", traceToHtml(trace));
}

const STATUS_LABEL: Record<string, string> = {
  GRADUATED: "Graduated",
  DROPPED: "Dropped out",
  CENSORED: "Ran out of time",
  DELAYED: "Delayed",
  ACTIVE: "On track",
};

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

function coursesCell(t: StudentTraceTerm): string {
  if (t.courses.length === 0) return '<span class="muted">—</span>';
  return t.courses
    .map((c) => {
      const cls = c.passed ? "pass" : "fail";
      const retake = c.attempt_no > 1 ? ` <span class="muted">· retake #${c.attempt_no}</span>` : "";
      return `<span class="chip ${cls}" title="${esc(c.title)}">${esc(c.code)} <b>${esc(c.grade)}</b>${retake}</span>`;
    })
    .join(" ");
}

function blockedCell(t: StudentTraceTerm): string {
  const notable = t.blocked.filter((b) => b.signal !== "prereq");
  const prereqCount = t.blocked.length - notable.length;
  const parts = notable.map(
    (b) => `<span class="chip block" title="${esc(SIGNAL_META[b.signal].unit)}">${esc(b.code)} · ${SIGNAL_META[b.signal].label}</span>`,
  );
  if (prereqCount > 0) parts.push(`<span class="muted">waiting on prerequisites for ${prereqCount} course${prereqCount > 1 ? "s" : ""}</span>`);
  return parts.length ? parts.join(" ") : '<span class="muted">—</span>';
}

export function traceToHtml(trace: StudentTrace): string {
  const progress = Math.round((trace.completed_ch / trace.total_program_ch) * 100);
  const ability =
    trace.ability_score > 0.03 ? "above-average aptitude" : trace.ability_score < -0.03 ? "below-average aptitude" : "average aptitude";
  const rows = trace.terms
    .map(
      (t) => `
      <tr>
        <td class="num">${t.personal_semester}</td>
        <td>${esc(t.label)}</td>
        <td>${coursesCell(t)}</td>
        <td>${blockedCell(t)}</td>
        <td class="num">${t.gpa.toFixed(2)}${t.on_probation ? ' <span class="warn">•</span>' : ""}</td>
        <td class="num">${t.completed_ch}</td>
        <td>${esc(STATUS_LABEL[t.status] ?? t.status)}</td>
      </tr>`,
    )
    .join("");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Student #${trace.student_id} — trace</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { font: 13px/1.5 -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif; color: #1a1a1a; margin: 32px; background: #fff; }
  h1 { font-size: 22px; margin: 0 0 2px; }
  .sub { color: #666; margin: 0 0 16px; }
  .meta { display: flex; flex-wrap: wrap; gap: 20px; margin: 0 0 20px; padding: 12px 16px; border: 1px solid #e2e2e2; border-radius: 10px; }
  .meta div { font-size: 12px; }
  .meta .k { color: #888; text-transform: uppercase; letter-spacing: .04em; font-size: 10px; }
  .meta .v { font-size: 16px; font-weight: 700; }
  table { border-collapse: collapse; width: 100%; }
  th, td { text-align: left; padding: 7px 9px; border-bottom: 1px solid #ececec; vertical-align: top; }
  th { font-size: 10px; text-transform: uppercase; letter-spacing: .05em; color: #888; border-bottom: 1.5px solid #ddd; }
  td.num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  tr { break-inside: avoid; }
  .chip { display: inline-block; padding: 1px 6px; border-radius: 6px; border: 1px solid #ccc; font-size: 11.5px; margin: 1px 0; white-space: nowrap; }
  .chip.pass { border-color: #9ad0a8; background: #f2faf4; }
  .chip.fail { border-color: #e6a99b; background: #fdf3f0; }
  .chip.block { border-color: #e6c98a; background: #fdf8ec; }
  .muted { color: #999; }
  .warn { color: #b0392b; }
  .pill { display: inline-block; padding: 2px 10px; border-radius: 999px; font-weight: 600; font-size: 12px; border: 1px solid #ccc; }
  .foot { margin-top: 22px; color: #999; font-size: 11px; }
  @media print { body { margin: 12mm; } .meta { break-inside: avoid; } }
</style>
</head>
<body>
  <h1>Student #${trace.student_id} <span class="pill">${esc(STATUS_LABEL[trace.final_status] ?? trace.final_status)}</span></h1>
  <p class="sub">Cohort ${trace.cohort_id} · ${ability} · ${esc(trace.final_reason)}</p>
  <div class="meta">
    <div><div class="k">Final GPA</div><div class="v">${trace.gpa.toFixed(2)}</div></div>
    <div><div class="k">Progress</div><div class="v">${progress}%</div><div class="muted">${trace.completed_ch}/${trace.total_program_ch} CH</div></div>
    <div><div class="k">Semesters</div><div class="v">${trace.grad_semester ?? trace.terms.length}</div></div>
  </div>
  <table>
    <thead>
      <tr><th>Sem</th><th>Term</th><th>Courses</th><th>Blocked</th><th>GPA</th><th>CH</th><th>Status</th></tr>
    </thead>
    <tbody>${rows}
    </tbody>
  </table>
  <p class="foot">Generated from the Single-Cohort Flow Simulator · synthetic student · deterministic (CRN) baseline run.</p>
</body>
</html>`;
}
