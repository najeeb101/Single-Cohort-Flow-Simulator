"use client";

import { useState } from "react";
import Link from "next/link";
import { ApiError, updateConfig } from "@/lib/api";
import { useSimulation } from "@/lib/SimulationContext";
import { useIntake } from "@/lib/IntakeContext";
import { changedInputs, fmtDate, isSweep } from "@/lib/intakeUtils";
import DataQualityStrip from "@/components/intake/DataQualityStrip";
import ProgressBar from "@/components/intake/ProgressBar";
import RecommendationCard from "@/components/intake/RecommendationCard";
import IntakeChart from "@/components/intake/IntakeChart";
import IntakeTable from "@/components/intake/IntakeTable";
import SeatPlanner from "@/components/intake/SeatPlanner";
import CalibrationCard from "@/components/intake/CalibrationCard";
import PastAnalyses from "@/components/intake/PastAnalyses";
import PolicyFields from "@/components/data/PolicyFields";
import type { AnalysisRecord, IntakePolicy } from "@/types/simulation";

// The home page: "How many students should we admit in the next CS intake, and what course seats
// does that number need?" Runs the intake analysis (src/intake.py, a background job), shows the
// recommendation, every intake tried, the seat planner and past analyses.
export default function IntakePlannerPage() {
  const { meta, refreshBaseline } = useSimulation();
  const { job, busy, latestSweep, history, error, run, cancel, load } = useIntake();
  // An earlier analysis being viewed, remembered with the latest one at the time: a fresh result
  // replaces it automatically.
  const [picked, setPicked] = useState<{ record: AnalysisRecord; latestId: number | null } | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const selected = picked && picked.latestId === (latestSweep?.id ?? null) ? picked.record : null;
  const setSelected = (record: AnalysisRecord | null) =>
    setPicked(record ? { record, latestId: latestSweep?.id ?? null } : null);
  const shown = selected ?? latestSweep;
  const sweep = isSweep(shown) ? shown : null;
  const label = meta.planning?.next_intake_label || "next intake";

  const sweepJob = busy && job?.kind === "intake_sweep" ? job : null;
  const stale = sweep ? changedInputs(sweep, meta) : [];

  const runAnalysis = async () => {
    setRunError(null);
    try {
      const rec = await run({ kind: "intake_sweep" });
      if (rec.status === "failed") setRunError(rec.error ?? "The analysis failed.");
    } catch (e) {
      setRunError(e instanceof ApiError ? e.message : "Could not start the analysis.");
    }
  };

  const viewPast = async (id: number) => {
    try {
      setSelected(await load(id));
    } catch {
      setRunError("Could not load that analysis.");
    }
  };

  return (
    <main className="mx-auto w-full max-w-[1200px] px-5 pb-16 sm:px-7">
      <header className="border-b border-border py-5">
        <div className="text-xs font-semibold uppercase tracking-wide text-accent">{label}</div>
        <h1 className="mt-0.5 text-[22px] font-extrabold tracking-tight">How many students should we admit?</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted">
          The planner simulates today&apos;s students plus many possible intakes competing for the same course seats, and
          finds the largest intake whose seat shortages stay within your limits. Update the inputs on the{" "}
          <Link href="/data" className="font-semibold text-accent hover:underline">Data</Link> page.
        </p>
      </header>

      <div className="mt-5 flex flex-col gap-5">
        <DataQualityStrip quality={sweep?.result.data_quality} meta={meta} />

        <p className="rounded-xl border border-info/40 bg-info/10 px-4 py-2.5 text-sm text-ink">
          Sections and seats change every semester. This recommendation assumes the seats below stay roughly the same for
          the next 6 years. Update the data and re-run when the schedule changes.
        </p>

        <PolicyCard
          policy={meta.intake_policy}
          onSaved={async () => {
            try {
              await refreshBaseline();
            } catch {
              // Saved; other pages pick it up on the next load.
            }
          }}
        />

        <section className="no-print flex flex-col gap-3 rounded-2xl border border-border bg-surface p-5">
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={runAnalysis}
              disabled={busy}
              className="rounded-xl bg-accent px-6 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              {sweepJob ? "Analysis running..." : sweep ? "Run analysis again" : "Run analysis"}
            </button>
            <span className="text-sm text-muted">
              Takes about two to three minutes. You can keep using the other pages while it runs.
            </span>
            {sweep && (
              <button type="button" onClick={() => window.print()} className="ml-auto text-sm font-semibold text-muted hover:text-ink">
                Print
              </button>
            )}
          </div>
          {busy && !sweepJob && <p className="text-sm text-muted">A seat plan is running; the analysis can start when it finishes.</p>}
          {sweepJob && <ProgressBar job={sweepJob} onCancel={cancel} />}
          {(runError || error) && <p className="text-sm text-bad">{runError || error}</p>}
        </section>

        {!sweep ? (
          !sweepJob && (
            <div className="rounded-2xl border border-dashed border-border-2 bg-surface px-5 py-8 text-center text-sm text-muted">
              No analysis yet. Check the inputs on the Data page, then press <b className="text-ink">Run analysis</b>.
            </div>
          )
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
              <span>
                {selected ? "Viewing an earlier analysis" : "Latest analysis"}, finished {fmtDate(sweep.finished_at)} ·{" "}
                {sweep.result.runs.toLocaleString()} simulations
              </span>
              {selected && (
                <button type="button" onClick={() => setSelected(null)} className="font-semibold text-accent hover:underline">
                  Back to the latest
                </button>
              )}
            </div>
            {stale.length > 0 && (
              <p className="rounded-xl border border-warn/40 bg-warn/10 px-4 py-2.5 text-sm text-ink">
                The data has changed since this analysis ran ({stale.join(", ")}). Run it again for an up-to-date answer.
              </p>
            )}
            <RecommendationCard result={sweep.result} />
            <IntakeChart result={sweep.result} />
            <IntakeTable result={sweep.result} />
          </>
        )}

        <SeatPlanner defaultTarget={sweep?.result.recommendation.upper_limit ?? 120} />

        {sweep && <CalibrationCard calibration={sweep.result.calibration} />}

        <PastAnalyses history={history} selectedId={sweep?.id ?? null} onSelect={viewPast} />
      </div>
    </main>
  );
}

function PolicyCard({ policy, onSaved }: { policy: IntakePolicy; onSaved: () => Promise<void> }) {
  const [draft, setDraft] = useState<IntakePolicy>(policy);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const dirty = JSON.stringify(draft) !== JSON.stringify(policy);

  const save = async () => {
    setSaving(true);
    setErr(null);
    try {
      await updateConfig({ intake_policy: draft });
      await onSaved();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Could not save the limits");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="no-print rounded-2xl border border-border bg-surface p-5">
      <h2 className="text-[15px] font-bold">Your limits</h2>
      <p className="mb-3 mt-1 max-w-3xl text-sm text-muted">
        How much harm from seat shortages is acceptable, compared with the same students given every seat they ask for.
        &quot;pts&quot; are percentage points.
      </p>
      <PolicyFields value={draft} baseline={policy} onChange={setDraft} />
      {(dirty || err) && (
        <div className="mt-3 flex items-center gap-3">
          <button
            type="button"
            onClick={save}
            disabled={saving || !dirty}
            className="rounded-xl bg-accent px-4 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save limits"}
          </button>
          <button type="button" onClick={() => setDraft(policy)} className="text-sm font-semibold text-muted hover:text-ink">
            Discard
          </button>
          {err && <span className="text-sm text-bad">{err}</span>}
        </div>
      )}
    </section>
  );
}
