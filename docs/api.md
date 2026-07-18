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
  "initial_state": {"occupancy": {...}, "standing": {...}},
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
  "llm_chat_enabled": false            // true iff LLM_API_KEY is set (Advisor chat available)
}
```

---

## Run a simulation

### `POST /simulate`
Runs the engine once (full window, not stepwise — see Live Simulation below for term-by-term)
against the active plan's curriculum, with any of the following fields in the body overriding
the plan's base config/scenario (all optional; omit a field to use the plan's value):

| Field | Type | Meaning |
|---|---|---|
| `capacity_multiplier` | float | scales every course's capacity |
| `capacity_overrides` | `{code: multiplier}` | per-course capacity scale |
| `offering_overrides` | `{code: [season, ...]}` | replace a course's offered seasons |
| `pass_rate_overrides` | `{code: rate}` | replace a course's pass rate |
| `cohort_size` | int | students per cohort |
| `num_cohorts` | int ≥ 1 | study cohorts admitted |
| `num_incumbent_cohorts` | int ≥ 0 | prior cohorts warm-started at negative terms |
| `admission_terms` | `list[str]` | seasons that admit a new cohort (mandatory seasons only; Fall-only or Fall+Spring) |
| `admission_sizes` | `{season: int}` | per-season intake size override (season absent → `cohort_size`) |
| `max_terms` | int ≥ 1 | personal semester budget before CENSORED |
| `seed` | int | RNG base seed |
| `initial_state` | `{occupancy, standing}` | admin-entered warm-start state (validated shape) |
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

`500` if the engine raises (e.g. a config combination that produces an invalid state). Every
successful call is recorded as a `Run` row (`overrides_json`, `summary_json`) visible via
`GET /runs`.

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
Partial update — any subset of the `CourseCreate` fields. `404` if not found; `422` on a cycle.

### `DELETE /curriculum/{code}`
`404` if not found. `422` if it's the plan's last remaining course, or if another course still
references it as a prerequisite / in a `rule_expr` (the response lists which courses).

---

## Config (active plan)

### `GET /config`
Returns the full raw config dict for the active plan (superset of what `/meta` selectively
exposes).

### `PUT /config`
Body: a partial dict, shallow-merged into the stored config. Validated fields:
`registration_tier_thresholds` (must be a 5-int list), `optional_terms_enabled` (must be bool),
`initial_state` (shape-checked: `occupancy` maps codes to non-negative ints, `standing` keys
are a subset of `Year2|Year3|Year4` with non-negative int values — `422` otherwise). Everything
else is stored as-is with no further validation.

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

## Live Simulation (stepwise)

See `docs/technical_design.md`'s Live Simulation Model for the replay design this is built on.
Shared within a plan — any request against the plan currently active is allowed to view/advance.

### `POST /livesim`
Body: `{name, initial_state?}`. Freezes the active plan's `(config, scenario)` as
`base_config`/`base_scenario` at creation time; `current_term` starts `null` (nothing simulated
yet).

### `GET /livesim`
List live sims for the active plan, each with `total_terms` (the full horizon, precomputed).

### `GET /livesim/{id}`
Returns `{live_sim, meta: {graph, stage_nodes, cohorts, initial_state, baseline_trajectory},
snapshots}` — `baseline_trajectory` is what an unedited replay looks like, for comparison against
the actually-edited snapshots.

### `POST /livesim/{id}/advance`
Body: `{edits?: {pass_rate_overrides?, offering_overrides?, cohort_size?, capacity_overrides?}}`.
Appends the edit (tagged `effective_from_term`) and replays from term 0 through the next term,
persisting one `LiveTermSnapshot`. `409` if the sim already finished or the next term is past its
horizon. `500` if replay doesn't land on the expected term (an engine-invariant violation, not a
normal user error).

### `DELETE /livesim/{id}`
Creator only — `403` otherwise.

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
