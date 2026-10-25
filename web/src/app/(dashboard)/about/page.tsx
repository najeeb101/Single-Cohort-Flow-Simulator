"use client";

import { useState } from "react";
import Link from "next/link";
import OnboardingIntro from "@/components/OnboardingIntro";

// Methodology in plain words for department staff and the committee. The precise version, with
// formulas, is docs/methodology.md in the project folder.
const SECTIONS: { title: string; body: string[] }[] = [
  {
    title: "The question",
    body: [
      "How many students should the department admit in the next CS intake, and what course seats does that number need?",
      "An intake is acceptable when the seat shortages it creates don't cost too many graduates or on-time graduates. You set those limits; the default (Balanced) allows at most 2 percentage points (pts) less graduation and 10 pts less on-time graduation.",
    ],
  },
  {
    title: "The inputs",
    body: [
      "The real CS roadmap (courses, prerequisites, which semester each runs), seats per course, pass rates, past intakes, and seats used by other programs such as Computer Engineering. Each is marked QU data or estimate on the Data page.",
      "Today's student body is rebuilt from the past intakes, so the next intake competes with the students already enrolled. Older years that aren't listed are estimated from the average.",
    ],
  },
  {
    title: "The model",
    body: [
      "Every student is simulated term by term: they ask for the courses they are eligible for, seats go to students with more credits first, and they pass or fail according to each course's pass rate. Students can be delayed, repeat courses, drop out, or run out of time.",
    ],
  },
  {
    title: "How the analysis works",
    body: [
      "The analysis tries many intakes (by default 20 to 200 in steps of 10), each many times with different random students, and looks at two views: admitting that number next year on top of today's students, and admitting it every year in the long run.",
      "To isolate the harm from seat shortages, the same students are also simulated with unlimited seats. The loss at an intake is the difference between the two. A smoothing step makes sure a larger intake is never reported as less harmful than a smaller one just by chance, and each loss gets a cautious upper value (95% confidence) so the limits are only passed when the evidence is clear.",
      "Intakes close to a limit are rechecked with more simulations. A full analysis is several hundred simulations and takes about two to three minutes.",
    ],
  },
  {
    title: "What the recommendation card means",
    body: [
      "Recommended next intake: the largest intake that keeps every limit, given today's students. If none does, the card says so and names the course that runs out of seats, rather than inventing a number.",
      "Sustainable every year: the intake the department could admit year after year. Upper limit: beyond it each extra student adds almost no graduates, because the seats are full. The range shows how the answer moves if three tight courses lose a section or pass rates are 5 pts lower.",
      "The seat planner answers the other half of the question: how many whole sections each course would need for a larger intake, checked against the same limits.",
    ],
  },
  {
    title: "Honesty about the data",
    body: [
      "Sections and seats change every semester. A recommendation assumes the seats stay roughly the same for the next six years, so update the Data page and re-run when the schedule changes. Every analysis keeps a copy of the data it used, and the site warns when the data has changed since.",
      "Results built mostly on estimates are labelled illustrative. When recorded outcomes are entered, each analysis compares the model with them and flags gaps larger than chance explains.",
    ],
  },
  {
    title: "The AI advisor",
    body: [
      "The optional Advisor chat explains the result and suggests changes to test. It runs on a local model on this PC by default. It never produces the intake number, and it never changes anything unless you test and apply its suggestion yourself.",
    ],
  },
];

export default function MethodologyPage() {
  const [intro, setIntro] = useState(false);
  if (intro) return <OnboardingIntro onComplete={() => setIntro(false)} showSkip={false} />;

  return (
    <main className="mx-auto w-full max-w-[900px] px-5 pb-16 sm:px-7">
      <header className="pb-4 pt-8">
        <h1 className="text-[26px] font-semibold leading-tight tracking-[-0.02em] text-ink sm:text-[28px]">Methodology</h1>
        <p className="mt-2 max-w-3xl text-[14px] leading-relaxed text-muted">
          How the CS Intake Planner turns the department&apos;s data into a recommended intake, and where it can be wrong. The
          precise version is <code className="rounded border border-border bg-surface-2 px-1 py-0.5 font-mono text-[12.5px]">docs/methodology.md</code> in the project
          folder.{" "}
          <button type="button" onClick={() => setIntro(true)} className="font-semibold text-accent hover:underline">
            Replay the intro
          </button>
        </p>
      </header>
      <div className="flex flex-col gap-6 py-6">
        {SECTIONS.map((sec) => (
          <section key={sec.title}>
            <h2 className="text-[15px] font-bold">{sec.title}</h2>
            {sec.body.map((para) => (
              <p key={para} className="mt-1.5 text-sm leading-relaxed text-muted">
                {para}
              </p>
            ))}
          </section>
        ))}
        <p className="text-sm">
          <Link href="/" className="font-semibold text-accent hover:underline">Back to the Intake Planner</Link>
        </p>
      </div>
    </main>
  );
}
