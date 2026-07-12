# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Purpose

A discrete-term, agent-based simulation of students progressing through Qatar University's Computer Science curriculum over up to 12 semesters each. Research question: **which prerequisite chains and scheduling constraints contribute most to student delay and non-completion?**

It now models a **multi-cohort, steady-state university**: a new cohort is admitted each year, the university starts **partly full of a pre-existing student body defined by an admin-entered initial state** (see [Initial-State Model](#initial-state-model)) rather than by simulated incumbent cohorts, and **all cohorts compete for one shared pool of course seats**. The engine emits a frontend-ready per-semester data file that the included Next.js dashboard (`web/`) animates.

Full design document: [docs/technical_design.md](docs/technical_design.md)
Assumptions log: [docs/assumptions.md](docs/assumptions.md)
API reference: [docs/api.md](docs/api.md)
Database schema: [docs/database.md](docs/database.md)

## Commands

```bash
# Run the full simulation (writes outputs/ only)
py run.py

# Re-calibrate each course's capacity to peak demand (writes into curriculum.json)
py scripts/size_capacity.py

# One-time seed of data/app.db from the JSON files (auto-runs on first API startup too;
# rerun with --force after hand-editing curriculum.json/simulation_config.json to resync)
py scripts/migrate_json_to_db.py [--force]

# Run the HTTP API (no auth/env-secret required — every request resolves to a single
# shared auto-provisioned demo user, see src/auth.py)
py -m uvicorn src.api:app --reload --port 8001

# Run the Next.js dashboard (talks to the API above via next.config.ts's rewrite, see
# web/README.md). Must open http://localhost:3000, not 127.0.0.1:3000 — Next.js 16 dev
# mode blocks cross-origin dev requests from origins not in `allowedDevOrigins`.
cd web && npm install && npm run dev   # then open http://localhost:3000

# Run tests
py -m pytest tests/ -v

# Install dependencies
py -m pip install -r requirements.txt
```

## Architecture

```
src/
├── models/
│   ├── course.py       # Course dataclass + load_curriculum() (incl. study_plan_term = the
│   │                   # recommended semester column 1..N for the semester-grid flow chart)
│   ├── student.py      # Student (state, GPA, enrollment, cohort_id/entry_term, curriculum_stage())
│   └── semester.py     # term_season(), term_year(), term_label()
├── datasource.py        # DataSource seam: CohortSpec + SyntheticDataSource (population creation, decoupled from the engine)
├── rules.py             # evaluate_rule() / gate_edges() — generic compound prerequisite/eligibility expressions
├── simulator.py         # Simulator (staggered admission + 3-phase per-term loop) + History + SimulationResult
├── analytics.py         # metrics, per-cohort metrics, admissions recommendation, curriculum graph, flow_timeline JSON, CSV writers
├── service.py            # run_simulation() — engine-as-a-service boundary, no file I/O (the seam an API layer calls)
├── db.py                 # SQLAlchemy engine/session, plan-scoped DB<->engine-shape loaders,
│                         # get_or_create_default_plan(), import_plan(), resolve_active_plan_id()
├── db_models.py          # User/Plan/Course/AppConfig/Scenario/Run ORM tables
│                         # (Course/AppConfig are per-Plan; User.active_plan_id
│                         # picks which Plan drives that user)
├── auth.py               # Auth removed — get_current_user gets-or-creates a single shared
│                         # demo user on every call (no token/cookie check); kept only so
│                         # every endpoint's Depends() signature is unchanged
├── scenarios.py          # Persistent /scenarios + /runs endpoints, scoped to the demo user
├── curriculum_validation.py  # check_no_cycle() — networkx prerequisite-cycle check for Settings
│                         # edits and Plan imports; PlanImportError for malformed/cyclic imports
├── livesim.py             # LiveRunner — deterministic replay engine for stepwise Live Simulation
├── optimizer.py           # solve_for_targets() — Auto-fill solver: bounded greedy search for the
│                         # smallest capacity additions meeting admission_targets at current intake
├── api.py                # FastAPI wrapper: /health, /meta, /simulate, /autofill, /scenarios, /runs,
│                         # /curriculum (GET/POST/PUT/DELETE), /config, /plans, /livesim — no
│                         # login required (see auth.py); see docs/api.md for the full reference
├── montecarlo.py         # run_monte_carlo() — mean ± 95% CI over many seeds
├── visualize.py          # save_all_figures() + per-figure functions
└── utils.py              # load_json(), grade_tier()
web/                   # Next.js/TypeScript dashboard — talks to src/api.py via next.config.ts's
                       # /api/backend/* rewrite (so the browser stays same-origin; no auth cookie
                       # involved since auth was removed). Includes the animated curriculum graph,
                       # the static figures (ported as React/SVG), saved Scenarios + Run History,
                       # Settings (curriculum CRUD + baseline config editing), Plans (import/
                       # activate/export/delete alternate curriculum+config combos), the Plan
                       # Builder wizard (create a new plan from scratch or by cloning the default),
                       # and the Live Simulation page (stepwise, term-by-term runs).
```

**Dashboard start gate + roadmap layout** (`web/src/lib/SimulationContext.tsx`,
`web/src/components/CurriculumGraph.tsx`, `web/src/lib/graphLayout.ts`): on load the dashboard
fetches only the program structure (`GET /meta`). If `initial_state` is still completely empty
(and the `initial-state-setup-done` localStorage flag isn't set), it first shows the required
[`InitialStateGate`](#initial-state-model) setup screen. Once that's past (dismissed, or on any
later load where the values are non-empty) the baseline **auto-runs** — there is no manual
"Start" button. `SimulationProvider`'s effect fires `start()` exactly once (a `useRef` guard
turns a *failed* run into a retry surface instead of a loop, `StartingScreen` shows a
"Running the baseline simulation…" state meanwhile). Re-running the baseline after an edit
(`refreshBaseline`, called from Settings/Plans/initial-state writes) sets a `refreshing` flag
that renders a fixed "Updating simulation…" pill. The roadmap is a Qatar-University-style
program-roadmap layout — `computeSemesterLayout` places each course in its `study_plan_term`
column (term 1 = Year 1 Fall, 2 = Year 1 Spring, …), grouped under Year 1–4 bands with
Fall/Spring + credit-hour headers, boxes coloured by requirement type (`CATEGORY_STYLE`), red
prerequisite arrows, and live seat stats overlaid once started. `data/curriculum.json`'s
`study_plan_term` values mirror the official QU CS plan (Programming Concepts + History in
Year 1, CS-core in plan order, electives in Years 3–4). If a plan has no assigned terms the
layout falls back to a balanced, prerequisite-respecting schedule so it never collapses into one
column.

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
`src/service.py::run_simulation(curriculum, config, scenario, data_source=None) -> dict` runs one scenario in memory (no file I/O) and returns `result`/`metrics`/`cohort_metrics`/`admissions_recommendation`/`flow_timeline`; `run.py` calls it, then passes the result to `analytics.py`/`visualize.py`'s writers, which remain the only place that touches disk.

## Term/Season Model

- The season cycle is config-driven (`src/models/semester.py`), defaulting to the legacy
  2-season Fall/Spring cycle (every season mandatory) when a config omits the new keys — every
  existing caller that doesn't pass `config` to `term_season`/`term_year`/`term_label` gets
  identical behavior to before this was generalized. `terms_per_year` (e.g.
  `["Fall", "Winter", "Spring", "Summer"]`) sets the cycle; `mandatory_terms` (e.g.
  `["Fall", "Spring"]`) marks which seasons advance a student's graduation clock.
- **`optional_terms_enabled` (default `false`) is the admin on/off switch** for the 4-season
  cycle, independent of whether `terms_per_year`/`mandatory_terms`/`optional_term_capacity_scale`
  are present in the config — they can sit there inert the whole time. The QU default plan
  (`data/simulation_config.json`) ships with all of that 4-season data already filled in *and*
  `optional_terms_enabled: false`, so Winter/Summer stay off (legacy 2-season behavior) until an
  admin flips it on via Settings → `PUT /config {"optional_terms_enabled": true}` (or `GET /meta`
  to read the current value) — no re-entry of the season data needed either way.
  `effective_admit_interval_terms(config)` (used by `SyntheticDataSource` instead of reading
  `admit_interval_terms` directly) auto-rescales the admission cadence so Fall-only yearly
  admission survives the toggle in both directions: if the stored value matches the *full*
  `terms_per_year` length (the "one full year" convention), turning optional terms off rescales it
  to one year under the now-2-season cycle instead of silently admitting every other year; any
  other stored value (a deliberately non-yearly cadence) is left untouched. A config dict that
  never sets `optional_terms_enabled` at all (e.g. hand-built test fixtures) defaults to the old,
  pre-flag behavior — presence of `terms_per_year` alone enables the 4-season cycle, unaffected by
  this flag's existence.
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
- **Optional-term capacity is smaller/separate**: `Simulator._effective_capacity` takes an
  optional trailing `season` parameter (`None` = legacy/mandatory behavior, so the many existing
  callers that omit it are unaffected). On a non-mandatory season, capacity is
  `floor(course.capacity * optional_term_capacity_scale)` (default scale `0.3`) — a single knob,
  no per-course optional-term override map.
- **The four block signals stay mandatory-term-accurate**: `capacity_block_counts`/`fail_counts`
  only ever fire on a real enrollment attempt, so the raw counters are untouched and *do* still
  fire during optional terms (e.g. "even the bonus session is oversubscribed" is a real signal,
  visible per-term in the timeline frames + utilization heatmap). **But the three *structural*
  bottleneck rankings (capacity, offering, prereq) are mandatory-terms-only**: `Simulator` keeps
  `capacity_block_counts_mandatory` / `offering_block_counts_mandatory` /
  `prereq_block_counts_mandatory` (+ `*_mandatory_by_cohort`), incremented only on mandatory-season
  events, and `analytics` ranks `top_capacity_blocks`/`top_offering_blocks`/`top_prereq_blocks`,
  `top_bottlenecks.{capacity,offering,prereq}`, and the per-cohort `top_*_block` off *those*. This is
  because an optional term's seats are a deliberately small bonus pool (`optional_term_capacity_scale`):
  a Summer denial/wait doesn't block graduation (the student takes the course in a regular term) and
  can't be relieved by raising the course's regular capacity/offering, so counting it would make the
  ranking (and the Bottlenecks cards, the Capacity-recommendations table, and the advisor's grounding,
  all of which read it) point at Summer service courses that are scarce *by design* instead of the
  regular-term gateways that actually delay students. In practice **offering** blocks can't occur in
  an optional term at all (a swept course is by definition offered), so its mandatory counter equals
  the raw one; **capacity** and **prereq** have real optional-term components that the mandatory
  counters strip. **`fail_counts` is deliberately NOT filtered** — a fail is a real fail whenever it
  happens. `GET /meta.mandatory_terms` exposes the regular seasons so the frontend
  (Capacity-recommendations, advisor `course_stats`) filters identically. Covered by
  `tests/test_optional_terms.py`.
  `offering_block_counts`/`prereq_block_counts` also fire passively for every
  eligible-or-waiting student every term regardless of intent, so sweeping the *entire*
  curriculum during an optional term (where almost nothing is offered) would inflate both purely
  from adding extra calendar terms. `Simulator._record_blocks` is scoped accordingly: on a
  mandatory term it sweeps the whole curriculum (unchanged); on an optional term it sweeps only
  the courses actually offered that term, so `prereq_block` stays a precise, actionable signal
  ("this bonus-term course was open and you weren't eligible yet") instead of noise.
- **`scripts/size_capacity.py`**'s demand calibration filters to mandatory-season timeline
  frames before aggregating — optional-term frames carry much smaller, separately-modeled
  demand and would otherwise dilute the peak/percentile figures meant to size *regular*-term
  capacity.
- Not surfaced in `/meta` or the Settings/Scenario Builder UI yet — `terms_per_year`,
  `mandatory_terms`, and `optional_term_capacity_scale` are JSON-file-only knobs for now,
  alongside other config keys (`grade_tiers`, `ability_sd`) that aren't exposed there either.

## Multi-Cohort Model

- **Admissions**: `num_cohorts` study cohorts of `cohort_size` enter every `admit_interval_terms` (default: **8 cohorts, one per year** — enough overlapping cohorts to reach a real steady state, since a ~6-year program with yearly admission has ~6 cohorts enrolled at once; fewer than that under-represents shared-pool competition). `num_incumbent_cohorts` prior cohorts enter at **negative** terms as a warm start, so gateway courses are already partly occupied when study cohort 0 arrives.
- **Global clock** runs `start_term = -num_incumbent_cohorts*admit_interval` .. `end_term`, where `end_term` is `mandatory_horizon_end_term(...)` (not a linear formula — see "Term/Season Model"). `term_season` handles negative indices (`-6 % 2 == 0` → Fall, under the legacy 2-season cycle; config-driven under any other cycle).
- **Personal time**: graduation/DELAYED/CENSORED use the stateful `Student.personal_semester` counter (mandatory terms only — see "Term/Season Model"), not a recomputed `global_term - entry_term + 1`. A student gets exactly `max_terms` *mandatory* semesters from their own entry.
- **Cohort ids**: study cohorts `0..n-1`. `num_incumbent_cohorts` still exists as an engine knob (defaults to **0** — incumbents `-1,-2,-3` at negative terms) but is no longer part of the default plan, which warm-starts via the [Initial-State Model](#initial-state-model) instead. The historical-transcript calibration stand-in (`analytics.compute_historical_transcripts`) is the one consumer that still opts incumbents back in. Globally-unique `student_id = (cohort_id + num_incumbent_cohorts)*cohort_size + i`; RNG seed `seed + student_id` (CRN preserved).
- **Capacity model**: per-term seats for a course = its own `capacity` field (`data/curriculum.json` / `Course.capacity`), **minus any `initial_state.occupancy[code]`** (see [Initial-State Model](#initial-state-model)). `scripts/size_capacity.py` auto-calibrates it (writes directly into `curriculum.json`), then hand-tunable per course in Settings. **Sizing policy: the whole required sequence (cs_core) and all non-CS courses are sized to *peak* demand; only interchangeable electives (cs_elective) are squeezed to the 75th demand percentile to keep a deliberate bottleneck.** This is *because* of the single-term offerings above: with several once-a-year upper courses, under-provisioning an early required gateway pushes students off the annual rhythm into a full-year wait that cascades into non-completion (CENSORED), so scarcity on the critical path is no longer "just delay." Electives are the only safe place to squeeze (4 interchangeable slots, no prerequisites). On an optional term, a separate, smaller model applies instead — see "Term/Season Model".
- **Headline metrics are scoped to study cohorts** (`entry_term >= 0`); incumbents (when enabled) are a warm-start device and appear only in the per-cohort ledger.

## Initial-State Model

- Replaces the old simulated-incumbent warm start: instead of admitting cohorts at negative terms, the admin enters an **initial state** describing the university the first simulated cohort walks into. It lives in `config["initial_state"]` (per-plan, in `AppConfig.data`) with two parts:
  - **`occupancy`** (`{course_code: seats}`) — seats in each course already taken by the existing, un-simulated student body. `src/simulator.py::_effective_capacity` subtracts this from a course's free seats on **every mandatory term** (steady-state background load, not just term 0; floored at 0). Optional (Summer/Winter) terms are left alone — their separate, much smaller capacity model shouldn't be zeroed out by it. A course whose seats are fully consumed reports `full` even with no requesters.
  - **`standing`** (`{Year2..YearN: count}`) — a head-count of pre-existing students at each year-standing above Year1, folded into the **aggregate** (`stages.totals`) stage nodes (and exposed per-frame as `frame["background"]`) so the flow chart starts non-empty. Display-only and constant every term; per-cohort node counts stay exactly the simulated population, and headline metrics are unaffected. The valid standing keys and the flow-chart stage nodes are **derived from `year_standing_thresholds`**, not hardcoded to a 4-year `Year1..Year4` — a K-threshold plan yields `Year1..Year(K+1)` bands (`src/models/student.py::stage_node_names`/`standing_levels`), so a program that isn't 4 years long works end-to-end (validation, engine, and the flow chart all scale). `frontend` derives the same via `meta.year_standing_thresholds`.
- Wired through `/meta` (read), `POST /simulate` (`ScenarioRequest.initial_state` override), and `PUT /config` (persist, validated by `src/api.py::_validate_initial_state`). `meta.flow_timeline.meta.initial_state` carries it to the dashboard.
- `num_incumbent_cohorts` and `initial_state` are independent and *can* coexist, but the default QU plan uses only `initial_state`.
- **Frontend editing surfaces** — two entry points share one editor, `web/src/components/scenario-builder/InitialStateEditor.tsx` (year-standing number-boxes + `InitialOccupancyTable.tsx`'s per-course occupancy table, sorted by `study_plan_term`), so there is one implementation, not two:
  - **Required first-run setup gate** (`web/src/components/InitialStateGate.tsx`, wired into `web/src/lib/SimulationContext.tsx`'s render waterfall, between the loading/error checks and the auto-run): whenever `meta.initial_state` is fully empty (no occupancy rows *and* every standing count zero) and a `localStorage` flag (`initial-state-setup-done`) isn't already `"1"`, the admin sees this screen before anything else — occupancy/standing must be reviewed (zero is an accepted answer) and "Continue" clicked (`PUT /config`, sets the flag) before the baseline auto-run becomes reachable at all. This makes entering today's real department state a mandatory first step, not an optional Settings tab an admin could skip past.
  - **`AdmissionsTab.tsx`** (Settings, Plan Builder's Config step) — the same editor, for revisiting the values any time after the gate.
  - **CSV import** (`InitialStateImportModal.tsx`, launched from a header button on either surface): paste or upload a two-column `code,value` CSV — `code` matches a course code (→ occupancy) or `Year2`/`Year3`/`Year4` (→ standing), case-insensitively; a header row is auto-detected; unknown codes or non-numeric values are skipped with a reason shown in a preview, never fatal to the rest of the batch. Lets a department head bulk-load real numbers instead of hand-typing ~41 rows.

## Multi-Plan Model

- A **Plan** (`src/db_models.py::Plan`) is a distinct `(curriculum, config)` pair, stored as its own rows in `Course`/`AppConfig` (`Course.code` is unique per-plan, not globally — multiple plans can each define their own "CMPS151"). One shared **default plan** (`owner_user_id is None`) is seeded from the JSON files for everyone; any other plan is private to the user who imported it.
- `User.active_plan_id` selects which plan that user's `/meta`, `/simulate`, `/curriculum`, `/config` calls resolve against (`src/db.py::resolve_active_plan_id` falls back to the default plan if the active one was deleted). This makes plan selection per-user, not a single global mutable baseline.
- `POST /plans/import` validates an uploaded `{name, curriculum, config}` payload — rejects an empty curriculum, a prerequisite cycle (`check_no_cycle`), or a config missing `cohort_size`/`scenarios` — as `PlanImportError` → HTTP 422, with nothing committed on failure. `POST /plans/{id}/activate` switches the caller's active plan; `GET /plans/{id}/export` round-trips back to the same `{curriculum, config}` shape; `DELETE /plans/{id}` (owner only, not the default) reassigns the caller to the default plan if it was active.
- **Curriculum CRUD on the active plan**: `POST /curriculum` adds a course (409 on a duplicate code within the plan, 422 on a prerequisite cycle); `DELETE /curriculum/{code}` removes one (404 if absent, 422 if another course's `prerequisites`/`rule_expr` still references it — checked via `src/rules.py::gate_edges`). `PUT /curriculum/{code}` (pre-existing) edits one course's fields in place. All three operate on whichever plan `resolve_active_plan_id` resolves to.
- Frontend: `web/src/app/(dashboard)/plans/page.tsx` — list, import (two JSON file uploads + name), activate, export, delete, and a **+ New plan** link into the Plan Builder. Settings' `CurriculumTable` now supports add/delete (not just per-course edits) via the shared `web/src/components/CourseFormFields.tsx`.
- **Plan Builder** (`web/src/app/(dashboard)/plan-builder/page.tsx`, `web/src/components/plan-builder/`): a 4-step wizard (name & seed → courses → config → review/save) for building a plan entirely client-side before the one and only network write (`POST /plans/import`, optionally followed by activate). "Seed" clones the default plan's `{curriculum, config}` via `GET /plans/{id}/export`, or starts blank (`web/src/lib/planBuilder.ts::BLANK_CONFIG`); the config step reuses the Scenario Builder's `AdmissionsTab`/`PassRatesDropoutTab`/`RegistrationPolicyTab` over a `BuilderState` built from the cloned/blank config (`metaFromPlanExport`).
- Distinct from the Scenario Builder (ephemeral per-run overrides on top of whatever plan is active) and Settings (in-place edits to the *active* plan's curriculum/config, persisted immediately per edit).

## Live Simulation Model (stepwise / "each term is a status")

- Alongside the instant `/simulate` (which runs the whole window at once), a **live simulation**
  runs **one term at a time**, persists each term as a reviewable snapshot, and is **advanced
  manually**. It models the admin-department workflow: review a term, adjust knobs, advance.
- **Persistence** (`src/db_models.py`): `LiveSimulation` (per `plan_id`, `created_by_user_id`,
  `name`, `current_term` [None until the first advance], `status` active|finished, frozen
  `base_config`/`base_scenario`, and an append-only `edits` list) + `LiveTermSnapshot` (one row
  per advanced term: the `flow_timeline` `frame`, a cheap running `summary`, and the
  `edits_applied` that took effect entering it). **Shared within a plan** — any user whose active
  plan == the live sim's `plan_id` can view/advance it.
- **Deterministic replay** (`src/livesim.py::LiveRunner`): no fragile engine-state
  serialization. Each `edits` entry is `{effective_from_term, patch}` where patch holds the
  editable knobs (`capacity_overrides`, `pass_rate_overrides`, `offering_overrides`,
  `cohort_size`). `capacity_overrides` is a per-course seat multiplier on top of the course's
  own `capacity` (`Simulator._effective_capacity`), sent diff-style — a course absent from it
  is untouched. Advancing to term N **replays from term 0**, folding each patch only
  from its `effective_from_term` onward, and takes the newly-reached term's frame. Because edits
  apply forward-only, earlier terms reproduce byte-identically, so previously-saved snapshots stay
  valid (the core correctness property, covered by `tests/test_livesim.py`). `cohort_size` edits
  use `_TimeVaryingCohortDataSource` so only cohorts admitted at/after the edit term resize.
- **Engine hook**: `Simulator.__init__` takes an optional `overlay_provider:
  Callable[[int], (config_patch, scenario_patch)]` (default `None`). On `None` the engine is
  byte-identical to before (all prior callers/tests unaffected); `LiveRunner` is the only real
  caller, applying the cumulative patch per term via `Simulator._apply_overlay`.
- **API** (`src/api.py`): `POST /livesim` (create, no term run yet), `GET /livesim` (list for the
  active plan), `GET /livesim/{id}` (`{live_sim, meta:{graph,stage_nodes,cohorts,initial_state},
  snapshots}`), `POST /livesim/{id}/advance` (`{edits?}` → simulate next term, returns
  `{live_sim, snapshot}`; 409 at the horizon), `DELETE /livesim/{id}` (creator only). `frame` is
  the same per-term shape `/simulate` emits, so the frontend renders snapshots with the existing
  components unchanged.
- **Frontend** (`web/src/app/live/`, `web/src/components/live/`): the **Live Simulation** page
  (its own route group *outside* `(dashboard)` so it isn't behind the dashboard's Start gate) —
  create/list sims, current-term status on the program roadmap (`CurriculumGraph`) + stage flow
  (`StageOverview`), an "Advance to next term" button, a collapsible edits panel for the four
  knobs (diff-only, like the Scenario Builder), a read-only history scrubber over saved terms, and
  a "Live" nav link. Reached via `web/src/lib/api.ts`'s `listLiveSims`/`createLiveSim`/
  `getLiveSim`/`advanceLiveSim`/`deleteLiveSim`.

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

**`prereq_block` is computed but no longer surfaced in the UI or the advisor** (product decision — a passive whole-curriculum sweep that's hard to act on). The engine still tracks it, `flow_timeline` still carries `prereq_waiting` / `top_bottlenecks.prereq` / per-cohort `top_prereq_block` (contract unchanged), and `SIGNAL_META.prereq` still exists — but it's dropped from the frontend `SIGNAL_ORDER` (so the Bottlenecks card + legend pill vanish), the Cohorts table, the Student-Trace chips, the animated narrative, and the advisor's grounding prompt. Re-add `"prereq"` to `web/src/lib/signalMeta.ts::SIGNAL_ORDER` (and the removed display bits) to bring it back.

## Scenarios (in simulation_config.json)

| Name | Change |
|---|---|
| baseline | Default (assumed) pass rates and capacity |

`capacity_multiplier`, `capacity_overrides`, `offering_overrides`, and `pass_rate_overrides` per-scenario hooks exist in the engine for what-if experiments. `run.py` simulates every scenario in this list and reports each in `simulation_summary.csv` + a `bottlenecks_<scenario>.png`; with a single scenario, `outputs/reports/flow_timeline.json` (what the dashboard animates) comes from it directly. The scenario's name is recorded at `flow_timeline.json`'s `meta.scenario` so the dashboard can pick the matching `bottlenecks_<scenario>.png`. With more than one scenario, `save_all_figures` also writes `scenario_comparison.png` (graduation/on-time rate + avg time-to-degree, one bar group per scenario, single-seed only).

> **Dashboard integration:** new scenarios added to `data/simulation_config.json` automatically
> appear in the web Scenario Builder — the UI reads them via `GET /meta` on each page load.
> No frontend changes are needed when adding scenarios; `py run.py` also picks them up in the
> same loop. The `capacity_overrides` and `offering_overrides` fields already in the engine
> (§11 in `docs/technical_design.md`) are the correct hooks for structural intervention scenarios.

## Advisor + Auto-fill

Two decision-support features layered on top of a completed run, both reading the same
`evaluate_health_criteria` slacks (vs `config['admission_targets']`) the admissions
recommendation already uses.

- **Advisor** (`web/src/components/AdvisorPanel.tsx`, on the Dashboard) — a **rules-based**
  (no-LLM, no-API-key) reading of the run's existing `flow_timeline.summary` (headline metrics,
  the four health criteria, top bottlenecks) into a prioritized list of plain-language
  recommendations. Pure frontend: it computes from data already in the `/simulate` payload, no
  extra request. This is **Phase A of the hybrid advisor**.
- **Advisor chat (Phase B)** (`src/advisor.py`, `POST /advisor/chat`,
  `web/src/components/AdvisorChat.tsx` on the `/advisor` page) — an **optional LLM chat box**
  grounded in the run's numbers. **Provider-agnostic**: it POSTs to any OpenAI-compatible
  `/chat/completions` endpoint selected purely by env vars (`LLM_API_KEY`, `LLM_BASE_URL`
  [default Groq `https://api.groq.com/openai/v1`], `LLM_MODEL` [default
  `llama-3.3-70b-versatile`]) — so Groq/Gemini/OpenRouter/Claude are a config swap, not a code
  change. **Grounding has two sources merged per call**: the frontend sends a facts blob from the
  `/simulate` summary (headline/criteria/bottlenecks) **plus per-course run aggregates**
  (`course_stats`: peak seat-denials, terms-full, pass/fail totals, from the frames it already
  holds); and the **`/advisor/chat` endpoint injects `plan`** — the active plan's *full curriculum
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
  engine hooks it used are exactly what Test drives.
  **Graceful degradation**: with no `LLM_API_KEY`, `chat_enabled()` is
  `False`, `/meta.llm_chat_enabled` reports it, and the chat box shows a "how to enable" note —
  Phase A is untouched and needs no key. Covered by `tests/test_advisor.py` (enabled path mocks
  `httpx.post`, so no network; proposal extraction/validation covered offline). Uses `httpx`
  (already a dep) — no new package, no `claude-api` skill needed since it's not Anthropic-specific.
- **Auto-fill** (`src/optimizer.py::solve_for_targets`, `POST /autofill`, panel
  `web/src/components/AutofillPanel.tsx` on the Bottlenecks page) — a bounded **greedy** solver:
  each iteration runs one simulation, finds the course with the worst single-(mandatory-)term
  seat shortfall, and bumps its capacity by that shortfall (the same "peak shortfall" heuristic
  `CapacityRecommendations` shows), until the **seat-denial** target is met or `run_budget`
  (default 20, clamped ≤ 40) is exhausted. It only drives `seats_denied_per_stud` — the one
  target capacity actually fixes — and reports grad-rate/time-to-degree/throughput-stability
  breaches as **non-capacity** (with an intake-reduction fallback probe), so it never overstates
  the seats needed. Objective is fixed as *"fewest capacity additions at the current intake"*
  (intake is a fallback lever only). Read-only endpoint; the panel **applies** the result via the
  existing `PUT /curriculum/{code}` + `PUT /config` + `refreshBaseline()` path. Single-seed per
  candidate (deterministic) — Monte-Carlo-verify the final pick before committing. Covered by
  `tests/test_optimizer.py`.

## Per-Student Trace Model ("watch one synthetic student")

- Turns the population aggregates into an individual view: pick a student by profile and see
  their **term-by-term** path — courses attempted (pass/fail), where they were blocked and why,
  GPA/probation/status trajectory, and final outcome. The per-student data mostly *already
  existed*: `History.transcript` is a full per-student-per-term course log and
  `History.outcomes` is one terminal record each. The one real gap was the four block signals,
  which the aggregate counters (`capacity_block_counts` etc.) discard per-student at increment
  time.
- **Engine capture is opt-in and default-off.** `Simulator(record_traces=False)` (every existing
  caller + the hot `/simulate` baseline) is byte-identical and pays nothing. When `True` (the
  trace endpoints only), the engine also records `History.block_events` (`BlockEvent{student_id,
  term, course_code, signal}` for capacity/offering/prereq — `fail` is derivable from a
  transcript row with `grade == "F"`) and `History.student_term_states`
  (`StudentTermState{student_id, term, personal_semester, gpa, completed_ch, on_probation,
  status}`, snapshotted from the pre-outcome `active` list so a terminal-transition term shows
  its post-transition status). Both live in `src/datasource.py`, stay **out of the
  `flow_timeline.json` contract** (exactly like `transcript`/`outcomes`), and only feed the
  trace.
- **Extraction** (`src/analytics.py`): `find_students_matching(result, *, cohort_id,
  final_status, ever_probation, limit)` → cheap candidate summaries (study cohorts only, most-
  delayed/most-failed first, no block recording needed); `compute_student_trace(result,
  curriculum, student_id)` → the full journey dict (or `None`). Prereq blocks sweep the whole
  remaining curriculum every term, so the **frontend** collapses them into a count and shows
  capacity/offering blocks (the actionable "eligible but stuck" signals) as chips.
- **API** (`src/api.py`, no persistence — deterministic re-run from the same overrides
  `/simulate` takes, default `{}` = dashboard baseline): `POST /simulate/students/search`
  (`ScenarioRequest` + profile filters → candidates) and `POST /simulate/students/{id}/trace`
  (`ScenarioRequest` → one student's trace; runs with `record_traces=True`; 404 if absent).
  Neither writes a `Run` row. See `docs/api.md`.
- **Frontend**: `web/src/components/StudentTracePanel.tsx` (profile picker → candidate cards →
  term-by-term timeline with grade chips, block chips, a status pill per term, and an inline SVG
  GPA sparkline) on the **`/students`** dashboard page (`Analytics → Student Trace` in the nav).
  Covered by `tests/test_student_trace.py` + trace cases in `tests/test_api.py`.

## Key Constraints

- **Curriculum = the official Qatar University CS Program Roadmap 2024** (41 courses, 120 CH):
  real course codes/titles/credits (CMPS151, MATH101, CHEM101/103, PHYS191–194, ENGL202/203,
  HIS121, ARAB100, DAWA111, GENG200/300, CMPS307, MAGT101, the Core-Curriculum "Package"
  courses, and Major Electives CSEL1–4), each placed in its real semester via `study_plan_term`
  (Year 1 Fall … Year 4 Spring), categories mapped to the roadmap's requirement-type colours
  (cs_core=Major Core, cs_elective=Major Elective, math=College Requirement, science=Major
  Supporting, english/gen_ed=Core Curriculum). See [Initial-State Model] / the dashboard
  roadmap note above.
- **Offerings mirror QU's real schedule, not a blanket Fall+Spring.** Most courses run
  Fall+Spring, but **8 core courses are single-term**: Fall-only {CMPS200, CMPS310, CMPE355,
  CMPS380} and Spring-only {CMPE263, CMPS323, CMPS351, CMPS405}. The 22 non-CS **service courses
  (math/science/english/gen_ed) additionally run in Summer** (an optional term — see "Term/Season
  Model"), matching how QU offers high-demand service courses year-round; CS courses are **never**
  offered in Summer. This single-term realism interacts with capacity: because a missed seat in an
  *early* gateway pushes a student off the annual rhythm and into a once-a-year upper course
  off-cycle (a full year lost), the required cs_core sequence is sized to **peak** demand rather
  than squeezed (see "Capacity model" below and `scripts/size_capacity.py`).
- CMPS303 (Data Structures) is the central gateway: prerequisite for CMPS323, CMPS380, CMPS405.
- CMPS493 (Senior Project I) compound rule: requires CMPS310 + (CMPS350 OR CMPS405) +
  completed_ch ≥ 84 — exactly the roadmap's stated Senior-Project entry requirement.
- D or better satisfies any prerequisite
- GPA = Σ(grade_points × credits) / Σ(all_attempted_credits) — F = 0.0 pts included in denominator
- CRN: each student RNG is `random.Random(seed + student_id)`, deterministic across runs.

## Outputs

```
outputs/
├── figures/    university_enrollment.png, cohort_flow.png, utilization_heatmap.png,
│               graduation_histogram.png, bottlenecks_<scenario>.png, curriculum_network.png,
│               survival_curve.png, cohort_bottleneck_comparison.png, scenario_comparison.png
└── reports/    simulation_summary.csv, cohort_flow.csv, cohort_summary.csv,
                course_utilization.csv, monte_carlo.csv, flow_timeline.json
```

`flow_timeline.json` is the frontend contract: `meta` (scenario name, stage nodes, cohorts, prerequisite `graph`), `frames` (one per semester: per-course stats + per-cohort stage nodes/flows), and `summary` (headline metrics + CIs, per-cohort metrics + bottlenecks, admissions recommendation).
