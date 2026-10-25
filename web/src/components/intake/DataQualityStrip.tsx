"use client";

import type { DataQuality, MetaResponse } from "@/types/simulation";
import { Pill } from "@/components/ui";

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

// One row of soft pills: how much of the input is QU data, CoAdvisor-style.
export default function DataQualityStrip({ quality, meta }: { quality?: DataQuality | null; meta: MetaResponse }) {
  const q = quality ?? fromMeta(meta);
  const tone = (qu: boolean) => (qu ? "good" : "neutral") as "good" | "neutral";
  return (
    <div className="flex flex-wrap items-center gap-2">
      {q.illustrative ? <Pill tone="warn">Illustrative: mostly estimates</Pill> : <Pill tone="good">Mostly QU data</Pill>}
      <Pill tone={tone(q.capacity.qu * 2 >= q.capacity.total)}>
        Seats <b className="font-semibold">{`${q.capacity.qu}/${q.capacity.total}`}</b> QU data
      </Pill>
      <Pill tone={tone(q.pass_rate.qu * 2 >= q.pass_rate.total)}>
        Pass rates <b className="font-semibold">{`${q.pass_rate.qu}/${q.pass_rate.total}`}</b> QU data
      </Pill>
      <Pill tone={tone(q.past_intakes.source === "qu")}>
        {q.past_intakes.entered} past intakes · {q.past_intakes.source === "qu" ? "QU data" : "estimate"}
      </Pill>
      <Pill tone={tone(q.occupancy === "qu")}>Other-program seats · {q.occupancy === "qu" ? "QU data" : "estimate"}</Pill>
      {q.as_of && <span className="text-[13px] text-muted">Data as of {q.as_of}</span>}
    </div>
  );
}
