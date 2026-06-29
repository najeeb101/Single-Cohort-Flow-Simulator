"use client";

import { useState } from "react";
import type { LiveSim } from "@/types/simulation";

interface Props {
  liveSims: LiveSim[];
  selectedId: number | null;
  onSelect: (id: number) => void;
  onCreate: (name: string) => Promise<void>;
  creating: boolean;
  error: string | null;
}

const STATUS_STYLE: Record<LiveSim["status"], string> = {
  active: "text-good",
  finished: "text-muted",
};

export default function LiveSimList({ liveSims, selectedId, onSelect, onCreate, creating, error }: Props) {
  const [name, setName] = useState("");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    await onCreate(name.trim());
    setName("");
  };

  return (
    <div className="flex h-fit flex-col gap-4">
      <form onSubmit={submit} className="rounded-2xl border border-border bg-surface p-4">
        <h2 className="mb-3 text-[13px] font-semibold">New live simulation</h2>
        <p className="mb-3 text-xs text-muted">
          Starts from the active plan&apos;s current curriculum and config — term 0 is simulated only once you
          press Advance.
        </p>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Fall 2026 what-if"
          className="mb-3 w-full rounded-[7px] border border-border-2 bg-surface-2 px-3 py-2 text-[13px] text-ink outline-none focus:border-accent"
        />
        {error && <p className="mb-2 text-[12.5px] text-bad">{error}</p>}
        <button
          type="submit"
          disabled={creating || !name.trim()}
          className="w-full rounded-[7px] bg-accent px-4 py-2 text-[13px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          {creating ? "Creating…" : "Create"}
        </button>
      </form>

      <div className="rounded-2xl border border-border bg-surface">
        <div className="border-b border-border px-4 py-2.5 text-[13px] font-semibold">Your live simulations</div>
        {liveSims.length === 0 ? (
          <p className="px-4 py-4 text-[12.5px] text-muted">None yet — create one above.</p>
        ) : (
          <ul className="divide-y divide-border">
            {liveSims.map((sim) => (
              <li key={sim.id}>
                <button
                  type="button"
                  onClick={() => onSelect(sim.id)}
                  className={`flex w-full flex-col gap-0.5 px-4 py-3 text-left ${
                    sim.id === selectedId ? "bg-accent/[0.08]" : "hover:bg-surface-2"
                  }`}
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="text-[13px] font-semibold text-ink">{sim.name}</span>
                    <span className={`text-[11px] font-semibold uppercase tracking-wide ${STATUS_STYLE[sim.status]}`}>
                      {sim.status}
                    </span>
                  </span>
                  <span className="text-[11.5px] text-muted">
                    {sim.current_term === null ? "Not started" : `Term ${sim.current_term} of ${sim.total_terms}`}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
