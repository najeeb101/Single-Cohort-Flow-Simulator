"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { advanceCheckpoint, ApiError, createCheckpoint, discardCheckpoint, editCheckpoint, getCheckpoint } from "@/lib/api";
import type { CheckpointEdit, CheckpointState } from "@/types/simulation";

// Semester Checkpoint Mode's provider (see CLAUDE.md). Unlike SimulationProvider, this does
// NOT auto-run anything on mount — it just checks whether the caller already has a session
// (GET /checkpoint, a plain 404 when there isn't one) and otherwise sits idle until the head
// explicitly clicks "Start checkpoint walkthrough". The always-on baseline dashboard
// (SimulationContext) is completely unaffected by anything in here.
interface CheckpointContextValue {
  session: CheckpointState | null;
  loading: boolean;
  busy: boolean;
  error: string | null;
  start: () => Promise<void>;
  advance: () => Promise<void>;
  edit: (patch: CheckpointEdit) => Promise<void>;
  discard: () => Promise<void>;
}

const CheckpointContext = createContext<CheckpointContextValue | null>(null);

export function CheckpointProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<CheckpointState | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getCheckpoint()
      .then(setSession)
      .catch(() => setSession(null)) // 404 (no active session) is the normal, common case
      .finally(() => setLoading(false));
  }, []);

  const start = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      setSession(await createCheckpoint());
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not start a checkpoint session");
    } finally {
      setBusy(false);
    }
  }, []);

  const advance = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      setSession(await advanceCheckpoint());
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not advance the session");
    } finally {
      setBusy(false);
    }
  }, []);

  const edit = useCallback(async (patch: CheckpointEdit) => {
    setBusy(true);
    setError(null);
    try {
      setSession(await editCheckpoint(patch));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not save the edit");
      throw e; // let the caller keep its pending (unsaved) local edits rather than clearing them
    } finally {
      setBusy(false);
    }
  }, []);

  const discard = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      await discardCheckpoint();
      setSession(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not discard the session");
    } finally {
      setBusy(false);
    }
  }, []);

  if (loading) {
    return <main className="mx-auto max-w-xl px-7 py-16 text-muted">Loading checkpoint session…</main>;
  }

  return (
    <CheckpointContext.Provider value={{ session, loading, busy, error, start, advance, edit, discard }}>
      {children}
    </CheckpointContext.Provider>
  );
}

export function useCheckpoint(): CheckpointContextValue {
  const ctx = useContext(CheckpointContext);
  if (!ctx) throw new Error("useCheckpoint must be used within a CheckpointProvider");
  return ctx;
}
