"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { getMeta, getMetaWithRetry, simulate } from "@/lib/api";
import CurriculumGraph from "@/components/CurriculumGraph";
import InitialStateGate from "@/components/InitialStateGate";
import OnboardingIntro from "@/components/OnboardingIntro";
import type {
  CohortInfo,
  Graph,
  MetaResponse,
  SimulateResponse,
} from "@/types/simulation";

const INITIAL_STATE_SETUP_DONE_KEY = "initial-state-setup-done";
const ONBOARDING_INTRO_DONE_KEY = "onboarding-intro-done";

function isInitialStateUnset(meta: MetaResponse): boolean {
  const occupancy = meta.initial_state?.occupancy ?? {};
  return Object.keys(occupancy).length === 0;
}

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
  refreshing: boolean;
}

const SimulationContext = createContext<SimulationState | null>(null);

export function SimulationProvider({ children }: { children: ReactNode }) {
  const [meta, setMeta] = useState<MetaResponse | null>(null);
  const [data, setData] = useState<SimulateResponse | null>(null);
  const [chartMeta, setChartMeta] = useState<ChartMeta | null>(null);
  const [phase, setPhase] = useState<Phase>("loading");
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [waking, setWaking] = useState(false);
  const autoStarted = useRef(false);
  const [introDismissed, setIntroDismissed] = useState(
    () => typeof window !== "undefined" && window.localStorage.getItem(ONBOARDING_INTRO_DONE_KEY) === "1"
  );
  const [initialStateDismissed, setInitialStateDismissed] = useState(
    () => typeof window !== "undefined" && window.localStorage.getItem(INITIAL_STATE_SETUP_DONE_KEY) === "1"
  );

  useEffect(() => {
    // On the hosted (Render free-tier) deployment the backend spins down when idle, so the
    // first load can hit a 40-50s cold start. Retry with backoff and flag `waking` after the
    // first miss so the UI shows a "waking the backend" message instead of a hard error.
    getMetaWithRetry({ onAttempt: () => setWaking(true) })
      .then((m) => {
        setMeta(m);
        setPhase("ready");
      })
      .catch(() => setPhase("error"))
      .finally(() => setWaking(false));
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
    setRefreshing(true);
    try {
      const [m, d] = await Promise.all([getMeta(), simulate({})]);
      setMeta(m);
      applyResult(d, true);
    } finally {
      setRefreshing(false);
    }
  }, [applyResult]);

  // Past the first-run setup gate but no results yet -> auto-run the baseline once, so the
  // admin never has to click a separate "Start" button (the whole point of the auto-run UX).
  // The ref guard means a *failed* run surfaces a retry instead of silently re-firing in a
  // loop, and a *successful* run fills `data`, so the condition can never become true again.
  const pastGate = !!meta && (initialStateDismissed || !isInitialStateUnset(meta));
  useEffect(() => {
    if (phase === "ready" && pastGate && !data && !starting && !startError && !autoStarted.current) {
      autoStarted.current = true;
      start();
    }
  }, [phase, pastGate, data, starting, startError, start]);

  if (phase === "loading") {
    return (
      <main className="mx-auto max-w-xl px-7 py-16 text-muted">
        {waking ? (
          <span className="flex items-center gap-2">
            <span className="inline-block h-2.5 w-2.5 animate-ping rounded-full bg-accent" />
            Waking the backend… the free-tier server sleeps when idle and can take up to ~40s to
            start. Hang tight.
          </span>
        ) : (
          "Loading the program structure…"
        )}
      </main>
    );
  }

  if (phase === "error" || !meta) {
    return (
      <main className="mx-auto max-w-xl px-7 py-16">
        <div className="rounded-2xl border border-border border-l-[4px] border-l-bad bg-surface px-6 py-5 text-bad">
          Could not reach the simulation API after several attempts. If you are running locally,
          start it with{" "}
          <code className="rounded bg-black/35 px-1.5 py-0.5">py -m uvicorn src.api:app --port 8001</code>{" "}
          (from the repo root) and reload. On the hosted version the backend may still be waking
          up, so wait a moment and reload.
        </div>
      </main>
    );
  }

  if (!introDismissed) {
    return (
      <OnboardingIntro
        onComplete={() => {
          window.localStorage.setItem(ONBOARDING_INTRO_DONE_KEY, "1");
          setIntroDismissed(true);
        }}
      />
    );
  }

  if (!initialStateDismissed && isInitialStateUnset(meta)) {
    return (
      <InitialStateGate
        meta={meta}
        onComplete={async () => {
          const freshMeta = await getMeta();
          setMeta(freshMeta);
          window.localStorage.setItem(INITIAL_STATE_SETUP_DONE_KEY, "1");
          setInitialStateDismissed(true);
        }}
      />
    );
  }

  // No manual Start screen anymore: the effect above kicks off the run automatically once we
  // get here. This is the transient "running…" view (or a retry, if that run failed).
  if (!data || !chartMeta) {
    return <StartingScreen meta={meta} error={startError} onRetry={start} retrying={starting} />;
  }

  return (
    <SimulationContext.Provider value={{ meta, data, chartMeta, refreshBaseline, refreshing }}>
      {refreshing && <UpdatingIndicator />}
      {children}
    </SimulationContext.Provider>
  );
}

// Shown while the baseline auto-runs on first load (and as a retry surface if it fails). The
// roadmap preview is the same graph the dashboard fills in once results arrive, so the hand-off
// is visually seamless rather than a jarring blank-to-populated jump.
function StartingScreen({
  meta,
  error,
  onRetry,
  retrying,
}: {
  meta: MetaResponse;
  error: string | null;
  onRetry: () => void;
  retrying: boolean;
}) {
  const totalCourses = meta.graph.nodes.length;
  const totalCH = meta.graph.nodes.reduce((s, n) => s + (n.credits || 0), 0);

  return (
    <main className="mx-auto w-full max-w-[1600px] px-7 pb-16">
      <div className="border-b border-border py-10">
        <div className="mx-auto flex max-w-2xl flex-col items-center text-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/qu-logo.png" alt="Qatar University" className="qu-mark h-36 w-auto shrink-0 object-contain" />
          <h1 className="mt-3 text-[24px] font-extrabold tracking-tight text-ink">
            Cohort Analyzer
          </h1>
          {error ? (
            <>
              <p className="mt-3 text-sm text-bad">{error}</p>
              <button
                type="button"
                onClick={onRetry}
                disabled={retrying}
                className="mt-4 rounded-xl bg-accent px-6 py-2 text-[14px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                {retrying ? "Running…" : "Try again"}
              </button>
            </>
          ) : (
            <p className="mt-3 flex items-center gap-2 text-[14px] text-muted">
              <span className="inline-block h-2.5 w-2.5 animate-ping rounded-full bg-accent" />
              Running the baseline simulation…
            </p>
          )}
        </div>
      </div>

      <section className="mt-6 rounded-2xl border border-border bg-surface">
        <div className="flex items-baseline justify-between gap-3 border-b border-border px-4 py-2.5 text-sm font-semibold">
          <span>Programme roadmap</span>
          <span className="text-xs font-normal text-muted">
            {totalCourses} courses · {totalCH} CH · coloured by requirement type
          </span>
        </div>
        <CurriculumGraph graph={meta.graph} courses={{}} />
      </section>
    </main>
  );
}

// Fixed-position pill shown whenever the shared baseline is re-running after an edit (Settings,
// Plans, initial-state changes). Lives inside the provider because NavBar sits outside it and
// can't read this state.
function UpdatingIndicator() {
  return (
    <div className="fixed bottom-5 right-5 z-[60] flex items-center gap-2 rounded-full border border-border-2 bg-surface px-4 py-2 text-sm font-semibold text-ink shadow-lg">
      <span className="inline-block h-2 w-2 animate-ping rounded-full bg-accent" />
      Updating simulation…
    </div>
  );
}

export function useSimulation(): SimulationState {
  const ctx = useContext(SimulationContext);
  if (!ctx) throw new Error("useSimulation must be used within a SimulationProvider");
  return ctx;
}
