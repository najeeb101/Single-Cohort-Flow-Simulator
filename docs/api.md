# API Reference

Base URL: wherever `uvicorn src.api:app` is running (default `http://localhost:8001`). The
Next.js dashboard never calls this directly — it goes through `web/next.config.ts`'s
`/api/backend/*` rewrite so the browser stays same-origin.

**No login required.** Every request resolves to a single shared, auto-provisioned demo user
(`src/auth.py`) — auth was built in an earlier phase and deliberately removed as part of a
scope-simplification pass (see `docs/progress_report.md`). All endpoints below therefore act on
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
  "initial_state": {"occupancy": {...}},
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
  "admission_targets": { "target_grad_rate": 0.70, ... },
  "llm_chat_enabled": false,           // true iff LLM_API_KEY is set (Advisor chat available)
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
  "admissions_recommendation": { ... },
  "flow_timeline": { "meta": {...}, "frames": [...], "summary": {...} }
}
```

`422` if the effective (post-override) config would be invalid: `admission_terms` naming a
non-mandatory season, a non-positive `cohort_size`/`admission_sizes` value, a malformed
`initial_state`, or `initial_state.occupancy` exceeding a course's `capacity` (`src/plan_
validation.py::validate_plan_edits`/`validate_admissions`/`validate_initial_state` — the same
guardrails a persisted `PUT /curriculum`/`PUT /config` edit is checked against, applied here too
since `ScenarioRequest` overrides could otherwise bypass them entirely). `500` if the engine
raises for any other reason. Every successful call is recorded as a `Run` row (`overrides_json`,
`summary_json`) visible via `GET /runs`.

---

## Per-student trace

"Watch one synthetic student's term-by-term journey." Both endpoints re-run the deterministic
engine (CRN: `seed + student_id`) from the same overrides `/simulate` accepts (default `{}` =
the dashboard baseline), so a trace matches the aggregate numbers elsewhere. Nothing is
persisted — the run is cheap (~0.4s) and reproducible on demand. Neither endpoint records a
`Run` row.

### `POST /simulate/students/search`
Body accepts every `POST /simulate` override field, plus profile filters:

| Field | Type | Meaning |
|---|---|---|
| `filter_cohort_id` | int | keep only this study cohort |
| `filter_final_status` | `graduated`\|`dropped`\|`censored` | keep only this outcome (422 on any other value) |
| `filter_ever_probation` | bool | keep only students who were / were never on probation |
| `limit` | int 1–50 (default 8) | max candidates returned |

Returns lightweight candidate summaries (study cohorts only), ordered most-instructive-first
(most-delayed / most-failed):

```jsonc
{
  "candidates": [
    { "student_id": 241, "cohort_id": 2, "entry_term": 8, "final_status": "CENSORED",
      "gpa": 2.14, "completed_ch": 96, "grad_semester": null, "ever_probation": true,
      "total_fails": 3 }
  ],
  "total_matched": 37
}
```

### `POST /simulate/students/{student_id}/trace`
Body is a plain `ScenarioRequest` (same overrides as `/simulate`; send `{}` for the baseline).
Re-runs with per-student trace capture on (`Simulator(record_traces=True)`) and returns one
student's full journey; `404` if `student_id` isn't in the run.

```jsonc
{
  "student_id": 241, "cohort_id": 2, "entry_term": 8, "ability_score": -0.07,
  "final_status": "CENSORED", "final_reason": "Ran out of their semester budget without finishing.",
  "grad_semester": null, "gpa": 2.14, "completed_ch": 96, "total_program_ch": 120,
  "terms": [
    { "term": 8, "season": "Fall", "label": "Year 3 Fall", "personal_semester": 1,
      "status": "ACTIVE", "gpa": 2.3, "completed_ch": 12, "on_probation": false,
      "courses": [ { "code": "CMPS303", "title": "Data Structures", "grade": "F", "passed": false, "attempt_no": 1 } ],
      "blocked": [ { "code": "CMPS323", "title": "…", "signal": "prereq" } ] }
  ]
}
```

`blocked[].signal` is one of `capacity` (lost the seat lottery), `offering` (eligible but not
taught that term), or `prereq` (prerequisites unmet). A failed attempt is not a block — it
appears in `courses` with `grade: "F"`.

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
`admission_terms`/`admission_sizes` (mandatory seasons only, positive sizes). Also runs the same
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
payload atomically — rejects an empty curriculum, a prerequisite cycle, or a config missing
`cohort_size`/`scenarios` — as `422` with nothing committed on failure.

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
(`summary.headline`, `summary.per_cohort`, `summary.admissions_recommendation`,
`summary.top_bottlenecks`). Safe to read at any point, including zero terms run, but always
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

### `POST /checkpoint/autofill`
Same request/response shape as `POST /autofill` (`src/optimizer.py::solve_for_targets` — searches
the smallest capacity additions that meet the admission health targets at the current intake;
body: optional `run_budget` int and `tune_intake_fallback` bool), but the solver runs against the
session's `working_curriculum`/`working_config` instead of the live plan — answers "what capacity
would meet targets given what I've staged so far" without writing to the live plan first.
Read-only; apply the result via `POST /checkpoint/edit` (not `PUT /curriculum`/`PUT /config`) so
it takes effect on the next advance. `404` if no session exists.

### `DELETE /checkpoint`
Marks the session `discarded`. `404` if no session exists.

---

## Saved Scenarios + Run History

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

`src/advisor.py`. Provider-agnostic (any OpenAI-compatible `/chat/completions`), selected by env
vars: `LLM_API_KEY` (enables the feature), `LLM_BASE_URL` (default Groq), `LLM_MODEL` (default
`llama-3.3-70b-versatile`). See `.env.example`. With no key the feature is dormant and
`GET /meta.llm_chat_enabled` is `false`.

### `POST /advisor/chat`
Grounded chat about the current run. The request carries the conversation plus a `context` blob
the frontend built from its `/simulate` summary; the endpoint additionally injects the active
plan's full curriculum + settings (`summarize_plan`) so the model can answer per-course questions
from real data. Read-only: it can suggest changes but never writes.

```jsonc
// request
{
  "messages": [ {"role": "user", "content": "what should I change?"} ],  // last must be "user"
  "context": { "headline": {...}, "criteria": [...], "bottlenecks": {...}, "course_stats": {...} }
}
// response — dormant (no key):
{ "configured": false, "reply": null }
// response — configured:
{
  "configured": true,
  "reply": "MAGT101 has the most seat denials…",   // prose, with any JSON proposal block stripped
  "proposals": [                                     // validated against the real plan; may be []
    { "type": "capacity", "code": "MAGT101", "value": 120, "current": 70,
      "reason": "worst seat bottleneck", "label": "Set MAGT101 capacity to 120 seats (from 70)" }
  ]
}
```

Proposal `type` ∈ `capacity` | `offering` | `pass_rate` | `cohort_size` (capped at 3). The frontend
renders each as a card: **Test** runs `POST /simulate` with the proposal as an ephemeral override
(predicts the effect, writes nothing), **Apply** persists it via `PUT /curriculum`/`PUT /config`,
and **Save as scenario** calls `POST /scenarios`. `400` if the last message isn't from the user;
`502` if the LLM provider is unreachable or returns an error.
