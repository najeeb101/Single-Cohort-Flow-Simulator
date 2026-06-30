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
