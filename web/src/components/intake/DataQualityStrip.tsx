"use client";

import type { DataQuality, MetaResponse } from "@/types/simulation";

// How much of the input is real QU data vs an estimate. Uses the analysis's own record when one
// is shown (what the result was built on), otherwise today's tags from /meta.
function fromMeta(meta: MetaResponse): DataQuality {
  const codes = meta.graph.nodes.map((n) => n.code);
  const ds = meta.data_sources ?? {};
  const count = (tags?: Record<string, string>) => {
    const qu = codes.filter((c) => tags?.[c] === "qu").length;
    return { qu, estimate: codes.length - qu, total: codes.length };
  };
  const capacity = count(ds.capacity);
  const passRate = count(ds.pass_rate);
  const entered = (meta.current_students?.past_intakes ?? []).filter((e) => e.size > 0).length;
  return {
    capacity,
    pass_rate: passRate,
    past_intakes: { entered, source: ds.past_intakes ?? "estimate" },
    occupancy: ds.occupancy ?? "estimate",
    as_of: meta.planning?.data_as_of ?? null,
    // Same rule as src/intake.py::data_quality.
    illustrative: capacity.qu * 2 < capacity.total || passRate.qu * 2 < passRate.total || entered === 0,
  };
}

function Tag({ qu }: { qu: boolean }) {
  return (
    <span className={`rounded px-1.5 py-0.5 text-[10.5px] font-semibold ${qu ? "bg-good/15 text-good" : "bg-warn/15 text-warn"}`}>
      {qu ? "QU data" : "Estimate"}
    </span>
  );
}

export default function DataQualityStrip({ quality, meta }: { quality?: DataQuality | null; meta: MetaResponse }) {
  const q = quality ?? fromMeta(meta);
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-xl border border-border bg-surface px-4 py-2.5 text-sm">
      {q.illustrative && (
        <span className="rounded-full bg-warn/15 px-2.5 py-0.5 text-xs font-bold uppercase tracking-wide text-warn">
          Illustrative
        </span>
      )}
      <span className="text-muted">
        Seats: <b className="text-ink">{q.capacity.qu}</b> of {q.capacity.total} QU data
      </span>
      <span className="text-muted">
        Pass rates: <b className="text-ink">{q.pass_rate.qu}</b> of {q.pass_rate.total} QU data
      </span>
      <span className="flex items-center gap-1.5 text-muted">
        Past intakes ({q.past_intakes.entered} entered) <Tag qu={q.past_intakes.source === "qu"} />
      </span>
      <span className="flex items-center gap-1.5 text-muted">
        Other-program seats <Tag qu={q.occupancy === "qu"} />
      </span>
      {q.as_of && <span className="text-muted">Data as of: <b className="text-ink">{q.as_of}</b></span>}
    </div>
  );
}
