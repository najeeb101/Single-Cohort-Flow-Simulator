# CS Flow Simulator — Multi-Cohort University Model

A discrete-term, agent-based simulation of students progressing through Qatar University's
Bachelor of Science in Computer Science (2024 study plan) over up to 12 semesters each.

**Research question:** *which prerequisite chains and scheduling constraints contribute most to
student delay and non-completion?*

It models a **steady-state university**: a new cohort is admitted every year, several incumbent
cohorts are seeded as a warm start, and **all cohorts compete for one shared pool of course seats**
— so a delayed senior class starves incoming freshmen of gateway seats and congestion compounds
cohort over cohort. Rather than reporting only a graduation rate, the simulator separates **why**
students get stuck into four independent signals — course failures, capacity denials, seasonal
offering mismatches, and unmet prerequisites — so each bottleneck points to a different fix.

An included **Next.js dashboard** (`web/`) animates the prerequisite flow chart semester by semester
and ends in a dashboard with per-cohort outcomes and a next-year admissions recommendation.

---

## Key results (baseline, seed 42 · 4 study + 3 incumbent cohorts of 100 · 35 seats/section)

| Metric | Value |
|---|---|
| Graduation rate (study cohorts, within 6 years) | **~71%** (QU benchmark: 72.3%) |
| Average graduation time | ~8.8 semesters |
| On-time rate (≤ 8 semesters) | ~35% |
| Academic dropout (3 fails of a course → 25% per extra fail) | ~27% |
| Censored (hit 12-semester horizon) | ~2% |
| Monte Carlo (30 seeds) | graduation **69.1%**, 95% CI 68.5–69.7% |
| Admissions recommendation | ~57 students/year |

Course capacity is modelled as **sections** (`course_sections × seats_per_section`), auto-calibrated
to each course's peak demand — so the baseline is an *adequately-resourced* university and the
residual delay comes from **prerequisite chains** (the **CMPS 303** gateway, which blocks three
downstream courses) and **once-a-year scheduling** (six Fall-only/Spring-only courses) rather than
raw seat shortage. Trim a course's sections in `course_sections` to study a capacity bottleneck.

---

## Requirements

- **Python 3.11+**
- `matplotlib`, `networkx` (plotting), `pytest` (tests)
- `pandas` *(optional — only for the external QU-data validation script)*

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

75 tests cover determinism, the 120-credit-hour reconciliation, graduation detection,
prerequisite logic, capacity allocation, probation, the multi-cohort layer (staggered
admissions, the incumbent warm start, shared-seat priority, per-cohort metrics, the admissions
recommendation, the timeline-JSON contract, and Monte Carlo), the generic rule-expression
evaluator, the historical-transcript export, the `run_simulation()` service boundary, and the
FastAPI wrapper.

### Run the HTTP API (optional)

```bash
py -m uvicorn src.api:app --reload --port 8001
```

A thin wrapper (`GET /health`, `GET /meta`, `POST /simulate`) around the same engine, with
no database or auth — see `docs/roadmap.md` §2.3/§3.2 for where this is headed.

### Run the Next.js dashboard (optional, Phase 2)

```bash
# with the API above already running
cd web && npm install && npm run dev
```

Open `http://localhost:3000` — **not** `http://127.0.0.1:3000`, Next.js 16's dev server
blocks cross-origin dev requests from origins outside `allowedDevOrigins`. This is a
from-scratch React/TypeScript port of the headline KPIs, bottlenecks, per-cohort table,
admissions recommendation, live what-if sliders, the animated semester-by-semester
curriculum graph (playback controls, narrative panel, per-cohort stage/flow side panel),
and the static figures (university population over time, per-cohort flow, time-to-
graduate distribution, seat-utilization heatmap, and the prerequisite network shaded by
failure count) as React/SVG — talking to the API directly, it does not read `outputs/`.
See `web/README.md` (generated by `create-next-app`) for the standard Next.js scripts.

### (Optional) Recompute the real-world QU benchmark

```bash
py -m pip install pandas
py scripts/analyze_qu_data.py
```

Computes QU's actual CS graduation rate from open enrollment data in `data/qu_raw/`.
Used only to validate the simulation — never as a model input.

---

## Configuration

All inputs are data-driven — no code changes needed to re-tune the model:

| File | Contents |
|---|---|
| `data/curriculum.json` | The 38 courses: prerequisites, offering seasons, pass rates, per-cohort capacities. **Source of truth.** |
| `data/simulation_config.json` | Cohort size, seed, load caps, probation/dropout rules, grade distributions, and the multi-cohort settings below. |

Key multi-cohort knobs in `simulation_config.json`:

| Key | Meaning |
|---|---|
| `num_cohorts` | study cohorts admitted (default 4) |
| `num_incumbent_cohorts` | prior cohorts seeded before term 0 as a warm start (default 3) |
| `admit_interval_terms` | terms between admissions (2 = yearly, Fall) |
| `seats_per_section` | class size; per-term seats for a course = `course_sections[code] × seats_per_section` |
| `course_sections` | per-course number of sections (auto-calibrated by `scripts/size_sections.py`, then hand-tunable) |
| `admission_targets` | health thresholds driving the intake recommendation |
| `monte_carlo` | `{enabled, n_runs, base_seed}` for confidence intervals |

To experiment, edit a value — e.g. add a section to a bottleneck course in `course_sections`, change a course's `offering`, or adjust `seats_per_section` — and re-run `py run.py`. To re-derive the section counts from demand, run `py scripts/size_sections.py`.

---

## Project structure

```
src/
├── models/
│   ├── course.py        # Course dataclass + load_curriculum()
│   ├── student.py       # Student state, GPA, eligibility, cohort_id/entry_term, curriculum_stage()
│   └── semester.py      # term index → Fall/Spring season + year
├── datasource.py         # DataSource seam: canonical schema + SyntheticDataSource (population creation)
├── rules.py              # evaluate_rule() / gate_edges() — generic compound prerequisite expressions
├── simulator.py          # Simulator (staggered admission + 3-phase per-term loop) + History
├── analytics.py          # metrics, per-cohort metrics, admissions rec, curriculum graph, flow_timeline JSON, CSVs
├── service.py            # run_simulation() — no-file-I/O engine boundary; what api.py calls
├── api.py                # FastAPI wrapper: GET /health, /meta, POST /simulate (no DB/auth)
├── montecarlo.py         # run_monte_carlo() — mean ± 95% CI over many seeds
├── visualize.py          # figure generation
└── utils.py              # load_json(), grade_tier()

web/         Next.js/TypeScript dashboard (Phase 2) — animated flow chart + dashboard,
             talks to src/api.py; all static figures ported as React/SVG
data/        curriculum.json, simulation_config.json, qu_raw/ (validation data)
outputs/     figures/ and reports/ (generated by run.py)
scripts/     size_sections.py, analyze_qu_data.py
tests/       pytest suite (75 tests)
docs/        project_overview.md, technical_design.md, assumptions.md, roadmap.md
run.py       entry point
```

---

## How the model works (in brief)

A new cohort is admitted each year onto one shared seat pool; incumbent cohorts are seeded at
negative terms so the university starts partly full. Each term runs a three-phase loop over **all**
active students from every cohort:

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
- **[docs/assumptions.md](docs/assumptions.md)** — every assumption and parameter, with justification.
- **[docs/roadmap.md](docs/roadmap.md)** — the plan for turning this into a deployable multi-tenant product, and what's already built toward it (`DataSource` seam, engine-as-a-service, FastAPI wrapper).
