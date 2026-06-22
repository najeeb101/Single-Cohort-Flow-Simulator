import type { Frame } from "@/types/simulation";
import { aggFlows } from "@/lib/flows";

interface Props {
  frame: Frame;
  nextFrame: Frame | undefined;
}

type Entry = { text: string; emphasis?: "em" | "good" | "bad" };
const EMPHASIS_CLASS: Record<string, string> = { em: "text-warn font-semibold", good: "text-good font-semibold", bad: "text-bad font-semibold" };

// Faithful port of frontend/app.js::renderNarrative() — always uses the global aggFlows()
// regardless of the cohort selector (that's the vanilla behavior; only the stage/flow
// side panels are cohort-scoped).
export default function NarrativePanel({ frame, nextFrame }: Props) {
  const flows = aggFlows(frame);
  const get = (k: string) => flows[k] || 0;

  const now: Entry[] = [];

  const entered = get("Admitted→Year1");
  if (entered > 0) now.push({ text: `A new cohort of ${entered} freshmen enrolled.`, emphasis: "em" });

  const denied = Object.entries(frame.courses)
    .filter(([, s]) => s.offered && s.denied > 0)
    .sort((a, b) => b[1].denied - a[1].denied)
    .slice(0, 3);
  if (denied.length) {
    now.push({ text: `Seats ran out in ${denied.map(([c, s]) => `${c} (−${s.denied})`).join(", ")}.`, emphasis: "bad" });
  }

  const adv = get("Year1→Year2") + get("Year2→Year3") + get("Year3→Year4");
  if (adv > 0) now.push({ text: `${adv} students advanced to a higher year.` });

  const grad = Object.keys(flows).filter((k) => k.endsWith("→Graduated")).reduce((s, k) => s + flows[k], 0);
  if (grad > 0) now.push({ text: `${grad} students graduated.`, emphasis: "good" });

  const dropped = Object.keys(flows).filter((k) => k.endsWith("→Dropped")).reduce((s, k) => s + flows[k], 0);
  if (dropped > 0) now.push({ text: `${dropped} dropped out (academic).`, emphasis: "bad" });

  const cens = Object.keys(flows).filter((k) => k.endsWith("→Censored")).reduce((s, k) => s + flows[k], 0);
  if (cens > 0) now.push({ text: `${cens} ran out of time (hit the 12-semester limit).`, emphasis: "bad" });

  const totPass = Object.values(frame.courses).reduce((s, c) => s + (c.passed || 0), 0);
  const totFail = Object.values(frame.courses).reduce((s, c) => s + (c.failed || 0), 0);
  if (totPass + totFail > 0) now.push({ text: `Course results: ${totPass} passes, ${totFail} fails.` });

  if (!now.length) now.push({ text: "Quiet term — students continuing their courses." });

  const next: Entry[] = [];
  if (nextFrame) {
    next.push({ text: `${nextFrame.term < 0 ? "Warm-up · " + nextFrame.season : nextFrame.label} begins.` });
    const opening: string[] = [];
    const closing: string[] = [];
    for (const code in nextFrame.courses) {
      const a = frame.courses[code];
      const b = nextFrame.courses[code];
      if (a && b) {
        if (!a.offered && b.offered) opening.push(code);
        if (a.offered && !b.offered) closing.push(code);
      }
    }
    if (opening.length) next.push({ text: `Opens: ${opening.slice(0, 6).join(", ")}.`, emphasis: "em" });
    if (closing.length) next.push({ text: `Closes (off-season): ${closing.slice(0, 6).join(", ")}.` });
    const nextEntrants = aggFlows(nextFrame)["Admitted→Year1"] || 0;
    if (nextEntrants > 0) next.push({ text: "A new cohort will enrol.", emphasis: "em" });
    const waiting = Object.entries(frame.courses)
      .filter(([, s]) => (s.prereq_waiting || 0) > 0)
      .sort((a, b) => b[1].prereq_waiting - a[1].prereq_waiting)
      .slice(0, 2);
    if (waiting.length) {
      next.push({ text: `Students are queued behind prerequisites for ${waiting.map(([c, s]) => `${c} (${s.prereq_waiting})`).join(", ")}.` });
    }
  } else {
    next.push({ text: "End of the simulation horizon — see the dashboard below for final outcomes." });
  }

  const renderEntry = (e: Entry, i: number) =>
    e.emphasis ? <li key={i}><span className={EMPHASIS_CLASS[e.emphasis]}>{e.text}</span></li> : <li key={i}>{e.text}</li>;

  return (
    <div className="mb-3.5 grid grid-cols-1 gap-3.5 md:grid-cols-2">
      <div className="rounded-2xl border border-border border-l-[3px] border-l-accent bg-surface px-4.5 py-3.5">
        <h4 className="mb-2 text-[11px] uppercase tracking-wide text-accent">This semester</h4>
        <ul className="m-0 list-disc space-y-1 pl-4.5 text-[13px] text-ink/85">{now.map(renderEntry)}</ul>
      </div>
      <div className="rounded-2xl border border-border border-l-[3px] border-l-warn bg-surface px-4.5 py-3.5">
        <h4 className="mb-2 text-[11px] uppercase tracking-wide text-warn">Next semester</h4>
        <ul className="m-0 list-disc space-y-1 pl-4.5 text-[13px] text-ink/85">{next.map(renderEntry)}</ul>
      </div>
    </div>
  );
}
