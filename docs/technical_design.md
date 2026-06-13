# Technical Design Document
## Single-Cohort Flow Simulator — Qatar University CS Program

---

## 1. Curriculum Analysis

### Source Documents
- `references/2024-CS-StudyPlan.pdf` — semester-by-semester layout, credit hours, graduation requirements
- `references/2024-CS-Prerequisite-Flowchart.pdf` — prerequisite dependency graph, concurrent prerequisites

### Degree Summary (from PDF)
| Category | Credit Hours | Courses |
|---|---|---|
| Core Curriculum Requirements | 33 | 11 |
| College Requirements | 21 | 9 |
| Major Core Requirements | 49 | 15 |
| Major Electives | 12 | 4 |
| Major Supporting Requirements | 5 | 2 |
| **Total** | **120** | **41** |

### Senior Project Eligibility (Special Rule)
A student may only register for CMPS 493 after satisfying **all three** conditions simultaneously:
- Completed ≥ 84 credit hours
- Passed CMPS 310 (Software Engineering)
- Passed CMPS 350 (Web Development) **OR** CMPS 405 (Operating Systems)

---

## 2. Extracted Course Catalog

### CS Major Core Courses (15 courses, 49 CH) — Simulated in Full Detail

CMPS 200, CMPS 205, and CMPS 307 are **not** Major Core — see category note below.

| Code | Title | CH | Prerequisites | Offering | Category |
|---|---|---|---|---|---|
| CMPS 151 | Programming Concepts | 3 | — | Fall + Spring | cs_core |
| CMPS 200 | Computer Ethics | 1 | — | Fall + Spring | cs_core |
| CMPS 205 | Discrete Structures | 3 | — | Fall + Spring | cs_core |
| CMPS 251 | Object-Oriented Programming | 4 | CMPS151 | Fall + Spring | cs_core |
| CMPS 303 | Data Structures | 4 | CMPS251 | Fall + Spring | cs_core |
| CMPS 323 | Design and Analysis of Algorithms | 3 | CMPS303, CMPS205 | **Spring only** | cs_core |
| CMPE 263 | Computer Architecture and Organization I | 3 | CMPS303 | Fall + Spring | cs_core |
| CMPS 351 | Fundamentals of Database Systems | 4 | CMPS303 | Fall + Spring | cs_core |
| CMPS 310 | Software Engineering | 4 | CMPS303 | Fall + Spring | cs_core |
| CMPE 355 | Data Communication & Computer Networks I | 4 | CMPE263 | Fall + Spring | cs_core |
| CMPS 380 | Cybersecurity Fundamentals | 3 | CMPS303 | Fall + Spring | cs_core |
| CMPS 405 | Operating Systems | 4 | CMPS303 | **Spring only** | cs_core |
| CMPS 350 | Web Development Fundamentals | 3 | CMPS251 | Fall + Spring | cs_core |
| CMPS 493 | Senior Project I | 3 | see §1 special rule | **Fall only** | cs_core |
| CMPS 499 | Senior Project II | 3 | CMPS493 | **Spring only** | cs_core |

**Category note**: CMPS200 (1 CH) and CMPS205 (3 CH) are counted as cs_core above, which yields exactly 49 CH / 15 courses matching the study plan. CMPS307 (2 CH) and MAGT101 (3 CH) are Major Supporting (5 CH, 2 courses) — they appear below in the pseudo-course table.

### Major Electives (4 slots, 12 CH)
Four abstract `ELEC_1` through `ELEC_4` (3 CH each). Available once the student has completed ≥ 60 CH. No course prerequisites. Offering: Fall + Spring.

### Non-CS Courses — Expanded as Pseudo-Courses

Bundles are expanded into individual pseudo-courses so that:
- Each has an exact credit-hour value
- Prerequisite chains within bundles are explicit
- "Blocked" detection works the same way as for CS courses
- Credit accounting is trivially verifiable

| Code | Covers | CH | Prerequisites | Offering |
|---|---|---|---|---|
| MATH_1 | MATH101 Calculus I | 3 | — | Fall + Spring |
| MATH_2 | MATH102 Calculus II | 3 | MATH_1 | Fall + Spring |
| MATH_3 | MATH231 Linear Algebra | 3 | MATH_1 | Fall + Spring |
| MATH_4 | GENG200 Probability & Statistics | 3 | MATH_2 | Fall + Spring |
| MATH_5 | GENG300 Numerical Methods | 3 | MATH_4 | Fall + Spring |
| PHYS_1 | PHYS191 + PHYS192 Physics I | 4 | — | Fall + Spring |
| PHYS_2 | PHYS193 + PHYS194 Physics II | 4 | PHYS_1 | Fall + Spring |
| CHEM_1 | CHEM101 + CHEM103 Chemistry I | 4 | — | Fall only (Y1) |
| ENGL_1 | ENGL202 English Language I | 3 | — | Fall + Spring |
| ENGL_2 | ENGL203 English Language II | 3 | ENGL_1 | Fall + Spring |
| GED_1 | HIST121 History of Qatar | 3 | — | Fall + Spring |
| GED_2 | ARAB100 Arabic Language I | 3 | — | Fall + Spring |
| GED_3 | Core Knowledge & Skills Package | 3 | — | Fall + Spring |
| GED_4 | DAWA111 Islamic Culture | 3 | — | Fall + Spring |
| GED_5 | Natural Science/Mathematics Package | 3 | — | Fall + Spring |
| GED_6 | Humanities/Fine Arts Package | 3 | — | Fall + Spring |
| GED_7 | Social/Behavioral Sciences Package | 3 | — | Fall + Spring |
| SUPP_1 | CMPS307 Project Management | 2 | — | Fall + Spring |
| SUPP_2 | MAGT101 Principles of Management | 3 | — | Fall + Spring |

### Credit Hour Reconciliation (must equal 120)
| Group | Courses | CH |
|---|---|---|
| CS core (15 courses) | CMPS151…CMPS499 | 49 |
| Major Supporting (2) | CMPS307, MAGT101 | 5 |
| Major Electives (4) | ELEC_1…ELEC_4 | 12 |
| Math sequence (5) | MATH_1…MATH_5 | 15 |
| Physics (2) | PHYS_1, PHYS_2 | 8 |
| Chemistry (1) | CHEM_1 | 4 |
| English (2) | ENGL_1, ENGL_2 | 6 |
| General education (7) | GED_1…GED_7 | 21 |
| **Total** | **38 pseudo-courses + 4 elective slots** | **120** |

---

## 3. Graduation Condition

**Graduation = all required courses/pseudo-courses passed.**

Do **not** use `completed_ch ≥ 120` as a separate gate. Because the catalog is reconciled to exactly 120 CH, completing all courses guarantees 120 CH. A dual gate creates a silent failure mode where the two conditions disagree and graduation rate becomes 0%.

---

## 4. Simulation Assumptions

### 4.1 Cohort
- 100 students, all starting Fall Semester 1
- Maximum study duration: 12 regular semesters (6 academic years)
- Reproducible via fixed seed (default 42)

### 4.2 Common Random Numbers (CRN)

Each student receives their own `random.Random(seed + student_id)`, **re-instantiated fresh at the start of each scenario**. This means student 7 in Scenario A has the same random stream as student 7 in Scenario B — the only differences between scenario outcomes are structural, not random noise. This is what makes scenario comparisons causally valid and is the single most important methodological choice.

```python
for scenario in ['A', 'B', 'C', 'D']:
    for i in range(100):
        rng = random.Random(BASE_SEED + i)   # same seed+i every scenario
        students.append(Student(id=i, rng=rng, ...))
```

### 4.3 Student Ability
Each student has a fixed `ability_score ~ Normal(0, 0.15)`, clipped to `[-0.30, 0.30]`. This shifts all their course pass probabilities consistently:

```
effective_pass_rate = clip(base_pass_rate + ability_score, 0.05, 0.98)
```

Ability is sampled once per student (using their RNG) at cohort creation, before the semester loop begins.

### 4.4 Pass Rates (Base)

| Course | Pass Rate | Course | Pass Rate |
|---|---|---|---|
| CMPS 151 | 0.78 | CMPS 310 | 0.82 |
| CMPS 200 | 0.98 | CMPE 355 | 0.72 |
| CMPS 205 | 0.76 | CMPS 380 | 0.75 |
| CMPS 251 | 0.82 | CMPS 405 | 0.72 |
| CMPS 303 | 0.70 | CMPS 350 | 0.78 |
| CMPS 323 | 0.65 | CMPS 307 | 0.92 |
| CMPE 263 | 0.72 | CMPS 493 | 0.88 |
| CMPS 351 | 0.75 | CMPS 499 | 0.90 |
| ELEC_X | 0.78 | MATH_1…3 | 0.82 |
| MATH_4…5 | 0.78 | PHYS_X | 0.80 |
| CHEM_1 | 0.88 | ENGL_X | 0.90 |
| GED_X | 0.92 | SUPP_X | 0.92 |

### 4.5 Grade Distribution
When a student passes a course, their letter grade is sampled from a weighted distribution based on the **course's base `pass_rate`** (not the student-shifted effective rate — ability affects whether you pass, not which tier the course belongs to):

| Grade | Points | Hard (base ≤ 0.72) | Medium (0.73–0.82) | Easy (> 0.82) |
|---|---|---|---|---|
| A | 4.0 | 8% | 12% | 25% |
| B+ | 3.3 | 15% | 18% | 25% |
| B | 3.0 | 32% | 33% | 25% |
| C+ | 2.3 | 22% | 22% | 12% |
| C | 2.0 | 18% | 13% | 10% |
| D | 1.0 | 5% | 2% | 3% |
| F | 0.0 | (1 − base pass_rate) | | |

### 4.6 Prerequisite Grade Assumption
A grade of **D or better** satisfies a prerequisite. There is no minimum-grade requirement enforced. This is a simplification documented here and in `docs/assumptions.md`.

### 4.7 GPA and Academic Probation
- Cumulative GPA = Σ(grade_points × credits) / Σ(completed_credits)
- **Probation trigger**: `completed_ch ≥ 25 AND gpa < 2.0`
- **Effect**: max semester load reduced to 12 CH (normal: 18 CH)
- **Recovery**: `gpa ≥ 2.0` → normal load restored next semester
- Order of operations each semester: resolve grades → update `completed_ch` → recalculate GPA → check probation → determine next semester's load

### 4.8 Enrollment Rules
Priority order per semester:
1. Failed required CS core courses (retakes first)
2. New eligible CS core courses (study-plan sequence order)
3. Major elective slots (once ≥ 60 CH completed)
4. Non-CS pseudo-courses (fill remaining credit space)

Subject to: Normal ≤ 18 CH | Probation ≤ 12 CH | Summer ≤ 12 CH (normal) / 6 CH (probation)

### 4.9 Dropout Rules
| Trigger | Probability |
|---|---|
| Same course failed 3 times | 40% dropout |
| Exceeded 12-semester maximum | Forced drop (100%) |

### 4.10 Status Transitions
```
Active  → Delayed    : current_semester > 8
Active  → Graduated  : all required courses passed
Active  → Dropped    : dropout trigger fires
Delayed → Graduated  : same as Active → Graduated
Delayed → Dropped    : same as Active → Dropped
```

### 4.11 Three Distinct "Stuck" Types

Do **not** lump these together. They have different causes and different fixes:

| Type | Definition | Tracked in |
|---|---|---|
| `failure_block` | Student is retaking a course they failed | `course_fail_counts` |
| `availability_block` | Student is eligible but the course isn't offered this semester | `course_availability_blocks` |
| `prereq_block` | Student is waiting on an upstream course to pass | `course_prereq_blocks` |

The Fall-only cascade (CMPS323 → CMPS310 → CMPS493) is an **availability bottleneck**, not a failure one — this distinction is the most interesting finding in the simulation and must be surfaced as its own visual.

---

## 5. Class Architecture

```
src/
├── course.py
│   ├── Course (dataclass, frozen=True)
│   └── load_curriculum(path) -> dict[str, Course]
│
├── student.py
│   └── Student
│       ├── student_id: int
│       ├── rng: random.Random             # seeded with BASE_SEED + student_id
│       ├── ability_score: float           # sampled once at creation
│       ├── current_semester: int
│       ├── completed_courses: dict[str, str]    # code -> grade letter
│       ├── failed_attempts: dict[str, int]       # code -> fail count
│       ├── gpa: float
│       ├── completed_ch: int
│       ├── status: str                    # Active/Delayed/Dropped/Graduated
│       ├── on_probation: bool
│       │
│       ├── effective_pass_rate(course) -> float
│       ├── prerequisites_met(course, curriculum) -> bool
│       ├── can_register_senior_project(curriculum) -> bool
│       ├── get_enrollable_courses(available_courses, curriculum) -> list[Course]
│       ├── update_gpa() -> None
│       └── update_status() -> None
│
├── simulator.py
│   ├── SimulationStats (dataclass)
│   │   ├── cohort_by_semester: list[dict]
│   │   ├── course_fail_counts: dict[str, int]
│   │   ├── course_availability_blocks: dict[str, int]
│   │   ├── course_prereq_blocks: dict[str, int]
│   │   ├── graduation_times: list[int]
│   │   └── gpa_distribution: list[float]
│   │
│   └── Simulator
│       ├── __init__(scenario, seed=42)
│       ├── generate_students() -> None
│       ├── run() -> SimulationStats
│       ├── _run_semester(semester_num, term) -> None
│       ├── _get_available_courses(term) -> list[Course]
│       ├── _resolve_grade(student, course) -> str
│       ├── _apply_dropout_checks() -> None
│       └── produce_statistics() -> SimulationStats
│
├── visualizations.py
│   ├── plot_funnel(stats, ax)
│   ├── plot_graduation_histogram(stats, ax)
│   ├── plot_bottleneck_ranking(stats, ax)
│   ├── plot_availability_cascade(stats, ax)      # new — surfaces the Fall-only cascade
│   ├── plot_prerequisite_network(stats, curriculum, ax)
│   ├── plot_course_failure_analysis(stats, ax)
│   └── save_all_figures(results: dict[str, SimulationStats])
│
└── main.py
    ├── run_all_scenarios() -> dict[str, SimulationStats]
    └── main()
```

---

## 6. Scenarios

| Name | Description |
|---|---|
| A_baseline | Default pass rates, default capacities (1× multiplier). All semester constraints active. |

A single baseline scenario is implemented. The `capacity_multiplier` field in `simulation_config.json` allows future scenarios to scale all capacities uniformly. Per-course overrides are supported via `capacity_overrides` and `pass_rate_overrides` in the scenario dict.

---

## 7. Folder Structure

```
Single-Cohort-Flow-Simulator/
├── src/
│   ├── models/
│   │   ├── course.py        # Course dataclass + load_curriculum()
│   │   ├── student.py       # Student state, GPA, enrollment logic
│   │   └── semester.py      # term_season(), term_year(), term_label()
│   ├── simulator.py         # Simulator + History + SimulationResult
│   ├── analytics.py         # compute_metrics(), build_summary_csv()
│   ├── visualize.py         # save_all_figures() + per-figure functions
│   └── utils.py             # load_json(), grade_tier()
├── data/
│   ├── curriculum.json      # 38 courses, 120 CH — source of truth
│   ├── simulation_config.json
│   └── qu_raw/              # downloaded QU open data CSVs (validation only)
├── outputs/
│   ├── figures/             # funnel, graduation_histogram, bottlenecks_*, curriculum_network, stage_flow_*
│   └── reports/             # simulation_summary.csv
├── scripts/
│   └── analyze_qu_data.py   # real QU graduation rate from open data
├── docs/
│   ├── assumptions.md
│   └── technical_design.md
├── run.py
└── CLAUDE.md
```

---

## 8. Face-Validity Checks

Before trusting results, verify these targets after Scenario A runs:

| Check | Expected range | A_baseline actual | Status |
|---|---|---|---|
| Graduation rate | 50–70% within 12 semesters | 65% | ✓ |
| On-time graduation (≤ 8 sem) | 30–50% | 21% | ✗ (structural — see assumptions §K) |
| Probation rate | 15–25% hit it at least once | 34% | ✗ (structural — see assumptions §K) |
| Top failure bottleneck | CMPS303 or CMPS323 | CMPS323 (59 failures) | ✓ |
| Academic dropout rate | 15–30% | 12% | ✓ |

See `docs/assumptions.md §K` for explanation of out-of-range results. No parameters were tuned post-hoc to force these into range.

---

## 9. Output Metrics

| Metric | Description |
|---|---|
| Graduation rate | % of 100 students graduating within 12 semesters |
| Academic dropout rate | % who trigger the 3-fails dropout rule |
| Censored rate | % still enrolled when the 12-semester horizon is hit |
| Average graduation time | Mean semesters among graduates |
| On-time graduation | % graduating in ≤ 8 semesters |
| Probation rate | % who hit probation at least once |
| Top failure bottleneck | Course with highest cumulative fail events |
| Top capacity block | Course with most denied seat-allocation requests |
| Top offering block | Course with most eligible-but-not-offered events |
| Top prereq block | Course with most prerequisite-not-met events |
