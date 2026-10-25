# Frontend start gate, roadmap layout, and plan-scoped data flow

Reference split out of `CLAUDE.md`; read it when touching `SimulationContext`, the roadmap graph, `data/app.db` seeding, or `service.run_simulation`.

**Start gate + roadmap layout (Walkthrough and baseline)** (`web/src/lib/SimulationContext.tsx`,
`web/src/components/CurriculumGraph.tsx`, `web/src/lib/graphLayout.ts`): on load the dashboard
fetches only the program structure (`GET /meta`). If `initial_state` is still completely empty
(and the `initial-state-setup-done` localStorage flag isn't set), it first shows the required
[`InitialStateGate`](cohorts-and-initial-state.md#initial-state-model) setup screen. Once that's past (dismissed, or on any
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
immediately, no server restart needed. See [Multi-Plan Model](plans-and-validation.md#multi-plan-model) below.
`src/service.py::run_simulation(curriculum, config, scenario, data_source=None) -> dict` runs one scenario in memory (no file I/O) and returns `result`/`metrics`/`cohort_metrics`/`flow_timeline`; `run.py` calls it, then passes the result to `analytics.py`/`visualize.py`'s writers, which remain the only place that touches disk.
