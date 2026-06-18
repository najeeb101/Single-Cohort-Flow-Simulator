# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Purpose

A discrete-term, agent-based simulation of students progressing through Qatar University's Computer Science curriculum over up to 12 semesters each. Research question: **which prerequisite chains and scheduling constraints contribute most to student delay and non-completion?**

It now models a **multi-cohort, steady-state university**: a new cohort is admitted each year, several incumbent cohorts are seeded before the study window as a warm start, and **all cohorts compete for one shared pool of course seats**. The engine emits a frontend-ready per-semester data file that an included web app animates.

Full design document: [docs/technical_design.md](docs/technical_design.md)
Assumptions log: [docs/assumptions.md](docs/assumptions.md)

## Commands

```bash
# Run the full simulation (writes outputs/ + frontend/flow_timeline.json)
py run.py

# View the animated flow chart + dashboard
cd frontend && py -m http.server 8000     # then open http://localhost:8000

# Re-calibrate course_sections to peak demand (writes into simulation_config.json)
py scripts/size_sections.py

# Run tests
py -m pytest tests/ -v

# Install dependencies
py -m pip install matplotlib networkx pytest
```

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
├── montecarlo.py         # run_monte_carlo() — mean ± 95% CI over many seeds
├── visualize.py          # save_all_figures() + per-figure functions
└── utils.py              # load_json(), grade_tier()
frontend/              # dependency-free web app: index.html, style.css, app.js (reads flow_timeline.json)
```

`data/curriculum.json` is the source of truth — 38 courses, 120 CH total. Never overwrite it.
`data/simulation_config.json` holds all tunable parameters.
`src/service.py::run_simulation(curriculum, config, scenario) -> dict` runs one scenario in memory (no file I/O) and returns `result`/`metrics`/`cohort_metrics`/`admissions_recommendation`/`flow_timeline`; `run.py` calls it, then passes the result to `analytics.py`/`visualize.py`'s writers, which remain the only place that touches disk.

## Multi-Cohort Model

- **Admissions**: `num_cohorts` study cohorts of `cohort_size` enter every `admit_interval_terms` (default: 4 cohorts, yearly). `num_incumbent_cohorts` prior cohorts enter at **negative** terms as a warm start, so gateway courses are already partly occupied when study cohort 0 arrives.
- **Global clock** runs `start_term = -num_incumbent_cohorts*admit_interval` .. `end_term`. `term_season` handles negative indices (`-6 % 2 == 0` → Fall).
- **Personal time**: graduation/DELAYED/CENSORED use `personal_semester = global_term - entry_term + 1`. A student gets exactly `max_terms` semesters from their own entry.
- **Cohort ids**: study cohorts `0..n-1`; incumbents `-1,-2,-3`. Globally-unique `student_id = (cohort_id + num_incumbent_cohorts)*cohort_size + i`; RNG seed `seed + student_id` (CRN preserved).
- **Sections model**: per-term seats for a course = `course_sections[code] × seats_per_section` (config). `course_sections` is auto-calibrated to peak demand by `scripts/size_sections.py` (writes the map into the config) and then hand-tunable — add a section to a course to relieve it. This replaces the old global `capacity_scale` multiplier with realistic, course-specific, adjustable section counts. A course missing from the map falls back to `ceil(curriculum capacity / seats_per_section)`.
- **Headline metrics are scoped to study cohorts** (`entry_term >= 0`); incumbents are a warm-start device and appear only in the per-cohort ledger.

## Per-Term Loop (three phases)

1. **Desired enrollment** — each active student (all cohorts) builds a priority-ordered list: retakes first, then `enrollment_priority_tiers` (config-defined category sets, each with an optional `min_ch` gate; QU CS default: cs_core/college_req > cs_elective at 60+ CH > math/science/english/gen_ed) subject to their load cap.
2. **Seat allocation** — sort requesters by `(registration_tier(completed_ch), tiebreak_token)`; grant first `effective_capacity`; record `capacity_block` for the rest. Seniors from older cohorts outrank freshmen automatically.
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
| A_baseline | Default pass rates and capacity |

A single baseline scenario. `capacity_multiplier`, `capacity_overrides`, `offering_overrides`, and `pass_rate_overrides` per-scenario hooks exist in the engine for future what-if experiments.

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
frontend/flow_timeline.json   # copy the web app reads
```

`flow_timeline.json` is the frontend contract: `meta` (stage nodes, cohorts, prerequisite `graph`), `frames` (one per semester: per-course stats + per-cohort stage nodes/flows), and `summary` (headline metrics + CIs, per-cohort metrics + bottlenecks, admissions recommendation).
