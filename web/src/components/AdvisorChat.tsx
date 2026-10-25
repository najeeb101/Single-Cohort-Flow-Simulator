"use client";

import { useMemo, useRef, useState } from "react";
import { advisorChat, ApiError } from "@/lib/api";
import { useSimulation } from "@/lib/SimulationContext";
import AdvisorProposalCard from "@/components/AdvisorProposalCard";
import type { AdvisorProposal, FlowTimelineSummary, Frame } from "@/types/simulation";

// A chat turn as this component tracks it: the wire shape (role/content) plus any actionable
// proposals the backend attached to an assistant reply (rendered as one-click Apply cards).
type ChatTurn = { role: "user" | "assistant"; content: string; proposals?: AdvisorProposal[]; model?: string };

// Phase B of the hybrid advisor: an optional LLM chat box, grounded in this run's numbers, the
// active plan's full curriculum + settings, and the latest intake analysis (the backend injects
// the last two on every /advisor/chat call from the DB, see src/api.py). The model explains the
// recommendation; it never produces the intake number. It only renders live when a model is
// configured (meta.llm_chat_enabled: a local Ollama server by default); otherwise it shows a short
// "how to turn it on" note. The rules-based AdvisorPanel (Phase A) works with or without it.

function suggestions(recommended: number | null | undefined): string[] {
  return [
    recommended != null ? `Why is the recommendation ${recommended}?` : "Why does no intake meet the limits?",
    "What would it take to admit 120?",
    "Which course most needs extra seats?",
  ];
}

// Per-course run behavior, aggregated from the frames the dashboard already holds. Merged into the
// backend's curriculum list (by course code) so the model sees each course's definition next to how
// it actually behaved this run — peak seat denials, terms it ran full, pass/fail totals.
type CourseRunStat = {
  denied_peak: number;
  full_terms: number;
  offering_blocked_peak: number;
  prereq_waiting_peak: number;
  passed: number;
  failed: number;
};

function aggregateCourseStats(frames: Frame[], mandatorySeasons: string[]): Record<string, CourseRunStat> {
  const mandatory = new Set(mandatorySeasons);
  const out: Record<string, CourseRunStat> = {};
  for (const f of frames) {
    const isMandatory = mandatory.has(f.season);
    for (const [code, s] of Object.entries(f.courses)) {
      const a =
        out[code] ??
        (out[code] = {
          denied_peak: 0,
          full_terms: 0,
          offering_blocked_peak: 0,
          prereq_waiting_peak: 0,
          passed: 0,
          failed: 0,
        });
      // The structural signals (seat denials, full, offering + prereq waits) count on regular terms
      // only — optional-term seats are a deliberately-scarce bonus pool, matching the mandatory-only
      // bottleneck rankings the model also sees. Passes/fails are real whenever they happen.
      if (isMandatory) {
        if (s.denied > a.denied_peak) a.denied_peak = s.denied;
        if (s.full) a.full_terms += 1;
        if (s.offering_blocked > a.offering_blocked_peak) a.offering_blocked_peak = s.offering_blocked;
        if (s.prereq_waiting > a.prereq_waiting_peak) a.prereq_waiting_peak = s.prereq_waiting;
      }
      a.passed += s.passed;
      a.failed += s.failed;
    }
  }
  return out;
}

export default function AdvisorChat({
  summary,
  scenario,
  frames,
  mandatorySeasons,
  enabled,
  modelLabel,
  recommendedIntake,
}: {
  summary: FlowTimelineSummary;
  scenario: string;
  frames: Frame[];
  mandatorySeasons: string[];
  enabled: boolean;
  modelLabel?: string | null;
  recommendedIntake?: number | null;
}) {
  const { refreshBaseline } = useSimulation();
  const baseline = summary.headline;
  const [messages, setMessages] = useState<ChatTurn[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const context = useMemo(() => {
    const h = summary.headline;
    return {
      scenario,
      headline: {
        graduation_rate: h.graduation_rate,
        on_time_rate: h.on_time_rate,
        avg_graduation_time: h.avg_graduation_time,
        academic_dropout_rate: h.academic_dropout_rate,
        censored_rate: h.censored_rate,
        mean_gpa_at_graduation: h.mean_gpa_at_graduation,
      },
      bottlenecks: summary.top_bottlenecks,
      course_stats: aggregateCourseStats(frames, mandatorySeasons),
      severe_terms: summary.severe_terms,
    };
  }, [summary, scenario, frames, mandatorySeasons]);

  const send = async (text: string) => {
    const q = text.trim();
    if (!q || sending) return;
    const next: ChatTurn[] = [...messages, { role: "user", content: q }];
    setMessages(next);
    setInput("");
    setSending(true);
    setError(null);
    // Let the just-added user bubble paint before scrolling.
    requestAnimationFrame(() => listRef.current?.scrollTo({ top: listRef.current.scrollHeight }));
    try {
      // Only role/content go on the wire; proposals are display-only state, not conversation.
      const res = await advisorChat(next.map(({ role, content }) => ({ role, content })), context);
      if (!res.configured) {
        setError("Chat isn't configured on the server (no model set up).");
        return;
      }
      setMessages([...next, { role: "assistant", content: res.reply ?? "", proposals: res.proposals, model: res.model }]);
      requestAnimationFrame(() => listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" }));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "The advisor couldn't respond — try again.");
    } finally {
      setSending(false);
    }
  };

  if (!enabled) {
    return (
      <section className="py-6">
        <h2 className="mb-1 text-[15px] font-bold">Ask the advisor</h2>
        <div className="flex flex-col gap-2 rounded-2xl border border-dashed border-border-2 bg-surface p-4 text-sm text-muted">
          <p>
            The chat is off. It runs best on a free local model through{" "}
            <a href="https://ollama.com" className="font-semibold text-accent hover:underline">Ollama</a>, so nothing leaves
            this PC and no API key is needed:
          </p>
          <ol className="ml-5 list-decimal">
            <li>
              Install Ollama, then run{" "}
              <code className="rounded border border-border bg-surface-2 px-1 py-0.5 font-mono text-[12.5px]">ollama pull qwen3:4b-instruct-2507-q4_K_M</code>.
            </li>
            <li>
              Add these two lines to the <code className="rounded border border-border bg-surface-2 px-1 py-0.5 font-mono text-[12.5px]">.env</code> file in the project
              folder (see <code className="rounded border border-border bg-surface-2 px-1 py-0.5 font-mono text-[12.5px]">.env.example</code>):
              <pre className="mt-1.5 rounded-lg border border-border bg-surface-2 px-3 py-2 text-xs">
                LLM_BASE_URL=http://localhost:11434/v1{"\n"}LLM_MODEL=qwen3:4b-instruct-2507-q4_K_M
              </pre>
            </li>
            <li>Restart the planner (start.bat).</li>
          </ol>
          <p>
            A larger model such as <code className="rounded border border-border bg-surface-2 px-1 py-0.5 font-mono text-[12.5px]">qwen3-coder:30b</code> needs a PC with
            about 32 GB of memory. A paid hosted model can be added as an optional backup (LLM_FALLBACK_* settings). The
            advice cards on this page work without any model.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className="py-6">
      <div className="mb-1 flex items-baseline gap-2">
        <h2 className="text-[15px] font-bold">Ask the advisor</h2>
        <span className="text-xs font-normal text-muted">grounded in the latest analysis, this run and your curriculum</span>
      </div>

      <div className="rounded-2xl border border-border bg-surface">
        <div ref={listRef} className="max-h-[420px] min-h-[80px] overflow-y-auto px-4 py-3">
          {messages.length === 0 ? (
            <div className="flex flex-col gap-2">
              <p className="text-sm text-muted">Ask about the recommendation, the bottlenecks, or what to change. Try:</p>
              <div className="flex flex-wrap gap-2">
                {suggestions(recommendedIntake).map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => send(s)}
                    className="rounded-full border border-border-2 px-3 py-1 text-xs text-ink hover:bg-surface-2"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-2.5">
              {messages.map((m, i) => (
                <div key={i} className={`flex flex-col gap-2 ${m.role === "user" ? "items-end" : "items-start"}`}>
                  <div
                    className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm leading-relaxed ${
                      m.role === "user"
                        ? "bg-accent/10 text-ink"
                        : "border border-border bg-surface-2 text-ink"
                    }`}
                  >
                    {m.content}
                  </div>
                  {m.role === "assistant" && m.model && <span className="text-[10.5px] text-muted">Answered by {m.model}</span>}
                  {m.role === "assistant" && m.proposals && m.proposals.length > 0 && (
                    <div className="flex w-full max-w-[85%] flex-col gap-1.5">
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted">
                        Suggested changes: test, then apply
                      </p>
                      {m.proposals.map((p, j) => (
                        <AdvisorProposalCard
                          key={j}
                          proposal={p}
                          baseline={baseline}
                          onApplied={refreshBaseline}
                        />
                      ))}
                    </div>
                  )}
                </div>
              ))}
              {sending && (
                <div className="flex justify-start">
                  <div className="rounded-2xl border border-border bg-surface-2 px-3 py-2 text-sm text-muted">
                    <span className="inline-block h-1.5 w-1.5 animate-ping rounded-full bg-accent" /> thinking… (a local model can take 20 to 30 seconds)
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            send(input);
          }}
          className="flex items-center gap-2 border-t border-border px-3 py-2.5"
        >
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask about the recommendation..."
            aria-label="Ask the advisor"
            disabled={sending}
            className="flex-1 rounded-xl border border-border-2 bg-surface-2 px-3 py-1.5 text-sm text-ink placeholder:text-faint focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-60"
          />
          <button
            type="submit"
            disabled={sending || !input.trim()}
            className="rounded-xl bg-primary px-4 py-1.5 text-sm font-semibold text-primary-ink disabled:cursor-not-allowed disabled:opacity-50"
          >
            Send
          </button>
        </form>
        {error && <p className="px-4 pb-2.5 text-sm text-bad">{error}</p>}
      </div>
      <p className="mt-1.5 text-xs text-muted">
        {modelLabel ? <>Model: <span className="font-semibold text-ink">{modelLabel}</span>. </> : null}
        The AI explains the result; the intake number always comes from the simulation. When it suggests a change you can{" "}
        <span className="font-semibold text-ink">Test</span> it (a what-if run that changes nothing) and then{" "}
        <span className="font-semibold text-ink">Apply</span> it, which writes it into your active plan. It never edits
        anything on its own. Treat replies as a starting point, not ground truth.
      </p>
    </section>
  );
}
