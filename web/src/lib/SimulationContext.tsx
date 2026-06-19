"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { getMeta, listScenarios, simulate } from "@/lib/api";
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
  // Fixed once from the baseline load — the curriculum graph structure, stage-node order,
  // and cohort roster are scenario-invariant, and AnimationSection's child components key
  // state off them positionally. Must NOT be recomputed from later live results.
  const [chartMeta, setChartMeta] = useState<ChartMeta | null>(null);
  const [topCapacityCourses, setTopCapacityCourses] = useState<string[]>([]);
  const [phase, setPhase] = useState<Phase>("loading");
  const [savedScenarios, setSavedScenarios] = useState<ScenarioRecord[]>([]);

  const refreshScenarios = useCallback(async () => {
    setSavedScenarios(await listScenarios());
  }, []);

  const refreshBaseline = useCallback(async () => {
    const [m, d] = await Promise.all([getMeta(), simulate({})]);
    setMeta(m);
    setData(d);
    setTopCapacityCourses(d.flow_timeline.summary.top_bottlenecks.capacity.slice(0, 3).map(([code]) => code));
    setChartMeta({
      graph: d.flow_timeline.meta.graph,
      stageNodes: d.flow_timeline.meta.stage_nodes,
      cohorts: d.flow_timeline.meta.cohorts,
    });
  }, []);

  useEffect(() => {
    refreshBaseline()
      .then(() => {
        setPhase("ready");
      })
      .catch(() => setPhase("error"));
    // Saved scenarios are non-critical-path — fetch alongside, don't block the dashboard.
    refreshScenarios().catch(() => {});
  }, [refreshBaseline, refreshScenarios]);

  const runScenario = useCallback(async (overrides: ScenarioRequest) => {
    const d = await simulate(overrides);
    setData(d);
  }, []);

  const resetToBaseline = useCallback(async () => {
    const d = await simulate({});
    setData(d);
  }, []);

  if (phase === "loading") {
    return (
      <main className="mx-auto max-w-5xl px-7 py-16 text-muted">
        Loading the simulation dashboard…
      </main>
    );
  }

  if (phase === "error" || !meta || !data || !chartMeta) {
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
