"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { activatePlan, deletePlan, exportPlan, listPlans, renamePlan } from "@/lib/api";
import { useSimulation } from "@/lib/SimulationContext";
import type { PlanRecord } from "@/types/simulation";

export default function PlansPage() {
  const { refreshBaseline } = useSimulation();
  const [plans, setPlans] = useState<PlanRecord[] | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [editing, setEditing] = useState<number | null>(null);
  const [draftName, setDraftName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const refreshPlans = async () => {
    setPlans(await listPlans());
  };

  useEffect(() => {
    // Fetch-on-mount: setPlans runs after the awaited request resolves (or in .catch), never
    // synchronously in the effect body, so the cascading-render concern the rule guards doesn't apply.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refreshPlans().catch(() => setPlans([]));
  }, []);

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

  const startRename = (plan: PlanRecord) => {
    setEditing(plan.id);
    setDraftName(plan.name);
    setError(null);
  };

  const cancelRename = () => {
    setEditing(null);
    setDraftName("");
  };

  const saveRename = async (plan: PlanRecord) => {
    const name = draftName.trim();
    if (!name) {
      setError("Plan name must not be empty");
      return;
    }
    if (name === plan.name) {
      cancelRename();
      return;
    }

    setBusy(plan.id);
    setError(null);
    try {
      await renamePlan(plan.id, name);
      await refreshPlans();
      cancelRename();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not rename plan");
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
    <main className="mx-auto w-full max-w-[1600px] px-7 pb-16">
      <header className="flex items-center justify-between border-b border-border py-5">
        <h1 className="text-[19px] font-bold tracking-tight">Plans</h1>
        <Link
          href="/plan-builder"
          className="rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-white"
        >
          + New plan
        </Link>
      </header>

      <section className="py-6">
        <div>
          {plans === null ? (
            <p className="text-sm text-muted">Loading...</p>
          ) : (
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr>
                  <th className="border-b border-border px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted">
                    Name
                  </th>
                  <th className="border-b border-border px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted">
                    Scope
                  </th>
                  <th className="border-b border-border px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted">
                    Status
                  </th>
                  <th className="border-b border-border px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {plans.map((plan) => (
                  <tr key={plan.id} className="group transition-colors hover:bg-surface-2">
                    <td className="border-b border-border px-3 py-2">
                      {editing === plan.id ? (
                        <form
                          className="flex max-w-md items-center gap-2"
                          onSubmit={(e) => {
                            e.preventDefault();
                            saveRename(plan);
                          }}
                        >
                          <input
                            value={draftName}
                            onChange={(e) => setDraftName(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Escape") cancelRename();
                            }}
                            autoFocus
                            disabled={busy !== null}
                            className="min-w-0 flex-1 rounded-lg border border-border-2 bg-surface px-3 py-1.5 text-sm font-semibold text-ink"
                          />
                          <button
                            type="submit"
                            disabled={busy !== null}
                            className="font-semibold text-accent disabled:opacity-50"
                          >
                            Save
                          </button>
                          <button
                            type="button"
                            onClick={cancelRename}
                            disabled={busy !== null}
                            className="font-semibold text-muted hover:text-ink disabled:opacity-50"
                          >
                            Cancel
                          </button>
                        </form>
                      ) : (
                        plan.name
                      )}
                    </td>
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
                        {editing !== plan.id && (
                          <button
                            type="button"
                            onClick={() => startRename(plan)}
                            disabled={busy !== null}
                            className="font-semibold text-accent disabled:opacity-50"
                          >
                            Rename
                          </button>
                        )}
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
          {error && <p className="mt-3 text-sm text-bad">{error}</p>}
        </div>
      </section>
    </main>
  );
}
