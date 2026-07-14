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
    desc: "Start with the current run and inspect how students move.",
    pages: "Dashboard, Live, Cohorts",
  },
  {
    label: "Analyze",
    desc: "Find the courses and patterns that delay graduation.",
    pages: "Bottlenecks, Figures, Prerequisites, Advisor",
  },
  {
    label: "Manage",
    desc: "Change the plan, warm-start state, and simulation assumptions.",
    pages: "Plans, Settings",
  },
];

function CardGrid({ items }: { items: { label: string; desc: string; pages?: string }[] }) {
  return (
    <div className="mx-auto grid max-w-5xl gap-2.5 sm:grid-cols-3">
      {items.map((c) => (
        <article
          key={c.label}
          className="rounded-xl border border-border bg-surface px-4 py-2.5 text-left transition-transform hover:-translate-y-0.5"
        >
          <div className="mb-0.5 text-sm font-semibold text-ink">{c.label}</div>
          <div className="text-[13px] leading-5 text-muted">{c.desc}</div>
          {c.pages && (
            <div className="mt-2 border-t border-border pt-1.5 text-xs font-medium text-accent">
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
    <main className="mx-auto w-full max-w-[1600px] px-5 pb-3 sm:px-7">
      <section className="border-b border-border py-4">
        <div className="mx-auto max-w-5xl">
          <div className="flex flex-col items-center gap-3 text-center sm:flex-row sm:justify-center sm:gap-5 sm:text-left">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/qu-logo.png"
              alt="Qatar University"
              className="h-16 w-auto shrink-0 rounded-xl bg-white object-contain p-2 sm:h-20"
            />

            <div className="max-w-2xl">
              {step === "welcome" && (
                <>
                  <h1 className="text-[28px] font-extrabold leading-tight tracking-tight text-ink sm:text-[34px]">
                    Cohort Analyzer
                  </h1>
                  <p className="mt-1.5 text-[13px] leading-5 text-muted sm:text-[14px]">
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
                  <p className="mt-1.5 text-sm leading-5 text-muted">
                    Three practical moves once a plan has been simulated.
                  </p>
                </>
              )}
              {step === "pages" && (
                <>
                  <h1 className="text-[25px] font-extrabold leading-tight tracking-tight text-ink">
                    Where to go
                  </h1>
                  <p className="mt-1.5 text-sm leading-5 text-muted">
                    The dashboard is organized around exploration, analysis, and plan management.
                  </p>
                </>
              )}
            </div>
          </div>

          <nav className="mx-auto mt-3 flex w-full max-w-2xl flex-col gap-2 sm:grid sm:grid-cols-3" aria-label="Intro steps">
            {STEP_ORDER.map((s, stepIdx) => (
              <button
                key={s}
                type="button"
                onClick={() => setStep(s)}
                aria-current={s === step ? "step" : undefined}
                className={[
                  "rounded-xl border px-3 py-1.5 text-left text-sm font-semibold",
                  s === step
                    ? "border-accent bg-accent/10 text-ink"
                    : "border-border bg-surface-2 text-muted hover:border-border-2 hover:text-ink",
                ].join(" ")}
              >
                <span className="mr-2 text-xs text-accent">{stepIdx + 1}</span>
                {STEP_LABELS[s]}
              </button>
            ))}
          </nav>
        </div>
      </section>

      <section className="py-3">
        {step === "welcome" && <CardGrid items={WELCOME_POINTS} />}
        {step === "how" && <CardGrid items={HOW_IT_WORKS} />}
        {step === "pages" && <CardGrid items={PAGE_GROUPS} />}
      </section>

      <div className="flex flex-col items-center gap-1.5 border-t border-border pt-3 text-center">
        <div className="flex items-center gap-3">
          {!isFirst && (
            <button
              type="button"
              onClick={back}
              className="rounded-xl border border-border-2 bg-surface px-5 py-1.5 text-[14px] font-semibold text-ink hover:border-accent"
            >
              Back
            </button>
          )}
          <button
            type="button"
            onClick={forward}
            className="rounded-xl bg-accent px-6 py-2 text-[14px] font-semibold text-white"
          >
            {isLast ? "Start" : "Continue"}
          </button>
        </div>
        {showSkip && (
          <button
            type="button"
            onClick={onComplete}
            className="text-sm text-muted underline underline-offset-2 transition-colors hover:text-ink"
          >
            Skip intro
          </button>
        )}
      </div>
    </main>
  );
}
