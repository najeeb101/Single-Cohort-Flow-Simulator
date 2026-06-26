# Scenario Builder input system (phased: ship the builder first, DB/auth second)

> **Status: historical.** Phases 1 and 2 below shipped as planned. Phase 2.2 (Auth) shipped
> with a hand-rolled JWT + httpOnly-cookie scheme instead of next-auth — see `src/auth.py`,
> `web/src/proxy.ts`, `web/next.config.ts` — because this repo's Next.js 16.2.9 renamed
> Middleware to Proxy, a breaking change next-auth's training data predates. A further,
> undocumented-here addition shipped on top of 2.1/2.4: **multi-plan support** — `Course`/
> `AppConfig` are now scoped to a `Plan` row instead of being single global rows, so each
> user can import/activate/export/delete their own alternate curriculum+config combos
> instead of sharing one mutable baseline. See `CLAUDE.md`'s "Multi-Plan Model" section and
> `src/db.py`/`src/db_models.py`/`src/api.py` for the as-built design; this doc was never
> updated to describe it and shouldn't be treated as current for that part.

## Context

The dashboard currently exposes only 2 sliders (top-3 course capacity, cohort size) via
`LiveWhatIfPanel`, even though the engine accepts far more levers (capacity/sections, pass
rates, 6 dropout params, registration-tier thresholds, enrollment-priority tiers,
admissions/cohort structure). The goal is a real input system covering all of that.

The original draft front-loaded a SQLite DB + auth before any of this was visible. On
review, that's backwards: DB/auth are the biggest, riskiest pieces, and they were gating
all visible progress on the thing actually requested (the input system itself). Re-sequenced
into two phases:

- **Phase 1** ships the Scenario Builder, the single-scenario cleanup, and the multi-page
  site against the existing JSON config files — no new infra, fast to verify end-to-end.
- **Phase 2** adds the database + auth, and upgrades scenario save/load from
  file-export/import to persistent, per-user storage with run history.

**Curriculum editing moves to Phase 2, as a separate "Settings" page (2.4), not the
Scenario Builder.** Editing the curriculum/baseline config only means something once
there's a durable place (the database) for it to live — in Phase 1 there's no real
"baseline" to mutate, just per-run overrides. Settings is for structural/persistent
changes (curriculum, baseline defaults); the Scenario Builder stays for ephemeral
per-run what-ifs. Settings gets basic validation (a prerequisite-cycle check, a
structured `rule_expr` editor instead of free JSON) so it can't silently break the model
for everyone.

**Before writing any `web/` code:** read `node_modules/next/dist/docs/` per
`web/AGENTS.md` — this Next.js version (16.2.9) may differ from standard App Router
conventions (middleware, route handlers) from training data.

---

## Phase 1 — Scenario Builder, single scenario, multi-page site

### 1.1 Collapse to a single scenario, remove the calibration workflow

- `data/simulation_config.json`: delete the `B_calibrated` entry from `scenarios`; rename
  the remaining entry's `name` from `"A_baseline"` to `"baseline"`.
- Delete `scripts/calibrate_from_history.py`, `src/calibration.py`,
  `tests/test_calibration.py` — the whole fit-from-history pipeline.
- `run.py` (~line 58-64): remove the `for preferred in ("B_calibrated", "A_baseline")`
  scenario-preference loop; with one scenario, `flow_timeline.json` comes from it directly.
- `CLAUDE.md`: remove the `py scripts/calibrate_from_history.py` command, drop the
  `B_calibrated` row from the Scenarios table, fix the "run.py prefers B_calibrated over
  A_baseline" sentence.
- `README.md`: trim calibration references (script invocation, `B_calibrated` description,
  `calibration_report.json` generation, file-tree mentions — lines 33, 83, 100, 105-113,
  193, 201-202, 238).
- Leave `docs/technical_design.md`, `docs/assumptions.md`, `report/report_v2.md` (since renamed
  to `docs/project_overview.md`) alone — historical narrative, not instructions to run anything
  removed.
- `outputs/reports/calibration_report.json` (currently open in the user's IDE) just goes
  stale since nothing regenerates it — not auto-deleting it, that's the user's call.

### 1.2 Multi-page site

Still reads `CURRICULUM`/`BASE_CONFIG` from the JSON files exactly as `src/api.py` does
today — no DB yet.

- `web/src/lib/SimulationContext.tsx` (new): client context/provider that on mount does
  what `page.tsx` lines 33-47 do today (`Promise.all([getMeta(), simulate({})])` → `meta`,
  `data`, `chartMeta`, `topCapacityCourses`, `phase`), exposes `runScenario(overrides)` /
  `resetToBaseline()`, and owns the loading/error gate currently in `page.tsx` lines 51-69.
- `web/src/components/NavBar.tsx` (new): links to `/`, `/scenario-builder`, `/cohorts`,
  `/bottlenecks`, `/figures`, `/prerequisites`; active link via `usePathname()`.
- `web/src/app/layout.tsx`: wrap `{children}` in `<SimulationProvider>`, render `<NavBar />`.
- Route split (slim client components reading `useSimulation()`):
  - `web/src/app/page.tsx` (rewritten) — header + read-only "Inputs" badge summary +
    `AnimationSection` + `AdmissionsRecommendation` + `HeadlineKpis`.
  - `web/src/app/scenario-builder/page.tsx` (new) — the Scenario Builder (1.3).
  - `web/src/app/cohorts/page.tsx`, `bottlenecks/page.tsx`, `figures/page.tsx`,
    `prerequisites/page.tsx` (new) — `CohortsTable`, `BottlenecksPanel`, the 4 static
    charts, `PrerequisiteNetwork` respectively.
- Delete `web/src/components/FiguresSection.tsx` (children inlined above) and
  `web/src/components/LiveWhatIfPanel.tsx` (superseded by the builder's Capacity tab).

### 1.3 The Scenario Builder

**Backend (`src/api.py`):**
- Extend `ScenarioRequest` with config-level fields applied to `config` the same way
  `cohort_size` is today: `num_cohorts`, `num_incumbent_cohorts`, `admit_interval_terms`,
  `max_terms`, `seed`, `course_sections_overrides: dict[str, int]` (merged into
  `config["course_sections"]`), `dropout_gpa_floor`, `dropout_base_hazard`,
  `dropout_early_multiplier`, `dropout_early_sem_cutoff`, `dropout_fails_threshold`,
  `dropout_prob_on_repeated_fail`, `registration_tier_thresholds: list[int]`,
  `enrollment_priority_tiers: list[dict]`. Add `Field(ge=..., le=...)` bounds on the
  probability/rate-shaped ones.
- Extend `/meta` to also return `course_pass_rates` (code → `Course.pass_rate`, the real
  baseline the Advanced pass-rate tab pre-fills) plus the rest of `BASE_CONFIG`'s scalar
  tunables, so the frontend always mirrors engine defaults instead of hardcoding them.

**UX bar:** most of these fields are values the user is manually providing, so the form
quality matters as much as the field coverage — smooth, no-jank switching between tabs and
Simple/Advanced, instant local feedback when a field changes (dirty-state highlighting,
live-computed diff against baseline) even though the actual simulation Run is explicit, and
layouts that don't feel cluttered or overwhelming despite covering ~5x more fields than
today's 2-slider panel. Treat this as a design requirement, not just a feature checklist.

**Frontend types** (`web/src/types/simulation.ts`): extend `ScenarioRequest`/`MetaResponse`
to match.

**Frontend (`web/src/components/scenario-builder/`):**
- `ScenarioBuilderForm.tsx`: form state mirroring the engine config shape (diff-only-changed
  pattern reused from `LiveWhatIfPanel.tsx:53-58`), a tab strip (Capacity / Pass Rates &
  Dropout / Admissions / Registration Policy), one Simple/Advanced toggle, **Run simulation**
  button, **Reset to baseline** button, and **Export / Import JSON** (download the current
  form state as a `.json` file; upload one to bulk-populate the form) — this is the
  no-database way to save/share/reload a configuration: export it, keep the file, import it
  later. (Server-backed Save/Load/Clone of named scenarios comes in Phase 2 once there's a
  database to store them in.)
- `CapacityTab.tsx` — Simple: today's top-3-bottleneck sliders + cohort-size slider.
  Advanced: a scrollable table of all courses with a capacity multiplier input each.
- `PassRatesDropoutTab.tsx` — Simple: 3 lowest-`course_pass_rates` courses + 2 headline
  dropout knobs (`dropout_base_hazard`, `dropout_gpa_floor`). Advanced: full per-course
  pass-rate table + all 6 dropout params with domain-ranged numeric inputs (hazard/prob
  fields 0-1, `dropout_early_sem_cutoff`/`dropout_fails_threshold` small positive ints,
  `dropout_gpa_floor` 0-4).
- `AdmissionsTab.tsx` — Simple: `cohort_size`, `num_cohorts`. Advanced: adds
  `num_incumbent_cohorts`, `admit_interval_terms`, `max_terms`, `seed`.
- `RegistrationPolicyTab.tsx` — Simple: the 5 `registration_tier_thresholds` CH-band number
  inputs. Advanced: `enrollment_priority_tiers` editor (category multi-select over the 7
  known categories from `src/models/course.py`'s `Course.category`, optional `min_ch`,
  add/remove tier).
- All numeric inputs get `min`/`max`/`step` as basic hygiene — no blocking inline-error UI
  (presets+advanced-toggle is the chosen guardrail, not hard validation).

**Phase 1 verification:**
- Backend: `py -m pytest tests/ -v` after removing `test_calibration.py` and editing
  `simulation_config.json`/`api.py` — must stay green. Extend `tests/test_api.py` with one
  case per new override category, mirroring the existing `capacity_overrides` test.
- Frontend: `cd web && npm run dev`, open `http://localhost:3000`. Click through all 6 nav
  routes, confirm each renders without re-fetching. Exercise the Scenario Builder in Simple
  then Advanced mode across all 4 tabs, hit Run, confirm `/` and other pages reflect the new
  result, Export the config, Import it back, Reset to baseline.

---

## Phase 2 — Database + auth, persistent scenarios & run history

Only start once Phase 1 is working end-to-end.

### 2.1 Database

New dependencies (`requirements.txt`): `sqlalchemy>=2.0`, `passlib[bcrypt]`, `pyjwt`.

- New `src/db.py`: SQLAlchemy engine/session against a single SQLite file
  (`data/app.db`, gitignored), with `init_db()` creating tables if missing (no Alembic).
- New `src/db_models.py`:
  - `User(id, email unique, hashed_password, created_at)`.
  - `Course` — mirrors `src/models/course.py::Course` fields exactly, replaces
    `data/curriculum.json`'s array (read-only from the UI per the cut-scope note above).
  - `AppConfig(id=1, data JSON)` — everything currently in `data/simulation_config.json`
    (single scenario, no list).
  - `Scenario(id, owner_user_id FK, name, overrides JSON, created_at, updated_at)`.
  - `Run(id, user_id FK, scenario_id FK nullable, requested_at, overrides_json,
    summary_json)` — `summary_json` holds `metrics` + `admissions_recommendation` only.
- New `scripts/migrate_json_to_db.py`: one-time script, read `data/curriculum.json` +
  `data/simulation_config.json`, insert into `Course`/`AppConfig` rows.
- `src/api.py`: replace the module-load `CURRICULUM = load_curriculum(...)` /
  `BASE_CONFIG = load_json(...)` with DB-backed equivalents returning the exact same
  in-memory shapes, so `src/simulator.py`/`src/analytics.py` need zero changes.
- `CLAUDE.md`: update the "`data/curriculum.json` is the source of truth" note to point at
  the DB, noting the JSON files are now just the one-time seed.

### 2.2 Auth

**Backend (new `src/auth.py`):**
- `POST /auth/register`, `POST /auth/login` (passlib/bcrypt + signed JWT, secret from
  `AUTH_SECRET` env var).
- `get_current_user` dependency on every endpoint except `/health` and `/auth/*` — no role
  check, just "is this a logged-in user" (equal permissions for everyone).

**Frontend:**
- `next-auth` (Auth.js v5): `web/src/auth.ts` (Credentials provider POSTing to FastAPI
  `/auth/login`, JWT session strategy, no separate NextAuth DB adapter), the
  `[...nextauth]` route handler, `web/src/app/login/page.tsx` /
  `web/src/app/register/page.tsx`, `web/src/middleware.ts` redirecting unauthenticated
  requests to `/login`.
- `web/src/lib/api.ts`: attach `Authorization: Bearer <token>` (from the NextAuth session)
  on every call.
- `NavBar.tsx` gets a sign-out control.

### 2.3 Persistent scenarios + run history

- New `GET/POST /scenarios`, `GET/PUT/DELETE /scenarios/{id}`; `GET /runs`, `GET /runs/{id}`
  — every `/simulate` call also writes a `Run` row.
- `ScenarioBuilderForm.tsx` gains **Save as...**, a **Load saved scenario** dropdown, and a
  **Clone** action, alongside the Phase-1 Export/Import (both stay — file export/import is
  still useful for sharing a config outside the app).
- New `web/src/app/scenarios/page.tsx` (manage saved scenarios) and
  `web/src/app/runs/page.tsx` (history table); add both to `NavBar`.

### 2.4 Settings — curriculum + baseline config editing

Separate from the Scenario Builder: this *persists* to the DB as the new baseline
(`Course`/`AppConfig` rows) rather than sending a per-run override to `/simulate`.

- Backend: `GET /curriculum`, `PUT /curriculum/{code}` (credits, prerequisites, pass_rate,
  offering, category, capacity, `rule_expr`, study_plan_order). Validate on write: reject
  an edit that introduces a prerequisite cycle (graph-cycle check, e.g. via `networkx`,
  already a dependency of `src/analytics.py`); edit `rule_expr` through a structured
  sub-form matching the compound-rule shape `src/rules.py::evaluate_rule` expects, not a
  raw JSON textarea. `GET /config`, `PUT /config` for the baseline `AppConfig` scalar
  fields (admissions/dropout/registration-policy values — the same fields the Scenario
  Builder's tabs expose, but here the edit becomes the new default instead of a one-run
  override).
- Frontend `web/src/app/settings/page.tsx`: a curriculum table (same per-course-row-editor
  pattern as the Scenario Builder's Advanced capacity/pass-rate tabs) plus a baseline
  config editor. Reuse the `AdmissionsTab`/`PassRatesDropoutTab`/`RegistrationPolicyTab`
  components from 1.3 in a `mode="persist"` variant (submits to `PUT /config` instead of
  building a `/simulate` override) rather than duplicating the UI. Add `/settings` to
  `NavBar`.

**Phase 2 verification:**
- Backend: add `tests/test_db.py` (migration round-trips a known course/config) and
  `tests/test_auth.py` (register → login → token required on `/simulate`, rejected without
  it). Add a case asserting `PUT /curriculum/{code}` rejects an edit that introduces a
  prerequisite cycle. Full `py -m pytest tests/ -v` green.
- Frontend: register a user, confirm logged-out access to any route redirects to `/login`.
  Save a scenario from the builder, reload the page, Load it back, confirm `/runs` shows
  the run history. In `/settings`, edit a course's `pass_rate`, confirm a subsequent
  `/simulate` run reflects it as the new baseline; try to create a prerequisite cycle and
  confirm it's rejected.
