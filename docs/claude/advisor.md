# Advisor

Reference split out of `CLAUDE.md`; read it when touching the advisor panel, advisor chat, proposals or `src/advisor.py`.

### Advisor

- **Advisor** (`web/src/components/AdvisorPanel.tsx`) — a **rules-based**
  (no-LLM, no-API-key) reading of the latest intake analysis and the run's `flow_timeline.summary` (headline metrics,
  top bottlenecks) into a prioritized list of plain-language
  recommendations. Pure frontend: it computes from data already in the `/simulate` payload, no
  extra request. This is **Phase A of the hybrid advisor**.
- **Advisor chat (Phase B)** (`src/advisor.py`, `POST /advisor/chat`,
  `web/src/components/AdvisorChat.tsx` on the `/advisor` page) — an **optional LLM chat box**
  grounded in the plan and the latest analysis. **The AI never produces the intake number; the simulation does.** **Provider-agnostic and local-first**: the default is a **local Ollama model** (`LLM_BASE_URL=http://localhost:11434/v1`, `LLM_MODEL=qwen3:4b-instruct-2507-q4_K_M`, ~25 s per grounded answer; `qwen3-coder:30b` failed to load on a laptop and needs ~32 GB RAM). A localhost base URL needs no `LLM_API_KEY` and gets a 120 s timeout; when it points at Ollama (port 11434) the backend calls the native `/api/chat` with `num_ctx=8192` so the ~3k-token grounding isn't truncated by Ollama's 4096 default, otherwise it POSTs to the OpenAI-compatible `/chat/completions` (hosted: `LLM_API_KEY`). Optional `LLM_FALLBACK_BASE_URL`/`_MODEL`/`_API_KEY` is tried if the primary fails (aggregate numbers only, never student records); `<think>` blocks are stripped; `/meta.llm_model` and the chat response's `model` show which model answered ("… · on this PC"). **Grounding has three sources merged per call**: the frontend sends a facts blob from the
  `/simulate` summary (headline/bottlenecks) **plus per-course run aggregates**
  (`course_stats`: peak seat-denials, terms-full, pass/fail totals, from the frames it already
  holds); the endpoint injects the latest completed `intake_sweep` for the plan (`summarize_analysis`: recommendation, why, robustness range, per-intake rows), and the **`/advisor/chat` endpoint injects `plan`** — the active plan's *full curriculum
  + settings* (`src/advisor.py::summarize_plan`: every course's seats/pass-rate/offering/
  prerequisites/study-plan-term, plus intake knobs and admission targets), loaded authoritatively
  from the DB so it's always fresh and can't be spoofed by the client. `build_system_prompt` renders
  all of it and forbids inventing figures/courses. So it answers detailed per-course questions
  ("what unlocks X?", "how many seats does Y have?") from the real plan, not a guess.
  **Actionable proposals (propose → admin applies)**: the model is instructed to append a fenced
  ```json {"proposals":[…]}``` block *only* when it recommends a concrete numeric change (types:
  `capacity`/`offering`/`pass_rate`/`cohort_size`). The endpoint runs `extract_proposals` (pulls the
  block out so the user sees prose, never raw JSON — fully defensive, a plain reply is untouched)
  then `validate_proposals` (whitelists the type, checks the course code exists / value is in range /
  offering seasons are in the plan, normalizes each into a `{type,code?,value,current,reason,label}`
  card, caps at 3). The frontend (`AdvisorProposalCard.tsx`) renders each as a card with two guarded
  actions: **Test** (runs one `/simulate` with the proposal as an ephemeral override and shows a
  predicted before/after table — grad rate, on-time, avg time, dropout, seats-denied — *without
  writing anything*) and **Apply** (Apply → confirm "edits your live plan and re-runs the baseline"
  → routes through the *existing* `PUT /curriculum`/`PUT /config` + `refreshBaseline()`). **The LLM
  never writes anything itself** — it only suggests; the human tests and confirms, and the write path
  is the same one Settings uses. This Test-then-Apply flow is now the app's **only** what-if surface:
  the prompt asks the model to emit a proposal for any "what if I…" request, so the advisor is the
  single entry point. The old standalone **`WhatIfPanel` was removed** (Bottlenecks now links to the
  advisor for what-if testing); the `capacity_overrides`/`offering_overrides`/`pass_rate_overrides`
  engine hooks it used are exactly what Test drives. **Proposal guardrails**:
  `validate_proposals` also deduplicates conflicting proposals (first-wins per `(type, code)` pair)
  and caps a `pass_rate` increase to +0.15 over the course's current rate, so the model can't
  round-trip an unrealistic 40% → 100% jump into an applyable card.
  **Severe-terms summary**: `src/analytics.py::summarize_severe_terms(result)` is a
  *retrospective* ranking, not a forecast — by the time it's called the run has already executed
  every term it reports on (true even mid-checkpoint: `history.timeline` only ever holds terms
  already stepped through). It walks the mandatory-term frames only (Summer/Winter excluded, same
  reasoning as the block-signal rankings above) and surfaces the worst seat shortfalls/offering
  blocks as a `{term_summaries, warnings}` structure — a `warning` fires once a single term's
  shortfall/block count hits 5, `severity: "high"` at 15+, sorted worst-first (severity, then
  shortfall size, then earliest term as a tiebreak, capped at 10) so index 0 really is the worst
  entry. It rides along for free as `summary.severe_terms` in every `/simulate`/`flow_timeline`
  payload (`src/analytics.py::flow_timeline_payload`), so `AdvisorPanel.tsx` surfaces the worst
  entry as an advice card ("Worst term-level bottleneck: Term N"), and `AdvisorChat.tsx` forwards
  it into the chat `context` so `build_system_prompt` can ground answers about bottlenecks that
  already showed up in the run — never phrased as a prediction of terms yet to come.
  **Graceful degradation**: with no `LLM_API_KEY`, `chat_enabled()` is
  `False`, `/meta.llm_chat_enabled` reports it, and the chat box shows a "how to enable" note —
  Phase A is untouched and needs no key. Covered by `tests/test_advisor.py` (enabled path mocks
  `httpx.post`, so no network; proposal extraction/validation covered offline) and
  `tests/test_severe_terms.py` (`summarize_severe_terms`'s shape, worst-first sort, and
  mandatory-terms-only filtering). Uses `httpx` (already a dep) — no new package, no `claude-api`
  skill needed since it's not Anthropic-specific.
