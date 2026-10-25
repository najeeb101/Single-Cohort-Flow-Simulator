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
import { PageHeader, Section, btnPrimary, btnSecondary } from "@/components/ui";
import type { AnalysisRecord, IntakePolicy, IntakeRecommendation } from "@/types/simulation";

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

  const rec = sweep?.result.recommendation;
  const policy = meta.intake_policy;
  const [limitsOpen, setLimitsOpen] = useState(false);

  return (
    <main className="mx-auto w-full max-w-[1080px] px-5 pb-24 sm:px-8">
      <PageHeader
        context={<>Computer Science · {label}</>}
        title="How many students should we admit?"
        actions={
          <>
            {sweep && (
              <button type="button" onClick={() => window.print()} className={btnSecondary}>
                Print
              </button>
            )}
            <button type="button" onClick={runAnalysis} disabled={busy} className={btnPrimary}>
              {sweepJob ? "Analysis running..." : sweep ? "Run analysis again" : "Run analysis"}
            </button>
          </>
        }
      >
        <Summary rec={rec ?? null} label={label} />
      </PageHeader>

      <div className="mt-4 flex flex-col gap-3">
        <DataQualityStrip quality={sweep?.result.data_quality} meta={meta} />
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[13px] text-muted">
          <button
            type="button"
            onClick={() => setLimitsOpen((v) => !v)}
            aria-expanded={limitsOpen}
            className="no-print inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-3 py-1 text-[13px] text-ink hover:bg-surface-2"
          >
            Limits: {policy.max_grad_rate_loss_pts} pts graduation · {policy.max_on_time_loss_pts} pts on-time
            <span className="text-accent">{limitsOpen ? "Close" : "Change"}</span>
          </button>
          <span>
            Sections and seats change every semester; the answer assumes today&apos;s seats hold for the next 6 years.
          </span>
        </div>
        {limitsOpen && (
          <PolicyCard
            policy={policy}
            onSaved={async () => {
              try {
                await refreshBaseline();
              } catch {
                // Saved; other pages pick it up on the next load.
              }
              setLimitsOpen(false);
            }}
          />
        )}
        {busy && !sweepJob && <p className="text-sm text-muted">A seat plan is running; the analysis can start when it finishes.</p>}
        {sweepJob && <ProgressBar job={sweepJob} onCancel={cancel} />}
        {(runError || error) && <p className="text-sm text-bad">{runError || error}</p>}
      </div>

      <div className="mt-10 flex flex-col gap-10">
        {!sweep ? (
          !sweepJob && (
            <div className="rounded-xl border border-dashed border-border-2 bg-surface-2/50 px-5 py-12 text-center text-sm text-muted">
              No analysis yet. Check the inputs on the{" "}
              <Link href="/data" className="font-medium text-accent hover:underline">Data</Link> page, then press{" "}
              <b className="font-medium text-ink">Run analysis</b>. It takes about two to three minutes.
            </div>
          )
        ) : (
          <>
            <Section
              title="Recommendation"
              meta={
                <>
                  {selected ? (
                    <button type="button" onClick={() => setSelected(null)} className="mr-2 font-medium text-accent hover:underline">
                      Back to the latest
                    </button>
                  ) : null}
                  {selected ? "Earlier analysis" : "Latest analysis"} · {fmtDate(sweep.finished_at)} ·{" "}
                  {sweep.result.runs.toLocaleString()} simulations
                </>
              }
            >
              {stale.length > 0 && (
                <p className="rounded-lg border border-warn/30 bg-warn/10 px-4 py-2.5 text-sm text-ink">
                  The data has changed since this analysis ran ({stale.join(", ")}). Run it again for an up-to-date answer.
                </p>
              )}
              <RecommendationCard result={sweep.result} />
            </Section>
            <Section title="What each intake would mean" meta="If the department admits this many next year">
              <IntakeChart result={sweep.result} />
            </Section>
            <Section title="Every intake tried">
              <IntakeTable result={sweep.result} />
            </Section>
          </>
        )}

        <Section title="Seat planner" meta={`Seats, rounded up to ${meta.seat_step}`}>
          <SeatPlanner defaultTarget={sweep?.result.recommendation.upper_limit ?? 120} />
        </Section>

        <div className="grid gap-10 lg:grid-cols-2">
          {sweep && (
            <Section title="Model check">
              <CalibrationCard calibration={sweep.result.calibration} />
            </Section>
          )}
          {history.length > 0 && (
            <Section title="Past analyses" className={sweep ? "" : "lg:col-span-2"}>
              <PastAnalyses history={history} selectedId={sweep?.id ?? null} onSelect={viewPast} />
            </Section>
          )}
        </div>
      </div>
    </main>
  );
}

// The CoAdvisor-style summary sentence under the title, in plain words.
function Summary({ rec, label }: { rec: IntakeRecommendation | null; label: string }) {
  if (!rec) {
    return (
      <p>
        Run the analysis to see how many students the {label} can take. It simulates today&apos;s students plus many
        possible intakes competing for the same course seats, and finds the largest intake whose seat shortages stay within
        your limits.
      </p>
    );
  }
  if (rec.recommended_intake == null) {
    return (
      <p>
        The latest analysis found <b className="font-medium text-ink">no intake that keeps your limits</b>
        {rec.binding_course ? <>; {rec.binding_course} runs out of seats first</> : null}. The seat planner shows what
        would make room.
      </p>
    );
  }
  return (
    <p>
      The latest analysis recommends admitting <b className="font-medium text-ink">{rec.recommended_intake} students</b> in
      the {label}.
      {rec.sustainable_intake != null && <> About {rec.sustainable_intake} a year is sustainable</>}
      {rec.upper_limit != null ? <>, and beyond {rec.upper_limit} extra students mostly add delay.</> : rec.sustainable_intake != null ? "." : null}
    </p>
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
            className="rounded-xl bg-primary px-4 py-1.5 text-sm font-semibold text-primary-ink disabled:opacity-50"
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
