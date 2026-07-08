"use client";

import { useState } from "react";

interface Props {
  onComplete: () => void;
  // The gated first-run flow can be skipped; the /about replay page (no gate to skip) hides it.
  showSkip?: boolean;
}

type Step = "welcome" | "how" | "pages";

const STEP_ORDER: Step[] = ["welcome", "how", "pages"];
const STEP_LABELS: Record<Step, string> = {
  welcome: "1. Welcome",
  how: "2. How it works",
  pages: "3. Page guide",
};

const HOW_IT_WORKS = [
  {
    label: "Simulate",
    desc: "Run the full multi-cohort model and see term-by-term who progresses, who gets blocked, and why.",
  },
  {
    label: "Identify bottlenecks",
    desc: "Find which courses deny the most seats, block the most prerequisites, and delay graduation most.",
  },
  {
    label: "Test interventions",
    desc: "Add a section to a gateway course or change cohort size and immediately see the impact on graduation rate.",
  },
];

const PAGE_GUIDE = [
  { label: "Dashboard", desc: "The live roadmap and headline results for the active plan." },
  { label: "Bottlenecks", desc: "The top courses blocking progress, and Auto-fill to search for the fewest seats that clear your targets." },
  { label: "Live", desc: "Step a simulation forward one term at a time, adjusting knobs as you go." },
  { label: "Advisor", desc: "A plain-language read of this run's results — what's wrong, and what to do about it." },
  { label: "Cohorts", desc: "Graduation and delay outcomes broken down by entry cohort." },
  { label: "Figures", desc: "Population trends, survival, graduation timing, and seat utilization charts." },
  { label: "Prerequisites", desc: "The prerequisite chain, shaded by where students get stuck." },
  { label: "Plans", desc: "Import, build, or switch between different curriculum + config combinations." },
  { label: "Settings", desc: "Edit the active plan's curriculum, initial state, and simulation parameters." },
];

function CardGrid({ items }: { items: { label: string; desc: string }[] }) {
  return (
    <div className="mx-auto grid max-w-4xl gap-3 sm:grid-cols-3">
      {items.map((c) => (
        <div key={c.label} className="rounded-2xl border border-border bg-surface px-4 py-3.5 text-left">
          <div className="mb-1 text-[12.5px] font-bold text-ink">{c.label}</div>
          <div className="text-[12px] text-muted">{c.desc}</div>
        </div>
      ))}
    </div>
  );
}

export default function OnboardingIntro({ onComplete, showSkip = true }: Props) {
  const [step, setStep] = useState<Step>("welcome");
  const idx = STEP_ORDER.indexOf(step);
  const isFirst = idx === 0;
  const isLast = idx === STEP_ORDER.length - 1;

  const back = () => setStep(STEP_ORDER[idx - 1]);
  const forward = () => (isLast ? onComplete() : setStep(STEP_ORDER[idx + 1]));

  return (
    <main className="mx-auto w-full max-w-[1600px] px-7 pb-16">
      <div className="border-b border-border py-10">
        <div className="mx-auto flex max-w-2xl flex-col items-center gap-1 text-center">
          <div className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-maroon text-[18px] font-extrabold text-white">
            CA
          </div>

          {step === "welcome" && (
            <>
              <h1 className="mt-3 text-[28px] font-extrabold tracking-tight text-ink">Cohort Analyzer</h1>
              <p className="mt-1 text-[14px] leading-relaxed text-muted">
                A discrete-term, agent-based model of students moving through a curriculum, term by
                term. Every student follows the real prerequisite chain, competes for the same
                limited seats, and can fail, repeat, or drop out — just like the real program.
              </p>
            </>
          )}
          {step === "how" && (
            <>
              <h1 className="mt-3 text-[22px] font-extrabold tracking-tight text-ink">How it works</h1>
              <p className="mt-1 text-[13px] leading-relaxed text-muted">
                Three things you can do with a plan, once it's simulated.
              </p>
            </>
          )}
          {step === "pages" && (
            <>
              <h1 className="mt-3 text-[22px] font-extrabold tracking-tight text-ink">Where to go</h1>
              <p className="mt-1 text-[13px] leading-relaxed text-muted">
                A quick tour of every page — you can revisit this anytime from the About link.
              </p>
            </>
          )}

          <div className="mt-4 flex gap-4 text-[12px]">
            {STEP_ORDER.map((s) => (
              <span key={s} className={s === step ? "font-semibold text-accent" : "text-faint"}>
                {STEP_LABELS[s]}
              </span>
            ))}
          </div>
        </div>
      </div>

      {step === "welcome" ? (
        <div className="h-8" />
      ) : (
        <div className="py-8">
          {step === "how" && <CardGrid items={HOW_IT_WORKS} />}
          {step === "pages" && <CardGrid items={PAGE_GUIDE} />}
        </div>
      )}

      <div className="flex flex-col items-center gap-2 border-t border-border pt-6 text-center">
        <div className="flex items-center gap-3">
          {!isFirst && (
            <button
              type="button"
              onClick={back}
              className="rounded-[10px] border border-border-2 bg-surface px-6 py-2 text-[14px] font-semibold text-ink"
            >
              Back
            </button>
          )}
          <button
            type="button"
            onClick={forward}
            className="rounded-[10px] bg-accent px-7 py-2.5 text-[14px] font-semibold text-white"
          >
            {isLast ? "Start" : "Continue"}
          </button>
        </div>
        {showSkip && (
          <button
            type="button"
            onClick={onComplete}
            className="text-[12px] text-muted underline underline-offset-2 transition-colors hover:text-ink"
          >
            Skip intro
          </button>
        )}
      </div>
    </main>
  );
}
