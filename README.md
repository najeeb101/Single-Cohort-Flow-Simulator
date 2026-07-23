# CS Flow Simulator — Multi-Cohort University Model

A discrete-term, agent-based simulation of students progressing through Qatar University's
Bachelor of Science in Computer Science (2024 study plan) over up to 12 semesters each.

**Research question:** *which prerequisite chains and scheduling constraints contribute most to
student delay and non-completion?*

It models a **steady-state university**: a new cohort is admitted every year, the university
starts **partly full of a pre-existing student body defined by an admin-entered initial state**
(seats already occupied per course — see `docs/technical_design.md`'s Initial-State Model)
rather than by simulated incumbent cohorts, and **all cohorts compete for one shared pool of
course seats** — so a delayed senior
class starves incoming freshmen of gateway seats and congestion compounds cohort over cohort.
Rather than reporting only a graduation rate, the simulator separates **why** students get stuck
into four independent signals — course failures, capacity denials, seasonal offering mismatches,
and unmet prerequisites — so each bottleneck points to a different fix.

An included **Next.js dashboard** (`web/`) lets you advance the active plan one semester at a
time from the main Dashboard page — editing capacity, pass rates, occupancy, and next intake
between steps (Semester Checkpoint Mode), with headline KPIs/per-cohort outcomes/admissions
recommendation and the Bottlenecks page updating live off that in-progress walkthrough — while a
full 12-semester baseline run powers Advisor and Figures (and Bottlenecks/Auto-fill before any
walkthrough has been started).

---

## Key results (baseline, seed 42 · 8 study cohorts of 100 admitted yearly, initial-state warm start)

| Metric | Value |
|---|---|
| Graduation rate (study cohorts, within 12 semesters) | **63.1%** |
| Average graduation time | 9.3 semesters |
| On-time rate (≤ 8 semesters) | 23.4% |
| Academic dropout | 14.9% |
| Censored (hit 12-semester horizon) | 22.0% |
| Monte Carlo (30 seeds) | graduation **65.5%**, 95% CI 65.0–66.0% |
| Admissions recommendation | ~6 students/year (at current capacity) |

The residual delay/non-completion comes from **once-a-year scheduling**: 8 core courses are
single-term (Fall-only {CMPS200, CMPS310, CMPE355, CMPS380}, Spring-only {CMPE263, CMPS323,
CMPS351, CMPS405}), matching QU's real schedule. A student who falls behind on the shared seat
pool reaches one of these off-cycle and loses a **full year**, which is what censors the tail —
so the required sequence is sized to peak demand (adequately seated) and the 22 non-CS service
courses run in **Summer** as a catch-up path. Lower a course's `capacity` in `curriculum.json`
(or Settings) to study a capacity bottleneck. Re-run `py run.py` any time the config changes —
these numbers are a snapshot of today's default plan, not a fixed constant.

---

## Requirements

- **Python 3.11+**
- `matplotlib`, `networkx` (plotting), `pytest` (tests)
- `fastapi`, `uvicorn`, `sqlalchemy` (HTTP API + SQLite persistence, both optional)

## Installation

```bash
# from the project root
py -m pip install -r requirements.txt
```

> On macOS/Linux use `python3` instead of `py`.

---

## How to run

### Run the full simulation

```bash
py run.py
```

This runs the baseline scenario and writes all outputs to `outputs/` plus the dashboard data file:

```
outputs/
├── figures/
│   ├── university_enrollment.png     # whole-university population over the global timeline
│   ├── cohort_flow.png               # per-cohort head-count (later cohorts lag)
│   ├── utilization_heatmap.png       # course × semester seat utilization
│   ├── graduation_histogram.png      # time-to-graduate distribution
│   ├── bottlenecks_<scenario>.png    # 4-panel: fail / capacity / offering / prereq blocks, one per scenario
│   └── curriculum_network.png        # prerequisite graph, shaded by failure count
└── reports/
    ├── simulation_summary.csv        # headline metrics + top bottleneck per signal, one row per scenario
    ├── cohort_flow.csv               # per-cohort, per-semester ledger
    ├── cohort_summary.csv            # per-cohort outcomes + where each got stuck
    ├── course_utilization.csv        # course × semester demand vs. capacity
    ├── monte_carlo.csv               # mean ± 95% CI over many seeds
    └── flow_timeline.json            # frontend contract for the scenario that feeds the dashboard (web/ fetches the same shape from POST /simulate)
```

To view the animated flow chart + dashboard, see "Run the Next.js dashboard" below.

### Run the tests

```bash
py -m pytest tests/ -v
```

220+ tests cover determinism, the 120-credit-hour reconciliation, graduation detection,
prerequisite logic, capacity allocation, probation, the multi-cohort layer (staggered
admissions, the initial-state warm start, shared-seat priority, per-cohort metrics, the
admissions recommendation, the timeline-JSON contract, and Monte Carlo), the generic
rule-expression evaluator, the historical-transcript export, optional Winter/Summer terms,
the multi-plan model, the `run_simulation()` service boundary, the FastAPI wrapper, the
prerequisite write-once lock and cross-object plan-edit guardrails, and Semester Checkpoint
Mode's resumable engine + `/checkpoint` API.

### Run the HTTP API (optional)

```bash
py -m uvicorn src.api:app --reload --port 8001
```

A thin wrapper around the same engine (`GET /health`, `GET /meta`, `POST /simulate`, plus
curriculum/config/plans/live-simulation endpoints backed by a SQLite database). No login is
required — every request resolves to a single shared demo user. See
[docs/api.md](docs/api.md) for the full endpoint reference and
[docs/database.md](docs/database.md) for the schema.

### Run the Next.js dashboard (optional, Phase 2)

```bash
# with the API above already running
cd web && npm install && npm run dev
```

Open `http://localhost:3000` — **not** `http://127.0.0.1:3000`, Next.js 16's dev server
blocks cross-origin dev requests from origins outside `allowedDevOrigins`. This is a
from-scratch React/TypeScript port of: the turn-based Dashboard (Semester Checkpoint Mode —
advance one semester at a time, editing capacity/pass-rate/occupancy/next-intake in a modal
between steps, with an inline curriculum roadmap and collapsible headline-KPIs/admissions-
recommendation/per-cohort-table/prerequisite-network sections showing results so far), the
Bottlenecks page (top-bottleneck cards, capacity recommendations, and an Auto-fill solver — both
this page and the Dashboard's sections read the in-progress checkpoint session live when one
exists, falling back to a full 12-semester baseline run otherwise), the Advisor's grounded chat
with a test-then-apply what-if flow, and the static figures (university population over time,
per-cohort flow, time-to-graduate distribution, seat-utilization heatmap, and the prerequisite
network shaded by failure count) as React/SVG — talking to the API directly, it does not read
`outputs/`. See `web/README.md` (generated by `create-next-app`) for the standard Next.js
scripts.

**First run:** if `initial_state.occupancy` hasn't been set yet, the dashboard opens on a
required setup screen instead of the checkpoint walkthrough — enter today's real department
numbers (or leave everything at 0 for a from-scratch university) before the simulation panel
unlocks. A "paste or upload CSV" import fills in a batch of courses at once (`code,value` rows,
each code setting its occupancy) instead of hand-typing all ~41 rows. The same editor is
reachable again any time afterward from **Settings**.

---

## Configuration

All inputs are data-driven — no code changes needed to re-tune the model:

| File | Contents |
|---|---|
| `data/curriculum.json` | The 41 courses (real QU CS roadmap): prerequisites, offering seasons, pass rates, per-course capacities. **Source of truth.** |
| `data/simulation_config.json` | Cohort size, seed, load caps, probation/dropout rules, grade distributions, and the multi-cohort settings below. |

> After first API startup these two files only seed `data/app.db` (gitignored SQLite) — from
> then on the DB is authoritative. Re-run `py scripts/migrate_json_to_db.py --force` after
> hand-editing either file to resync the default plan.

Key multi-cohort knobs in `simulation_config.json`:

| Key | Meaning |
|---|---|
| `num_cohorts` | study cohorts admitted, one per year (default 8, for a steady state) |
| `num_incumbent_cohorts` | prior cohorts seeded before term 0 as a warm start (default **0** — the default plan warm-starts via `initial_state` instead, see below) |
| `initial_state` | `{occupancy: {code: seats}}` — the admin-entered pre-existing student body (see `docs/technical_design.md`) |
| `admission_terms` | seasons that admit a new cohort — `["Fall"]` (yearly) or `["Fall", "Spring"]` (a second yearly intake); mandatory seasons only, never Summer |
| `admission_sizes` | optional per-season intake size, e.g. `{"Spring": 40}` (a season absent uses `cohort_size`) |
| `admission_targets` | health thresholds driving the intake recommendation |
| `monte_carlo` | `{enabled, n_runs, base_seed}` for confidence intervals |

Per-course seat capacity lives on each course's own `capacity` field in `curriculum.json`
(auto-calibrated by `scripts/size_capacity.py`, then hand-tunable). To experiment, edit a
course's `capacity` or `offering`, then re-run `py run.py`. To re-derive capacity from demand,
run `py scripts/size_capacity.py`.

---

## Project structure

```
src/
├── models/
│   ├── course.py        # Course dataclass + load_curriculum()
│   ├── student.py       # Student state, GPA, eligibility, cohort_id/entry_term, curriculum_stage()
│   └── semester.py      # term index → season + year (config-driven, supports optional terms)
├── datasource.py         # DataSource seam: canonical schema + SyntheticDataSource (population creation)
├── rules.py              # evaluate_rule() / gate_edges() — generic compound prerequisite expressions
├── simulator.py          # Simulator (staggered admission + 3-phase per-term loop) + History
├── analytics.py          # metrics, per-cohort metrics, admissions rec, curriculum graph, flow_timeline JSON, CSVs
├── service.py            # run_simulation() — no-file-I/O engine boundary; what api.py calls
├── db.py                 # SQLAlchemy engine/session, plan-scoped loaders
├── db_models.py          # User/Plan/Course/AppConfig/Scenario/Run ORM tables
├── auth.py               # No-op auth — resolves every request to one shared demo user
├── curriculum_validation.py  # check_no_cycle() — prerequisite-cycle check for edits/imports
├── scenarios.py          # Persistent /scenarios + /runs endpoints
├── api.py                # FastAPI wrapper: /health, /meta, /simulate, /curriculum, /config,
│                         # /plans, /scenarios, /runs — see docs/api.md
├── montecarlo.py         # run_monte_carlo() — mean ± 95% CI over many seeds
├── visualize.py          # figure generation
└── utils.py              # load_json(), grade_tier()

web/         Next.js/TypeScript dashboard — turn-based Checkpoint Mode Dashboard, Bottlenecks,
             Advisor, Settings, Plans, Plan Builder; talks to src/api.py; static figures
             ported as React/SVG
data/        curriculum.json, simulation_config.json
outputs/     figures/ and reports/ (generated by run.py)
scripts/     size_capacity.py, migrate_json_to_db.py
tests/       pytest suite (220+ tests)
docs/        project_overview.md, technical_design.md, assumptions.md, code_walkthrough.md,
             api.md, database.md, progress_report.md
run.py       entry point
```

---

## How the model works (in brief)

A new cohort is admitted each year onto one shared seat pool; the university starts partly full
via an admin-entered initial state (occupied seats per course for the pre-existing student
body). Each term runs a three-phase loop over **all** active students
from every cohort:

1. **Desired enrollment** — every active student builds a priority-ordered wish-list
   (retakes → required CS → electives → filler), capped at 18 credit hours (12 on probation).
2. **Seat allocation** — when demand exceeds a course's capacity, students are ranked by
   completed credit hours (QU's registration priority), so seniors from older cohorts outrank
   freshmen; the overflow is logged as a capacity block.
3. **Outcome resolution** — pass/fail is drawn against each student's ability-adjusted pass rate;
   passers receive a sampled letter grade. Dropout, probation, graduation (on each student's own
   12-semester clock), and the four block signals are then updated.

Every student owns a fixed random stream seeded by `seed + student_id` (**Common Random Numbers**),
so the simulation is fully **deterministic**. Full mechanics:
[docs/technical_design.md](docs/technical_design.md).

---

## Documentation

- **[docs/project_overview.md](docs/project_overview.md)** — what the project is, how the simulation works, design tradeoffs, and known limitations. Deliberately has no point-in-time output numbers (those depend on the active configuration and go stale the moment it changes) — run the simulation for today's actual figures.
- **[docs/technical_design.md](docs/technical_design.md)** — model architecture and execution walkthrough.
- **[docs/code_walkthrough.md](docs/code_walkthrough.md)** — deep code-level reference (real function signatures and snippets, module by module), for reading alongside the source.
- **[docs/assumptions.md](docs/assumptions.md)** — every assumption and parameter, with justification.
- **[docs/api.md](docs/api.md)** — every HTTP endpoint (`/simulate`, `/curriculum`, `/plans`, ...), request/response shapes, and status codes.
- **[docs/database.md](docs/database.md)** — the SQLite schema (`User`/`Plan`/`Course`/`AppConfig`/`Scenario`/`Run`) and how it relates to the JSON seed files.
