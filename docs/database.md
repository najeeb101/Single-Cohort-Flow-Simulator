# Database Schema

`src/db_models.py` (SQLAlchemy ORM) → SQLite at `data/app.db` (gitignored; `DATABASE_URL` env
var can point it at Postgres instead — `src/db.py` only special-cases SQLite connection args).

`data/curriculum.json` and `data/simulation_config.json` are a **one-time seed**, not a live
source: `get_or_create_default_plan()` loads them into the DB on first API startup, creating the
shared default `Plan`. After that, **the DB is authoritative** — every request reads/writes rows,
never the JSON files again, until someone explicitly re-syncs with
`py scripts/migrate_json_to_db.py --force`.

## Tables

```
User ──< active_plan_id >── Plan ──< plan_id >── Course
  │                           │
  │                           └──< plan_id >── AppConfig  (1:1 — one config row per plan)
  │
  ├──< owner_user_id >── Scenario
  ├──< user_id >── Run
  └──< created_by_user_id >── LiveSimulation ──< live_sim_id >── LiveTermSnapshot
                                  │
                                  └── plan_id (FK to Plan — shared within a plan, not owner-scoped)
```

### `users`
| Column | Type | Notes |
|---|---|---|
| `id` | PK | |
| `email` | unique, indexed | in practice always the single demo user (`demo@local`) — see `docs/api.md` |
| `hashed_password` | string | empty string; auth was removed, column kept for schema stability |
| `active_plan_id` | FK → `plans.id`, nullable | which plan this user's requests resolve against |

### `plans`
A **Plan** is a distinct `(curriculum, config)` pair. `owner_user_id is None` marks the shared,
system-seeded **default plan** (visible to everyone); any other row is private to the user who
imported it via `POST /plans/import`.

| Column | Type | Notes |
|---|---|---|
| `id` | PK | |
| `owner_user_id` | FK → `users.id`, nullable | `null` = default plan |
| `name` | string | |
| `created_at` | datetime | |

### `courses`
Mirrors `src/models/course.py::Course` field-for-field. `code` is unique **only within a plan**
(`uq_course_plan_code` on `(plan_id, code)`), not globally — two plans can each define their own
`CMPS151` with different prerequisites/capacity.

| Column | Type | Notes |
|---|---|---|
| `id` | PK | surrogate key, since `code` isn't globally unique |
| `plan_id` | FK → `plans.id` | |
| `code`, `title` | string | |
| `credits` | int | |
| `prerequisites` | JSON list[str] | |
| `pass_rate` | float | |
| `offering` | JSON list[str] | subset of `Fall/Spring/Summer/Winter` |
| `category` | string | one of `cs_core/cs_elective/college_req/math/science/english/gen_ed` |
| `capacity` | int | seats/term, auto-calibrated by `scripts/size_capacity.py` |
| `rule_expr` | JSON, nullable | compound eligibility expression (see `src/rules.py`) |
| `study_plan_order` | int | tiebreak ordering for `/curriculum` listing |
| `study_plan_term` | int | recommended semester column (1..N) for the roadmap layout; backfilled via `_ensure_columns()` for DBs created before this column existed |

### `app_config`
One row per plan, holding the full `simulation_config.json` shape (cohort size, seed, dropout
knobs, `initial_state`, `scenarios`, etc.) as a single JSON blob — there's no per-key column
because the config shape is meant to evolve without a migration each time a new knob is added.

| Column | Type | Notes |
|---|---|---|
| `id` | PK | |
| `plan_id` | FK → `plans.id`, **unique** | enforces one config row per plan |
| `data` | JSON | the whole config dict |

### `scenarios`
User-saved scenario-builder presets (`{name, overrides}`), independent of `Plan` — a saved
scenario is a set of `/simulate` request overrides, not a full curriculum.

| Column | Type | Notes |
|---|---|---|
| `id` | PK | |
| `owner_user_id` | FK → `users.id` | |
| `name` | string | |
| `overrides` | JSON | a `ScenarioRequest`-shaped dict |
| `created_at`, `updated_at` | datetime | |

### `runs`
One row per `POST /simulate` call — a lightweight history log, not a full re-runnable snapshot
(the full `flow_timeline` isn't stored, only the overrides that produced it + the metrics
summary).

| Column | Type | Notes |
|---|---|---|
| `id` | PK | |
| `user_id` | FK → `users.id` | |
| `scenario_id` | FK → `scenarios.id`, nullable | which saved scenario this run came from, if any |
| `requested_at` | datetime | |
| `overrides_json` | JSON | the `ScenarioRequest` that was sent |
| `summary_json` | JSON | `{metrics, admissions_recommendation}` |

### `live_simulations`
A stepwise, term-by-term simulation run — see `docs/technical_design.md`'s Live Simulation Model
for the deterministic-replay design this supports. **Shared within a plan**, not owner-scoped:
any request whose active plan matches `plan_id` can view/advance it.

| Column | Type | Notes |
|---|---|---|
| `id` | PK | |
| `plan_id` | FK → `plans.id` | |
| `created_by_user_id` | FK → `users.id` | only this user may `DELETE` it |
| `name` | string | |
| `current_term` | int, nullable | `null` until the first `/advance` call |
| `status` | string | `active` \| `finished` |
| `base_config`, `base_scenario` | JSON | frozen at creation; **never mutated** — forward changes go through `edits` instead |
| `edits` | JSON list | append-only `{effective_from_term, patch}` entries consumed by `LiveRunner.replay` |
| `created_at` | datetime | |

### `live_term_snapshots`
One row per term the sim has advanced through. Unique on `(live_sim_id, term_index)` since
`/advance` only ever appends the next term in order.

| Column | Type | Notes |
|---|---|---|
| `id` | PK | |
| `live_sim_id` | FK → `live_simulations.id` | |
| `term_index` | int | |
| `season`, `label` | string | e.g. `"Fall"`, `"Fall 2027"` |
| `frame` | JSON | the same per-term shape `/simulate`'s `flow_timeline.frames[i]` uses |
| `summary` | JSON, nullable | cheap running counts (active/graduated/dropped/censored) off `frame` alone |
| `edits_applied` | JSON | exactly which edit patch (if any) took effect entering this term |
| `created_at` | datetime | |

## Migrations

There's no migration framework (Alembic, etc.) — schema changes are additive and handled by
`src/db.py::_ensure_columns()`, which runs a guarded `ALTER TABLE ... ADD COLUMN` for any column
introduced after a DB was first created (SQLAlchemy's `create_all()` only creates missing
*tables*, never alters existing ones). Adding a new column means: add it to the `db_models.py`
class, then add a `(table, column, DDL)` tuple to `_ensure_columns()`'s `additions` list.
