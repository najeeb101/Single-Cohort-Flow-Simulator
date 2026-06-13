# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Purpose

Single-Cohort Flow Simulator models 100 students progressing through Qatar University's Computer Science curriculum over up to 12 semesters. Research question: **which prerequisite chains and scheduling constraints contribute most to student delay and non-completion?**

Full design document: [docs/technical_design.md](docs/technical_design.md)  
Assumptions log: [docs/assumptions.md](docs/assumptions.md)

## Commands

```bash
# Run the full simulation (all 4 scenarios, writes outputs/)
py run.py

# Run tests
py -m pytest tests/ -v

# Install dependencies
py -m pip install matplotlib networkx pytest
```

## Architecture

```
src/
├── models/
│   ├── course.py      # Course dataclass + load_curriculum()
│   ├── student.py     # Student (state, GPA, enrollment logic, registration_tier())
│   └── semester.py    # term_season(), term_year(), term_label()
├── simulator.py       # Simulator (3-phase per-term loop) + History + SimulationResult
├── analytics.py       # compute_metrics(), build_summary_csv() — no plotting
├── visualize.py       # save_all_figures() + per-figure functions
└── utils.py           # load_json(), grade_tier()
```

`data/curriculum.json` is the source of truth — 38 courses, 120 CH total. Never overwrite it.  
`data/simulation_config.json` holds all tunable parameters and scenario definitions.

## Per-Term Loop (three phases)

1. **Desired enrollment** — each student builds a priority-ordered list (retakes > cs_core > electives > non_cs) subject to their load cap.
2. **Seat allocation** — sort requesters by `(registration_tier(completed_ch), tiebreak_token)`; grant first `effective_capacity`; record `capacity_block` for the rest.
3. **Take courses** — resolve pass/fail via student RNG, sample grade tier, update GPA/probation/status.

## Four Block Signals (never merged)

| Signal | Meaning |
|---|---|
| `fail_counts` | Student attempted and failed |
| `capacity_block_counts` | Requested seat but lost allocation |
| `offering_block_counts` | Eligible but course not taught this term |
| `prereq_block_counts` | Prerequisites not yet satisfied |

## Scenarios (in simulation_config.json)

| Name | Change |
|---|---|
| A_baseline | Default pass rates and capacity |

## Key Constraints

- **Spring-only:** CMPS323, CMPS405, CMPS351. **Fall-only:** CMPS310, CMPS380, CMPE355. All other courses (incl. CMPS493, CMPS499) are offered Fall + Spring.
- CMPS303 is the gateway course: it is the prerequisite for CMPS323, CMPS380, CMPS405 (unlocks exactly these three)
- CMPS493 compound rule: requires CMPS310 + (CMPS350 OR CMPS405) + completed_ch ≥ 84
- D or better satisfies any prerequisite
- GPA = Σ(grade_points × credits) / Σ(all_attempted_credits) — F = 0.0 pts included in denominator
- CRN: each student RNG is re-instantiated `random.Random(seed + student_id)` at the start of every scenario

## Outputs

```
outputs/
├── figures/    funnel.png, graduation_histogram.png, bottlenecks_<scenario>.png, curriculum_network.png, stage_flow_<scenario>.png
└── reports/    simulation_summary.csv
```
