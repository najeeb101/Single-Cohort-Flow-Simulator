"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { getMeta, simulate } from "@/lib/api";
import CurriculumGraph from "@/components/CurriculumGraph";
import type {
  CohortInfo,
  Graph,
  MetaResponse,
  SimulateResponse,
} from "@/types/simulation";

type Phase = "loading" | "ready" | "error";

interface ChartMeta {
  graph: Graph;
  stageNodes: string[];
  cohorts: CohortInfo[];
}

interface SimulationState {
  meta: MetaResponse;
  data: SimulateResponse;
  chartMeta: ChartMeta;
  refreshBaseline: () => Promise<void>;
}

const SimulationContext = createContext<SimulationState | null>(null);

export function SimulationProvider({ children }: { children: ReactNode }) {
  const [meta, setMeta] = useState<MetaResponse | null>(null);
  const [data, setData] = useState<SimulateResponse | null>(null);
  const [chartMeta, setChartMeta] = useState<ChartMeta | null>(null);
  const [phase, setPhase] = useState<Phase>("loading");
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  useEffect(() => {
    getMeta()
      .then((m) => {
        setMeta(m);
        setPhase("ready");
      })
      .catch(() => setPhase("error"));
  }, []);

  const applyResult = useCallback((d: SimulateResponse, freezeChartMeta: boolean) => {
    setData(d);
    if (freezeChartMeta) {
      setChartMeta({
        graph: d.flow_timeline.meta.graph,
        stageNodes: d.flow_timeline.meta.stage_nodes,
        cohorts: d.flow_timeline.meta.cohorts,
      });
    }
  }, []);

  const start = useCallback(async () => {
    setStarting(true);
    setStartError(null);
    try {
      const d = await simulate({});
      applyResult(d, true);
    } catch {
      setStartError("Could not run the simulation. Is the API running?");
    } finally {
      setStarting(false);
    }
  }, [applyResult]);

  const refreshBaseline = useCallback(async () => {
    const [m, d] = await Promise.all([getMeta(), simulate({})]);
    setMeta(m);
    applyResult(d, true);
  }, [applyResult]);

  if (phase === "loading") {
    return (
      <main className="mx-auto max-w-5xl px-7 py-16 text-muted">
        Loading the program structure…
      </main>
    );
  }

  if (phase === "error" || !meta) {
    return (
      <main className="mx-auto max-w-xl px-7 py-16">
        <div className="rounded-2xl border border-[#5a2c2c] bg-[#241516] px-6 py-5 text-[#f0c2c2]">
          Could not reach the simulation API. Start it with{" "}
          <code className="rounded bg-black/35 px-1.5 py-0.5">py -m uvicorn src.api:app --port 8001</code>{" "}
          (from the repo root) and reload.
        </div>
      </main>
    );
  }

  if (!data || !chartMeta) {
    const totalCH = meta.graph.nodes.reduce((s, n) => s + (n.credits || 0), 0);
    const totalCourses = meta.graph.nodes.length;
    const totalPrereqs = meta.graph.edges.length;

    return (
      <main className="mx-auto w-full max-w-[1600px] px-7 pb-16">
        {/* Hero */}
        <div className="border-b border-border py-10">
          <div className="flex items-start gap-4">
            <div className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-maroon text-[18px] font-extrabold text-white">
              QU
            </div>
            <div>
              <h1 className="text-[28px] font-extrabold tracking-tight text-ink">
                CS Curriculum Flow Simulator
              </h1>
              <p className="mt-1 max-w-2xl text-[14px] leading-relaxed text-muted">
                A discrete-term, agent-based model of students progressing through Qatar University's
                Computer Science programme. Each student follows the real prerequisite chain, competes
                for the same limited seats, and can fail, repeat, or drop out — exactly as in the
                real university.
              </p>
            </div>
          </div>

          {/* Research question */}
          <div className="mt-6 max-w-2xl rounded-2xl border border-border bg-surface px-5 py-4">
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-accent">Research question</div>
            <p className="text-[13.5px] leading-relaxed text-ink">
              Which prerequisite chains and scheduling constraints contribute most to student delay
              and non-completion — and what does adding one course section actually do to graduation rates?
            </p>
          </div>

          {/* Key stats */}
          <div className="mt-5 flex flex-wrap gap-3">
            {[
              ["Courses", totalCourses],
              ["Credit hours", totalCH],
              ["Prerequisite links", totalPrereqs],
              ["Max semesters", meta.max_terms],
              ["Cohort size", meta.cohort_size],
              ["Seats / section", meta.seats_per_section],
            ].map(([k, v]) => (
              <div key={String(k)} className="rounded-[10px] border border-border bg-surface px-3.5 py-2 text-[12.5px] text-muted">
                {k}: <b className="ml-0.5 font-bold text-ink">{v}</b>
              </div>
            ))}
          </div>

          {/* What you can do */}
          <div className="mt-6 grid gap-3 sm:grid-cols-3">
            {[
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
            ].map((c) => (
              <div key={c.label} className="rounded-2xl border border-border bg-surface px-4 py-3.5">
                <div className="mb-1 text-[12.5px] font-bold text-ink">{c.label}</div>
                <div className="text-[12px] text-muted">{c.desc}</div>
              </div>
            ))}
          </div>

          {/* Start */}
          <div className="mt-7 flex flex-col items-start gap-1.5">
            <button
              type="button"
              onClick={start}
              disabled={starting}
              className="rounded-[10px] bg-accent px-7 py-2.5 text-[14px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              {starting ? "Running simulation…" : "▶ Start simulation"}
            </button>
            <span className="text-[11.5px] text-muted">
              Runs the baseline scenario — takes a few seconds. Change any parameter in Settings first.
            </span>
            {startError && <span className="text-xs text-bad">{startError}</span>}
          </div>
        </div>

        {/* Curriculum roadmap preview */}
        <section className="mt-6 rounded-2xl border border-border bg-surface">
          <div className="flex items-baseline justify-between gap-3 border-b border-border px-4 py-2.5 text-[13px] font-semibold">
            <span>Programme roadmap — QU CS 2024</span>
            <span className="text-xs font-normal text-muted">
              {totalCourses} courses · {totalCH} CH · coloured by requirement type
            </span>
          </div>
          <CurriculumGraph graph={meta.graph} courses={{}} />
        </section>
      </main>
    );
  }

  return (
    <SimulationContext.Provider value={{ meta, data, chartMeta, refreshBaseline }}>
      {children}
    </SimulationContext.Provider>
  );
}

export function useSimulation(): SimulationState {
  const ctx = useContext(SimulationContext);
  if (!ctx) throw new Error("useSimulation must be used within a SimulationProvider");
  return ctx;
}
