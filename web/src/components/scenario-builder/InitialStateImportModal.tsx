"use client";

import { useMemo, useRef, useState } from "react";
import type { CourseRecord } from "@/types/simulation";
import Modal from "@/components/Modal";

// Default year-standing keys (a 4-year program). Callers with a plan's real
// `year_standing_thresholds` pass its own bands via `standingLevelsFromThresholds`, so a
// program that isn't 4 years long recognizes the right standing keys (Year2..Year(K+1)).
export const STANDING_NODES = ["Year2", "Year3", "Year4"] as const;

// Valid standing keys for a plan = every year band above Year1 (Year1 is the incoming cohort,
// not warm-start standing). K thresholds -> K+1 year bands -> Year2..Year(K+1). Falls back to
// the default when thresholds are missing/empty.
export function standingLevelsFromThresholds(thresholds: number[] | undefined): string[] {
  if (!thresholds || thresholds.length === 0) return [...STANDING_NODES];
  return Array.from({ length: thresholds.length }, (_, i) => `Year${i + 2}`);
}

// Per-row classification for the import preview table. A row is either applied (occupancy or
// standing), superseded by a later row for the same key (duplicate — last write wins), or
// skipped with a reason. Purely additive to the result: existing consumers read only
// occupancy/standing/skipped and are unaffected by the new `rows`.
export type PreviewStatus =
  | "occupancy"
  | "standing"
  | "duplicate"
  | "malformed"
  | "non-numeric"
  | "negative"
  | "unknown";

export interface PreviewRow {
  key: string; // first cell, trimmed
  value: string; // second cell as typed (shown verbatim in the preview)
  target: string; // canonical course code / standing node when resolved, else ""
  status: PreviewStatus;
}

export interface InitialStateImportResult {
  occupancy: Record<string, number>;
  standing: Record<string, number>;
  skipped: { row: string; reason: string }[];
  rows: PreviewRow[];
}

// Back-compat reason strings for the `skipped` list (unchanged wording).
function skipReason(status: PreviewStatus): string {
  if (status === "malformed") return "malformed row";
  if (status === "unknown") return "unknown code";
  return "invalid value"; // non-numeric / negative
}

function stripQuotes(cell: string): string {
  return cell.replace(/^"(.*)"$/, "$1").trim();
}

// Shared, pure row -> {occupancy, standing, skipped} mapper used by BOTH the CSV parser and
// the spreadsheet (.xlsx) reader, so the two formats converge on one set of rules. Two columns
// `key,value`: `key` first tries a standing node (Year2/Year3/Year4), then a course code —
// both case-insensitively — so one file can set occupancy and standing head-counts at once. A
// header row is auto-detected. Never aborts on a bad row; each row is applied or skipped with a
// reason.
export function mapRowsToInitialState(
  rows: string[][],
  courses: CourseRecord[],
  standingNodes: readonly string[] = STANDING_NODES,
): InitialStateImportResult {
  const result: InitialStateImportResult = { occupancy: {}, standing: {}, skipped: [], rows: [] };
  if (rows.length === 0) return result;

  const standingByUpper = new Map(standingNodes.map((n) => [n.toUpperCase(), n]));
  const courseByUpper = new Map(courses.map((c) => [c.code.toUpperCase(), c.code]));

  // Treat the first row as a header (labels) when its second cell isn't a number.
  let dataRows = rows;
  const first = rows[0];
  const firstValueLooksNumeric = first.length >= 2 && first[1] !== "" && Number.isFinite(Number(first[1]));
  if (!firstValueLooksNumeric) dataRows = rows.slice(1);

  // First pass: classify each data row on its own (malformed / bad value / resolved target).
  const preview: PreviewRow[] = dataRows.map((cells) => {
    const key = (cells[0] ?? "").trim();
    const rawValue = (cells[1] ?? "").trim();
    if (cells.length < 2) return { key, value: rawValue, target: "", status: "malformed" };
    const value = Number(cells[1]);
    if (!Number.isFinite(value)) return { key, value: rawValue, target: "", status: "non-numeric" };
    if (value < 0) return { key, value: rawValue, target: "", status: "negative" };
    const node = standingByUpper.get(key.toUpperCase());
    if (node) return { key, value: rawValue, target: node, status: "standing" };
    const code = courseByUpper.get(key.toUpperCase());
    if (code) return { key, value: rawValue, target: code, status: "occupancy" };
    return { key, value: rawValue, target: "", status: "unknown" };
  });

  // Second pass: when the same target appears more than once, last write wins (the aggregate
  // behavior is unchanged) — flag every earlier occurrence as a duplicate so the preview shows it.
  const lastIndexByTarget = new Map<string, number>();
  preview.forEach((row, i) => {
    if (row.status === "occupancy" || row.status === "standing") lastIndexByTarget.set(row.target, i);
  });
  preview.forEach((row, i) => {
    if ((row.status === "occupancy" || row.status === "standing") && lastIndexByTarget.get(row.target) !== i) {
      row.status = "duplicate";
    }
  });

  // Aggregate the surviving rows; keep `skipped` populated exactly as before for back-compat.
  for (const row of preview) {
    if (row.status === "standing") result.standing[row.target] = Number(row.value);
    else if (row.status === "occupancy") result.occupancy[row.target] = Number(row.value);
    else if (row.status !== "duplicate") result.skipped.push({ row: `${row.key},${row.value}`, reason: skipReason(row.status) });
  }

  result.rows = preview;
  return result;
}

function statusColor(status: PreviewStatus): string {
  if (status === "occupancy" || status === "standing") return "text-good";
  if (status === "duplicate") return "text-warn";
  return "text-bad";
}

function statusLabel(row: PreviewRow): string {
  switch (row.status) {
    case "occupancy":
      return `Occupancy → ${row.target}`;
    case "standing":
      return `Standing → ${row.target}`;
    case "duplicate":
      return `Duplicate of ${row.target} (overwritten)`;
    case "malformed":
      return "Skipped: malformed row";
    case "non-numeric":
      return "Skipped: not a number";
    case "negative":
      return "Skipped: negative value";
    case "unknown":
      return "Skipped: unknown code";
  }
}

// CSV adapter: split text into rows of cells, then hand off to the shared mapper. Public
// signature/behavior unchanged, so the reactive textarea preview keeps working as before.
export function parseInitialStateCsv(
  raw: string,
  courses: CourseRecord[],
  standingNodes: readonly string[] = STANDING_NODES,
): InitialStateImportResult {
  const rows = raw
    .split(/\r\n|\r|\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .map((line) => line.split(",").map(stripQuotes));
  return mapRowsToInitialState(rows, courses, standingNodes);
}

interface Props {
  open: boolean;
  onClose: () => void;
  courses: CourseRecord[];
  standingNodes?: readonly string[]; // the plan's year bands above Year1; defaults to Year2/3/4
  onApply: (result: { occupancy: Record<string, number>; standing: Record<string, number> }) => void;
}

export default function InitialStateImportModal({ open, onClose, courses, standingNodes = STANDING_NODES, onApply }: Props) {
  const [text, setText] = useState("");
  // A binary spreadsheet can't live in the textarea, so its parsed result is held separately
  // and takes precedence over the pasted/CSV text. The two sources are kept mutually exclusive:
  // uploading a spreadsheet clears the text, and editing the text clears the file result.
  const [fileResult, setFileResult] = useState<InitialStateImportResult | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const textResult = useMemo(() => parseInitialStateCsv(text, courses, standingNodes), [text, courses, standingNodes]);
  const result = fileResult ?? textResult;
  const occupancyCount = Object.keys(result.occupancy).length;
  const standingCount = Object.keys(result.standing).length;
  const duplicateCount = result.rows.filter((r) => r.status === "duplicate").length;
  const hasAnything = occupancyCount > 0 || standingCount > 0;

  // A ready-to-import example built from this plan's own first standing band + earliest courses,
  // so the downloaded file always maps to real codes (importing it produces no "unknown code").
  const sampleCsv = useMemo(() => {
    const early = [...courses].sort((a, b) => a.study_plan_term - b.study_plan_term);
    const lines = ["code,value"];
    if (standingNodes.length > 0) lines.push(`${standingNodes[0]},10`);
    if (early[0]) lines.push(`${early[0].code},5`);
    if (early[1]) lines.push(`${early[1].code},0`);
    return lines.join("\n") + "\n";
  }, [courses, standingNodes]);

  const downloadSample = () => {
    const url = URL.createObjectURL(new Blob([sampleCsv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "initial-state-sample.csv";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const clearFile = () => {
    setFileResult(null);
    setFileName(null);
    setError(null);
  };

  const handleClose = () => {
    setText("");
    clearFile();
    onClose();
  };

  const handleTextChange = (value: string) => {
    setText(value);
    clearFile();
  };

  const handleCsvFile = (file: File) => {
    file.text().then((t) => {
      clearFile();
      setText(t);
    });
  };

  const handleSpreadsheet = async (file: File) => {
    try {
      const buf = await file.arrayBuffer();
      // Dynamic import so the ~1 MB SheetJS lib is a lazy chunk, fetched only on the first
      // spreadsheet upload rather than shipped in the initial bundle.
      const XLSX = await import("xlsx");
      const wb = XLSX.read(buf, { type: "array" });
      // First sheet that actually has rows (skips stray empty sheets). header:1 yields an
      // array-of-arrays in column order; keep only the first two columns and stringify so
      // numeric vs header cells behave exactly like the CSV path.
      let rows: string[][] = [];
      for (const name of wb.SheetNames) {
        const aoa = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name], { header: 1, blankrows: false, defval: "" });
        if (aoa.length > 0) {
          rows = aoa.map((r) => r.slice(0, 2).map((c) => String(c ?? "")));
          break;
        }
      }
      setText("");
      setError(null);
      setFileName(file.name);
      setFileResult(mapRowsToInitialState(rows, courses, standingNodes));
    } catch {
      clearFile();
      setError("Couldn't read that spreadsheet. Make sure it's a valid .xlsx or .xls file.");
    }
  };

  const handleFileInput = (file: File) => {
    const isSpreadsheet =
      /\.(xlsx|xls)$/i.test(file.name) || file.type.includes("spreadsheet") || file.type === "application/vnd.ms-excel";
    if (isSpreadsheet) handleSpreadsheet(file);
    else handleCsvFile(file);
  };

  const handleApply = () => {
    onApply({ occupancy: result.occupancy, standing: result.standing });
    handleClose();
  };

  return (
    <Modal open={open} onClose={handleClose} title="Import initial state from a file">
      <p className="mb-2.5 text-xs text-muted">
        Two columns: <code className="rounded bg-black/20 px-1 py-0.5">code,value</code>. A header row is
        auto-detected. Rows use either a course code (occupancy) or a year-standing key ({standingNodes.map((n, i) => (
          <span key={n}>{i > 0 ? "/" : ""}<code className="rounded bg-black/20 px-1 py-0.5">{n}</code></span>
        ))}) for standing.
        Paste below, or upload a <code className="rounded bg-black/20 px-1 py-0.5">.csv</code> or Excel{" "}
        <code className="rounded bg-black/20 px-1 py-0.5">.xlsx</code>/<code className="rounded bg-black/20 px-1 py-0.5">.xls</code> file.
        Its first sheet&apos;s first two columns are read the same way.
      </p>

      <textarea
        value={text}
        onChange={(e) => handleTextChange(e.target.value)}
        placeholder={"code,value\nYear2,40\nCOURSE101,30"}
        className="h-32 w-full resize-y rounded-[8px] border border-border-2 bg-surface-2 px-2.5 py-1.5 font-mono text-[12.5px] text-ink focus:outline-none focus:ring-1 focus:ring-accent"
      />

      <div className="mt-2 flex items-center gap-2">
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFileInput(file);
            e.target.value = "";
          }}
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="rounded-md border border-border-2 px-2.5 py-1 text-[11px] font-semibold text-ink hover:bg-surface-2"
        >
          Upload file
        </button>
        <button
          type="button"
          onClick={downloadSample}
          className="rounded-md border border-border-2 px-2.5 py-1 text-[11px] font-semibold text-ink hover:bg-surface-2"
        >
          Download sample CSV
        </button>
      </div>

      {error && <p className="mt-2 text-[12px] text-bad">{error}</p>}

      {(fileResult !== null || text.trim().length > 0) && (
        <div className="mt-3 overflow-hidden rounded-lg border border-border bg-surface-2 text-[12px]">
          {fileName && (
            <p className="border-b border-border px-3 py-1.5 text-muted">
              Loaded from <span className="font-semibold text-ink">{fileName}</span>
            </p>
          )}
          {result.rows.length === 0 ? (
            <p className="px-3 py-2 text-muted">Nothing to import — no rows found.</p>
          ) : (
            <>
              <div className="flex flex-wrap gap-x-3 gap-y-0.5 px-3 py-1.5 text-[11px]">
                <span className="text-good">
                  <b>{occupancyCount}</b> occupancy
                </span>
                <span className="text-good">
                  <b>{standingCount}</b> standing
                </span>
                {duplicateCount > 0 && (
                  <span className="text-warn">
                    <b>{duplicateCount}</b> duplicate
                  </span>
                )}
                {result.skipped.length > 0 && (
                  <span className="text-bad">
                    <b>{result.skipped.length}</b> skipped
                  </span>
                )}
              </div>
              <div className="max-h-48 overflow-y-auto border-t border-border">
                <table className="w-full border-collapse text-left">
                  <thead className="sticky top-0 bg-surface-2 text-[10.5px] uppercase tracking-wide text-muted">
                    <tr>
                      <th className="px-3 py-1 font-semibold">Key</th>
                      <th className="px-3 py-1 font-semibold">Value</th>
                      <th className="px-3 py-1 font-semibold">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.rows.map((row, i) => (
                      <tr key={i} className="border-t border-border/60">
                        <td className="px-3 py-1 font-mono text-ink">{row.key || <span className="text-muted">—</span>}</td>
                        <td className="px-3 py-1 font-mono text-ink">{row.value || <span className="text-muted">—</span>}</td>
                        <td className={`px-3 py-1 font-medium ${statusColor(row.status)}`}>{statusLabel(row)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}

      <div className="mt-4 flex justify-end gap-2">
        <button
          type="button"
          onClick={handleClose}
          className="rounded-[9px] border border-border-2 px-3.5 py-1.5 text-[13px] font-semibold text-ink hover:bg-surface-2"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleApply}
          disabled={!hasAnything}
          className="rounded-[9px] bg-accent px-3.5 py-1.5 text-[13px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          Apply
        </button>
      </div>
    </Modal>
  );
}
