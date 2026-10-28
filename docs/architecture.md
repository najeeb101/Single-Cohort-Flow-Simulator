# Architecture

How the repository is organised and the rules that keep it that way. If you are adding code, read
sections 2 and 3 first. If you want to understand what the system does, start with the
[README](../README.md).

## 1. The system in one picture

```
 browser  ──►  web/ (Next.js)  ──/api/backend/*──►  src/api (FastAPI)
                                                        │
                      ┌─────────────────────────────────┼───────────────────────┐
                      ▼                                 ▼                       ▼
              src/planner                          src/storage              src/analysis
        intake sweep, seat plan,               SQLite (data/app.db):     metrics, Monte Carlo,
        background jobs, advisor               plans, courses, config,   timeline JSON, figures
                      │                        analyses, checkpoints             │
                      └───────────────┬─────────────────────────────────────────┘
                                      ▼
                      src/engine  (the simulator: deterministic, no I/O)
                                      │
                      src/validation ─┴─ src/domain  (Course, Student, terms, rules)
```

Two things make the design work:

- **The engine is a pure function of `(curriculum, config, scenario, seed)`.** It never touches
  the database, the network or the disk. Everything above it hands it plain dicts and dataclasses.
- **The database is authoritative after first boot.** `data/*.json` only seed it. Every API
  request resolves the caller's active `Plan` from the database, so there is no shared mutable
  state between requests.

## 2. Layers

`src/` is a set of packages ordered from lowest to highest. **A package may import from its own
layer or any layer below it, never from one above.** `tests/test_architecture.py` enforces this by
parsing every import, including lazy ones.

| # | Package | Responsibility | Modules |
|---|---|---|---|
| 1 | `domain/` | The vocabulary: what a course, a student, a term and a prerequisite rule *are*. No simulation, no I/O. | `course.py`, `student.py`, `semester.py`, `rules.py` |
| 2 | `validation/` | Guardrails: is this curriculum or config legal? Single home for cross-object invariants. | `plan_validation.py`, `curriculum_validation.py` |
| 3 | `engine/` | The simulator: population creation, the three-phase term loop, seat allocation, process-pool helper, seeds. | `simulator.py`, `datasource.py`, `parallel.py`, `utils.py` |
| 4 | `analysis/` | Turning runs into numbers and pictures. Never changes a run. | `analytics.py`, `montecarlo.py`, `service.py`, `visualize.py` |
| 5 | `storage/` | SQLite persistence: ORM tables, plan-scoped loaders, startup migration. | `db.py`, `db_models.py` |
| 6 | `planner/` | The product logic: the intake decision layer, background jobs, the advisor. | `intake.py`, `jobs.py`, `advisor.py` |
| 7 | `api/` | HTTP. Thin: parse, validate, call a lower layer, serialise. | `app.py`, `auth.py`, `scenarios.py` |

`src/env.py` (a zero-dependency `.env` loader) is the only module outside the layers; anything may
import it.

What each layer is *not* allowed to know:

- `domain` and `validation` know nothing about simulation or persistence.
- `engine` knows nothing about the database, HTTP, files, or what an "intake" is.
- `analysis` reads a finished (or paused) run; it does not drive one.
- `storage` knows about plans and rows, not about intake maths.
- `api` contains no business logic worth testing without HTTP. If a handler grows logic, move
  the logic down a layer and call it.

### Where does new code go?

| You are adding... | It goes in... |
|---|---|
| A field on `Course` or `Student`, a new prerequisite-rule operator | `domain/` (and see the monotonicity warning in [CLAUDE.md](../CLAUDE.md) for rules) |
| A new "this edit is not allowed" check | `validation/plan_validation.py` |
| A change to how a term is simulated | `engine/simulator.py` |
| A new metric or CSV | `analysis/analytics.py` |
| A change to how the intake is chosen | `planner/intake.py` (and update [methodology.md](methodology.md)) |
| A new table or column | `storage/db_models.py` (and update [database.md](database.md)) |
| A new endpoint | `api/app.py` (and update [api.md](api.md)) |
| A new page | `web/src/app/(dashboard)/<name>/page.tsx` |

## 3. Rules that keep it tidy

1. **Respect the layer order.** The architecture test will fail if you do not.
2. **Determinism is sacred.** Same inputs, same outputs, byte for byte. Each student's RNG is
   `Random(seed + student_id)`; parallel code collects results in input order.
3. **One place per concern.** Validation lives in `validation/`, not in endpoints. SQL lives in
   `storage/`, not in `planner/`. Season arithmetic lives in `domain/semester.py`, not inline.
4. **No generated files in git.** `outputs/` and `data/app.db` are produced locally and
   git-ignored.
5. **Docs describe the present.** No change-history notes inside docs; git has the history. A
   number that changes whenever the data does (a recommendation, a graduation rate) does not
   belong in a doc.
6. **Every new behaviour gets a test** in `tests/`, named for the module or feature it covers.

## 4. Repository layout

```
.
├── README.md             What the project is, how to run it
├── CLAUDE.md             Working notes and design record for contributors and AI assistants
├── start.bat             One-click launcher (backend + website) for the department PC
├── run.py                Command-line entry point (baseline run, --intake for the analysis)
├── requirements.txt      Python dependencies
├── pyproject.toml        Package metadata and pytest config
├── .env.example          Optional settings (local LLM for the Advisor, workers, CORS)
│
├── src/                  The Python backend (layered, section 2)
├── web/                  The Next.js website (section 5)
├── data/                 Seed data: curriculum.json, simulation_config.json (app.db is generated)
├── scripts/              One-off maintenance tools (calibrate seats, seed the DB, profile)
├── tests/                pytest suite; one file per module or feature
├── docs/                 Documentation (section 6)
├── references/           The official QU CS study plan and prerequisite flowchart (PDF)
├── outputs/              Generated by run.py; git-ignored
├── .github/              CI / repository automation
├── .claude/              Shared Claude Code settings and hooks
└── .agents/skills/       Project skills for AI assistants
```

## 5. The website (`web/`)

```
web/src/
├── app/(dashboard)/      One folder per page: Intake Planner (home), bottlenecks, walkthrough,
│                         advisor, data, plans, plan-builder, about (methodology)
├── components/           Shared UI. Sub-folders group a page's own pieces:
│   ├── intake/           recommendation card, chart, per-intake table, seat planner, calibration
│   ├── data/             Data-page editors, CSV/Excel import
│   ├── checkpoint/       Walkthrough edit panel
│   ├── plan-builder/     Plan Builder wizard steps
│   ├── scenario-builder/ config editors reused by Plan Builder and the Walkthrough
│   └── settings/         curriculum table pieces
├── lib/                  Contexts (Simulation, Checkpoint, Intake), API client, helpers
└── types/                Shared TypeScript types
```

The browser only ever talks to `/api/backend/*`, which `next.config.ts` rewrites to the FastAPI
server. There is no auth and no secret in the browser.

## 6. Documentation map

| Document | Audience | Answers |
|---|---|---|
| [README](../README.md) | Everyone | What is this, how do I run it |
| [user_guide.md](user_guide.md) | Department staff | How do I use the site each year |
| [methodology.md](methodology.md) | Committee, reviewers | How is the recommendation computed, and how far can it be trusted |
| [architecture.md](architecture.md) | Developers | How is the code organised (this file) |
| [engine.md](engine.md) | Developers | How does one student and one term behave |
| [assumptions.md](assumptions.md) | Reviewers, developers | Every parameter, with its justification |
| [api.md](api.md) | Developers | Every HTTP endpoint |
| [database.md](database.md) | Developers | The SQLite schema and startup migration |
| [CLAUDE.md](../CLAUDE.md) | Contributors, AI assistants | Commands, subsystem design record, constraints |

## 7. Data flow of the two main jobs

**Intake analysis** (`POST /intake-analyses`):
`api` validates and stores an `Analysis` row, `planner/jobs` starts one background worker, which
calls `planner/intake.run_intake_sweep`. That fans every simulation of the sweep across one process
pool of `engine.Simulator` runs, builds the two views, the unlimited-seat reference, the isotonic
fit and the decision rule, and writes the result plus an exact `inputs_snapshot` back through
`storage`. The browser polls `GET /intake-analyses/{id}`.

**Baseline / walkthrough** (`POST /simulate`, `/checkpoint/*`):
`api` loads the active plan from `storage`, `analysis/service.run_simulation` runs the engine in
memory and returns metrics plus the `flow_timeline` the website draws. A checkpoint session
instead pickles the paused `Simulator` into `storage`, so each "advance one term" resumes the same
state in a fresh process.
