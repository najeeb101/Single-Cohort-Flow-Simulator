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

// Pure, no-I/O parser: two columns `key,value`. `key` first tries to match a standing node
// (Year2/Year3/Year4), then a course code — both case-insensitively — so one CSV can set
// occupancy and standing head-counts in a single import. Never aborts on a bad row; each row
// is independently applied or skipped with a reason.
export function parseInitialStateCsv(raw: string, courses: CourseRecord[]): InitialStateImportResult {
  const result: InitialStateImportResult = { occupancy: {}, standing: {}, skipped: [] };

  const lines = raw
    .split(/\r\n|\r|\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length === 0) return result;

  const standingByUpper = new Map(STANDING_NODES.map((n) => [n.toUpperCase(), n]));
  const courseByUpper = new Map(courses.map((c) => [c.code.toUpperCase(), c.code]));

  const parseLine = (line: string): string[] => line.split(",").map(stripQuotes);

  let dataLines = lines;
  const firstCells = parseLine(lines[0]);
  const firstValueLooksNumeric = firstCells.length >= 2 && firstCells[1] !== "" && Number.isFinite(Number(firstCells[1]));
  if (!firstValueLooksNumeric) dataLines = lines.slice(1);

  for (const line of dataLines) {
    const cells = parseLine(line);
    if (cells.length < 2) {
      result.skipped.push({ row: line, reason: "malformed row" });
      continue;
    }
    const [rawKey, rawValue] = cells;
    const key = rawKey.trim();
    const upper = key.toUpperCase();
    const value = Number(rawValue);
    if (!Number.isFinite(value) || value < 0) {
      result.skipped.push({ row: line, reason: "invalid value" });
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
    result.skipped.push({ row: line, reason: "unknown code" });
  }

  return result;
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
  const fileInputRef = useRef<HTMLInputElement>(null);

  const result = useMemo(() => parseInitialStateCsv(text, courses), [text, courses]);
  const occupancyCount = Object.keys(result.occupancy).length;
  const standingCount = Object.keys(result.standing).length;
  const hasAnything = occupancyCount > 0 || standingCount > 0;

  const handleClose = () => {
    setText("");
    onClose();
  };

  const handleFile = (file: File) => {
    file.text().then(setText);
  };

  const handleApply = () => {
    onApply({ occupancy: result.occupancy, standing: result.standing });
    handleClose();
  };

  return (
    <Modal open={open} onClose={handleClose} title="Import initial state from CSV">
      <p className="mb-2.5 text-xs text-muted">
        Two columns: <code className="rounded bg-black/20 px-1 py-0.5">code,value</code>. A header row is
        auto-detected. Rows use either a course code (occupancy) or <code className="rounded bg-black/20 px-1 py-0.5">Year2</code>/
        <code className="rounded bg-black/20 px-1 py-0.5">Year3</code>/<code className="rounded bg-black/20 px-1 py-0.5">Year4</code> (standing).
      </p>

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={"code,value\nYear2,40\nCMPS303,30"}
        className="h-32 w-full resize-y rounded-[8px] border border-border-2 bg-surface-2 px-2.5 py-1.5 font-mono text-[12.5px] text-ink focus:outline-none focus:ring-1 focus:ring-accent"
      />

      <div className="mt-2 flex items-center gap-2">
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFile(file);
            e.target.value = "";
          }}
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="rounded-md border border-border-2 px-2.5 py-1 text-[11px] font-semibold text-ink hover:bg-surface-2"
        >
          Upload .csv file
        </button>
      </div>

      {text.trim().length > 0 && (
        <div className="mt-3 rounded-lg border border-border bg-surface-2 px-3 py-2 text-[12px]">
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
