"use client";

import { useMemo, useRef, useState } from "react";
import type { CourseRecord } from "@/types/simulation";
import Modal from "@/components/Modal";

export const STANDING_NODES = ["Year2", "Year3", "Year4"] as const;

export interface InitialStateImportResult {
  occupancy: Record<string, number>;
  standing: Record<string, number>;
  skipped: { row: string; reason: string }[];
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
export function mapRowsToInitialState(rows: string[][], courses: CourseRecord[]): InitialStateImportResult {
  const result: InitialStateImportResult = { occupancy: {}, standing: {}, skipped: [] };
  if (rows.length === 0) return result;

  const standingByUpper = new Map(STANDING_NODES.map((n) => [n.toUpperCase(), n]));
  const courseByUpper = new Map(courses.map((c) => [c.code.toUpperCase(), c.code]));

  // Treat the first row as a header (labels) when its second cell isn't a number.
  let dataRows = rows;
  const first = rows[0];
  const firstValueLooksNumeric = first.length >= 2 && first[1] !== "" && Number.isFinite(Number(first[1]));
  if (!firstValueLooksNumeric) dataRows = rows.slice(1);

  for (const cells of dataRows) {
    const label = cells.join(",");
    if (cells.length < 2) {
      result.skipped.push({ row: label, reason: "malformed row" });
      continue;
    }
    const key = cells[0].trim();
    const upper = key.toUpperCase();
    const value = Number(cells[1]);
    if (!Number.isFinite(value) || value < 0) {
      result.skipped.push({ row: label, reason: "invalid value" });
      continue;
    }
    const standingNode = standingByUpper.get(upper);
    if (standingNode) {
      result.standing[standingNode] = value;
      continue;
    }
    const courseCode = courseByUpper.get(upper);
    if (courseCode) {
      result.occupancy[courseCode] = value;
      continue;
    }
    result.skipped.push({ row: label, reason: "unknown code" });
  }

  return result;
}

// CSV adapter: split text into rows of cells, then hand off to the shared mapper. Public
// signature/behavior unchanged, so the reactive textarea preview keeps working as before.
export function parseInitialStateCsv(raw: string, courses: CourseRecord[]): InitialStateImportResult {
  const rows = raw
    .split(/\r\n|\r|\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .map((line) => line.split(",").map(stripQuotes));
  return mapRowsToInitialState(rows, courses);
}

interface Props {
  open: boolean;
  onClose: () => void;
  courses: CourseRecord[];
  onApply: (result: { occupancy: Record<string, number>; standing: Record<string, number> }) => void;
}

const SKIPPED_PREVIEW_LIMIT = 10;

export default function InitialStateImportModal({ open, onClose, courses, onApply }: Props) {
  const [text, setText] = useState("");
  // A binary spreadsheet can't live in the textarea, so its parsed result is held separately
  // and takes precedence over the pasted/CSV text. The two sources are kept mutually exclusive:
  // uploading a spreadsheet clears the text, and editing the text clears the file result.
  const [fileResult, setFileResult] = useState<InitialStateImportResult | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const textResult = useMemo(() => parseInitialStateCsv(text, courses), [text, courses]);
  const result = fileResult ?? textResult;
  const occupancyCount = Object.keys(result.occupancy).length;
  const standingCount = Object.keys(result.standing).length;
  const hasAnything = occupancyCount > 0 || standingCount > 0;

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
      setFileResult(mapRowsToInitialState(rows, courses));
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
        auto-detected. Rows use either a course code (occupancy) or <code className="rounded bg-black/20 px-1 py-0.5">Year2</code>/
        <code className="rounded bg-black/20 px-1 py-0.5">Year3</code>/<code className="rounded bg-black/20 px-1 py-0.5">Year4</code> (standing).
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
      </div>

      {error && <p className="mt-2 text-[12px] text-bad">{error}</p>}

      {(fileResult !== null || text.trim().length > 0) && (
        <div className="mt-3 rounded-lg border border-border bg-surface-2 px-3 py-2 text-[12px]">
          {fileName && (
            <p className="mb-1 text-muted">
              Loaded from <span className="font-semibold text-ink">{fileName}</span>
            </p>
          )}
          {hasAnything ? (
            <p className="text-ink">
              <b>{occupancyCount}</b> occupancy row{occupancyCount === 1 ? "" : "s"} and <b>{standingCount}</b> standing
              row{standingCount === 1 ? "" : "s"} will be applied.
            </p>
          ) : (
            <p className="text-muted">Nothing to import — no valid rows found.</p>
          )}
          {result.skipped.length > 0 && (
            <p className="mt-1 text-bad">
              {result.skipped.length} row{result.skipped.length === 1 ? "" : "s"} skipped:{" "}
              {result.skipped
                .slice(0, SKIPPED_PREVIEW_LIMIT)
                .map((s) => `${s.row} (${s.reason})`)
                .join(", ")}
              {result.skipped.length > SKIPPED_PREVIEW_LIMIT && ` +${result.skipped.length - SKIPPED_PREVIEW_LIMIT} more`}
            </p>
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
