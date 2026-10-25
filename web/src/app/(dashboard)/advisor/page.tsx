"use client";

import { useSimulation } from "@/lib/SimulationContext";
import { useIntake } from "@/lib/IntakeContext";
import { isSweep } from "@/lib/intakeUtils";
import AdvisorPanel from "@/components/AdvisorPanel";
import AdvisorChat from "@/components/AdvisorChat";

export default function AdvisorPage() {
  const { data, meta } = useSimulation();
  const { latestSweep } = useIntake();
  const summary = data.flow_timeline.summary;
  const scenario = data.flow_timeline.meta?.scenario ?? "baseline";
  const frames = data.flow_timeline.frames;
  const analysis = isSweep(latestSweep) ? latestSweep.result : null;

  return (
    <main className="mx-auto w-full max-w-[1280px] px-5 pb-24 sm:px-8">
      <header className="pb-4 pt-8">
        <h1 className="text-[26px] font-semibold leading-tight tracking-[-0.02em] text-ink sm:text-[28px]">Advisor</h1>
        <p className="mt-2 max-w-2xl text-[14px] leading-relaxed text-muted">
          A plain-language reading of the latest intake analysis and the baseline run: what the recommendation means, what
          limits it, and what to do and not do. The number itself always comes from the simulation.
        </p>
      </header>
      <AdvisorChat
        summary={summary}
        scenario={scenario}
        frames={frames}
        mandatorySeasons={meta.mandatory_terms ?? ["Fall", "Spring"]}
        enabled={!!meta.llm_chat_enabled}
        modelLabel={meta.llm_model}
        recommendedIntake={analysis?.recommendation.recommended_intake}
      />
      <AdvisorPanel summary={summary} analysis={analysis} showHeading={false} />
    </main>
  );
}
