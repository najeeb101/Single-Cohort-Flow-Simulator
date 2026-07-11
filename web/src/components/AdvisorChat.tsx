"use client";

import { useMemo, useRef, useState } from "react";
import { advisorChat, ApiError } from "@/lib/api";
import type { AdvisorChatMessage, FlowTimelineSummary, Frame } from "@/types/simulation";

// Phase B of the hybrid advisor: an optional LLM chat box, grounded in this run's numbers AND the
// active plan's full curriculum + settings (the backend injects those on every /advisor/chat call
// from the DB — see src/api.py). It only renders live when the backend has an LLM key
// (meta.llm_chat_enabled); otherwise it shows a short "how to turn it on" note. The rules-based
// AdvisorPanel (Phase A) works with or without it. The run-summary + per-course aggregates below
// are built from data the dashboard already has — no extra run.

const SUGGESTIONS = [
  "Why aren't we hitting the graduation target?",
  "Which course should I add seats to first?",
  "What unlocks after the biggest bottleneck course, and how many seats does it have?",
];

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

function aggregateCourseStats(frames: Frame[]): Record<string, CourseRunStat> {
  const out: Record<string, CourseRunStat> = {};
  for (const f of frames) {
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
      if (s.denied > a.denied_peak) a.denied_peak = s.denied;
      if (s.offering_blocked > a.offering_blocked_peak) a.offering_blocked_peak = s.offering_blocked;
      if (s.prereq_waiting > a.prereq_waiting_peak) a.prereq_waiting_peak = s.prereq_waiting;
      if (s.full) a.full_terms += 1;
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
  enabled,
}: {
  summary: FlowTimelineSummary;
  scenario: string;
  frames: Frame[];
  enabled: boolean;
}) {
  const [messages, setMessages] = useState<AdvisorChatMessage[]>([]);
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
      criteria: summary.admissions_recommendation.criteria ?? [],
      bottlenecks: summary.top_bottlenecks,
      course_stats: aggregateCourseStats(frames),
    };
  }, [summary, scenario, frames]);

  const send = async (text: string) => {
    const q = text.trim();
    if (!q || sending) return;
    const next: AdvisorChatMessage[] = [...messages, { role: "user", content: q }];
    setMessages(next);
    setInput("");
    setSending(true);
    setError(null);
    // Let the just-added user bubble paint before scrolling.
    requestAnimationFrame(() => listRef.current?.scrollTo({ top: listRef.current.scrollHeight }));
    try {
      const res = await advisorChat(next, context);
      if (!res.configured) {
        setError("Chat isn't configured on the server (no LLM key).");
        return;
      }
      setMessages([...next, { role: "assistant", content: res.reply ?? "" }]);
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
        <div className="rounded-2xl border border-dashed border-border-2 bg-surface p-4 text-[12.5px] text-muted">
          The conversational advisor is off. Add <code className="rounded bg-black/20 px-1 py-0.5">LLM_API_KEY</code> to
          your <code className="rounded bg-black/20 px-1 py-0.5">.env</code> (see{" "}
          <code className="rounded bg-black/20 px-1 py-0.5">.env.example</code>) and restart the backend to chat with an
          assistant grounded in this run&apos;s numbers. Groq&apos;s free tier works out of the box; any
          OpenAI-compatible endpoint is a swap via <code className="rounded bg-black/20 px-1 py-0.5">LLM_BASE_URL</code> /{" "}
          <code className="rounded bg-black/20 px-1 py-0.5">LLM_MODEL</code>. The prioritized advice above works without it.
        </div>
      </section>
    );
  }

  return (
    <section className="py-6">
      <div className="mb-1 flex items-baseline gap-2">
        <h2 className="text-[15px] font-bold">Ask the advisor</h2>
        <span className="text-xs font-normal text-muted">— grounded in this run&apos;s numbers and your curriculum</span>
      </div>

      <div className="rounded-2xl border border-border bg-surface">
        <div ref={listRef} className="max-h-[420px] min-h-[80px] overflow-y-auto px-4 py-3">
          {messages.length === 0 ? (
            <div className="flex flex-col gap-2">
              <p className="text-[12.5px] text-muted">Ask about the results, the bottlenecks, or what to change. Try:</p>
              <div className="flex flex-wrap gap-2">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => send(s)}
                    className="rounded-full border border-border-2 px-3 py-1 text-[11.5px] text-ink hover:bg-surface-2"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-2.5">
              {messages.map((m, i) => (
                <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                  <div
                    className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-[12.5px] leading-relaxed ${
                      m.role === "user"
                        ? "bg-accent/10 text-ink"
                        : "border border-border bg-surface-2 text-ink"
                    }`}
                  >
                    {m.content}
                  </div>
                </div>
              ))}
              {sending && (
                <div className="flex justify-start">
                  <div className="rounded-2xl border border-border bg-surface-2 px-3 py-2 text-[12.5px] text-muted">
                    <span className="inline-block h-1.5 w-1.5 animate-ping rounded-full bg-accent" /> thinking…
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
            placeholder="Ask about this run…"
            aria-label="Ask the advisor"
            disabled={sending}
            className="flex-1 rounded-[9px] border border-border-2 bg-surface-2 px-3 py-1.5 text-[13px] text-ink placeholder:text-faint focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-60"
          />
          <button
            type="submit"
            disabled={sending || !input.trim()}
            className="rounded-[9px] bg-accent px-4 py-1.5 text-[13px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            Send
          </button>
        </form>
        {error && <p className="px-4 pb-2.5 text-[12px] text-bad">{error}</p>}
      </div>
      <p className="mt-1.5 text-[11px] text-muted">
        Answers come from an LLM reading this run&apos;s numbers and your full curriculum + settings. It can
        explain and suggest, but can&apos;t change anything — apply changes yourself in Settings, Bottlenecks, or
        What-if. Treat replies as a starting point, not ground truth.
      </p>
    </section>
  );
}
