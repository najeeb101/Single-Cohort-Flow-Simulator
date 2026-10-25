# API Reference

Base URL: wherever `uvicorn src.api:app` is running (default `http://localhost:8001`). The
Next.js dashboard never calls this directly — it goes through `web/next.config.ts`'s
`/api/backend/*` rewrite so the browser stays same-origin.

**No login required.** Every request resolves to a single shared, auto-provisioned demo user
(`src/auth.py`) — auth was built in an earlier phase and deliberately removed as part of a
scope-simplification pass (the planner runs locally on a department PC). All endpoints below therefore act on
that one user's data; there is no per-user isolation except at the `Plan` level (a plan with
`owner_user_id != null` is private in principle, but since there's only ever one user in
practice, this only matters if auth is reintroduced later).

Every endpoint that mutates data commits before returning; there are no partial-write states to
poll for. Validation errors return `422` with a Pydantic-style `detail`; not-found returns `404`;
a duplicate/conflict (e.g. importing a course code that already exists) returns `409`.

---

## Health

### `GET /health`
Returns `{"status": "ok"}`. No DB access — use for a liveness probe.

---

## Program metadata

### `GET /meta`
Returns everything the dashboard needs before running a simulation, resolved from the caller's
**active plan**:

```jsonc
{
  "graph": { ... },                       // prerequisite graph (build_curriculum_graph)
  "course_pass_rates": {"CMPS151": 0.8, ...},
  "baseline_scenario": { ... },            // config["scenarios"][0]
  "cohort_size": 100,
  "num_cohorts": 8,
  "num_incumbent_cohorts": 0,
  "initial_state": {"occupancy": {...}},   // seats per course used by OTHER programs, every regular term
  "admission_terms": ["Fall"],                // seasons that admit a cohort (Fall-only / Fall+Spring)
  "admission_sizes": {},                      // optional per-season intake size, e.g. {"Spring": 40}
  "optional_terms_enabled": true,
  "max_terms": 12,
  "seed": 42,
  "dropout_gpa_floor": ...,
  "dropout_base_hazard": ...,
  "dropout_early_multiplier": ...,
  "dropout_early_sem_cutoff": ...,
  "dropout_fails_threshold": ...,
  "dropout_prob_on_repeated_fail": ...,
  "dropout_delay_hazard_scale": 0.0,
  "registration_tier_thresholds": [...],
  "enrollment_priority_tiers": [...],
  "intake_policy": {"max_grad_rate_loss_pts": 2.0, "max_on_time_loss_pts": 10.0, "min_grad_rate": null},
  "intake_analysis": {"grid_min": 20, "grid_max": 200, "grid_step": 10, "seeds": 20, ...},  // sweep knobs, merged with defaults
  "seat_step": 5,
  "planning": {"next_intake_label": "Fall 2027 intake", "data_as_of": "..."},
  "current_students": {"past_intakes": [{"label": "Fall 2026", "size": 100}, ...]},  // most recent first
  "historical_outcomes": {"grad_rate_6yr": null, "on_time_rate_4yr": null, "n_students": null, "current_headcount": null},
  "data_sources": {"capacity": {"CMPS151": "qu"}, "pass_rate": {}, "past_intakes": "estimate", "occupancy": "estimate"},
  "intake_job_running": false,         // true while an intake analysis is running
  "llm_chat_enabled": false,           // true iff a model is configured (local Ollama URL, or a hosted key)
  "llm_model": null,                   // e.g. "qwen3:4b-instruct-2507-q4_K_M · on this PC" (shown under the chat box)
  "checkpoint_active": false,          // true iff the caller has an in-progress/completed session
  "checkpoint_next_term": null         // that session's next_term, else null — see "Semester Checkpoint Mode"
}
```

---

## Run a simulation

### `POST /simulate`
Runs the engine once (full window) against the active plan's curriculum, with any of the
following fields in the body overriding
the plan's base config/scenario (all optional; omit a field to use the plan's value):

| Field | Type | Meaning |
|---|---|---|
| `capacity_multiplier` | float | scales every course's capacity |
| `capacity_overrides` | `{code: multiplier}` | per-course capacity scale |
| `offering_overrides` | `{code: [season, ...]}` | replace a course's offered seasons |
| `pass_rate_overrides` | `{code: rate}` | replace a course's pass rate |
| `cohort_size` | int ≥ 1 | students per cohort |
| `num_cohorts` | int ≥ 1 | study cohorts admitted |
| `num_incumbent_cohorts` | int ≥ 0 | prior cohorts warm-started at negative terms |
| `admission_terms` | `list[str]` | seasons that admit a new cohort (mandatory seasons only; Fall-only or Fall+Spring) |
| `admission_sizes` | `{season: int}` | per-season intake size override (season absent → `cohort_size`) |
| `max_terms` | int ≥ 1 | personal semester budget before CENSORED |
| `seed` | int | RNG base seed |
| `initial_state` | `{occupancy}` | admin-entered warm-start state (validated shape) |
| `dropout_gpa_floor` / `dropout_base_hazard` / `dropout_early_multiplier` / `dropout_early_sem_cutoff` / `dropout_fails_threshold` / `dropout_prob_on_repeated_fail` | number | dropout-hazard knobs |
| `registration_tier_thresholds` | `list[int]` (len 5) | CH bands for registration priority |
| `enrollment_priority_tiers` | `list[dict]` | category-priority tier definitions |
| `include_monte_carlo` | bool | re-runs the engine 30x for CIs (slow — opt-in) |
| `scenario_id` | int | bookkeeping only — which saved `Scenario` this came from |

Response:

```jsonc
{
  "metrics": { ... },                 // headline metrics
  "cohort_metrics": { ... },          // per-cohort breakdown
  "flow_timeline": { "meta": {...}, "frames": [...], "summary": {...} }
}
```

`/simulate` no longer returns an `admissions_recommendation` (the old one-run heuristic was
retired). The intake recommendation comes from `POST /intake-analyses`, below. The engine's
scenario dict also accepts `unlimited_seats: "all"|"regular"` (used internally by the intake
analysis for its no-shortage reference); it is not a `/simulate` request field.

`422` if the effective (post-override) config would be invalid: `admission_terms` naming a
non-mandatory season, a non-positive `cohort_size`/`admission_sizes` value, a malformed
`initial_state`, or `initial_state.occupancy` exceeding a course's `capacity` (`src/plan_
validation.py::validate_plan_edits`/`validate_admissions`/`validate_initial_state` — the same
guardrails a persisted `PUT /curriculum`/`PUT /config` edit is checked against, applied here too
since `ScenarioRequest` overrides could otherwise bypass them entirely). `500` if the engine
raises for any other reason. Every successful call is recorded as a `Run` row (`overrides_json`,
`summary_json`) visible via `GET /runs` (the website no longer has a Run History page, but the
endpoints remain).

---

## Intake Planner: background analyses

`src/intake.py` run through `src/jobs.py`; see [methodology.md](methodology.md) for the method.
An analysis is a background job stored as an `Analysis` row ([database.md](database.md)) with an
exact snapshot of the inputs it ran on. **Only one runs at a time** (an analysis already uses
every CPU core): starting a second returns `409`. Analyses are scoped to the caller and the
caller's active plan.

### `POST /intake-analyses` (202)
Starts a job and returns the summary row immediately; poll `GET /intake-analyses/{id}`.

```jsonc
// request (all fields optional except target_intake for a seat plan)
{
  "kind": "intake_sweep",            // "intake_sweep" (default) | "seat_plan"
  "label": "Fall 2027 intake",       // default: config.planning.next_intake_label
  "target_intake": 120,              // required for seat_plan, int 10..1000
  "source": "plan",                  // "plan" (active plan) | "checkpoint" (the walkthrough session's working data)
  "policy": {"max_grad_rate_loss_pts": 3},   // one-off policy override, not persisted
  "params": {"seeds": 30},           // one-off intake_analysis overrides, not persisted
  "run_budget": 6                    // seat_plan only: verification rounds, 1..20
}
```

Response (summary row, no `result` yet):

```jsonc
{
  "id": 7, "kind": "intake_sweep", "source": "plan", "label": "Fall 2027 intake",
  "status": "queued",                // queued | running | done | failed | cancelled
  "progress": 0.0, "progress_note": "",
  "params": {...}, "error": null,
  "created_at": "...", "started_at": null, "finished_at": null,
  "summary": {                       // intake_sweep: recommended_intake, sustainable_intake, upper_limit,
    "recommended_intake": null,      //   feasible, binding_limit, illustrative
    ...                              // seat_plan: target_intake, feasible, total_seats_added
  }
}
```

`409` if another analysis is running. `422` if `target_intake` is missing for a seat plan, the
policy/params fail validation (`validate_intake_policy`/`validate_intake_analysis`), or the
plan's data fails `validate_plan_edits`. `404` if `source: "checkpoint"` and there is no session.

### `GET /intake-analyses?kind=&limit=`
Past analyses for the caller's active plan, newest first (summaries only; `limit` 1..100,
default 20; optional `kind` filter).

### `GET /intake-analyses/{id}`
The summary row plus `result` and `inputs_snapshot` (`{curriculum, config}` exactly as run).
`404` if not the caller's. Progress is written about once a second while running.

`result` for `intake_sweep`:

```jsonc
{
  "analysis_version": 2, "label": "...", "policy": {...}, "params": {...},
  "reference": {"grad_rate", "on_time_rate", "se_grad", "se_on_time", "n_students", "runs", "denials": 0, ...},
  "history": [{"size": 100, "source": "entered"}, {"size": 100, "source": "padded"}],
  "views": {
    "next":   {"points": [...], "limits": [...], "recommended_intake", "binding_limit", "feasible"},
    "steady": {"points": [...], "limits": [...], "marginal": [...], "upper_limit", "recommended_intake", ...}
  },
  "recommendation": {
    "recommended_intake": 40, "sustainable_intake": 70, "upper_limit": 90, "feasible": true,
    "binding_limit": "on_time_loss", "binding_course": "CSEL2", "first_failing_intake": 50,
    "why": "...", "robustness": {"range": [lo, hi], "fewer_seats": ..., "lower_pass_rates": ..., "window": [...]},
    "warnings": ["..."]
  },
  "calibration": {"usual_intake": 100, "checks": [{"label", "actual", "simulated", "gap", "allowed_gap", "flag"}], "note": "..."},
  "data_quality": {"capacity": {"qu", "estimate", "total"}, "pass_rate": {...}, "past_intakes": {...}, "occupancy": "estimate", "as_of": "...", "illustrative": true},
  "runs": 570, "elapsed_s": 150.2
}
```

Each point in `views.*.points` has: `intake`, `seeds`, `grad_rate`/`grad_se`, `on_time_rate`/`on_time_se`,
`dropout_rate`, `censored_rate`, `avg_time_to_degree`, `graduates_per_year`, `denials_per_student`,
`summer_denial_share`, `top_courses` (`[{code, denials_per_student}]`), the per-limit columns
`grad_rate_loss`/`_fit`/`_upper` and `on_time_loss`/`_fit`/`_upper` (percentage points; `_fit` is the
monotone-smoothed value and `_upper` the one-sided 95% bound), and, on the `next` view,
`current_students_grad_rate` and `headcount_at_start`. Each entry of `limits` has `name`
(`grad_rate_loss|on_time_loss|min_grad_rate`), `tolerance`, `max_intake`, `first_failing_intake`,
`status` (`ok|imprecise|infeasible`) and `precision_warning`. When no intake satisfies a limit,
`recommended_intake` is `null` and `feasible` is `false`.

`result` for `seat_plan`: `target_intake`, `seat_step` (suggestions round up to it), `feasible`, `changes`
(`[{code, title, current, recommended, seats_added}]`, largest first),
`total_seats_added`, `before`/`after` (per view: `grad_rate`, `on_time_rate`,
`avg_time_to_degree`, `denials_per_student`, `checks`), `reference`, `trace` (one entry per
verification round that added a section), `runs`, `elapsed_s`, `note`. A seat plan is read-only:
apply it with `PUT /curriculum/{code}` (plan) or `POST /checkpoint/edit` (walkthrough session).

### `POST /intake-analyses/{id}/cancel`
`{"id": n, "cancel_requested": true}`. Stops the running job's workers; the row ends as
`cancelled`. A queued job that is not actually running is marked cancelled directly. `409` if the
analysis is already finished; `404` if not the caller's.

A server restart (for example `uvicorn --reload`) kills the job thread; at the next startup the
orphaned `queued`/`running` rows are marked `failed` with an "Interrupted" error.

---

## Curriculum CRUD (active plan)

### `GET /curriculum`
List all courses in the active plan, sorted by `study_plan_order`.

### `POST /curriculum`
Body: `CourseCreate` (`code`, `title`, `credits` 0–6, `prerequisites`, `pass_rate` 0–1,
`offering` [nonempty subset of `Fall|Spring|Summer|Winter`], `category` [one of `cs_core`,
`cs_elective`, `college_req`, `math`, `science`, `english`, `gen_ed`], `capacity` ≥ 1,
`rule_expr`, `study_plan_order`, `study_plan_term` 0–20).
`409` if the code already exists in this plan; `422` if adding it creates a prerequisite cycle.

### `PUT /curriculum/{code}`
Partial update — any subset of the `CourseCreate` fields **except `prerequisites`/`rule_expr`**,
which are write-once (settable only at creation, via `POST /curriculum` or Plan Builder) and
permanently locked afterward — a patch that actually *changes* either 422s (diff-based: resending
the same unchanged value is fine). `404` if not found; `422` on a prerequisite-lock violation, a
cycle, or a value `src/plan_validation.py::validate_plan_edits` rejects (e.g. capacity dropped
below existing `initial_state.occupancy` for that course).

### `DELETE /curriculum/{code}`
`404` if not found. `422` if it's the plan's last remaining course, or if another course still
references it as a prerequisite / in a `rule_expr` (the response lists which courses).

---

## Config (active plan)

### `GET /config`
Returns the full raw config dict for the active plan (superset of what `/meta` selectively
exposes).

### `PUT /config`
Body: a partial dict, shallow-merged into the stored config (a partial `initial_state` replaces
the *whole* key, not a deep merge — round-trip the full object if only changing one field of it).
Validated fields: `registration_tier_thresholds` (must be a 5-int list), `optional_terms_enabled`
(must be bool), `initial_state` (shape-checked: `occupancy` maps codes to non-negative ints),
`admission_terms`/`admission_sizes` (mandatory seasons only, positive sizes), and the Intake
Planner keys `intake_policy` (loss limits in `(0, 50]` / `(0, 100]` points, `min_grad_rate` null or
0..1), `intake_analysis` (sweep knobs within bounds, at most 60 grid points, `refine_seeds >= seeds`),
`current_students` (`past_intakes`: at most 30 entries, `size` 0..2000), `historical_outcomes`
(rates null or 0..1, counts non-negative) and `seat_step` (1..100). **`admission_targets` and `section_size` are
retired: a patch containing either returns `422`** ("set intake_policy instead"; sections vary
in size, so seat suggestions round to `seat_step`). Also runs the same
cross-object guardrails as `PUT /curriculum` against the resulting (config, curriculum) pair:
`cohort_size >= 1` and `initial_state.occupancy[code] <= capacity` for every course. `422` on any
violation, nothing committed on failure. Everything else is stored as-is with no further
validation.

---

## Plans

A **Plan** is a distinct `(curriculum, config)` pair; see `docs/database.md` for the schema.

### `GET /plans`
List plans visible to the caller: the shared default plan plus any the caller owns.

### `POST /plans/import`
Body: `{name, curriculum: [CourseCreate-shaped dicts], config: {...}}`. Validates the whole
payload atomically — rejects an empty curriculum, a prerequisite cycle, or a config missing any
required engine key — as `422` with nothing committed on failure. The config is passed through
`normalize_config` (drops `admission_targets`, fills the Intake Planner defaults).

### `POST /plans/{plan_id}/activate`
Switches the caller's `active_plan_id`. `404` if the plan doesn't exist or isn't visible to the
caller.

### `GET /plans/{plan_id}/export`
Round-trips back to the same `{curriculum, config}` shape `POST /plans/import` accepts.

### `DELETE /plans/{plan_id}`
Owner only, and never the default plan. If it was the caller's active plan, the caller is
reassigned to the default plan first.

---

## Semester Checkpoint Mode

A turn-based, resumable re-run of the active plan — one calendar term (mandatory *or* optional —
Summer/Winter are their own steps too) per `advance` call, with editable future-facing knobs in
between, and a `rewind` call to go back to any earlier step. No `Run` row is written by any of
these (this isn't the baseline `/simulate` path); one active-or-completed session exists per
caller at a time. See CLAUDE.md's "Semester Checkpoint Mode" for the full design (the Dashboard
*is* this feature — there's no separate baseline-only page).

### `POST /checkpoint`
Starts a new session from the caller's active plan (a frozen-at-creation copy of its curriculum
+ config). Discards any existing session for the caller first. Returns the session state (see
below), with zero terms run.

### `GET /checkpoint`
Returns the current session: `id`, `status` (`active|completed|discarded`), `next_term`,
`next_term_label` (season/year of the upcoming term, e.g. `"Summer Y2"` — `null` once finished),
`is_finished`, `working_curriculum` (plan-export shape), `working_config`, `frames` (same shape
as `flow_timeline.frames`, one per term run so far), `meta` (`{graph, stage_nodes}`),
`counts_so_far` (`{active, delayed, graduated, dropped, censored}`), `history` (every step
recorded so far — `[{seq, next_term, label}]`, `seq=0` labeled `"Start"`, otherwise the
season/year just completed, e.g. `"Fall Y1"`; feed a `seq` from here into `POST
/checkpoint/rewind`), and `flow_timeline` — the *exact* `{meta, frames, summary}` shape a
completed `POST /simulate` returns, computed live off the session's partial run
(`summary.headline`, `summary.per_cohort`, `summary.top_bottlenecks`). Safe to read at any point, including zero terms run, but always
**partial**: fewer terms means less reliable numbers, especially before any cohort has
finished — callers should frame it as such (the Dashboard and Bottlenecks pages both show an
explicit "N terms run so far" note when reading from a session). `404` if the caller has no
session (the normal "none in progress" state, not an error).

### `POST /checkpoint/edit`
Body (all optional, only present fields change): `capacity` (`{code: int}`), `pass_rate`
(`{code: float}`), `initial_state` (`{occupancy}`), `cohort_size` (int ≥ 1),
`admission_sizes` (`{season: int}`). No other field exists on this model — there is no way to
edit prerequisites, offering, category, `admission_terms`, `num_cohorts`, `max_terms`, or `seed`
through it. Validated the same way `PUT /curriculum`/`PUT /config` are; `422` on any violation,
with the stored session left untouched (validated against a copy first). Does not advance any
terms. `404` if no session exists.

### `GET /checkpoint/peek/{seq}`
Read-only preview of step `seq` (same payload shape as `GET /checkpoint`, with `viewed_seq`);
never mutates the session.

Seat plans for a walkthrough session: `POST /intake-analyses` with `source: "checkpoint"` runs
against the session's staged `working_curriculum`/`working_config` (it replaces the old
`POST /checkpoint/autofill`); apply the result through `POST /checkpoint/edit` so it takes effect
on the next advance.

### `POST /checkpoint/advance`
Steps the session forward exactly one calendar term — mandatory *or* optional, never more than
one per call — applying whatever edits were staged since the last advance. Marks the session
`completed` once the horizon is reached; advancing a `completed` session 422s. `404` if no
session exists.

### `POST /checkpoint/rewind`
Body: `{"seq": int}` — a step number from `history` (see `GET /checkpoint`). Restores the
session's simulated terms to that step and **discards every step recorded after it** (a linear
undo: advancing again afterward starts a fresh forward path from there, not a redo of whatever
used to come next). Reactivates a `completed` session back to `active` unless the target step is
itself the horizon's end. Deliberately leaves `working_curriculum`/`working_config` untouched —
staged capacity/pass-rate/occupancy/intake edits survive a rewind and apply starting from the
rewound point forward. `422` if `seq` doesn't match any recorded step. `404` if no session
exists.

### `DELETE /checkpoint`
Marks the session `discarded`. `404` if no session exists.

---

## Saved Scenarios + Run History (API only)

The website no longer has Scenarios or Run History pages; these endpoints remain for API users.

`src/scenarios.py` — every route below is scoped to the demo user (cross-user access 404s rather
than 403ing, so an attacker can't distinguish "not yours" from "doesn't exist" — a leftover
guarantee from when auth existed and worth keeping if it's ever reintroduced).

| Method | Path | Notes |
|---|---|---|
| `GET` | `/scenarios` | list, newest-updated first |
| `POST` | `/scenarios` | body `{name, overrides}` |
| `GET` | `/scenarios/{id}` | `404` if not owned |
| `PUT` | `/scenarios/{id}` | partial update (`name?`, `overrides?`) |
| `DELETE` | `/scenarios/{id}` | |
| `GET` | `/runs` | list, newest-first; each is a `POST /simulate` call's overrides + summary |
| `GET` | `/runs/{id}` | `404` if not owned |

---

## Advisor chat (optional LLM)

`src/advisor.py`. Provider-agnostic, selected by env
vars. **The default setup is a local model through Ollama** (`LLM_BASE_URL=http://localhost:11434/v1`,
`LLM_MODEL=qwen3:4b-instruct-2507-q4_K_M`, tested at about 25 s per grounded answer; a larger model such as `qwen3-coder:30b` needs a PC with about 32 GB RAM and is set via `LLM_MODEL`); a localhost base URL needs no `LLM_API_KEY`, and the timeout rises to
120 s (`LLM_TIMEOUT`). A hosted provider needs `LLM_API_KEY`. An optional `LLM_FALLBACK_BASE_URL`/
`LLM_FALLBACK_MODEL`/`LLM_FALLBACK_API_KEY` provider is tried if the primary fails. `<think>`
blocks (reasoning models) are stripped from replies. See `.env.example`. With neither a local URL
nor a key the feature is dormant and `GET /meta.llm_chat_enabled` is `false`. The AI never
produces the intake number; it explains the analysis and proposes changes to test.

### `POST /advisor/chat`
Grounded chat about the current run. The request carries the conversation plus a `context` blob
the frontend built from its `/simulate` summary; the endpoint additionally injects the active
plan's full curriculum + settings (`summarize_plan`) and the latest completed `intake_sweep` for the
plan (`summarize_analysis`: recommendation, why, range, per-intake rows) so the model can answer
"why 80?" or "what would it take to admit 120?" from the real analysis. Read-only: it can suggest
changes but never writes.

```jsonc
// request
{
  "messages": [ {"role": "user", "content": "what should I change?"} ],  // last must be "user"
  "context": { "headline": {...}, "bottlenecks": {...}, "course_stats": {...} }
}
// response — dormant (no key):
{ "configured": false, "reply": null }
// response — configured:
{
  "configured": true,
  "reply": "MAGT101 has the most seat denials…",   // prose, with any JSON proposal block stripped
  "model": "qwen3:4b-instruct-2507-q4_K_M · on this PC",           // which model answered
  "proposals": [                                     // validated against the real plan; may be []
    { "type": "capacity", "code": "MAGT101", "value": 120, "current": 70,
      "reason": "worst seat bottleneck", "label": "Set MAGT101 capacity to 120 seats (from 70)" }
  ]
}
```

Proposal `type` ∈ `capacity` | `offering` | `pass_rate` | `cohort_size` (capped at 3). The frontend
renders each as a card: **Test** runs `POST /simulate` with the proposal as an ephemeral override
(predicts the effect, writes nothing), and **Apply** persists it via `PUT /curriculum`/`PUT /config`. `400` if the last message isn't from the user;
`502` if the LLM provider is unreachable or returns an error.

Transport: when `LLM_BASE_URL` points at a local Ollama server (port 11434), the backend calls
Ollama's native `/api/chat` with `num_ctx=8192`, so the grounding prompt (about 3k tokens: the
full curriculum plus the latest analysis) is not silently truncated by Ollama's 4096-token
default. Any other server (hosted providers, LM Studio) is called through the OpenAI-compatible
`/chat/completions` endpoint.
