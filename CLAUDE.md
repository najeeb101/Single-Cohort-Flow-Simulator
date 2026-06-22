# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Purpose

A discrete-term, agent-based simulation of students progressing through Qatar University's Computer Science curriculum over up to 12 semesters each. Research question: **which prerequisite chains and scheduling constraints contribute most to student delay and non-completion?**

It now models a **multi-cohort, steady-state university**: a new cohort is admitted each year, several incumbent cohorts are seeded before the study window as a warm start, and **all cohorts compete for one shared pool of course seats**. The engine emits a frontend-ready per-semester data file that the included Next.js dashboard (`web/`) animates.

Full design document: [docs/technical_design.md](docs/technical_design.md)
Assumptions log: [docs/assumptions.md](docs/assumptions.md)

## Commands

```bash
# Run the full simulation (writes outputs/ only)
py run.py

# Re-calibrate course_sections to peak demand (writes into simulation_config.json)
py scripts/size_sections.py

# One-time seed of data/app.db from the JSON files (auto-runs on first API startup too;
# rerun with --force after hand-editing curriculum.json/simulation_config.json to resync)
py scripts/migrate_json_to_db.py [--force]

# Run the HTTP API. AUTH_SECRET must be set (the process fails fast at import time if it
# isn't — no hardcoded dev-secret fallback, by design):
#   PowerShell: $env:AUTH_SECRET = "some-32+-byte-local-dev-secret"
#   bash:       export AUTH_SECRET="some-32+-byte-local-dev-secret"
py -m uvicorn src.api:app --reload --port 8001

# Run the Next.js dashboard (talks to the API above via next.config.ts's rewrite, see
# web/README.md). Must open http://localhost:3000, not 127.0.0.1:3000 — Next.js 16 dev
# mode blocks cross-origin dev requests from origins not in `allowedDevOrigins`.
cd web && npm install && npm run dev   # then open http://localhost:3000, register an account

# Run tests
py -m pytest tests/ -v

# Install dependencies
py -m pip install -r requirements.txt
```

Deploying a live instance (Render free tier, one `render.yaml` blueprint for backend + frontend
+ Postgres): see [docs/deployment.md](docs/deployment.md).

## Architecture

```
src/
├── models/
│   ├── course.py       # Course dataclass + load_curriculum()
│   ├── student.py      # Student (state, GPA, enrollment, cohort_id/entry_term, curriculum_stage())
│   └── semester.py     # term_season(), term_year(), term_label()
├── datasource.py        # DataSource seam: CohortSpec + SyntheticDataSource (population creation, decoupled from the engine)
├── rules.py             # evaluate_rule() / gate_edges() — generic compound prerequisite/eligibility expressions
├── simulator.py         # Simulator (staggered admission + 3-phase per-term loop) + History + SimulationResult
├── analytics.py         # metrics, per-cohort metrics, admissions recommendation, curriculum graph, flow_timeline JSON, CSV writers
├── service.py            # run_simulation() — engine-as-a-service boundary, no file I/O (the seam an API layer calls)
├── db.py                 # SQLAlchemy engine/session, plan-scoped DB<->engine-shape loaders,
│                         # get_or_create_default_plan(), import_plan(), resolve_active_plan_id()
├── db_models.py          # User/Plan/Course/Instructor/AppConfig/Scenario/Run ORM tables
│                         # (Course/Instructor/AppConfig are per-Plan; User.active_plan_id
│                         # picks which Plan drives that user)
├── auth.py               # JWT register/login, get_current_user (header or `session` cookie)
├── scenarios.py          # Persistent /scenarios + /runs endpoints, scoped per user
├── curriculum_validation.py  # check_no_cycle() — networkx prerequisite-cycle check for Settings
│                         # edits and Plan imports; PlanImportError for malformed/cyclic imports
├── capacity.py            # build_capacity_report()/build_instructor_capacity() — seats +
│                         # instructor-load feasibility + admissions, composed into
│                         # flow_timeline.summary.capacity_planning (see Capacity Planning Model)
├── api.py                # FastAPI wrapper: /health, /auth/*, /meta, /simulate, /scenarios, /runs,
│                         # /curriculum (GET/POST/PUT/DELETE), /instructors (GET/POST/PUT/DELETE),
│                         # /config, /plans — every endpoint but /health + /auth/* requires login
├── montecarlo.py         # run_monte_carlo() — mean ± 95% CI over many seeds
├── visualize.py          # save_all_figures() + per-figure functions
└── utils.py              # load_json(), grade_tier()
web/                   # Next.js/TypeScript dashboard — talks to src/api.py via next.config.ts's
                       # /api/backend/* rewrite (so the browser stays same-origin and the httpOnly
                       # auth cookie reaches FastAPI without CORS-with-credentials). Includes the
                       # animated curriculum graph, the static figures (ported as React/SVG),
                       # the Scenario Builder, login/register, saved Scenarios + Run History,
                       # Settings (curriculum + instructor CRUD + baseline config editing), a
                       # Capacity Planning page (seat/instructor/admissions report), Plans (import/
                       # activate/export/delete alternate curriculum+config+instructor combos per
                       # user), and the Plan Builder wizard (create a new plan from scratch or by
                       # cloning the default, entering courses/config by hand before the first save).
```

`data/curriculum.json` and `data/simulation_config.json` are the one-time seed for `data/app.db`
(gitignored SQLite) — `src/db.py::get_or_create_default_plan()` auto-runs it on first API startup
(creating the shared default `Plan`), and `scripts/migrate_json_to_db.py --force` re-syncs that
default plan after hand-editing the JSON files. **After that first boot, the DB is authoritative,
per-plan**: every `src/api.py` endpoint resolves `(curriculum, config)` fresh per-request from the
requesting user's *active* `Plan` (`_load_plan_data` → `resolve_active_plan_id`) — there are no
cached module globals, so two users can have two different active plans at once with no shared
mutable state to race on. `PUT /curriculum/{code}`/`PUT /config` (Settings) write into the active
plan's rows; switching plans (`POST /plans/{id}/activate`) changes what subsequent requests see
immediately, no server restart needed. See [Multi-Plan Model](#multi-plan-model) below.
`src/service.py::run_simulation(curriculum, config, scenario, instructors=None) -> dict` runs one scenario in memory (no file I/O) and returns `result`/`metrics`/`cohort_metrics`/`admissions_recommendation`/`flow_timeline`; `run.py` calls it, then passes the result to `analytics.py`/`visualize.py`'s writers, which remain the only place that touches disk.

## Capacity Planning Model

- **`Instructor`** (`src/db_models.py`) is a synthetic/configurable, plan-scoped faculty roster — `{name, categories, max_sections_per_term}`. `categories` is a subset of `Course.category` (cs_core/cs_elective/college_req/math/science/english/gen_ed): an instructor qualified for a category is assumed able to teach any course in it (no per-course assignment — this is a staffing *feasibility check*, not a scheduler). `max_sections_per_term` uses the same "sections" unit as `course_sections`, so no credit-hour-equivalent conversion is needed. `data/instructors.json` seeds the default plan (~34 instructors), hand-tuned so `cs_core` shows a real shortfall (peak ~38 sections/term vs. ~31 capacity) the same way `simulation_config.json`'s `_sections_note` hand-tunes seat capacity.
- **`src/capacity.py`**: `build_instructor_capacity(result, instructors, curriculum)` walks `result.history.timeline`'s per-term `sections` counts (already computed by `Simulator._section_count`) to get peak/representative per-term section demand by category, compares against summed instructor capacity, and flags categories as `ok`/`tight`/`shortfall`. `course_staffing_risks` lists courses in an at-risk category, with `top_driver` marking the single largest contributor to that category's peak demand — not a per-course qualification signal, since the model only tracks qualification at the category level. `build_capacity_report(result, instructors, curriculum)` composes this with the existing `build_course_utilization` (seats) and `compute_admissions_recommendation` (admissions) into one report.
- This report lands at `flow_timeline.summary.capacity_planning` (`src/analytics.py::flow_timeline_payload`, threaded through `service.run_simulation` and `POST /simulate`) — it's per-run, not static, so a Scenario Builder run with different capacity/admissions overrides recomputes it too.
- `/instructors` (GET/POST/PUT `{id}`/DELETE `{id}`) CRUD mirrors `/curriculum`'s pattern, scoped to the active plan; `PlanImportRequest`/`GET /plans/{id}/export` carry an optional `instructors` list (defaults to `[]` for plans exported before this existed). Frontend: Settings' new `InstructorTable` (mirrors `CurriculumTable`) and the `/capacity` nav page (`CapacityPlanningPanel` + the reused `AdmissionsRecommendation` card).
- **Local dev note**: an existing `data/app.db` predating this feature needs `py scripts/migrate_json_to_db.py --force` to get the seeded instructor roster (the table is created automatically by `init_db()`, but seeding only happens on first plan creation or an explicit `--force` reseed).

## Term/Season Model

- The season cycle is config-driven (`src/models/semester.py`), defaulting to the legacy
  2-season Fall/Spring cycle (every season mandatory) when a config omits the new keys — every
  existing caller that doesn't pass `config` to `term_season`/`term_year`/`term_label` gets
  identical behavior to before this was generalized. `terms_per_year` (e.g.
  `["Fall", "Winter", "Spring", "Summer"]`) sets the cycle; `mandatory_terms` (e.g.
  `["Fall", "Spring"]`) marks which seasons advance a student's graduation clock. The QU default
  plan (`data/simulation_config.json`) now uses the 4-season cycle, with Winter/Summer as
  optional intersessions.
- **A course is only offered in an optional season if its own `offering` list says so** — same
  mechanism as Fall/Spring, no new concept. `admit_interval_terms` was bumped 2 → 4 in the QU
  default config to keep yearly, Fall-only admissions now that the cycle is 4 terms long instead
  of 2 (new cohorts are never admitted in an optional term — `SyntheticDataSource` only ever
  spaces entries by `admit_interval_terms`, and a non-mandatory-aligned interval would be a config
  mistake, not something the engine guards against).
- **`Student.personal_semester`** (`src/models/student.py`) is a stateful counter, incremented by
  `Simulator._run_term` once per *mandatory* term only (never during an optional term) for every
  non-terminal student. It replaces the old `term_idx - entry_term + 1` recomputation everywhere
  that mattered: the dropout-hazard early-cutoff check, the `max_terms`/`CENSORED`/`DELAYED`
  check, and `grad_semester`. This is *the* mechanism behind "Summer/Winter doesn't cost you a
  semester" — a student can take courses in an optional term (GPA/completed_ch/failed_attempts
  all update normally) without the clock ticking, and can still graduate immediately if an
  optional term happens to complete their last requirement.
- **`mandatory_horizon_end_term(entry_term, max_terms, config)`** replaces the old
  `entry_term + max_terms` formula for `Simulator.end_term` — that formula only gives the right
  calendar-term horizon when every season is mandatory; once optional seasons exist, it would
  truncate the simulation window before a student's real semester budget is exhausted. The same
  helper fixes the analogous bug in `src/analytics.py::_representative_cohort`'s "is this cohort
  finished" check. `_throughput_stability` reads the real calendar term of graduation from
  `OutcomeRecord.graduation_term` directly instead of reconstructing it from `entry_term +
  grad_semester`, since that reconstruction also drifts once `grad_semester` is mandatory-only.
- **Optional-term capacity is smaller/separate**: `Simulator._section_count`/`_effective_capacity`
  take an optional trailing `season` parameter (`None` = legacy/mandatory behavior, so the many
  existing callers that omit it are unaffected). On a non-mandatory season, sections come from
  `optional_term_course_sections` (mirrors `course_sections`), falling back to
  `floor(regular_section_count * optional_term_capacity_scale)` (default scale `0.3`) for a
  course offered optionally without an explicit entry.
- **The four block signals stay mandatory-term-accurate**: `capacity_block_counts`/`fail_counts`
  only ever fire on a real enrollment attempt, so they're untouched and *should* still fire
  during optional terms (e.g. "even the bonus session is oversubscribed" is a real signal).
  `offering_block_counts`/`prereq_block_counts` are different — they fire passively for every
  eligible-or-waiting student every term regardless of intent, so sweeping the *entire*
  curriculum during an optional term (where almost nothing is offered) would inflate both purely
  from adding extra calendar terms. `Simulator._record_blocks` is scoped accordingly: on a
  mandatory term it sweeps the whole curriculum (unchanged); on an optional term it sweeps only
  the courses actually offered that term, so `prereq_block` stays a precise, actionable signal
  ("this bonus-term course was open and you weren't eligible yet") instead of noise.
- **`src/capacity.py::build_instructor_capacity`** and **`scripts/size_sections.py`**'s demand
  calibration both filter to mandatory-season timeline frames before aggregating — optional-term
  frames carry much smaller, separately-modeled demand and would otherwise dilute the
  peak/percentile figures meant to size *regular*-term capacity/staffing. Optional-term staffing
  isn't modeled in the capacity-planning report yet.
- Not surfaced in `/meta` or the Settings/Scenario Builder UI yet — `terms_per_year`,
  `mandatory_terms`, `optional_term_course_sections`, and `optional_term_capacity_scale` are
  JSON-file-only knobs for now, alongside other config keys (`grade_tiers`, `ability_sd`) that
  aren't exposed there either.

## Multi-Cohort Model

- **Admissions**: `num_cohorts` study cohorts of `cohort_size` enter every `admit_interval_terms` (default: 4 cohorts, yearly). `num_incumbent_cohorts` prior cohorts enter at **negative** terms as a warm start, so gateway courses are already partly occupied when study cohort 0 arrives.
- **Global clock** runs `start_term = -num_incumbent_cohorts*admit_interval` .. `end_term`, where `end_term` is `mandatory_horizon_end_term(...)` (not a linear formula — see "Term/Season Model"). `term_season` handles negative indices (`-6 % 2 == 0` → Fall, under the legacy 2-season cycle; config-driven under any other cycle).
- **Personal time**: graduation/DELAYED/CENSORED use the stateful `Student.personal_semester` counter (mandatory terms only — see "Term/Season Model"), not a recomputed `global_term - entry_term + 1`. A student gets exactly `max_terms` *mandatory* semesters from their own entry.
- **Cohort ids**: study cohorts `0..n-1`; incumbents `-1,-2,-3`. Globally-unique `student_id = (cohort_id + num_incumbent_cohorts)*cohort_size + i`; RNG seed `seed + student_id` (CRN preserved).
- **Sections model**: per-term seats for a course = `course_sections[code] × seats_per_section` (config) on a mandatory term. `course_sections` is auto-calibrated to peak demand by `scripts/size_sections.py` (writes the map into the config) and then hand-tunable — add a section to a course to relieve it. This replaces the old global `capacity_scale` multiplier with realistic, course-specific, adjustable section counts. A course missing from the map falls back to `ceil(curriculum capacity / seats_per_section)`. On an optional term, a separate, smaller model applies instead — see "Term/Season Model".
- **Headline metrics are scoped to study cohorts** (`entry_term >= 0`); incumbents are a warm-start device and appear only in the per-cohort ledger.

## Multi-Plan Model

- A **Plan** (`src/db_models.py::Plan`) is a distinct `(curriculum, config, instructors)` triple, stored as its own rows in `Course`/`Instructor`/`AppConfig` (`Course.code`/`Instructor.name` are unique per-plan, not globally — multiple plans can each define their own "CMPS151" or "Dr. Smith"). One shared **default plan** (`owner_user_id is None`) is seeded from the JSON files for everyone; any other plan is private to the user who imported it.
- `User.active_plan_id` selects which plan that user's `/meta`, `/simulate`, `/curriculum`, `/config` calls resolve against (`src/db.py::resolve_active_plan_id` falls back to the default plan if the active one was deleted). This makes plan selection per-user, not a single global mutable baseline.
- `POST /plans/import` validates an uploaded `{name, curriculum, config}` payload — rejects an empty curriculum, a prerequisite cycle (`check_no_cycle`), or a config missing `cohort_size`/`scenarios` — as `PlanImportError` → HTTP 422, with nothing committed on failure. `POST /plans/{id}/activate` switches the caller's active plan; `GET /plans/{id}/export` round-trips back to the same `{curriculum, config}` shape; `DELETE /plans/{id}` (owner only, not the default) reassigns the caller to the default plan if it was active.
- **Curriculum CRUD on the active plan**: `POST /curriculum` adds a course (409 on a duplicate code within the plan, 422 on a prerequisite cycle); `DELETE /curriculum/{code}` removes one (404 if absent, 422 if another course's `prerequisites`/`rule_expr` still references it — checked via `src/rules.py::gate_edges`). `PUT /curriculum/{code}` (pre-existing) edits one course's fields in place. All three operate on whichever plan `resolve_active_plan_id` resolves to.
- Frontend: `web/src/app/(dashboard)/plans/page.tsx` — list, import (two JSON file uploads + name), activate, export, delete, and a **+ New plan** link into the Plan Builder. Settings' `CurriculumTable` now supports add/delete (not just per-course edits) via the shared `web/src/components/CourseFormFields.tsx`.
- **Plan Builder** (`web/src/app/(dashboard)/plan-builder/page.tsx`, `web/src/components/plan-builder/`): a 4-step wizard (name & seed → courses → config → review/save) for building a plan entirely client-side before the one and only network write (`POST /plans/import`, optionally followed by activate). "Seed" clones the default plan's `{curriculum, config}` via `GET /plans/{id}/export`, or starts blank (`web/src/lib/planBuilder.ts::BLANK_CONFIG`); the config step reuses the Scenario Builder's `AdmissionsTab`/`PassRatesDropoutTab`/`RegistrationPolicyTab` over a `BuilderState` built from the cloned/blank config (`metaFromPlanExport`).
- Distinct from the Scenario Builder (ephemeral per-run overrides on top of whatever plan is active) and Settings (in-place edits to the *active* plan's curriculum/config, persisted immediately per edit).

## Per-Term Loop (three phases)

1. **Desired enrollment** — each active student (all cohorts) builds a priority-ordered list: retakes first, then `enrollment_priority_tiers` (config-defined category sets, each with an optional `min_ch` gate; QU CS default: cs_core/college_req > cs_elective at 60+ CH > math/science/english/gen_ed) subject to their load cap.
2. **Seat allocation** — sort requesters by `(registration_tier(completed_ch, config), tiebreak_token)`; grant first `effective_capacity`; record `capacity_block` for the rest. Seniors from older cohorts outrank freshmen automatically. The CH bands themselves are config data (`registration_tier_thresholds` in `simulation_config.json`), not hardcoded — a different institution's priority-registration policy is a config edit, not a code change.
3. **Take courses** — resolve pass/fail via student RNG, sample grade tier, update GPA/probation/status.

Each term also records: per-cohort-per-course block counters (all four signals), per-course stats (capacity/registered/granted/denied/pass/fail/waiting/full), per-cohort stage node counts + flows, a cohort ledger row, and a timeline frame.

## Four Block Signals (never merged)

| Signal | Meaning |
|---|---|
| `fail_counts` | Student attempted and failed |
| `capacity_block_counts` | Requested seat but lost allocation |
| `offering_block_counts` | Eligible but course not taught this term |
| `prereq_block_counts` | Prerequisites not yet satisfied |

Each also has a `*_by_cohort` variant (`cohort_id -> {course -> count}`) powering per-cohort "where did they get stuck" post-mortems.

## Scenarios (in simulation_config.json)

| Name | Change |
|---|---|
| baseline | Default (assumed) pass rates and capacity |

`capacity_multiplier`, `capacity_overrides`, `offering_overrides`, and `pass_rate_overrides` per-scenario hooks exist in the engine for what-if experiments. `run.py` simulates every scenario in this list and reports each in `simulation_summary.csv` + a `bottlenecks_<scenario>.png`; with a single scenario, `outputs/reports/flow_timeline.json` (what the dashboard animates) comes from it directly. The scenario's name is recorded at `flow_timeline.json`'s `meta.scenario` so the dashboard can pick the matching `bottlenecks_<scenario>.png`.

## Key Constraints

- **Spring-only:** CMPS323, CMPS405, CMPS351. **Fall-only:** CMPS310, CMPS380, CMPE355. All other courses (incl. CMPS493, CMPS499) are offered Fall + Spring.
- CMPS303 is the gateway course: it is the prerequisite for CMPS323, CMPS380, CMPS405 (unlocks exactly these three)
- CMPS493 compound rule: requires CMPS310 + (CMPS350 OR CMPS405) + completed_ch ≥ 84
- D or better satisfies any prerequisite
- GPA = Σ(grade_points × credits) / Σ(all_attempted_credits) — F = 0.0 pts included in denominator
- CRN: each student RNG is `random.Random(seed + student_id)`, deterministic across runs.

## Outputs

```
outputs/
├── figures/    university_enrollment.png, cohort_flow.png, utilization_heatmap.png,
│               graduation_histogram.png, bottlenecks_<scenario>.png, curriculum_network.png
└── reports/    simulation_summary.csv, cohort_flow.csv, cohort_summary.csv,
                course_utilization.csv, monte_carlo.csv, flow_timeline.json
```

`flow_timeline.json` is the frontend contract: `meta` (scenario name, stage nodes, cohorts, prerequisite `graph`), `frames` (one per semester: per-course stats + per-cohort stage nodes/flows), and `summary` (headline metrics + CIs, per-cohort metrics + bottlenecks, admissions recommendation).
