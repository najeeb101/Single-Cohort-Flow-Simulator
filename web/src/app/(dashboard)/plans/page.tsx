"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { activatePlan, deletePlan, exportPlan, importPlan, listPlans } from "@/lib/api";
import { useSimulation } from "@/lib/SimulationContext";
import type { CourseRecord, PlanRecord } from "@/types/simulation";

export default function PlansPage() {
  const { refreshBaseline } = useSimulation();
  const curriculumInputRef = useRef<HTMLInputElement | null>(null);
  const configInputRef = useRef<HTMLInputElement | null>(null);
  const [plans, setPlans] = useState<PlanRecord[] | null>(null);
  const [name, setName] = useState("");
  const [curriculumFile, setCurriculumFile] = useState<File | null>(null);
  const [configFile, setConfigFile] = useState<File | null>(null);
  const [busy, setBusy] = useState<number | "import" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refreshPlans = async () => {
    setPlans(await listPlans());
  };

  useEffect(() => {
    refreshPlans().catch(() => setPlans([]));
  }, []);

  const onImport = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!curriculumFile || !configFile || !name.trim()) return;
    setBusy("import");
    setError(null);
    try {
      const [curriculum, config] = await Promise.all([
        curriculumFile.text().then((text) => JSON.parse(text) as CourseRecord[]),
        configFile.text().then((text) => JSON.parse(text) as Record<string, unknown>),
      ]);
      await importPlan({ name: name.trim(), curriculum, config });
      setName("");
      setCurriculumFile(null);
      setConfigFile(null);
      if (curriculumInputRef.current) curriculumInputRef.current.value = "";
      if (configInputRef.current) configInputRef.current.value = "";
      await refreshPlans();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not import plan");
    } finally {
      setBusy(null);
    }
  };

  const activate = async (plan: PlanRecord) => {
    setBusy(plan.id);
    setError(null);
    try {
      await activatePlan(plan.id);
      await Promise.all([refreshPlans(), refreshBaseline()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not activate plan");
    } finally {
      setBusy(null);
    }
  };

  const remove = async (plan: PlanRecord) => {
    setBusy(plan.id);
    setError(null);
    try {
      await deletePlan(plan.id);
      await Promise.all([refreshPlans(), refreshBaseline()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete plan");
    } finally {
      setBusy(null);
    }
  };

  const download = async (plan: PlanRecord) => {
    setBusy(plan.id);
    setError(null);
    try {
      const payload = await exportPlan(plan.id);
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${plan.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "plan"}.json`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not export plan");
    } finally {
      setBusy(null);
    }
  };

  return (
    <main className="mx-auto max-w-6xl px-7 pb-16">
      <header className="flex items-center justify-between border-b border-border py-5">
        <h1 className="text-[19px] font-bold tracking-tight">Plans</h1>
        <Link
          href="/plan-builder"
          className="rounded-[9px] bg-accent px-4 py-2 text-[13px] font-semibold text-white"
        >
          + New plan
        </Link>
      </header>

      <section className="grid gap-8 py-6 lg:grid-cols-[1fr_340px]">
        <div>
          {plans === null ? (
            <p className="text-[12.5px] text-muted">Loading...</p>
          ) : (
            <table className="w-full border-collapse text-[12.5px]">
              <thead>
                <tr>
                  <th className="border-b border-border px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-muted">
                    Name
                  </th>
                  <th className="border-b border-border px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-muted">
                    Scope
                  </th>
                  <th className="border-b border-border px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-muted">
                    Status
                  </th>
                  <th className="border-b border-border px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {plans.map((plan) => (
                  <tr key={plan.id}>
                    <td className="border-b border-border px-3 py-2">{plan.name}</td>
                    <td className="border-b border-border px-3 py-2 text-muted">
                      {plan.is_default ? "Default" : "Private"}
                    </td>
                    <td className="border-b border-border px-3 py-2">
                      {plan.is_active ? (
                        <span className="font-semibold text-good">Active</span>
                      ) : (
                        <span className="text-muted">Inactive</span>
                      )}
                    </td>
                    <td className="border-b border-border px-3 py-2">
                      <div className="flex justify-end gap-3">
                        {!plan.is_active && (
                          <button
                            type="button"
                            onClick={() => activate(plan)}
                            disabled={busy !== null}
                            className="font-semibold text-accent disabled:opacity-50"
                          >
                            Activate
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => download(plan)}
                          disabled={busy !== null}
                          className="font-semibold text-accent disabled:opacity-50"
                        >
                          Export
                        </button>
                        {!plan.is_default && (
                          <button
                            type="button"
                            onClick={() => remove(plan)}
                            disabled={busy !== null}
                            className="font-semibold text-bad disabled:opacity-50"
                          >
                            Delete
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <form onSubmit={onImport} className="h-fit border border-border bg-surface px-4 py-4">
          <h2 className="mb-4 text-[14px] font-bold">Import Plan</h2>
          <label className="mb-3 flex flex-col gap-1.5 text-[12.5px] text-muted">
            Name
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              className="rounded-[7px] border border-border-2 bg-surface-2 px-3 py-2 text-[13px] text-ink outline-none focus:border-accent"
            />
          </label>
          <label className="mb-3 flex flex-col gap-1.5 text-[12.5px] text-muted">
            Curriculum JSON
            <input
              ref={curriculumInputRef}
              type="file"
              accept="application/json,.json"
              onChange={(event) => setCurriculumFile(event.target.files?.[0] ?? null)}
              className="text-[12.5px] text-muted file:mr-3 file:rounded-[7px] file:border-0 file:bg-surface-2 file:px-3 file:py-2 file:font-semibold file:text-ink"
            />
          </label>
          <label className="mb-4 flex flex-col gap-1.5 text-[12.5px] text-muted">
            Config JSON
            <input
              ref={configInputRef}
              type="file"
              accept="application/json,.json"
              onChange={(event) => setConfigFile(event.target.files?.[0] ?? null)}
              className="text-[12.5px] text-muted file:mr-3 file:rounded-[7px] file:border-0 file:bg-surface-2 file:px-3 file:py-2 file:font-semibold file:text-ink"
            />
          </label>
          {error && <p className="mb-3 text-[12.5px] text-bad">{error}</p>}
          <button
            type="submit"
            disabled={busy !== null || !name.trim() || !curriculumFile || !configFile}
            className="w-full rounded-[7px] bg-accent px-4 py-2 text-[13px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy === "import" ? "Importing..." : "Import"}
          </button>
        </form>
      </section>
    </main>
  );
}
