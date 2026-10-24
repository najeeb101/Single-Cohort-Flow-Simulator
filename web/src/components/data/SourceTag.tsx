"use client";

import type { DataSource } from "@/types/simulation";

// "QU data" vs "Estimate" label for one value or a whole table. Clickable when editable, so staff
// can mark a number as confirmed once it comes from the Registrar or the schedule.
export default function SourceTag({
  value,
  onChange,
}: {
  value: DataSource | undefined;
  onChange?: (next: DataSource) => void;
}) {
  const qu = value === "qu";
  const cls = `rounded px-1.5 py-0.5 text-[10.5px] font-semibold whitespace-nowrap ${
    qu ? "bg-good/15 text-good" : "bg-warn/15 text-warn"
  }`;
  if (!onChange) return <span className={cls}>{qu ? "QU data" : "Estimate"}</span>;
  return (
    <button
      type="button"
      onClick={() => onChange(qu ? "estimate" : "qu")}
      title={qu ? "Marked as QU data. Click to mark as an estimate." : "An estimate. Click to mark as QU data."}
      className={`${cls} hover:opacity-80`}
    >
      {qu ? "QU data" : "Estimate"}
    </button>
  );
}
