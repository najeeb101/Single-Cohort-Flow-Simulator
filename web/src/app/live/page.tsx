"use client";

import { useEffect, useState } from "react";
import { ApiError, createLiveSim, getLiveSim, getMeta, listLiveSims } from "@/lib/api";
import type { LiveSim, LiveSimDetail, MetaResponse } from "@/types/simulation";
import LiveSimList from "@/components/live/LiveSimList";
import LiveSimDetailView from "@/components/live/LiveSimDetailView";

type Phase = "loading" | "ready" | "error";

// Independent of SimulationContext/SimulationProvider on purpose — that provider gates the
// rest of the dashboard behind a "Start simulation" screen until a baseline /simulate run
// completes, but Live Simulation is its own per-livesim engine state that should be usable
// immediately. This page fetches /meta directly (for the curriculum-structure constants
// CurriculumGraph/LiveEditsPanel need) and /livesim itself, with no dependency on a baseline
// run ever having happened. See web/src/app/live/layout.tsx for the matching layout split.
export default function LivePage() {
  const [phase, setPhase] = useState<Phase>("loading");
  const [meta, setMeta] = useState<MetaResponse | null>(null);
  const [liveSims, setLiveSims] = useState<LiveSim[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  // Tagged with the id it was fetched for, so switching selectedId doesn't show a stale
  // detail for the previously selected sim while the new one is loading (computed below as
  // `detail` rather than cleared from the fetch effect, to avoid a derived-state setState).
  const [fetchedDetail, setFetchedDetail] = useState<{ id: number; data: LiveSimDetail } | null>(null);
  // True while fetchedDetail hasn't caught up to selectedId yet — derived rather than
  // tracked as its own state, since it's fully determined by those two.
  const [detailFetchFailed, setDetailFetchFailed] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  // Initial load: program structure + the list of this user's live sims, in parallel. Calls
  // the @/lib/api functions directly (rather than through a local helper) so the effect body
  // is a single promise chain — selecting the first sim, if any, once both resolve.
  useEffect(() => {
    Promise.all([getMeta(), listLiveSims()])
      .then(([m, sims]) => {
        setMeta(m);
        setLiveSims(sims);
        setPhase("ready");
        if (sims.length > 0) setSelectedId(sims[0].id);
      })
      .catch(() => setPhase("error"));
  }, []);

  useEffect(() => {
    if (selectedId === null) return;
    let cancelled = false;
    const id = selectedId;
    getLiveSim(id)
      .then((d) => {
        if (cancelled) return;
        setFetchedDetail({ id, data: d });
        setDetailFetchFailed(false);
      })
      .catch(() => {
        if (!cancelled) setDetailFetchFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  // Effective detail: only show fetchedDetail when it actually matches the current
  // selection (guards against a stale render between selecting a new sim and its fetch
  // resolving) — derived during render rather than cleared via a setState-in-effect.
  const detail = fetchedDetail && fetchedDetail.id === selectedId ? fetchedDetail.data : null;
  const detailLoading = selectedId !== null && detail === null && !detailFetchFailed;

  const refreshList = async () => {
    const sims = await listLiveSims();
    setLiveSims(sims);
    return sims;
  };

  const refreshDetail = async (id: number) => {
    const d = await getLiveSim(id);
    setFetchedDetail({ id, data: d });
    return d;
  };

  const handleCreate = async (name: string) => {
    setCreating(true);
    setCreateError(null);
    try {
      const created = await createLiveSim(name);
      await refreshList();
      setSelectedId(created.id);
    } catch (e) {
      setCreateError(e instanceof ApiError ? e.message : "Could not create live simulation");
    } finally {
      setCreating(false);
    }
  };

  const handleChanged = async () => {
    await Promise.all([refreshList(), selectedId !== null ? refreshDetail(selectedId) : Promise.resolve()]);
  };

  const handleDeleted = async () => {
    setSelectedId(null);
    setFetchedDetail(null);
    const sims = await refreshList();
    if (sims.length > 0) setSelectedId(sims[0].id);
  };

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

  return (
    <main className="mx-auto w-full max-w-[1600px] px-7 pb-16">
      <header className="border-b border-border py-5">
        <h1 className="text-[19px] font-bold tracking-tight">Live Simulation</h1>
        <p className="mt-0.5 text-[12.5px] text-muted">
          Step a simulation forward one term at a time, tweaking capacity, pass rates, offerings, and admissions
          between terms — independent of the baseline run on the Dashboard.
        </p>
      </header>

      <section className="grid gap-6 py-6 lg:grid-cols-[300px_1fr]">
        <LiveSimList
          liveSims={liveSims}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onCreate={handleCreate}
          creating={creating}
          error={createError}
        />

        <div>
          {selectedId === null ? (
            <div className="rounded-2xl border border-border bg-surface px-4 py-10 text-center text-[12.5px] text-muted">
              Select a live simulation, or create a new one to get started.
            </div>
          ) : detailFetchFailed && !detail ? (
            <div className="rounded-2xl border border-border bg-surface px-4 py-10 text-center text-[12.5px] text-bad">
              Could not load this live simulation.
            </div>
          ) : detailLoading || !detail ? (
            <div className="rounded-2xl border border-border bg-surface px-4 py-10 text-center text-[12.5px] text-muted">
              Loading…
            </div>
          ) : (
            <LiveSimDetailView meta={meta} detail={detail} onChanged={handleChanged} onDeleted={handleDeleted} />
          )}
        </div>
      </section>
    </main>
  );
}
