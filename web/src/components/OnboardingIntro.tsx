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
  welcome: "The question",
  how: "How it decides",
  pages: "Where to go",
};

const WELCOME_POINTS = [
  { label: "One question", desc: "How many students should the department admit in the next CS intake, and what course seats does that number need?" },
  { label: "Today's students included", desc: "The next intake joins the students already enrolled, rebuilt from past intakes, plus seats other programs use." },
  { label: "Honest about data", desc: "Every input is marked QU data or estimate. A result built mostly on estimates is labelled illustrative." },
];

const HOW_IT_WORKS = [
  {
    label: "Try many intakes",
    desc: "For each candidate intake, the model simulates every student term by term through the real roadmap, many times over.",
  },
  {
    label: "Measure the harm",
    desc: "The same students are also run with unlimited seats. The difference is the harm caused purely by seat shortages.",
  },
  {
    label: "Apply your limits",
    desc: "The recommendation is the largest intake whose harm stays within your limits, with a range for uncertainty. The AI never sets the number.",
  },
];

const PAGE_GROUPS = [
  {
    label: "Decide",
    desc: "Run the analysis, read the recommendation, and plan the seats a larger intake needs.",
    pages: "Intake Planner",
  },
  {
    label: "Understand",
    desc: "See which courses limit intake, ask questions, or step through the terms one by one.",
    pages: "Bottlenecks, Advisor, Walkthrough",
  },
  {
    label: "Keep it current",
    desc: "Update seats, pass rates and past intakes each semester, and manage programs.",
    pages: "Data, Plans, Methodology",
  },
];

const STEP_COPY: Record<Step, { title: string; lead: string; items: { label: string; desc: string; pages?: string }[] }> = {
  welcome: {
    title: "CS Intake Planner",
    lead: "A planning tool for Qatar University's Computer Science department. It simulates students moving through the real CS roadmap, competing for the same course seats.",
    items: WELCOME_POINTS,
  },
  how: { title: "How it decides", lead: "The full method is on the Methodology page.", items: HOW_IT_WORKS },
  pages: { title: "Where to go", lead: "Everything on the site serves the intake decision.", items: PAGE_GROUPS },
};

// First-run welcome, styled like QU CoAdvisor's onboarding dialog: a step bar, a title, a short
// list, and one full-width button.
export default function OnboardingIntro({ onComplete, showSkip = true }: Props) {
  const [step, setStep] = useState<Step>("welcome");
  const idx = STEP_ORDER.indexOf(step);
  const isLast = idx === STEP_ORDER.length - 1;
  const copy = STEP_COPY[step];

  return (
    <main className="flex min-h-[calc(100dvh-3rem)] items-center justify-center px-4 py-10">
      <div className="w-full max-w-[520px] rounded-2xl border border-border bg-surface p-8 sm:p-10">
        <div className="mx-auto mb-7 flex w-40 gap-1.5" aria-label={`Step ${idx + 1} of ${STEP_ORDER.length}`}>
          {STEP_ORDER.map((s, i) => (
            <button
              key={s}
              type="button"
              onClick={() => setStep(s)}
              aria-label={STEP_LABELS[s]}
              aria-current={s === step ? "step" : undefined}
              className={`h-1.5 flex-1 rounded-full ${i <= idx ? "bg-primary" : "bg-surface-2"}`}
            />
          ))}
        </div>

        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/qu-logo.png" alt="Qatar University" className="qu-mark mb-5 h-12 w-auto object-contain" />
        <h1 className="text-[22px] font-semibold tracking-[-0.01em] text-ink">{copy.title}</h1>
        <p className="mt-1.5 text-[14px] leading-relaxed text-muted">{copy.lead}</p>

        <ul key={step} className="mt-6 flex flex-col gap-2.5">
          {copy.items.map((item) => (
            <li key={item.label} className="rounded-xl border border-border px-4 py-3">
              <div className="text-[14px] font-medium text-ink">{item.label}</div>
              <div className="mt-0.5 text-[13px] leading-relaxed text-muted">{item.desc}</div>
              {item.pages && <div className="mt-1 text-[12px] font-medium text-accent">{item.pages}</div>}
            </li>
          ))}
        </ul>

        <button
          type="button"
          onClick={() => (isLast ? onComplete() : setStep(STEP_ORDER[idx + 1]))}
          className="mt-7 w-full rounded-lg bg-primary py-2.5 text-[14px] font-medium text-primary-ink"
        >
          {isLast ? "Start planning" : "Continue"}
        </button>
        <div className="mt-3 flex items-center justify-between text-[13px]">
          {idx > 0 ? (
            <button type="button" onClick={() => setStep(STEP_ORDER[idx - 1])} className="text-muted hover:text-ink">
              Back
            </button>
          ) : (
            <span />
          )}
          {showSkip && (
            <button type="button" onClick={onComplete} className="text-muted underline-offset-2 hover:text-ink hover:underline">
              Skip intro
            </button>
          )}
        </div>
      </div>
    </main>
  );
}
