# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Purpose

Single-Cohort Flow Simulator models 100 students progressing through Qatar University's Computer Science curriculum over up to 12 semesters. The research question is: **which prerequisite chains contribute most to student delay and non-completion?**

The full specification is in [project_plan.md](project_plan.md).

## Tech Stack

- Python with NumPy (simulation), Pandas (analysis), Matplotlib + Seaborn (charts), NetworkX (curriculum graph)
- Optional: Streamlit dashboard
- Fixed random seed (`random.seed(42)`) for reproducibility across all runs

## Commands

```bash
# Run the simulation
python main.py

# Install dependencies
pip install numpy pandas matplotlib seaborn networkx streamlit

# Run a specific scenario
python main.py --scenario B   # or A (baseline) / C (summer retakes)
```

## Architecture

Three core classes defined in [project_plan.md](project_plan.md):

**`Student`** — tracks `id`, `current_semester`, `completed_courses`, `failed_courses`, `gpa`, and `status` (Active / Delayed / Dropped / Graduated).

**`Course`** — holds `code`, `credits`, `prerequisites` (list of course codes), and `pass_rate`.

**`Simulator`** — orchestrates everything:
- `generate_students()` — creates the initial 100-student cohort
- `run_semester()` — advances all active students one semester, enrolling eligible courses and resolving pass/fail probabilistically
- `process_failures()` — applies dropout rules (40% dropout if same course failed 3×; 20% dropout if delayed >4 semesters)
- `produce_statistics()` — aggregates per-course delay counts, cohort funnel data, and graduation timelines

## Curriculum Prerequisite Chains

Three chains share a common root (CMPS151 → CMPS251):

- **Programming**: CMPS251 → CMPS303 → CMPS323
- **Systems**: CMPS251 → CMPS303 → CMPS405
- **Software Engineering**: CMPS251 → CMPS350 → CMPS310 → CMPS493 → CMPS499

CMPS303 (Data Structures) is the primary bottleneck — it gates both the Programming and Systems paths.

## Key Simulation Rules

- Max 5 courses per semester; prerequisites must be satisfied before enrollment
- Failed courses must be retaken before taking dependent courses
- Pass rates: introductory 90%, programming 80%, data structures 70%, algorithms/OS 65%, senior project 85%

## Experimental Scenarios

- **A (baseline)**: default pass rates
- **B**: Data Structures pass rate raised 70% → 80%
- **C**: Summer semester added, allowing failed-course retakes between regular semesters

## Visualizations

Four outputs expected from `visualizations.py`:
1. NetworkX curriculum graph — node size = students blocked, large red nodes = bottlenecks
2. Bottleneck ranking table (courses × students delayed)
3. Cohort funnel (attrition per year: 100 → ~92 → ~81 → ~71 → ~63 → ~58)
4. Graduation timeline histogram (8 / 9 / 10 semesters + dropped out)
