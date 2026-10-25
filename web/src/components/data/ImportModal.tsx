"use client";

import { useMemo, useRef, useState } from "react";
import Modal from "@/components/Modal";
import type { CourseRecord } from "@/types/simulation";

// One row of the import preview: applied, overwritten by a later row for the same key, or
// skipped with a reason. A bad row never stops the rest of the file.
export interface ImportRow {
  key: string;
  value: string;
  status: "ok" | "duplicate" | "skipped";
  note: string;
}

export interface ImportResult<T> {
  value: T;
  count: number;
  rows: ImportRow[];
}

export type RowMapper<T> = (rows: string[][]) => ImportResult<T>;

function stripQuotes(cell: string): string {
  return cell.replace(/^"(.*)"$/, "$1").trim();
}

function splitCsv(raw: string): string[][] {
  return raw
    .split(/\r\n|\r|\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .map((line) => line.split(",").map(stripQuotes));
}

// Drop a header row: the first row counts as one when its second cell isn't a number.
export function withoutHeader(rows: string[][]): string[][] {
  const first = rows[0];
  if (!first) return rows;
  const numeric = first.length >= 2 && first[1] !== "" && Number.isFinite(Number(String(first[1]).replace("%", "")));
  return numeric ? rows : rows.slice(1);
}

// Two columns "course code, number". `parse` turns the cell into the stored value or returns an
// error note. Course codes match case-insensitively; the last row for a course wins.
export function courseValueMapper(
  courses: CourseRecord[],
  parse: (cell: string) => number | string,
): RowMapper<Record<string, number>> {
  const byUpper = new Map(courses.map((c) => [c.code.toUpperCase(), c.code]));
  return (raw) => {
    const value: Record<string, number> = {};
    const rows: ImportRow[] = [];
    const lastIndex = new Map<string, number>();
    withoutHeader(raw).forEach((cells) => {
      const key = (cells[0] ?? "").trim();
      const cell = (cells[1] ?? "").trim();
      const code = byUpper.get(key.toUpperCase());
      if (cells.length < 2) return rows.push({ key, value: cell, status: "skipped", note: "missing value" });
      if (!code) return rows.push({ key, value: cell, status: "skipped", note: "unknown course code" });
      const parsed = parse(cell);
      if (typeof parsed === "string") return rows.push({ key, value: cell, status: "skipped", note: parsed });
      const prev = lastIndex.get(code);
      if (prev !== undefined) rows[prev] = { ...rows[prev], status: "duplicate", note: `overwritten by a later ${code} row` };
      lastIndex.set(code, rows.length);
      value[code] = parsed;
      rows.push({ key, value: cell, status: "ok", note: code });
    });
    return { value, count: Object.keys(value).length, rows };
  };
}

export function nonNegativeInt(cell: string): number | string {
  const n = Number(cell);
  if (!Number.isFinite(n)) return "not a number";
  if (n < 0) return "negative";
  return Math.round(n);
}

// Pass rates may be typed as 0.85, 85 or 85%.
export function passRate(cell: string): number | string {
  const pctSign = cell.endsWith("%");
  const n = Number(cell.replace("%", ""));
  if (!Number.isFinite(n)) return "not a number";
  const rate = pctSign || n > 1 ? n / 100 : n;
  if (rate < 0 || rate > 1) return "must be between 0 and 100%";
  return Math.round(rate * 10000) / 10000;
}

interface Props<T> {
  open: boolean;
  onClose: () => void;
  title: string;
  help: string;
  sampleCsv: string;
  sampleName: string;
  mapRows: RowMapper<T>;
  onApply: (value: T) => void;
}

// CSV or Excel import shared by every Data tab: paste or upload, preview each row's fate, apply.
// The ~1 MB SheetJS library is loaded only when a spreadsheet is actually uploaded.
export default function ImportModal<T>({ open, onClose, title, help, sampleCsv, sampleName, mapRows, onApply }: Props<T>) {
  const [text, setText] = useState("");
  const [fileRows, setFileRows] = useState<string[][] | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const result = useMemo(() => mapRows(fileRows ?? splitCsv(text)), [mapRows, fileRows, text]);
  const hasInput = fileRows !== null || text.trim().length > 0;

  const reset = () => {
    setText("");
    setFileRows(null);
    setFileName(null);
    setError(null);
  };
  const close = () => {
    reset();
    onClose();
  };

  const readFile = async (file: File) => {
    const spreadsheet = /\.(xlsx|xls)$/i.test(file.name) || file.type.includes("spreadsheet") || file.type === "application/vnd.ms-excel";
    if (!spreadsheet) {
      const t = await file.text();
      reset();
      setText(t);
      return;
    }
    try {
      const XLSX = await import("xlsx");
      const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
      let rows: string[][] = [];
      for (const name of wb.SheetNames) {
        const aoa = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name], { header: 1, blankrows: false, defval: "" });
        if (aoa.length > 0) {
          rows = aoa.map((r) => r.slice(0, 2).map((c) => String(c ?? "").trim()));
          break;
        }
      }
      setText("");
      setError(null);
      setFileName(file.name);
      setFileRows(rows);
    } catch {
      reset();
      setError("Couldn't read that spreadsheet. Make sure it's a valid .xlsx or .xls file.");
    }
  };

  const downloadSample = () => {
    const url = URL.createObjectURL(new Blob([sampleCsv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = sampleName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const skipped = result.rows.filter((r) => r.status === "skipped").length;
  const dups = result.rows.filter((r) => r.status === "duplicate").length;

  return (
    <Modal open={open} onClose={close} title={title}>
      <p className="mb-2.5 text-xs text-muted">
        {help} A header row is detected automatically. Paste below, or upload a .csv or Excel (.xlsx/.xls) file; its first
        sheet&apos;s first two columns are read.
      </p>
      <textarea
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setFileRows(null);
          setFileName(null);
        }}
        placeholder={sampleCsv}
        className="h-32 w-full resize-y rounded-lg border border-border-2 bg-surface-2 px-2.5 py-1.5 font-mono text-sm text-ink focus:outline-none focus:ring-1 focus:ring-accent"
      />
      <div className="mt-2 flex items-center gap-2">
        <input
          ref={inputRef}
          type="file"
          accept=".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void readFile(f);
            e.target.value = "";
          }}
        />
        <button type="button" onClick={() => inputRef.current?.click()} className="rounded-md border border-border-2 px-2.5 py-1 text-xs font-semibold text-ink hover:bg-surface-2">
          Upload file
        </button>
        <button type="button" onClick={downloadSample} className="rounded-md border border-border-2 px-2.5 py-1 text-xs font-semibold text-ink hover:bg-surface-2">
          Download sample CSV
        </button>
      </div>
      {error && <p className="mt-2 text-sm text-bad">{error}</p>}

      {hasInput && (
        <div className="mt-3 overflow-hidden rounded-lg border border-border bg-surface-2 text-sm">
          {fileName && <p className="border-b border-border px-3 py-1.5 text-muted">Loaded from <b className="text-ink">{fileName}</b></p>}
          {result.rows.length === 0 ? (
            <p className="px-3 py-2 text-muted">Nothing to import: no rows found.</p>
          ) : (
            <>
              <div className="flex flex-wrap gap-x-3 px-3 py-1.5 text-xs">
                <span className="text-good"><b>{result.count}</b> to apply</span>
                {dups > 0 && <span className="text-warn"><b>{dups}</b> duplicate</span>}
                {skipped > 0 && <span className="text-bad"><b>{skipped}</b> skipped</span>}
              </div>
              <div className="max-h-48 overflow-y-auto border-t border-border">
                <table className="w-full border-collapse text-left">
                  <thead className="sticky top-0 bg-surface-2 text-[10.5px] uppercase tracking-wide text-muted">
                    <tr>
                      <th className="px-3 py-1 font-semibold">First column</th>
                      <th className="px-3 py-1 font-semibold">Value</th>
                      <th className="px-3 py-1 font-semibold">Result</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.rows.map((r, i) => (
                      <tr key={i} className="border-t border-border/60">
                        <td className="px-3 py-1 font-mono text-ink">{r.key || "-"}</td>
                        <td className="px-3 py-1 font-mono text-ink">{r.value || "-"}</td>
                        <td className={`px-3 py-1 font-medium ${r.status === "ok" ? "text-good" : r.status === "duplicate" ? "text-warn" : "text-bad"}`}>
                          {r.status === "ok" ? `Applied: ${r.note}` : r.status === "duplicate" ? `Duplicate: ${r.note}` : `Skipped: ${r.note}`}
                        </td>
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
        <button type="button" onClick={close} className="rounded-xl border border-border-2 px-3.5 py-1.5 text-sm font-semibold text-ink hover:bg-surface-2">
          Cancel
        </button>
        <button
          type="button"
          onClick={() => {
            onApply(result.value);
            close();
          }}
          disabled={result.count === 0}
          className="rounded-xl bg-primary px-3.5 py-1.5 text-sm font-semibold text-primary-ink disabled:cursor-not-allowed disabled:opacity-50"
        >
          Apply
        </button>
      </div>
    </Modal>
  );
}
