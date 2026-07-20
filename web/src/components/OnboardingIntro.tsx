"use client";

import { useState } from "react";

interface Props {
  onComplete: () => void;
  // The gated first-run flow can be skipped; the /about replay page hides it.
  showSkip?: boolean;
}

type Step = "welcome" | "how" | "pages";

const STEP_ORDER: Step[] = ["welcome", "how", "pages"];
const STEP_LABELS: Record<Step, string> = {
  welcome: "Welcome",
  how: "How it works",
  pages: "Page guide",
};

const WELCOME_POINTS = [
  { label: "Student-level", desc: "Each student carries grades, credits, standing, and delay history." },
  { label: "Seat-aware", desc: "Every term respects course capacity, offering seasons, and prerequisite gates." },
  { label: "Plan-ready", desc: "Use the same run to explain bottlenecks, compare plans, and size interventions." },
];

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

const PAGE_GROUPS = [
  {
    label: "Explore",
    desc: "Walk the plan forward one semester at a time, inspect one student, or review past runs.",
    pages: "Dashboard, Student Trace, Run History",
  },
  {
    label: "Analyze",
    desc: "Find the courses and patterns that delay graduation.",
    pages: "Bottlenecks, Advisor, Figures",
  },
  {
    label: "Manage",
    desc: "Change the plan, warm-start state, and simulation assumptions.",
    pages: "Plans, Settings, Plan Builder",
  },
];

function CardGrid({ items }: { items: { label: string; desc: string; pages?: string }[] }) {
  return (
    <div className="mx-auto grid max-w-4xl justify-items-center gap-2 sm:grid-cols-3">
      {items.map((c) => (
        <article
          key={c.label}
          className="flex min-h-[110px] w-full max-w-[245px] flex-col rounded-xl border border-border bg-surface px-4 py-2.5 text-left transition-transform hover:-translate-y-0.5"
        >
          <div className="mb-1 text-[14px] font-semibold text-ink">{c.label}</div>
          <div className="text-[12px] leading-5 text-muted">{c.desc}</div>
          {c.pages && (
            <div className="mt-auto pt-2 text-[11px] font-medium leading-4 text-accent">
              {c.pages}
            </div>
          )}
        </article>
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
    <main className="mx-auto flex min-h-[calc(100dvh-5rem)] w-full max-w-[1600px] flex-col justify-center px-5 py-4 sm:px-7">
      <div className="my-auto w-full">
        <section className="border-b border-border pb-2.5 pt-0">
          <div className="mx-auto max-w-5xl">
          <div className="flex flex-col items-center gap-2.5 text-center sm:flex-row sm:justify-center sm:gap-4 sm:text-left">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/qu-logo.png"
              alt="Qatar University"
              className="qu-mark h-15 w-auto shrink-0 object-contain sm:h-20"
            />

            <div className="max-w-2xl">
              {step === "welcome" && (
                <>
                  <h1 className="text-[27px] font-extrabold leading-tight tracking-tight text-ink sm:text-[32px]">
                    Cohort Analyzer
                  </h1>
                  <p className="mt-1 text-[12px] leading-5 text-muted sm:text-[13px]">
                    A discrete-term, agent-based model of students moving through a curriculum, term by
                    term. Every student follows the real prerequisite chain, competes for the same
                    limited seats, and can fail, repeat, or drop out.
                  </p>
                </>
              )}
              {step === "how" && (
                <>
                  <h1 className="text-[25px] font-extrabold leading-tight tracking-tight text-ink">
                    How it works
                  </h1>
                  <p className="mt-1 text-[12px] leading-5 text-muted">
                    Three practical moves once a plan has been simulated.
                  </p>
                </>
              )}
              {step === "pages" && (
                <>
                  <h1 className="text-[25px] font-extrabold leading-tight tracking-tight text-ink">
                    Where to go
                  </h1>
                  <p className="mt-1 text-[12px] leading-5 text-muted">
                    The dashboard is organized around exploration, analysis, and plan management.
                  </p>
                </>
              )}
            </div>
          </div>

          <nav className="mx-auto mt-2.5 flex w-full max-w-2xl flex-col gap-2 sm:grid sm:grid-cols-3" aria-label="Intro steps">
            {STEP_ORDER.map((s, stepIdx) => (
              <button
                key={s}
                type="button"
                onClick={() => setStep(s)}
                aria-current={s === step ? "step" : undefined}
                className={[
                  "rounded-xl border px-3 py-1.5 text-left text-sm font-semibold outline-none transition-all",
                  s === step
                    ? "border-accent bg-accent/10 text-ink shadow-sm"
                    : "border-border bg-surface-2 text-muted hover:-translate-y-0.5 hover:border-border-2 hover:text-ink",
                  "focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                ].join(" ")}
              >
                <span className="mr-2 text-xs text-accent">{stepIdx + 1}</span>
                {STEP_LABELS[s]}
              </button>
            ))}
          </nav>
        </div>
        </section>

        <section className="py-2" aria-live="polite">
          <div key={step} className="w-full animate-in fade-in slide-in-from-bottom-2 duration-200">
          {step === "welcome" && <CardGrid items={WELCOME_POINTS} />}
          {step === "how" && <CardGrid items={HOW_IT_WORKS} />}
          {step === "pages" && <CardGrid items={PAGE_GROUPS} />}
          </div>
        </section>

        <div className="flex flex-col items-center gap-1 border-t border-border py-2 text-center">
        <div className="flex items-center gap-2.5">
          {!isFirst && (
            <button
              type="button"
              onClick={back}
              className="rounded-xl border border-border-2 bg-surface px-5 py-1.5 text-[14px] font-semibold text-ink outline-none transition-colors hover:border-accent focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              Back
            </button>
          )}
          <button
            type="button"
            onClick={forward}
            className="rounded-xl bg-accent px-6 py-2 text-[14px] font-semibold text-white outline-none transition-colors hover:bg-accent/90 focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            {isLast ? "Enter dashboard" : "Continue"}
          </button>
        </div>
        <p className="text-xs text-muted">You can revisit this intro anytime from About.</p>
        {showSkip && (
          <button
            type="button"
            onClick={onComplete}
            className="text-sm text-muted underline underline-offset-2 transition-colors hover:text-ink focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            Skip intro
          </button>
        )}
        </div>
      </div>
    </main>
  );
}
