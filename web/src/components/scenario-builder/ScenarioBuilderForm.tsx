"use client";

import { useMemo, useRef, useState } from "react";
import { useSimulation } from "@/lib/SimulationContext";
import { ApiError, createScenario } from "@/lib/api";
import { applyOverrides, baselineFromMeta, buildOverrides, type BuilderState } from "@/lib/scenarioBuilder";
import CapacityTab from "./CapacityTab";
import PassRatesDropoutTab from "./PassRatesDropoutTab";
import AdmissionsTab from "./AdmissionsTab";
import RegistrationPolicyTab from "./RegistrationPolicyTab";

const TABS = ["Capacity", "Pass Rates & Dropout", "Admissions", "Registration Policy"] as const;
type Tab = (typeof TABS)[number];

export default function ScenarioBuilderForm() {
  const { meta, topCapacityCourses, runScenario, resetToBaseline, savedScenarios, refreshScenarios } =
    useSimulation();
  const baseline = useMemo(() => baselineFromMeta(meta, topCapacityCourses), [meta, topCapacityCourses]);

  const [state, setState] = useState<BuilderState>(baseline);
  const [tab, setTab] = useState<Tab>("Capacity");
  const [mode, setMode] = useState<"simple" | "advanced">("simple");
  const [status, setStatus] = useState<"idle" | "running" | "updated" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [loadedScenarioId, setLoadedScenarioId] = useState<number | null>(null);
  const [saveName, setSaveName] = useState("");
  const [showSaveInput, setShowSaveInput] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const setField = <K extends keyof BuilderState>(key: K, value: BuilderState[K]) =>
    setState((prev) => ({ ...prev, [key]: value }));

  const setRecordField = (key: "capacityMultipliers" | "courseSections" | "passRates", code: string, value: number) =>
    setState((prev) => ({ ...prev, [key]: { ...prev[key], [code]: value } }));

  const overrides = useMemo(() => buildOverrides(state, baseline), [state, baseline]);
  const changeCount = Object.keys(overrides).length;

  const handleRun = async () => {
    setStatus("running");
    setError(null);
    try {
      await runScenario(loadedScenarioId ? { ...overrides, scenario_id: loadedScenarioId } : overrides);
      setStatus("updated");
    } catch (e) {
      setStatus("error");
      setError(e instanceof ApiError ? e.message : "Run failed");
    }
  };

  const handleReset = async () => {
    setState(baseline);
    setLoadedScenarioId(null);
    setStatus("running");
    setError(null);
    try {
      await resetToBaseline();
      setStatus("idle");
    } catch (e) {
      setStatus("error");
      setError(e instanceof ApiError ? e.message : "Reset failed");
    }
  };

  const handleExport = () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "scenario.json";
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImport = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result)) as Partial<BuilderState>;
        setState((prev) => ({ ...prev, ...parsed }));
      } catch {
        setStatus("error");
        setError("Could not parse that file as a scenario JSON.");
      }
    };
    reader.readAsText(file);
  };

  const handleSaveAs = async () => {
    if (!saveName.trim()) return;
    try {
      const created = await createScenario(saveName.trim(), overrides);
      await refreshScenarios();
      setLoadedScenarioId(created.id);
      setSaveName("");
      setShowSaveInput(false);
    } catch (e) {
      setStatus("error");
      setError(e instanceof ApiError ? e.message : "Save failed");
    }
  };

  const handleLoad = (id: number) => {
    if (!id) {
      setLoadedScenarioId(null);
      setState(baseline);
      return;
    }
    const record = savedScenarios.find((s) => s.id === id);
    if (!record) return;
    setState(applyOverrides(record.overrides, baseline));
    setLoadedScenarioId(id);
  };

  const handleClone = async () => {
    const current = savedScenarios.find((s) => s.id === loadedScenarioId);
    const name = `${current?.name ?? "Scenario"} (copy)`;
    try {
      const created = await createScenario(name, overrides);
      await refreshScenarios();
      setLoadedScenarioId(created.id);
    } catch (e) {
      setStatus("error");
      setError(e instanceof ApiError ? e.message : "Clone failed");
    }
  };

  const disabled = status === "running";

  return (
    <section className="py-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-[15px] font-bold">
          Scenario Builder
          {changeCount > 0 && (
            <span className="rounded-full bg-accent/20 px-2 py-0.5 text-[11px] font-semibold text-accent">
              {changeCount} change{changeCount === 1 ? "" : "s"} vs. baseline
            </span>
          )}
        </h2>

        <div className="flex rounded-[9px] border border-border-2 bg-surface-2 p-0.5 text-[12.5px]">
          {(["simple", "advanced"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={`rounded-[7px] px-3 py-1 font-semibold capitalize ${
                mode === m ? "bg-accent text-white" : "text-muted"
              }`}
            >
              {m}
            </button>
          ))}
        </div>
      </div>

      <div className="mb-4 flex flex-wrap gap-1 border-b border-border">
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={
              tab === t
                ? "-mb-px border-b-2 border-accent px-3 py-2 text-[13px] font-semibold text-ink"
                : "-mb-px border-b-2 border-transparent px-3 py-2 text-[13px] font-semibold text-muted hover:text-ink"
            }
          >
            {t}
          </button>
        ))}
      </div>

      <div className="min-h-[200px]">
        {tab === "Capacity" && (
          <CapacityTab
            mode={mode}
            meta={meta}
            topCapacityCourses={topCapacityCourses}
            state={state}
            baseline={baseline}
            setField={setField}
            setRecordField={setRecordField}
          />
        )}
        {tab === "Pass Rates & Dropout" && (
          <PassRatesDropoutTab mode={mode} meta={meta} state={state} baseline={baseline} setField={setField} setRecordField={setRecordField} />
        )}
        {tab === "Admissions" && <AdmissionsTab mode={mode} state={state} baseline={baseline} setField={setField} />}
        {tab === "Registration Policy" && (
          <RegistrationPolicyTab mode={mode} state={state} baseline={baseline} setField={setField} />
        )}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-border pt-4">
        <button
          type="button"
          onClick={handleRun}
          disabled={disabled}
          className="rounded-[9px] bg-accent px-4 py-1.5 text-[13px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          {status === "running" ? "Running…" : "Run simulation"}
        </button>
        <button
          type="button"
          onClick={handleReset}
          disabled={disabled}
          className="rounded-[9px] border border-border-2 bg-surface-2 px-3.5 py-1.5 text-[13px] font-semibold text-ink disabled:cursor-not-allowed disabled:opacity-50"
        >
          Reset to baseline
        </button>
        <select
          value={loadedScenarioId ?? ""}
          onChange={(e) => handleLoad(Number(e.target.value))}
          className="rounded-[9px] border border-border-2 bg-surface-2 px-2.5 py-1.5 text-[13px] text-ink"
        >
          <option value="">Load saved scenario…</option>
          {savedScenarios.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        {showSaveInput ? (
          <span className="flex items-center gap-1.5">
            <input
              autoFocus
              value={saveName}
              onChange={(e) => setSaveName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSaveAs()}
              placeholder="Scenario name"
              className="rounded-[9px] border border-border-2 bg-surface-2 px-2.5 py-1.5 text-[13px] text-ink"
            />
            <button
              type="button"
              onClick={handleSaveAs}
              className="rounded-[9px] border border-border-2 bg-surface-2 px-3 py-1.5 text-[13px] font-semibold text-ink"
            >
              Save
            </button>
          </span>
        ) : (
          <button
            type="button"
            onClick={() => setShowSaveInput(true)}
            className="rounded-[9px] border border-border-2 bg-surface-2 px-3.5 py-1.5 text-[13px] font-semibold text-ink"
          >
            Save as…
          </button>
        )}
        {loadedScenarioId !== null && (
          <button
            type="button"
            onClick={handleClone}
            className="rounded-[9px] border border-border-2 bg-surface-2 px-3.5 py-1.5 text-[13px] font-semibold text-ink"
          >
            Clone
          </button>
        )}
        <button
          type="button"
          onClick={handleExport}
          className="rounded-[9px] border border-border-2 bg-surface-2 px-3.5 py-1.5 text-[13px] font-semibold text-ink"
        >
          Export JSON
        </button>
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="rounded-[9px] border border-border-2 bg-surface-2 px-3.5 py-1.5 text-[13px] font-semibold text-ink"
        >
          Import JSON
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/json"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleImport(file);
            e.target.value = "";
          }}
        />

        <span
          className={
            status === "running"
              ? "text-xs text-accent"
              : status === "updated"
                ? "text-xs text-good"
                : status === "error"
                  ? "text-xs text-bad"
                  : "text-xs text-muted"
          }
        >
          {status === "running" ? "Running…" : status === "updated" ? "Updated — see Dashboard / Cohorts / Bottlenecks" : status === "error" ? error : "Idle"}
        </span>
      </div>
    </section>
  );
}
