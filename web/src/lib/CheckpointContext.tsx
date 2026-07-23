"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { advanceCheckpoint, ApiError, createCheckpoint, discardCheckpoint, editCheckpoint, getCheckpoint, peekCheckpoint, rewindCheckpoint } from "@/lib/api";
import type { CheckpointEdit, CheckpointState } from "@/types/simulation";

// Semester Checkpoint Mode's provider (see CLAUDE.md). Unlike SimulationProvider, this does
// NOT auto-run anything on mount — it just checks whether the caller already has a session
// (GET /checkpoint, a plain 404 when there isn't one) and otherwise sits idle until the head
// explicitly clicks "Start checkpoint walkthrough". The always-on baseline dashboard
// (SimulationContext) is completely unaffected by anything in here.
interface CheckpointContextValue {
  session: CheckpointState | null;
  // A read-only preview of an earlier step (GET /checkpoint/peek), separate from `session` (the
  // live/current state). Non-null while the user is "looking but not touching" an earlier term —
  // see `peek`/`returnToCurrent` below. Other pages (Bottlenecks etc.) never read this and so are
  // unaffected by whatever the Dashboard happens to be previewing.
  viewing: CheckpointState | null;
  loading: boolean;
  busy: boolean;
  error: string | null;
  start: () => Promise<void>;
  advance: () => Promise<void>;
  edit: (patch: CheckpointEdit) => Promise<void>;
  rewind: (seq: number) => Promise<void>;
  peek: (seq: number) => Promise<void>;
  returnToCurrent: () => void;
  discard: () => Promise<void>;
}

const CheckpointContext = createContext<CheckpointContextValue | null>(null);

export function CheckpointProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<CheckpointState | null>(null);
  const [viewing, setViewing] = useState<CheckpointState | null>(null);
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
      setViewing(null);
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
      setViewing(null);
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
      setViewing(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not save the edit");
      throw e; // let the caller keep its pending (unsaved) local edits rather than clearing them
    } finally {
      setBusy(false);
    }
  }, []);

  const rewind = useCallback(async (seq: number) => {
    setBusy(true);
    setError(null);
    try {
      setSession(await rewindCheckpoint(seq));
      // The live session now IS this point, so there's nothing left to "preview" separately.
      setViewing(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not go back to that term");
    } finally {
      setBusy(false);
    }
  }, []);

  // Non-destructive: fetches an earlier step's data into `viewing` without touching `session` or
  // any recorded history — the whole point is that just looking costs nothing. Switching to a
  // different past step (or back to the current one) is just another peek/clear, no confirmation
  // needed since nothing on the server has changed yet.
  const peek = useCallback(async (seq: number) => {
    setBusy(true);
    setError(null);
    try {
      setViewing(await peekCheckpoint(seq));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not preview that term");
    } finally {
      setBusy(false);
    }
  }, []);

  const returnToCurrent = useCallback(() => {
    setViewing(null);
  }, []);

  const discard = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      await discardCheckpoint();
      setSession(null);
      setViewing(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not discard the session");
    } finally {
      setBusy(false);
    }
  }, []);

  // Deliberately does NOT block rendering while loading (unlike SimulationProvider) — this
  // provider now lives at the dashboard layout level (see layout.tsx) so every page can read
  // it, and most pages (Bottlenecks, etc.) just fall back to their baseline data until the
  // (typically near-instant) GET /checkpoint resolves, no full-page flash needed. The Dashboard
  // page itself reads `loading` directly to avoid flashing its "Start walkthrough" screen before
  // an existing session is found.
  return (
    <CheckpointContext.Provider
      value={{ session, viewing, loading, busy, error, start, advance, edit, rewind, peek, returnToCurrent, discard }}
    >
      {children}
    </CheckpointContext.Provider>
  );
}

export function useCheckpoint(): CheckpointContextValue {
  const ctx = useContext(CheckpointContext);
  if (!ctx) throw new Error("useCheckpoint must be used within a CheckpointProvider");
  return ctx;
}
