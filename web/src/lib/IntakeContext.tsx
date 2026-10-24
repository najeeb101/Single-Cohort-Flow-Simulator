"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import {
  ApiError,
  cancelIntakeAnalysis,
  getIntakeAnalysis,
  listIntakeAnalyses,
  startIntakeAnalysis,
} from "@/lib/api";
import { useSimulation } from "@/lib/SimulationContext";
import type { AnalysisRecord, IntakeAnalysisRequest } from "@/types/simulation";

// Shared Intake Planner state, mounted in the dashboard layout so the home page and the
// Bottlenecks page see the same job. The backend runs one analysis at a time (src/jobs.py), so
// there is a single `job`: the queued/running analysis, polled until it finishes. A job started
// before a page reload is picked up again from the list on mount.

const POLL_MS = 1500;
const TERMINAL = new Set(["done", "failed", "cancelled"]);

interface IntakeState {
  // The running (or just-finished) job, refreshed while it runs.
  job: AnalysisRecord | null;
  busy: boolean;
  // Latest finished intake sweep on the active plan (not a walkthrough), full record.
  latestSweep: AnalysisRecord | null;
  // Latest finished seat plan (any source), full record.
  latestSeatPlan: AnalysisRecord | null;
  history: AnalysisRecord[];
  error: string | null;
  // Resolves with the finished record (done, failed or cancelled).
  run: (req: IntakeAnalysisRequest) => Promise<AnalysisRecord>;
  cancel: () => Promise<void>;
  load: (id: number) => Promise<AnalysisRecord>;
  reload: () => Promise<void>;
}

const IntakeContext = createContext<IntakeState | null>(null);

export function IntakeProvider({ children }: { children: ReactNode }) {
  const { meta } = useSimulation();
  const [job, setJob] = useState<AnalysisRecord | null>(null);
  const [latestSweep, setLatestSweep] = useState<AnalysisRecord | null>(null);
  const [latestSeatPlan, setLatestSeatPlan] = useState<AnalysisRecord | null>(null);
  const [history, setHistory] = useState<AnalysisRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const waiters = useRef(new Map<number, (r: AnalysisRecord) => void>());
  const polling = useRef<number | null>(null);

  const finish = useCallback((record: AnalysisRecord) => {
    if (record.status === "done") {
      if (record.kind === "intake_sweep" && record.source === "plan") setLatestSweep(record);
      if (record.kind === "seat_plan") setLatestSeatPlan(record);
    }
    listIntakeAnalyses().then(setHistory).catch(() => {});
    const resolve = waiters.current.get(record.id);
    if (resolve) {
      waiters.current.delete(record.id);
      resolve(record);
    }
  }, []);

  const poll = useCallback(
    (id: number) => {
      if (polling.current === id) return;
      polling.current = id;
      const tick = async () => {
        try {
          const rec = await getIntakeAnalysis(id);
          setJob(rec);
          if (TERMINAL.has(rec.status)) {
            polling.current = null;
            finish(rec);
            return;
          }
        } catch {
          // A missed poll (backend restarting) is retried on the next tick.
        }
        if (polling.current === id) window.setTimeout(tick, POLL_MS);
      };
      tick();
    },
    [finish],
  );

  // Show what the list says: resume polling a running job, and load the latest finished results.
  const applyList = useCallback(
    async (rows: AnalysisRecord[]) => {
      setHistory(rows);
      const active = rows.find((r) => r.status === "queued" || r.status === "running");
      if (active) poll(active.id);
      const sweep = rows.find((r) => r.kind === "intake_sweep" && r.status === "done" && r.source === "plan");
      const plan = rows.find((r) => r.kind === "seat_plan" && r.status === "done");
      const [sweepRec, planRec] = await Promise.all([
        sweep ? getIntakeAnalysis(sweep.id) : null,
        plan ? getIntakeAnalysis(plan.id) : null,
      ]);
      setLatestSweep(sweepRec);
      setLatestSeatPlan(planRec);
    },
    [poll],
  );

  const reload = useCallback(async () => {
    try {
      await applyList(await listIntakeAnalyses());
    } catch {
      // Leave whatever was shown; the page still works without history.
    }
  }, [applyList]);

  // Re-read on mount and whenever the plan data changes (refreshBaseline swaps `meta`), since the
  // list is scoped to the active plan.
  useEffect(() => {
    listIntakeAnalyses()
      .then(applyList)
      .catch(() => {});
  }, [applyList, meta]);

  const run = useCallback(
    async (req: IntakeAnalysisRequest) => {
      setError(null);
      let rec: AnalysisRecord;
      try {
        rec = await startIntakeAnalysis(req);
      } catch (e) {
        const msg = e instanceof ApiError ? e.message : "Could not start the analysis. Is the backend running?";
        setError(msg);
        throw e;
      }
      setJob(rec);
      const done = new Promise<AnalysisRecord>((resolve) => waiters.current.set(rec.id, resolve));
      poll(rec.id);
      return done;
    },
    [poll],
  );

  const cancel = useCallback(async () => {
    if (!job || TERMINAL.has(job.status)) return;
    try {
      await cancelIntakeAnalysis(job.id);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not cancel the analysis");
    }
  }, [job]);

  const busy = !!job && !TERMINAL.has(job.status);

  return (
    <IntakeContext.Provider
      value={{ job, busy, latestSweep, latestSeatPlan, history, error, run, cancel, load: getIntakeAnalysis, reload }}
    >
      {children}
    </IntakeContext.Provider>
  );
}

export function useIntake(): IntakeState {
  const ctx = useContext(IntakeContext);
  if (!ctx) throw new Error("useIntake must be used within an IntakeProvider");
  return ctx;
}
