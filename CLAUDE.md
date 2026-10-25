# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Purpose

The **CS Intake Planner**: a decision tool Qatar University's CS department runs locally on a department PC to answer **"how many students should we admit in the next CS intake, and what course seats does that number need?"** Computer Engineering may come later as a second program (a separate Plan on the same engine).

Under it is a discrete-term, agent-based simulation of students progressing through the CS curriculum, modeled as a **multi-cohort, steady-state university**: a new cohort is admitted each year, today's student body is rebuilt from the department's real past intakes, seats used by other programs are a permanent background load, and **all cohorts compete for one shared pool of course seats**. The decision layer (`src/intake.py`) sweeps candidate intakes against that engine and returns a recommended intake with uncertainty. Every input is tagged QU data vs estimate, and results built on estimates are marked "illustrative".

Method: [docs/methodology.md](docs/methodology.md). Staff guide: [docs/user_guide.md](docs/user_guide.md). Design: [docs/technical_design.md](docs/technical_design.md). Assumptions: [docs/assumptions.md](docs/assumptions.md). API: [docs/api.md](docs/api.md). Database: [docs/database.md](docs/database.md).

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

## Map

`src/`: `models/` (Course, Student, semester) · `datasource.py` (population) · `rules.py` (prerequisite expressions) · `simulator.py` (engine, 3-phase term loop) · `intake.py` (decision layer) · `jobs.py` (background analyses) · `analytics.py` · `service.py` (`run_simulation`, no file I/O) · `db.py` / `db_models.py` (plans, users, runs) · `api.py` (FastAPI) · `plan_validation.py` / `curriculum_validation.py` (guardrails) · `montecarlo.py` / `parallel.py` · `advisor.py`. `web/`: Next.js site, same-origin via `/api/backend/*`. Full tree: [docs/claude/architecture.md](docs/claude/architecture.md).

## Rules most tasks need

- After first boot the DB (`data/app.db`) is authoritative per plan; `data/*.json` are only the seed. Every endpoint resolves the active plan per request, with no module globals.
- Determinism: student RNG is `Random(seed + student_id)`. Use `utils.spaced_seeds` for multi-seed runs, and keep `ordered_map` results byte-identical to a serial run.
- Eligibility is cached on the assumption it is monotonic (`Student._eligible_codes`). Never add a non-monotonic rule gate (upper CH bound, "not passed X") without invalidating that cache.
- `prerequisites` / `rule_expr` are write-once at course creation; changing them later returns 422.
- Every write path validates through `plan_validation.py` (cohort size, load limits, occupancy <= capacity).
- `personal_semester` counts mandatory terms only; only mandatory seasons admit; structural bottleneck rankings use the mandatory-only counters.
- Keep the four block signals separate: fail, capacity, offering, prereq.
- The AI never produces the intake number, and the LLM advisor never writes: it proposes, the user tests and applies.
- Tests: `py -m pytest tests/`. Jobs run inline with `INTAKE_JOBS_INLINE=1` and `INTAKE_WORKERS=1`.

## Deeper reference

Read the file for the area you are changing. Nothing was removed from these; they hold what used to live here.

| File | Read when |
|---|---|
| [docs/claude/architecture.md](docs/claude/architecture.md) | touching any module under `src/` or the layout of `web/` |
| [docs/claude/frontend-and-data-flow.md](docs/claude/frontend-and-data-flow.md) | touching `SimulationContext`, the roadmap graph, `data/app.db` seeding, or `service.run_simulation` |
| [docs/claude/seasons-and-terms.md](docs/claude/seasons-and-terms.md) | touching optional terms, `personal_semester`, capacity scaling or the mandatory-only bottleneck rankings |
| [docs/claude/cohorts-and-initial-state.md](docs/claude/cohorts-and-initial-state.md) | touching admissions, incumbents, `past_intakes`, occupancy or data tags |
| [docs/claude/plans-and-validation.md](docs/claude/plans-and-validation.md) | touching plans, curriculum CRUD, the prerequisite lock, guardrails or Plan Builder |
| [docs/claude/term-loop-and-signals.md](docs/claude/term-loop-and-signals.md) | touching enrollment, seat allocation, the four block signals or scenarios |
| [docs/claude/intake-planner.md](docs/claude/intake-planner.md) | touching `src/intake.py`, `src/jobs.py`, seat plans or `POST /intake-analyses` |
| [docs/claude/advisor.md](docs/claude/advisor.md) | touching the advisor panel, advisor chat, proposals or `src/advisor.py` |
| [docs/claude/checkpoint-mode.md](docs/claude/checkpoint-mode.md) | touching the Walkthrough page or any `/checkpoint` endpoint |
| [docs/claude/performance.md](docs/claude/performance.md) | touching parallelism, Monte Carlo, the eligibility cache or analysis runtime |
| [docs/claude/curriculum-and-outputs.md](docs/claude/curriculum-and-outputs.md) | touching curriculum data, offering rules, grading or `outputs/` |
