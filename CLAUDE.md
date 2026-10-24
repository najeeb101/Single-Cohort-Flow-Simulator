# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Purpose

The **CS Intake Planner**: a decision tool Qatar University's CS department runs locally on a department PC to answer **"how many students should we admit in the next CS intake, and what course seats does that number need?"** Computer Engineering may come later as a second program (a separate Plan on the same engine).

Under it is a discrete-term, agent-based simulation of students progressing through the CS curriculum over up to 12 semesters each, modeled as a **multi-cohort, steady-state university**: a new cohort is admitted each year, **today's student body is rebuilt from the department's real past intakes** (`config["current_students"]["past_intakes"]`, padded with estimated older years, see [Initial-State Model](#initial-state-model)), seats used by other programs are a permanent background load, and **all cohorts compete for one shared pool of course seats**. The decision layer (`src/intake.py`, see [Intake Planner](#intake-planner--advisor)) sweeps candidate intakes against that engine and returns a recommended intake with uncertainty. Real QU data is only partly available, so every input is tagged QU data vs estimate and results built on estimates are marked "illustrative". Sections and seats change every semester, so analyses store a snapshot of their inputs and the site says to re-run when the schedule changes.

Method for the committee: [docs/methodology.md](docs/methodology.md). Staff guide: [docs/user_guide.md](docs/user_guide.md).

Full design document: [docs/technical_design.md](docs/technical_design.md)
Assumptions log: [docs/assumptions.md](docs/assumptions.md)
API reference: [docs/api.md](docs/api.md)
Database schema: [docs/database.md](docs/database.md)

## Commands

```bash
# One-click start on the department PC: launches backend + website, opens http://localhost:3000
start.bat

# Run the full simulation (writes outputs/ only)
py run.py
# ...plus the intake analysis (about a minute or two on a multi-core PC); prints the
# recommendation and writes outputs/reports/intake_analysis.json
py run.py --intake

# Re-calibrate each course's capacity to peak demand (writes into curriculum.json)
py scripts/size_capacity.py

# One-time seed of data/app.db from the JSON files (auto-runs on first API startup too;
# rerun with --force after hand-editing curriculum.json/simulation_config.json to resync)
py scripts/migrate_json_to_db.py [--force]

# Run the HTTP API (no auth/env-secret required — every request resolves to a single
# shared auto-provisioned demo user, see src/auth.py)
py -m uvicorn src.api:app --reload --port 8001

# Run the Next.js website (talks to the API above via next.config.ts's rewrite, see
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
├── intake.py             # THE DECISION LAYER: run_intake_sweep() (two views, spaced seeds, pooled
│                         # unlimited-seat reference, isotonic smoothing, one-sided 95% bounds,
│                         # decision rule), run_seat_plan(), calibration_check(). Engine imports only.
├── jobs.py               # background runner for analyses: one at a time, daemon thread + own DB
│                         # session, throttled progress, cancel, inline mode for tests
├── analytics.py         # metrics, per-cohort metrics, curriculum graph, flow_timeline JSON, CSV writers
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
├── curriculum_validation.py  # check_no_cycle() — networkx prerequisite-cycle check, now only
│                         # reachable from course *creation* (Plan Builder / POST /curriculum),
│                         # never a PUT edit — see "Prerequisite Lock" below
├── plan_validation.py    # validate_plan_edits() etc. — single entry point for cross-object
│                         # guardrails (cohort_size positivity, capacity-vs-occupancy, admission
│                         # season/size shape) called by every write/simulate path; also
│                         # validate_prerequisites_locked() for the write-once prereq guard
├── api.py                # FastAPI wrapper: /health, /meta, /simulate, /intake-analyses, /scenarios, /runs,
│                         # /curriculum (GET/POST/PUT/DELETE), /config, /plans — no
│                         # login required (see auth.py); see docs/api.md for the full reference
├── montecarlo.py         # run_monte_carlo() — mean ± 95% CI over spaced seeds (parallel across
│                         # seeds via src/parallel.py; results collected in seed order so they're
│                         # byte-identical to a serial run)
├── parallel.py           # ordered_map() — process-pool helper for the embarrassingly-parallel
│                         # workloads (MC seeds); make_pool()/iter_ordered() drive intake analyses (one pool
│                         # per job, no silent serial fallback). See "Parallel Workloads"
├── visualize.py          # save_all_figures() + per-figure functions
└── utils.py              # load_json(), grade_tier()
web/                   # Next.js/TypeScript website — talks to src/api.py via next.config.ts's
                       # /api/backend/* rewrite (same-origin; no auth). Nav: Intake Planner (/, the
                       # home page: run analysis, recommendation card, chart, per-N table, seat
                       # planner, calibration, past analyses) · Bottlenecks · Walkthrough
                       # (/walkthrough, the Semester Checkpoint Mode) · Advisor · Data (the former
                       # Settings: courses & seats, pass rates, current students, other-program
                       # seats, policy & analysis, advanced) · Programs (Plans, Plan Builder) ·
                       # Methodology (/about). Figures, Scenarios and Run History pages were removed.
```

**Start gate + roadmap layout (Walkthrough and baseline)** (`web/src/lib/SimulationContext.tsx`,
`web/src/components/CurriculumGraph.tsx`, `web/src/lib/graphLayout.ts`): on load the dashboard
fetches only the program structure (`GET /meta`). If the planner inputs still need setting up
(past intakes empty or tagged estimate) and the `initial-state-setup-done` localStorage flag isn't
set, it first shows the [`InitialStateGate`](#initial-state-model) setup screen. Once that's past
the baseline **auto-runs** — there is no manual
"Start" button. `SimulationProvider`'s effect fires `start()` exactly once (a `useRef` guard
turns a *failed* run into a retry surface instead of a loop, `StartingScreen` shows a
"Loading the department's data…" state meanwhile). Re-running the baseline after an edit
(`refreshBaseline`, called from Data/Plans/seat-plan Apply/policy writes) sets a `refreshing` flag
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
`src/service.py::run_simulation(curriculum, config, scenario, data_source=None) -> dict` runs one scenario in memory (no file I/O) and returns `result`/`metrics`/`cohort_metrics`/`flow_timeline`; `run.py` calls it, then passes the result to `analytics.py`/`visualize.py`'s writers, which remain the only place that touches disk.

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
  Admission cadence survives the toggle automatically because it's driven by *which seasons
  admit* (`admission_terms`, see "Multi-Cohort Model"), not a term-count interval:
  `admission_seasons(config)` walks the calendar and admits only on the chosen (mandatory)
  seasons, so Fall-only stays exactly one year apart whether the cycle is 2, 3, or 4 terms long,
  in either toggle direction. A config dict that never sets `optional_terms_enabled` at all (e.g.
  hand-built test fixtures) defaults to the old, pre-flag behavior — presence of `terms_per_year`
  alone enables the multi-season cycle, unaffected by this flag's existence.
- **A course is only offered in an optional season if its own `offering` list says so** — same
  mechanism as Fall/Spring, no new concept. A new cohort is never admitted in an optional term:
  `admission_seasons` filters out any non-mandatory season, so even a stray `admission_terms`
  entry naming Summer/Winter is dropped (and rejected at the API with a 422). Admission seasons
  are the single source of cadence — there is no `admit_interval_terms` knob anymore.
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
- Not surfaced in `/meta` or the Data page yet — `terms_per_year`,
  `mandatory_terms`, and `optional_term_capacity_scale` are JSON-file-only knobs for now,
  alongside other config keys (`grade_tiers`, `ability_sd`) that aren't exposed there either.

## Multi-Cohort Model

- **Admissions**: `num_cohorts` study cohorts enter in the seasons named by **`admission_terms`** (default `["Fall"]` — one cohort per year, in Fall; **8 cohorts** by default, enough overlapping cohorts to reach a real steady state, since a ~6-year program with yearly admission has ~6 cohorts enrolled at once). Adding `"Spring"` (`admission_terms: ["Fall", "Spring"]`) gives a **second yearly intake**; `admission_sizes` (`{season: size}`) sets a per-season intake size so a department can run, e.g., a smaller Spring cohort — a season absent from it uses `cohort_size`. **Only mandatory seasons may admit** (`admission_seasons` filters out Summer/Winter; the API returns 422 on one). `SyntheticDataSource` builds the schedule by walking the calendar forward from term 0 (study) and backward from term −1 (incumbents), so entry terms fall on real Fall/Spring slots and never on an optional term. Cohort-id bases are a cumulative sum of sizes (contiguous, unique) — **byte-identical to the old `(cohort_id+num_incumbents)*cohort_size` scheme for equal-size Fall-only admission**, so determinism/CRN is preserved. `num_incumbent_cohorts` prior cohorts warm-start at **negative** terms (default 0 in the QU plan, which warm-starts via [Initial-State Model] instead).
- **Global clock** runs `start_term` (earliest admission) .. `end_term`, both read straight off `SyntheticDataSource.cohort_specs()`, where `end_term` is `mandatory_horizon_end_term(...)` (not a linear formula — see "Term/Season Model"). `term_season` handles negative indices. There is **no `admit_interval_terms`**; cadence comes entirely from `admission_terms` + the season cycle.
- **Personal time**: graduation/DELAYED/CENSORED use the stateful `Student.personal_semester` counter (mandatory terms only — see "Term/Season Model"), not a recomputed `global_term - entry_term + 1`. A student gets exactly `max_terms` *mandatory* semesters from their own entry.
- **Cohort ids**: study cohorts `0..n-1`. `num_incumbent_cohorts` still exists as an engine knob (defaults to **0** — incumbents `-1,-2,-3` at negative terms) but is no longer part of the default plan, which warm-starts via the [Initial-State Model](#initial-state-model) instead. The historical-transcript calibration stand-in (`analytics.compute_historical_transcripts`) is the one consumer that still opts incumbents back in. Globally-unique `student_id = (cohort_id + num_incumbent_cohorts)*cohort_size + i`; RNG seed `seed + student_id` (CRN preserved).
- **Capacity model**: per-term seats for a course = its own `capacity` field (`data/curriculum.json` / `Course.capacity`), **minus any `initial_state.occupancy[code]`** (see [Initial-State Model](#initial-state-model)). `scripts/size_capacity.py` auto-calibrates it (writes directly into `curriculum.json`), then hand-tunable per course in Settings. **Sizing policy: the whole required sequence (cs_core) and all non-CS courses are sized to *peak* demand; only interchangeable electives (cs_elective) are squeezed to the 75th demand percentile to keep a deliberate bottleneck.** This is *because* of the single-term offerings above: with several once-a-year upper courses, under-provisioning an early required gateway pushes students off the annual rhythm into a full-year wait that cascades into non-completion (CENSORED), so scarcity on the critical path is no longer "just delay." Electives are the only safe place to squeeze (4 interchangeable slots, no prerequisites). On an optional term, a separate, smaller model applies instead — see "Term/Season Model".
- **Headline metrics are scoped to study cohorts** (`entry_term >= 0`); incumbents (when enabled) are a warm-start device and appear only in the per-cohort ledger.

## Initial-State Model

- **Today's CS student body** is rebuilt from **`config["current_students"]["past_intakes"]`** (`[{label, size}]`, most recent first). `src/intake.py::resolve_incumbent_sizes` pads them with estimated older years (the mean of the real ones, or `cohort_size`) to at least `intake_analysis.min_history_years` (8) so the oldest cohort doesn't start in an empty university; each entry is tagged `entered` or `padded`. `SyntheticDataSource(config, incumbent_sizes=...)` turns them into incumbent cohorts at negative terms with their own sizes (passing both `incumbent_sizes` and `num_incumbent_cohorts > 0` raises). With `past_intakes` absent/empty the engine's ids and specs are byte-identical to before, so a plain `/simulate` baseline is unchanged.
- **`config["initial_state"]["occupancy"]`** (`{course_code: seats}`) now means **seats used by OTHER programs** (e.g. Computer Engineering students in CMPS151 or MATH101): a permanent background load. `src/simulator.py::_effective_capacity` subtracts it from a course's free seats on **every mandatory term** (floored at 0). Optional (Summer/Winter) terms are left alone (their separate, smaller capacity model shouldn't be zeroed out). A course whose seats are fully consumed reports `full` even with no requesters. The seat plan adds it to demand when sizing.
- No separate year-standing head-count exists (an earlier `initial_state.standing` field was removed). `year_standing_thresholds` is unrelated: it classifies *simulated* students into `Year1..Year(K+1)` flow-chart stages.
- Wired through `/meta` (`initial_state`, `current_students`, `data_sources`, `historical_outcomes`, `planning`, `section_size`), `POST /simulate` (`ScenarioRequest.initial_state` override), and `PUT /config` (validated by `src/plan_validation.py::validate_initial_state`, `validate_current_students`, `validate_historical_outcomes`, `validate_section_size`).
- **Data tags.** `config["data_sources"]` records `capacity`/`pass_rate` per course (`"qu"` or absent = estimate), `past_intakes` and `occupancy` as `"qu"`/`"estimate"`; `intake.data_quality` turns them into the "N of 41 QU data" strip and the `illustrative` flag (fewer than half of capacities or pass rates tagged QU, or no real past intakes).
- **Frontend editing surfaces** share one editor family (`InitialStateEditor.tsx` + `InitialOccupancyTable.tsx` for other-program seats, `web/src/components/data/PastIntakesEditor.tsx` for past intakes): the **first-run setup gate** (`InitialStateGate.tsx`, wired into `SimulationContext.tsx`'s `plannerSetupNeeded`: shown while past intakes are empty or still tagged estimate and the `initial-state-setup-done` flag isn't `"1"`; "Skip for now" keeps the shipped estimates, zero is accepted) and the **Data page** (`web/src/app/(dashboard)/data/page.tsx`, tabs via `?tab=`; and Plan Builder's Config step) for revisiting them. **CSV/Excel import** (`web/src/components/data/ImportModal.tsx`, one generic modal with a row mapper per Data tab: `courseValueMapper` for seats/pass rates/other-program seats, a label,size mapper for past intakes): a header row is auto-detected, unknown codes or non-numeric values are skipped with a reason shown in a preview, never fatal to the rest of the batch. QU data / Estimate tags (`SourceTag.tsx`) write `config.data_sources`; imports never auto-tag.
- **Intake Planner frontend**: `web/src/lib/IntakeContext.tsx` (layout-level, so the home page and Bottlenecks share the one running job; polls `GET /intake-analyses/{id}` every 1.5 s, resumes a job started before a reload, holds the latest finished sweep/seat plan), `web/src/lib/intakeUtils.ts` (`changedInputs` compares an analysis's `inputs_snapshot` with current `/meta` order-insensitively for the "data has changed" banner; losses <= 0 display as "none"), components in `web/src/components/intake/` (recommendation card, SVG chart, per-intake table + CSV, seat planner, calibration card, past analyses, progress bar).

## Multi-Plan Model

- A **Plan** (`src/db_models.py::Plan`) is a distinct `(curriculum, config)` pair, stored as its own rows in `Course`/`AppConfig` (`Course.code` is unique per-plan, not globally — multiple plans can each define their own "CMPS151"). One shared **default plan** (`owner_user_id is None`) is seeded from the JSON files for everyone; any other plan is private to the user who imported it.
- `User.active_plan_id` selects which plan that user's `/meta`, `/simulate`, `/curriculum`, `/config` calls resolve against (`src/db.py::resolve_active_plan_id` falls back to the default plan if the active one was deleted). This makes plan selection per-user, not a single global mutable baseline.
- `POST /plans/import` validates an uploaded `{name, curriculum, config}` payload — rejects an empty curriculum, a prerequisite cycle (`check_no_cycle`), or a config missing any of `src/db.py::REQUIRED_CONFIG_KEYS` (the keys the engine reads unconditionally: `seed`, `cohort_size`, `max_terms`, `scenarios`, `normal_load_ch`, `probation_load_ch`, `probation_min_ch`, `dropout_fails_threshold`, `dropout_prob_on_repeated_fail`, `enrollment_priority_tiers`, `grade_tiers`; guarded/defaulted keys like `terms_per_year`/`mandatory_terms` are *not* required) — as `PlanImportError` → HTTP 422, with nothing committed on failure. Catching the incomplete config here avoids an opaque `KeyError` 500 at the first `/simulate`. `POST /plans/{id}/activate` switches the caller's active plan; `GET /plans/{id}/export` round-trips back to the same `{curriculum, config}` shape; `DELETE /plans/{id}` (owner only, not the default) reassigns the caller to the default plan if it was active.
- **Curriculum CRUD on the active plan**: `POST /curriculum` adds a course (409 on a duplicate code within the plan, 422 on a prerequisite cycle); `DELETE /curriculum/{code}` removes one (404 if absent, 422 if another course's `prerequisites`/`rule_expr` still references it — checked via `src/rules.py::gate_edges`). `PUT /curriculum/{code}` (pre-existing) edits one course's fields in place **except `prerequisites`/`rule_expr`** — see "Prerequisite Lock" below. All three operate on whichever plan `resolve_active_plan_id` resolves to.
- Frontend: `web/src/app/(dashboard)/plans/page.tsx` — list, import (two JSON file uploads + name), activate, export, delete, and a **+ New plan** link into the Plan Builder. Settings' `CurriculumTable` now supports add/delete (not just per-course edits) via the shared `web/src/components/CourseFormFields.tsx`. In Settings it also renders **`pass_rate`, `capacity`, and initial `occupancy` as inline-editable columns** (deferred `NumberBox` edits, dirty-highlighted, persisted together on "Save as new baseline" — pass rate/capacity via per-course `PUT /curriculum`, occupancy via `PUT /config`); the structural edit form (title/prereqs/offering/rule/plan-term) opens as an **expansion row beneath** the course row so those inline cells stay visible while editing, and `CourseFormFields` hides its own pass-rate/capacity inputs there (`hidePassRate`/`hideCapacity`) to keep a single edit path.
- **Prerequisite lock**: `prerequisites`/`rule_expr` are **write-once**, settable only at course creation (Plan Builder's course step, or `POST /curriculum` for a course added later to an existing plan — both still cycle-checked by `check_no_cycle`) and permanently immutable afterward. They define eligibility, which drives the whole deterministic trajectory, so editing them mid-life would silently invalidate what any run built on the old graph means. `src/plan_validation.py::validate_prerequisites_locked` diffs a `PUT /curriculum/{code}` patch against the stored course and 422s **only on an actual change** to either field (not merely their presence, since the Settings edit form used to always round-trip both) — capacity/title/offering-only saves are unaffected. `CourseFormFields.tsx`'s new `lockPrerequisites` prop (same pattern as `hidePassRate`/`hideCapacity`) renders them read-only in Settings' edit form while Plan Builder's course step keeps them fully editable. The lock is permanent from creation, not "until first run" — the baseline auto-run already writes a `Run` row on every dashboard load, so "never run" is effectively never true.
- **Cross-object guardrails** (`src/plan_validation.py::validate_plan_edits`, called by `PUT /curriculum`, `POST /curriculum`, `PUT /config`, and every `/simulate`-family endpoint): `cohort_size` within `[10, 1000]`, `normal_load_ch`/`probation_load_ch` each within `[1, 24]` with `probation_load_ch <= normal_load_ch`, `max_course_attempts` within `[1, 10]`, and `initial_state.occupancy[code] <= capacity` for every course — `Simulator._effective_capacity` otherwise silently floors `capacity - occupancy` at 0, which can quietly stall a required gateway into mass `CENSORED` instead of erroring up front. It also runs `src/curriculum_validation.py::validate_curriculum_topology` — no course references a nonexistent prerequisite, no prerequisite cycle (`check_no_cycle`), and the longest prerequisite chain doesn't exceed `max_terms` (a chain that can't be completed within the term budget). The same module also holds `validate_initial_state`/`validate_admissions` (moved here from `src/api.py`, same behavior) so there is one place cross-object plan invariants live, not one per endpoint.
- **Plan Builder** (`web/src/app/(dashboard)/plan-builder/page.tsx`, `web/src/components/plan-builder/`): a 4-step wizard (name & seed → courses → config → review/save) for building a plan entirely client-side before the one and only network write (`POST /plans/import`, optionally followed by activate). "Seed" clones the default plan's `{curriculum, config}` via `GET /plans/{id}/export`, or starts blank (`web/src/lib/planBuilder.ts::BLANK_CONFIG`); the config step reuses the Scenario Builder's `AdmissionsTab`/`PassRatesDropoutTab`/`RegistrationPolicyTab` over a `BuilderState` built from the cloned/blank config (`metaFromPlanExport`).
- Distinct from the Advisor's ephemeral what-if Test (per-run overrides on top of whatever plan is active) and the Data page (formerly Settings: in-place edits to the *active* plan's curriculum/config, persisted immediately per edit).

## Per-Term Loop (three phases)

1. **Desired enrollment** — each active student (all cohorts) builds a priority-ordered list: retakes first, then `enrollment_priority_tiers` (config-defined category sets, each with an optional `min_ch` gate; QU CS default: cs_core/college_req > cs_elective at 60+ CH > math/science/english/gen_ed) subject to their load cap.
2. **Seat allocation** — sort requesters by `(registration_tier(completed_ch, config), tiebreak_token)`; grant first `effective_capacity`; record `capacity_block` for the rest. Seniors from older cohorts outrank freshmen automatically. The CH bands themselves are config data (`registration_tier_thresholds` in `simulation_config.json`), not hardcoded — a different institution's priority-registration policy is a config edit, not a code change. (The Settings/Plan-Builder editor card for these bands was removed as noise — the value still drives the engine, it's just no longer surfaced in the UI; edit it in the config/JSON.)
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

**The prereq signal's Bottlenecks *card* is hidden** (product decision — it's a passive whole-curriculum sweep that's noisier than the others). It's dropped from the frontend `SIGNAL_ORDER` (`web/src/lib/signalMeta.ts`), which also drops its legend-toggle pill on the Bottlenecks page — that list is the *only* consumer of `SIGNAL_ORDER`. Everything else still shows it: the Cohorts table's `top_prereq_block` column, the Student-Trace "waiting on prerequisites" count, the animated narrative, and the advisor's grounding. `SIGNAL_META.prereq`, the `BlockSignal` type, and the whole `flow_timeline` contract (`prereq_waiting` / `top_bottlenecks.prereq` / `top_prereq_block`) are all untouched. Re-add `"prereq"` to `SIGNAL_ORDER` to bring the card back.

## Scenarios (in simulation_config.json)

| Name | Change |
|---|---|
| baseline | Default (assumed) pass rates and capacity |

`capacity_multiplier`, `capacity_overrides`, `offering_overrides`, and `pass_rate_overrides` per-scenario hooks exist in the engine for what-if experiments. `run.py` simulates every scenario in this list and reports each in `simulation_summary.csv` + a `bottlenecks_<scenario>.png`; with a single scenario, `outputs/reports/flow_timeline.json` (the walkthrough/baseline data) comes from it directly. The scenario's name is recorded at `flow_timeline.json`'s `meta.scenario` so the dashboard can pick the matching `bottlenecks_<scenario>.png`. With more than one scenario, `save_all_figures` also writes `scenario_comparison.png` (graduation/on-time rate + avg time-to-degree, one bar group per scenario, single-seed only).

> The website's Scenarios page was removed; the `/scenarios` and `/runs` endpoints remain for API
> users. `py run.py` picks up any scenario added to `data/simulation_config.json`. The engine's
> `capacity_overrides` and `offering_overrides` are the hooks the Advisor's what-if **Test** uses, and
> `unlimited_seats` is the hook the intake analysis uses for its no-shortage reference.

## Intake Planner + Advisor

### Intake Planner (`src/intake.py`, `src/jobs.py`, `POST /intake-analyses`)

Replaces the old `compute_admissions_recommendation` heuristic ("admit 7/year", two targets unmeetable at any intake, no uncertainty) and `admission_targets` (config migration drops the key; `PUT /config` with it returns 422; its old 0.70 grad target is deliberately NOT converted to `min_grad_rate`). The method is in `docs/methodology.md`; the load-bearing facts:

- **Policy** `config["intake_policy"]` (default "Balanced"): `max_grad_rate_loss_pts: 2`, `max_on_time_loss_pts: 10`, optional `min_grad_rate: null`. Sweep knobs in `config["intake_analysis"]` (grid 20..200 step 10, 20 seeds, refine step 5 with 40 seeds, 8 reference runs, `min_history_years` 8); `section_size: 35`; `planning.next_intake_label`; `historical_outcomes` for the calibration check.
- **Two views per N**: *next* (rebuilt incumbents, then the next intakes of N, measured on the first 2) drives the headline; *steady* (8 earlier cohorts of N, then 6, measured on the first 4) gives the sustainable intake and the diminishing-returns upper limit.
- **Spaced seeds** (`utils.spaced_seeds`, `SEED_STRIDE = 10_000_019`): student RNG is `Random(seed + student_id)`, so consecutive seeds replay ~99% of the same students. Monte Carlo uses the same helper now (intentional output change; its CIs were too narrow).
- **Unlimited-seat reference**: scenario key `unlimited_seats: "all"|"regular"` in `_effective_capacity` bypasses every seat limit (overrides, Summer scale, occupancy). The pooled `"all"` reference (outcomes are independent of N) asserts zero denials; loss = reference − real-seat outcome. `"regular"` is for demand sizing (Summer keeps its small pool).
- **Smoothing + bounds**: weighted isotonic (non-decreasing) fit of loss vs N, one-sided 95% upper bound (`t_quantile`, no scipy). **Decision rule**: per-limit maximum N (every smaller N also passes); recommended = smallest; no feasible intake is reported honestly (`recommended_intake: null`); `imprecise` status when inside the limit but too uncertain; robustness range (one fewer section in the 3 tightest courses; pass rates −5 pts); precision warning when the margin exceeds half the limit; early stop of the coarse sweep once every limit has clearly failed.
- **Seat plan** `run_seat_plan(target)` (`kind=seat_plan`): demand sizing with `unlimited_seats: "regular"` at the 90th percentile + occupancy, rounded to whole sections, verified on both views, +1 section on the worst course per failing round up to `run_budget` (6). Seats change with `dataclasses.replace`, never multipliers. Read-only: the site applies it via `PUT /curriculum` (or `POST /checkpoint/edit` when `source: "checkpoint"`). Replaces `src/optimizer.py`/Auto-fill (both removed, along with `/autofill` and `/checkpoint/autofill`).
- **Jobs** (`src/jobs.py`): one analysis at a time (`POST /intake-analyses` → 202, or 409), results and an exact `inputs_snapshot` stored in the `Analysis` table; `GET /intake-analyses[/{id}]`, `POST .../cancel` (terminates pool workers). `src/db.py::recover_interrupted_analyses` fails rows a killed server left running; `migrate_plan_configs`/`normalize_config` bring stored configs up to date at startup. Tests run jobs inline (`INTAKE_JOBS_INLINE=1`, `INTAKE_WORKERS=1`). Covered by `tests/test_intake_*.py`, `test_seat_plan.py`, `test_analysis_api.py`, `test_config_migration.py`.

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

## Semester Checkpoint Mode ("advance one term at a time")

**The Walkthrough page (`/walkthrough`) IS this feature** (it used to be the dashboard home; the home page is now the Intake Planner). A
department head advances **one calendar term at a time — including optional Summer/Winter
terms, not just Fall/Spring** — and edits future-facing knobs (capacity, pass rate, occupancy,
next intake) between steps — never the courses already run. This is **not** a revival of the
old, removed Live Simulation feature (which was continuous-tick/replay-based over an
append-only edit log): a checkpoint session advances **only** on an explicit "Advance one
term" click, and it freezes/resumes real mid-run engine state rather than replaying from term 0
each time.

The walkthrough page shows the roadmap, headline results, per-cohort table and prerequisite
network, driven by the **checkpoint session's own partial run** instead of a single complete
`/simulate` call (see "Live-synced analytics"); its admissions section links to the latest intake analysis
instead of computing a recommendation. The full-horizon baseline simulation still runs in the
background (`SimulationProvider`, from the dashboard layout) purely so the Advisor and
Bottlenecks have data before any walkthrough starts.

- **Resumable engine** (`src/simulator.py`): both stepping methods share a private
  `_advance_one_calendar_term()` (admit any cohort due that term, run it, advance the cursor —
  returns the season processed). `Simulator.step_one_mandatory_term()` loops that until it hits
  a MANDATORY (Fall/Spring) term, sweeping through any intervening optional (Summer/Winter) term
  in the same call — this is what `run()` uses (`while not self.is_finished:
  self.step_one_mandatory_term()`, byte-identical to the old single-shot for-loop; the full test
  suite's many fixed-value assertions all still pass unchanged). **`Simulator.step_one_term()`**
  calls `_advance_one_calendar_term()` exactly once, mandatory or optional — this is what the
  Semester Checkpoint Mode session actually calls, so a department head can pause (and edit) at
  a Summer/Winter boundary too, not just Fall/Spring. Neither method changes
  `Student.personal_semester` semantics (still mandatory-terms-only, handled inside
  `_run_term`) — pausing more often never changes what happens inside any given term, only how
  finely a caller can stop between terms. `Simulator.snapshot()`/
  `from_snapshot(curriculum, config, scenario, blob)` pickle/restore the dynamic state (students,
  `History`, the resume cursor) so a session can pause after one request and resume in a
  **brand-new** `Simulator` instance on the next — curriculum/config/scenario are supplied fresh
  on restore, which is how a staged edit takes effect starting with the next step. `History`'s
  per-cohort counters use named module-level factory functions (`_int_defaultdict`/
  `_cohort_int_defaultdict`) instead of lambdas specifically so `History` stays picklable.
  Covered by `tests/test_checkpoint_engine.py`, most importantly a snapshot→restore→finish run
  producing byte-identical results to a straight-through run, and (for `step_one_term`) that
  stepping one calendar term at a time all the way to completion matches a straight `run()`
  exactly even with optional terms enabled.
- **Persistence** (`src/db_models.py::CheckpointSession`, `src/db.py::
  resolve_active_checkpoint_session`): one row per in-progress session, one active-or-completed
  session per user (mirrors `User.active_plan_id`). `working_curriculum` (plan-export shape,
  a list of course dicts) and `working_config` are a **frozen-at-creation copy** of the active
  plan's data, mutated only by `POST /checkpoint/edit` — never the plan's own `Course`/
  `AppConfig` rows, so a concurrent Settings/Plan edit can't reach into an in-progress session.
  `status` is `active | completed | discarded`; the resolver returns anything not `discarded`
  (so a `completed` session's final frames stay viewable until explicitly discarded, not 404).
- **API** (`src/api.py`, no `Run` row is ever written — this isn't the baseline `/simulate`
  path): `POST /checkpoint` starts one (404-then-create is the normal "no session yet" flow);
  `GET /checkpoint` reads the current state; `POST /checkpoint/edit` stages a whitelisted patch
  (`capacity`, `pass_rate`, `initial_state`, `cohort_size`, `admission_sizes` — there is
  deliberately no field for prerequisites/offering/category/admission_terms/num_cohorts/
  max_terms/seed, so there's no way to smuggle a structural or horizon-changing edit through it
  even by accident) validated through the same `plan_validation.py` guardrails as a persisted
  `PUT /curriculum`/`PUT /config`; `POST /checkpoint/advance` steps the session forward exactly
  one calendar term (`Simulator.step_one_term()` — mandatory or optional, see "Resumable engine"
  above); `DELETE /checkpoint` discards it. `GET /meta` reports
  `checkpoint_active`/`checkpoint_next_term`.
- **Go back to a previous term** (`src/db_models.py::CheckpointSnapshot`, `POST
  /checkpoint/rewind`): a second table holds one engine snapshot **per step** (`seq=0` at
  session creation, `seq=N` after the Nth successful advance) instead of the single
  overwritten blob `CheckpointSession.snapshot` still tracks as "the current/latest" (for the
  existing advance/edit code paths, unchanged). `_checkpoint_summary_from_sim` exposes this as
  `history: [{seq, next_term, label}]` (`label` is "Start" for `seq=0`, otherwise
  `term_label(next_term - 1, config)` — the season/year just completed, e.g. "Summer Y2" — so an
  optional-term step reads as distinctly as a mandatory one) and a top-level `next_term_label`
  (the *upcoming* term's season/year, `None` once finished) so the frontend never has to do its
  own season arithmetic. `POST /checkpoint/rewind {seq}` looks up that step's snapshot, **deletes
  every recorded step after it** (a linear undo, no branching/redo — advancing again after a
  rewind records a fresh forward path from there, overwriting what would have been the old
  future), restores the engine from that blob, and reactivates a `completed` session back to
  `active` if the target isn't the horizon's end. **Deliberately does NOT touch
  `working_curriculum`/`working_config`**: staged capacity/pass-rate/occupancy/intake edits
  survive a rewind and apply starting from the rewound point forward — that's what makes "go
  back, then try a different number from here" actually useful, and it matches the existing
  edits-are-always-forward-looking architecture. A session created *before* this feature shipped
  (or one that otherwise lost its `seq=0` row) self-heals on its next advance:
  `advance_checkpoint` back-fills the CURRENT pre-advance state as `seq=0` first if it finds zero
  recorded steps, rather than mislabeling "one step further along" as the start. `DELETE
  /checkpoint` and starting a new session both purge the old session's `CheckpointSnapshot` rows
  (`_purge_checkpoint_snapshots`) — they have no value once their session is gone. Covered by
  `tests/test_checkpoint_api.py` (rewind restores/truncates correctly, edits survive a rewind, a
  completed session reactivates, an out-of-range `seq` 422s, the backfill scenario, discard
  purges history).
- **Preview before committing** (`GET /checkpoint/peek/{seq}`): clicking a Term-history chip no
  longer rewinds immediately — it calls this read-only sibling of `POST /checkpoint/rewind`
  instead, which looks up the same `CheckpointSnapshot` row but **never mutates
  `CheckpointSession` or deletes anything**; it just returns a `_checkpoint_summary_from_sim`
  payload for that step (with `next_term`/`next_term_label`/`status` overridden to reflect the
  *peeked* point, since those three normally come from the live `row` this endpoint deliberately
  leaves untouched), plus a `viewed_seq` marker so the frontend knows it's a preview and not the
  live session. `CheckpointContext`'s `viewing` state holds this separately from `session` (the
  real, current state every other page still reads) — the Dashboard renders whichever the head is
  looking at, but "Edit term settings"/"Advance one term" are hidden while `viewing` is set, since
  those always act on the live session. Only the explicit **"Continue from here"** action (shown
  in place of Edit/Advance while previewing) calls the actual `POST /checkpoint/rewind` — same
  confirm dialog and truncation behavior as before, just moved one click later so "go back to look"
  and "go back and change something" are no longer the same action. Covered by
  `tests/test_checkpoint_api.py` (peek returns an earlier step's data without touching session
  status/`next_term`/history length; a peek doesn't affect a subsequent rewind's behavior).
- **Live-synced analytics**: `_checkpoint_summary_from_sim` includes a `flow_timeline` field —
  the *exact* `{meta, frames, summary}` shape `analytics.flow_timeline_payload` builds for a
  completed `/simulate` run, computed straight off the mid-run `Simulator` (`compute_metrics`/
  `compute_cohort_metrics` only ever read `.history`/
  `.config`/`.students`, all present on a `Simulator` whether it's finished or not — every ratio
  already guards its own zero-student/zero-graduate case).
  This lets the walkthrough's `HeadlineKpis`/`CohortsTable`/
  `PrerequisiteNetwork` (each wrapped in a `CollapsibleSection`, collapsed by default) and the
  Bottlenecks page's `BottlenecksPanel`/`CapacityRecommendations` read a checkpoint session
  exactly like they'd read the baseline's `flow_timeline` — always **explicitly framed as
  partial** (a note above the sections / a banner on Bottlenecks: "N terms run so far, not the
  full horizon"), since fewer terms run means less reliable numbers, especially before any
  cohort has finished. `CheckpointProvider` therefore lives at the **dashboard layout level**
  (`web/src/app/(dashboard)/layout.tsx`, nested inside `SimulationProvider`), not just on the
  Dashboard page, so Bottlenecks can reach it too; unlike `SimulationProvider` it does **not**
  block rendering while its initial `GET /checkpoint` resolves (`loading` is exposed for the one
  place — the Dashboard's own start/session branch — that needs to avoid flashing the wrong
  screen; every other page just falls back to the baseline until the near-instant fetch settles).
  **Seat plans also have a session-scoped variant**: `POST /intake-analyses` with `source: "checkpoint"`
  runs the analysis or seat plan against the session's `working_curriculum`/`working_config` (it replaced
  `POST /checkpoint/autofill`) — read-only; "Apply" routes through `POST /checkpoint/edit` instead of
  `PUT /curriculum`/`PUT /config`, so it takes effect on the next Advance rather than immediately. The seat
  planner and `CapacityRecommendations` pick whichever mode matches whether a checkpoint session is active.
  Covered by `tests/test_checkpoint_api.py::test_checkpoint_summary_carries_flow_timeline_shaped_data`.
- **Frontend** (`web/src/lib/CheckpointContext.tsx`,
  `web/src/app/(dashboard)/walkthrough/page.tsx`, `web/src/components/checkpoint/CheckpointEditPanel.tsx`):
  built like `SimulationContext` but **with no auto-run** — it starts idle until "Start checkpoint
  walkthrough" is clicked. A "Term history" chip strip (`TermHistoryStrip`, rendered
  once `session.history` has more than one entry) lists every recorded step by its `label` (from
  the API, e.g. "Start", "Fall Y1", "Summer Y2"); clicking an earlier chip confirms via
  `window.confirm` (same pattern as Discard) and calls `useCheckpoint().rewind(seq)` — the
  current step's chip is visually marked and disabled. The status bar's "Next up: …" line prefers
  `session.next_term_label` over the bare `next_term` number. The edit panel (`CheckpointEditPanel`, composed entirely from existing
  pieces — `InitialStateEditor` for occupancy, `CurriculumTable` for capacity/pass-rate/occupancy,
  a small custom next-intake control, no new form widgets) is no longer rendered inline: an "Edit
  term settings" button in the session's status bar opens it inside `web/src/components/Modal.tsx`
  (given a new `size="wide"` variant so a full `CurriculumTable` fits and scrolls inside the modal
  instead of overflowing it), and a successful save (`onSaved` callback) auto-closes the modal.
  `CurriculumTable` gained a `structuralEditsDisabled` prop: it hides Add/Delete and the structural
  edit-expansion row, since those call `updateCourse`/`createCourse`/`deleteCourse`
  (`PUT`/`POST`/`DELETE /curriculum`) against the **live plan**, not a checkpoint session's
  `working_curriculum` — only the deferred inline capacity/pass-rate/occupancy columns (already
  owned by the parent's `onChange`) stay available. `AdmissionsTab` was deliberately **not** reused
  for the intake control: its `BuilderState` coupling and `mode="simple"/"advanced"` split doesn't
  cleanly hide exactly `num_cohorts`/`max_terms`/`seed` while keeping `cohort_size`/
  `admission_sizes`/initial state, so a small purpose-built control was simpler and safer than
  forcing that fit.

## Parallel Workloads

- A single simulation is cheap (~0.75s / ~10 MB for the 800-student baseline). What was slow was
  the workloads that run *many* independent sims.
- **Per-run hot path**: eligibility (`Student.is_eligible_for`) is called hundreds of thousands of
  times per run (active student × candidate course × term, from both `get_desired_courses` and
  `_record_blocks`). It caches a *True* result in `Student._eligible_codes` (wiped in
  `_reset_rng_and_state`). This is behavior-preserving because eligibility is **monotonic** —
  `rule_expr` (`src/rules.py`) is only AND/OR of `has_passed`/`min_ch`, with no negation or upper
  bound, and passed grades / `completed_ch` never decrease — so a course that's eligible stays
  eligible. Verified byte-identical (same flow_timeline + block-count fingerprint before/after);
  ~20% faster per run. A False is never cached. **Don't add a non-monotonic gate (e.g. an upper CH
  bound, or a "not passed X") to the rule grammar without invalidating this cache.**
- **`src/parallel.py::ordered_map(fn, items, workers=...)`** fans independent sims across a
  `ProcessPoolExecutor`. Two properties callers rely on: **order-preserving** (results come back in
  input order, so aggregates are byte-identical to a serial loop) and a **serial fallback** on any
  pool/spawn failure (a genuine bug in `fn` re-raises from the serial path — only environmental pool
  problems are silently recovered). `fn` must be a module-level function (spawn-picklable); below 3
  items or `workers<=1` it just runs serial.
- **Monte Carlo** (`run_monte_carlo(..., workers=None)`) parallelizes across its **spaced** seeds (`spaced_seeds`, see Intake Planner) — **~7x faster on a 20-core box (27.7s → 4.0s for 30 seeds), result byte-identical.** Worker
  count: explicit `workers` arg → `config["monte_carlo"]["workers"]` → one per CPU; `workers=1` forces
  serial. Only runs when `include_monte_carlo` is set, so it never touches the default dashboard load.
- **Intake analyses** (`src/intake.py`) fan every simulation of a job across one process pool
  (`parallel.make_pool`/`iter_ordered`: ordered results for progress, no silent serial fallback,
  `terminate_workers()` on cancel on Python 3.14). A full default analysis is ~570 simulations,
  ~2.5 minutes on a 20-core PC (`INTAKE_WORKERS` caps cores); the coarse sweep stops early once every
  limit has clearly failed because high intakes are the most expensive and least informative.

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
                course_utilization.csv, monte_carlo.csv, flow_timeline.json,
                intake_analysis.json (only with `py run.py --intake`)
```

`flow_timeline.json` is the frontend contract: `meta` (scenario name, stage nodes, cohorts, prerequisite `graph`), `frames` (one per semester: per-course stats + per-cohort stage nodes/flows), and `summary` (headline metrics + CIs, per-cohort metrics + bottlenecks, severe terms). The intake recommendation is not in it: it lives in the `Analysis` result (`POST /intake-analyses`).
