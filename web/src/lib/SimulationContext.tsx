"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { getMeta, listScenarios, simulate } from "@/lib/api";
import CurriculumGraph from "@/components/CurriculumGraph";
import type {
  CohortInfo,
  Graph,
  MetaResponse,
  ScenarioRecord,
  ScenarioRequest,
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
  topCapacityCourses: string[];
  refreshBaseline: () => Promise<void>;
  runScenario: (overrides: ScenarioRequest) => Promise<void>;
  resetToBaseline: () => Promise<void>;
  savedScenarios: ScenarioRecord[];
  refreshScenarios: () => Promise<void>;
}

const SimulationContext = createContext<SimulationState | null>(null);

export function SimulationProvider({ children }: { children: ReactNode }) {
  const [meta, setMeta] = useState<MetaResponse | null>(null);
  const [data, setData] = useState<SimulateResponse | null>(null);
  // Fixed once the simulation is started — the curriculum graph structure, stage-node order,
  // and cohort roster are scenario-invariant, and AnimationSection's child components key
  // state off them positionally. Must NOT be recomputed from later live results.
  const [chartMeta, setChartMeta] = useState<ChartMeta | null>(null);
  const [topCapacityCourses, setTopCapacityCourses] = useState<string[]>([]);
  const [phase, setPhase] = useState<Phase>("loading");
  const [savedScenarios, setSavedScenarios] = useState<ScenarioRecord[]>([]);
  // Nothing runs until the user presses Start — the dashboard loads only the program
  // structure (meta) on mount and waits. This is deliberate: a simulation is never kicked
  // off automatically.
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  const refreshScenarios = useCallback(async () => {
    setSavedScenarios(await listScenarios());
  }, []);

  // Mount: fetch the program structure only (no simulation). getMeta reads curriculum/config;
  // it does not run the engine.
  useEffect(() => {
    getMeta()
      .then((m) => {
        setMeta(m);
        setPhase("ready");
      })
      .catch(() => setPhase("error"));
    refreshScenarios().catch(() => {});
  }, [refreshScenarios]);

  const applyResult = useCallback((d: SimulateResponse, freezeChartMeta: boolean) => {
    setData(d);
    setTopCapacityCourses(d.flow_timeline.summary.top_bottlenecks.capacity.slice(0, 3).map(([code]) => code));
    if (freezeChartMeta) {
      setChartMeta({
        graph: d.flow_timeline.meta.graph,
        stageNodes: d.flow_timeline.meta.stage_nodes,
        cohorts: d.flow_timeline.meta.cohorts,
      });
    }
  }, []);

  // The explicit Start: this is the ONLY place the baseline run is triggered on first load.
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

  // Re-run the baseline (used after Settings edits) — only meaningful once started.
  const refreshBaseline = useCallback(async () => {
    const [m, d] = await Promise.all([getMeta(), simulate({})]);
    setMeta(m);
    applyResult(d, true);
  }, [applyResult]);

  const runScenario = useCallback(async (overrides: ScenarioRequest) => {
    const d = await simulate(overrides);
    applyResult(d, false);
  }, [applyResult]);

  const resetToBaseline = useCallback(async () => {
    const d = await simulate({});
    applyResult(d, false);
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

  // Structure loaded, but the simulation has not been started yet — show the program roadmap
  // and a Start button. Nothing has been simulated at this point.
  if (!data || !chartMeta) {
    return (
      <main className="mx-auto w-full max-w-[1600px] px-7 pb-16">
        <header className="flex flex-wrap items-center justify-between gap-4 border-b border-border py-6">
          <div>
            <h1 className="text-[19px] font-bold tracking-tight">Program roadmap</h1>
            <p className="mt-0.5 text-[12.5px] text-muted">
              {meta.graph.nodes.length} courses · {meta.graph.nodes.reduce((s, n) => s + (n.credits || 0), 0)} CH ·
              {" "}the simulation has not started yet.
            </p>
          </div>
          <div className="flex flex-col items-end gap-1">
            <button
              type="button"
              onClick={start}
              disabled={starting}
              className="rounded-[10px] bg-accent px-5 py-2 text-[14px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              {starting ? "Starting…" : "▶ Start simulation"}
            </button>
            {startError && <span className="text-xs text-bad">{startError}</span>}
          </div>
        </header>

        <section className="mt-5 rounded-2xl border border-border bg-surface">
          <div className="flex items-baseline justify-between gap-3 border-b border-border px-4 py-2.5 text-[13px] font-semibold">
            <span>Curriculum structure</span>
            <span className="text-xs font-normal text-muted">boxes coloured by requirement type · press Start to simulate</span>
          </div>
          <CurriculumGraph graph={meta.graph} courses={{}} />
        </section>
      </main>
    );
  }

  return (
    <SimulationContext.Provider
      value={{
        meta,
        data,
        chartMeta,
        topCapacityCourses,
        refreshBaseline,
        runScenario,
        resetToBaseline,
        savedScenarios,
        refreshScenarios,
      }}
    >
      {children}
    </SimulationContext.Provider>
  );
}

export function useSimulation(): SimulationState {
  const ctx = useContext(SimulationContext);
  if (!ctx) throw new Error("useSimulation must be used within a SimulationProvider");
  return ctx;
}
