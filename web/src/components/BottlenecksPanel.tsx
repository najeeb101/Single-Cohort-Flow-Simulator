"use client";

import { useState } from "react";
import type { Frame, TopBottlenecks } from "@/types/simulation";
import { SIGNAL_META, SIGNAL_ORDER, type SignalKey } from "@/lib/signalMeta";
import SignalLegend from "@/components/SignalLegend";
import Modal from "@/components/Modal";

// Card header + description per signal (a fuller register than the inline pill labels), plus the
// key into TopBottlenecks. Colours/fills/fields come from the shared SIGNAL_META so the cards,
// the legend, the Details charts, and the Student Trace pills can never drift apart.
const CARD: Record<SignalKey, { title: string; desc: string; list: keyof TopBottlenecks }> = {
  fail: { title: "Failures", desc: "Times a student sat the course and did not pass.", list: "fail" },
  capacity: { title: "Capacity blocks", desc: "Times a student requested a seat and was denied because the course was full.", list: "capacity" },
  offering: { title: "Offering blocks", desc: "Times an eligible student couldn't enrol because the course wasn't running that term.", list: "offering" },
  prereq: { title: "Prerequisite blocks", desc: "Times a student was ready to take the course but still missing a prerequisite.", list: "prereq" },
};

interface Detail {
  signal: SignalKey;
  code: string;
}

export default function BottlenecksPanel({ bottlenecks, frames }: { bottlenecks: TopBottlenecks; frames: Frame[] }) {
  const [active, setActive] = useState<Set<SignalKey>>(() => new Set(SIGNAL_ORDER));
  const [detail, setDetail] = useState<Detail | null>(null);

  const toggle = (k: SignalKey) =>
    setActive((prev) => {
      const next = new Set(prev);
      // Never let the last signal be switched off — an empty board is just confusing.
      if (next.has(k)) {
        if (next.size > 1) next.delete(k);
      } else next.add(k);
      return next;
    });

  const shown = SIGNAL_ORDER.filter((k) => active.has(k));

  return (
    <section className="py-6">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-[15px] font-bold">Top bottlenecks</h2>
          <p className="mt-0.5 max-w-2xl text-[12.5px] text-muted">
            The four reasons a student couldn&apos;t take a course they needed — ranked by how often each course
            caused the problem across the run. A course near the top of multiple lists is the deepest structural
            delay point in the curriculum.
          </p>
        </div>
        <SignalLegend active={active} onToggle={toggle} />
      </div>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(210px,1fr))] gap-3.5">
        {shown.map((k) => {
          const card = CARD[k];
          const info = SIGNAL_META[k];
          const list = bottlenecks[card.list];
          return (
            <div key={k} className={`rounded-2xl border border-border border-l-[3px] bg-surface p-4 ${info.border}`}>
              <h4 className="mb-0.5 flex items-center gap-1.5 text-xs uppercase tracking-wide">
                <span className={`h-2 w-2 rounded-full ${info.dot}`} aria-hidden />
                <span className="text-ink">{card.title}</span>
              </h4>
              <p className="mb-2.5 text-[11px] text-muted">{card.desc}</p>
              {list.length ? (
                <ol className="space-y-1 text-[13px]">
                  {list.map(([code, n], i) => (
                    <li key={code} className="flex items-center gap-2">
                      <span className="w-4 text-right text-[11px] text-faint tabular-nums">{i + 1}</span>
                      <button
                        type="button"
                        onClick={() => setDetail({ signal: k, code })}
                        aria-label={`Open ${code} ${card.title.toLowerCase()} details`}
                        className="font-medium text-ink underline decoration-dotted decoration-border-2 underline-offset-2 hover:decoration-accent"
                        title="See this course's signal over time"
                      >
                        {code}
                      </button>
                      <span className="ml-auto tabular-nums text-muted">{n.toLocaleString()}</span>
                    </li>
                  ))}
                </ol>
              ) : (
                <span className="text-xs text-muted">none</span>
              )}
            </div>
          );
        })}
      </div>

      {detail && <DetailModal detail={detail} frames={frames} onClose={() => setDetail(null)} />}
    </section>
  );
}

function DetailModal({ detail, frames, onClose }: { detail: Detail; frames: Frame[]; onClose: () => void }) {
  const info = SIGNAL_META[detail.signal];
  const rows = frames.map((f) => ({
    label: f.label,
    season: f.season,
    v: (f.courses[detail.code]?.[info.field] ?? 0) as number,
  }));
  const cap = frames.find((f) => f.courses[detail.code])?.courses[detail.code]?.capacity ?? 0;
  const offeredTerms = frames.filter((f) => f.courses[detail.code]?.offered).length;
  const total = rows.length;
  const peakRow = rows.reduce((best, r) => (r.v > best.v ? r : best), { label: "—", season: "", v: 0 });
  const peakMandatory = Math.max(0, ...rows.filter((r) => r.season === "Fall" || r.season === "Spring").map((r) => r.v));

  let fix: string;
  switch (detail.signal) {
    case "capacity":
      if (peakMandatory > 0) {
        fix = `Add ~${peakMandatory} seat${peakMandatory > 1 ? "s" : ""} to clear the worst term's denials (capacity ${cap} → ${cap + peakMandatory}). Set it in Settings, or use Auto-fill below.`;
      } else if (peakRow.v > 0) {
        fix =
          "All seat denials fall in optional (Summer) terms, which use a separate, smaller capacity model — regular-term capacity is sufficient.";
      } else {
        fix = "No seat denials recorded — current capacity is sufficient.";
      }
      break;
    case "offering":
      fix = `Offered in ${offeredTerms} of ${total} terms. Widen this course's offering schedule (Settings → course offering) so eligible students don't wait a full cycle.`;
      break;
    case "fail":
      fix = "Failures track the pass rate, not seats — raising capacity won't help. Review prerequisite readiness or add academic support for this course.";
      break;
    case "prereq":
      fix = "Students reach this course before finishing its prerequisites. The real fix is upstream — clear the earlier bottleneck feeding it.";
      break;
  }

  return (
    <Modal open onClose={onClose} title={`${detail.code} · ${info.label} over time`}>
      <p className="mb-3 text-[12px] text-muted">{info.unit}</p>
      <div className="overflow-x-auto rounded-lg border border-border bg-surface-2 p-3">
        <SignalBars rows={rows} fill={info.fill} />
      </div>
      <p className="mt-2 text-[12px] text-ink">
        Peak <b>{peakRow.v.toLocaleString()}</b>
        {peakRow.v > 0 && <span className="text-muted"> in {peakRow.label}</span>} · total{" "}
        <b>{rows.reduce((s, r) => s + r.v, 0).toLocaleString()}</b> across {total} terms.
      </p>
      <div className="mt-3 rounded-lg border border-accent/30 bg-accent/5 px-3 py-2 text-[12px] text-ink">
        <span className="font-semibold">Suggested fix: </span>
        {fix}
      </div>
    </Modal>
  );
}

// Inline per-term bar chart (no chart lib, matches the app's SVG-first figures). One bar per term,
// hover for the exact count; height normalised to the series peak.
function SignalBars({ rows, fill }: { rows: { label: string; v: number }[]; fill: string }) {
  const peak = Math.max(1, ...rows.map((r) => r.v));
  const bw = 14;
  const gap = 4;
  const h = 72;
  const w = Math.max(1, rows.length) * (bw + gap);

  return (
    <svg width={w} height={h} role="img" aria-label="Signal count per term">
      {rows.map((r, i) => {
        const bh = (r.v / peak) * (h - 2);
        const x = i * (bw + gap);
        return (
          <rect key={i} x={x} y={h - bh} width={bw} height={Math.max(bh, r.v > 0 ? 1.5 : 0)} rx={2} className={`${fill} opacity-90`}>
            <title>
              {r.label}: {r.v}
            </title>
          </rect>
        );
      })}
    </svg>
  );
}
