"use client";

import { useState } from "react";
import { useSimulation } from "@/lib/SimulationContext";
import { deleteScenario, updateScenario } from "@/lib/api";

export default function ScenariosPage() {
  const { savedScenarios, refreshScenarios } = useSimulation();
  const [renamingId, setRenamingId] = useState<number | null>(null);
  const [renameValue, setRenameValue] = useState("");

  const startRename = (id: number, name: string) => {
    setRenamingId(id);
    setRenameValue(name);
  };

  const commitRename = async (id: number) => {
    if (renameValue.trim()) {
      await updateScenario(id, { name: renameValue.trim() });
      await refreshScenarios();
    }
    setRenamingId(null);
  };

  const remove = async (id: number) => {
    await deleteScenario(id);
    await refreshScenarios();
  };

  return (
    <main className="mx-auto max-w-[1600px] px-7 pb-16">
      <header className="border-b border-border py-5">
        <h1 className="text-[19px] font-bold tracking-tight">Saved Scenarios</h1>
      </header>

      <section className="py-6">
        {savedScenarios.length === 0 ? (
          <p className="text-[12.5px] text-muted">
            No saved scenarios yet — build one in the Scenario Builder and click &quot;Save as…&quot;.
          </p>
        ) : (
          <table className="w-full border-collapse text-[12.5px]">
            <thead>
              <tr>
                <th className="border-b border-border px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-muted">
                  Name
                </th>
                <th className="border-b border-border px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-muted">
                  Last updated
                </th>
                <th className="border-b border-border px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-muted">
                  Changes vs. baseline
                </th>
                <th className="border-b border-border px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {savedScenarios.map((s) => (
                <tr key={s.id}>
                  <td className="border-b border-border px-3 py-2">
                    {renamingId === s.id ? (
                      <input
                        autoFocus
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && commitRename(s.id)}
                        onBlur={() => commitRename(s.id)}
                        className="rounded-[7px] border border-border-2 bg-surface-2 px-2 py-1 text-ink"
                      />
                    ) : (
                      s.name
                    )}
                  </td>
                  <td className="border-b border-border px-3 py-2 text-muted">
                    {new Date(s.updated_at).toLocaleString()}
                  </td>
                  <td className="border-b border-border px-3 py-2 text-muted">
                    {Object.keys(s.overrides).length}
                  </td>
                  <td className="border-b border-border px-3 py-2">
                    <div className="flex gap-3">
                      <a href="/scenario-builder" className="font-semibold text-accent">
                        Load
                      </a>
                      <button
                        type="button"
                        onClick={() => startRename(s.id, s.name)}
                        className="font-semibold text-accent"
                      >
                        Rename
                      </button>
                      <button type="button" onClick={() => remove(s.id)} className="font-semibold text-bad">
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </main>
  );
}
