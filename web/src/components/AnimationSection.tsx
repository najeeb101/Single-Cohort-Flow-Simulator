"use client";

import { useEffect, useRef, useState } from "react";
import type { CohortInfo, Frame, Graph } from "@/types/simulation";
import CurriculumGraph from "@/components/CurriculumGraph";
import { categoryLegend } from "@/lib/graphLayout";
import AnimationControls from "@/components/AnimationControls";
import NarrativePanel from "@/components/NarrativePanel";
import StageOverview from "@/components/StageOverview";
import FlowsList from "@/components/FlowsList";

interface Props {
  graph: Graph; // frozen at initial load (page.tsx) — curriculum structure never changes
  stageNodes: string[]; // frozen
  cohorts: CohortInfo[]; // frozen
  frames: Frame[]; // live — replaced on every what-if update
}

// Owns all playback state, mirroring frontend/app.js's module-level idx/playing/timer.
// The one subtlety ported deliberately (see plan): a fresh boot seeks to term 0 and
// autoplays; a later `frames` swap from a live what-if update only clamps idx and pauses
// — it must NOT re-seek or re-autoplay, exactly like applyLiveResult() vs. boot().
export default function AnimationSection({ graph, stageNodes, cohorts, frames }: Props) {
  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(700);
  const [cohortSel, setCohortSel] = useState("totals");
  // Tracks which `frames` array reference we've already booted/clamped for — not a plain
  // boolean. React Strict Mode (on by default in Next.js dev) double-invokes effects on
  // mount; a boolean ref survives that double-invoke (refs aren't reset), so the second
  // invocation would wrongly take the "live update" branch and immediately pause autoplay
  // before it ever started. Comparing against the actual `frames` reference makes the
  // effect idempotent for the same array, while still detecting a genuinely new one.
  const bootedFramesRef = useRef<Frame[] | null>(null);

  useEffect(() => {
    if (bootedFramesRef.current === frames) return;
    const isFirstBoot = bootedFramesRef.current === null;
    bootedFramesRef.current = frames;

    if (isFirstBoot) {
      const start = Math.max(0, frames.findIndex((f) => f.term === 0));
      setIdx(start);
      setPlaying(frames.length > 1);
    } else {
      // A live what-if update replaced `frames` — clamp position, pause, don't reseek.
      setIdx((i) => Math.max(0, Math.min(i, frames.length - 1)));
      setPlaying(false);
    }
  }, [frames]);

  useEffect(() => {
    if (!playing) return;
    const timer = setInterval(() => {
      setIdx((i) => {
        if (i >= frames.length - 1) {
          setPlaying(false);
          return i;
        }
        return i + 1;
      });
    }, speed);
    return () => clearInterval(timer);
  }, [playing, speed, frames.length]);

  const frame = frames[idx];
  if (!frame) return null;

  const termLabel = frame.term < 0 ? `Warm-up · ${frame.season} (t=${frame.term})` : `${frame.label} (t=${frame.term})`;

  return (
    <section className="py-6">
      <h2 className="mb-4 flex items-center gap-2 text-[15px] font-bold">
        <span className="grid h-6 w-6 place-items-center rounded-[7px] border border-border-2 bg-surface-2 text-xs font-bold text-accent">1</span>
        Prerequisite flow <span className="text-xs font-normal text-muted">— semester by semester</span>
      </h2>

      <AnimationControls
        idx={idx}
        frameCount={frames.length}
        playing={playing}
        speed={speed}
        cohortSel={cohortSel}
        cohorts={cohorts}
        termLabel={termLabel}
        onScrub={setIdx}
        onTogglePlay={() => setPlaying((p) => !p)}
        onStep={(delta) => setIdx((i) => Math.max(0, Math.min(frames.length - 1, i + delta)))}
        onSpeedChange={setSpeed}
        onCohortChange={setCohortSel}
      />

      <NarrativePanel frame={frame} nextFrame={frames[idx + 1]} />

      {/* Asymmetric bento: the curriculum graph is the dominant cell (spans both rows);
          Stage overview and Flows sit beside it as two smaller, independent cards rather
          than one tall stacked aside — that's what actually reads as "bento" instead of
          "sidebar." Mobile collapses to a plain single-column stack via the unprefixed
          col-span-1 default (high-end-visual-design's "Asymmetrical Bento" archetype,
          scaled down for a data dashboard rather than a marketing grid). */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-6">
        <div className="col-span-1 flex min-w-0 flex-col rounded-2xl border border-border bg-surface md:col-span-4 md:row-span-2">
          <div className="flex items-baseline justify-between gap-3 border-b border-border px-4 py-2.5 text-[13px] font-semibold">
            <span>Program roadmap</span>
            <span className="text-xs font-normal text-muted">
              {graph.nodes.length} courses · {graph.nodes.reduce((s, n) => s + (n.credits || 0), 0)} CH · boxes coloured by requirement type · bar = seat use
            </span>
          </div>
          <CurriculumGraph graph={graph} courses={frame.courses} />
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-border px-4 py-2.5 text-xs text-muted">
            {categoryLegend().map((c) => (
              <span key={c.label}>
                <i
                  className="mr-1 inline-block h-3 w-3 rounded-sm border align-[-2px]"
                  style={{ background: c.fill, borderColor: c.border }}
                />
                {c.label}
              </span>
            ))}
            <span className="ml-1 border-l border-border pl-3">
              <i className="mr-1 inline-block h-1 w-4 rounded-sm bg-[#e2553b] align-[1px]" />seat use ▣ full
            </span>
            <span><span className="mr-1 text-[#d1453b]">→</span>prerequisite</span>
          </div>
        </div>

        <aside className="col-span-1 flex flex-col rounded-2xl border border-border bg-surface px-4 pb-3.5 md:col-span-2">
          <div className="border-b border-border py-2.5 text-[13px] font-semibold">Stage overview</div>
          <StageOverview frame={frame} stageNodes={stageNodes} cohortSel={cohortSel} />
        </aside>

        <aside className="col-span-1 flex flex-col rounded-2xl border border-border bg-surface px-4 pb-3.5 md:col-span-2">
          <div className="border-b border-border py-2.5 text-[13px] font-semibold">Biggest moves</div>
          <FlowsList frame={frame} cohortSel={cohortSel} />
        </aside>
      </div>
    </section>
  );
}
