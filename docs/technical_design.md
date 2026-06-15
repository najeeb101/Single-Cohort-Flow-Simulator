# Technical Design Document
## Single-Cohort Flow Simulator: Qatar University CS Program

---

## 1. Curriculum Analysis

### Source Documents
- `references/2024-CS-StudyPlan.pdf`: semester-by-semester layout, credit hours, graduation requirements
- `references/2024-CS-Prerequisite-Flowchart.pdf`: prerequisite dependency graph, concurrent prerequisites

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

### CS Major Core Courses (15 courses, 49 CH), Simulated in Full Detail

CMPS 200, CMPS 205, and CMPS 307 are **not** Major Core (see category note below).

Prerequisites and offering seasons below match `data/curriculum.json` (the source of truth) and the 2024 CS Prerequisite Flowchart.

| Code | Title | CH | Prerequisites | Offering | Category |
|---|---|---|---|---|---|
| CMPS 151 | Programming Concepts | 3 | — | Fall + Spring | cs_core |
| CMPS 200 | Computer Ethics | 1 | — | Fall + Spring | cs_core |
| CMPS 205 | Discrete Structures | 3 | — | Fall + Spring | cs_core |
| CMPS 251 | Object-Oriented Programming | 4 | CMPS151 | Fall + Spring | cs_core |
| CMPS 303 | Data Structures | 4 | CMPS251 | Fall + Spring | cs_core |
| CMPS 350 | Web Development Fundamentals | 3 | CMPS251 | Fall + Spring | cs_core |
| CMPS 351 | Fundamentals of Database Systems | 4 | CMPS251 | **Spring only** | cs_core |
| CMPS 310 | Software Engineering | 4 | CMPS251 | **Fall only** | cs_core |
| CMPE 263 | Computer Architecture and Organization I | 3 | CMPS151, CMPS205 | Fall + Spring | cs_core |
| CMPE 355 | Data Communication & Computer Networks I | 4 | CMPE263 | **Fall only** | cs_core |
| CMPS 380 | Cybersecurity Fundamentals | 3 | CMPS303 | **Fall only** | cs_core |
| CMPS 323 | Design and Analysis of Algorithms | 3 | CMPS303, CMPS205 | **Spring only** | cs_core |
| CMPS 405 | Operating Systems | 4 | CMPS303, CMPE263 | **Spring only** | cs_core |
| CMPS 493 | Senior Project I | 3 | see §1 special rule | Fall + Spring | cs_core |
| CMPS 499 | Senior Project II | 3 | CMPS493 | Fall + Spring | cs_core |

**The CMPS 303 gateway**: CMPS 303 (Data Structures) is the prerequisite for exactly three courses: CMPS 380, CMPS 323, and CMPS 405. It is the highest-leverage node in the prerequisite graph; a failure or deferral here blocks all three simultaneously.

**Category note**: CMPS200 (1 CH) and CMPS205 (3 CH) are counted as cs_core above, which yields exactly 49 CH / 15 courses matching the study plan. CMPS307 (2 CH) and MAGT101 (3 CH) are Major Supporting (5 CH, 2 courses); they appear below in the pseudo-course table.

### Major Electives (4 slots, 12 CH)
Four abstract `ELEC_1` through `ELEC_4` (3 CH each). Available once the student has completed ≥ 60 CH. No course prerequisites. Offering: Fall + Spring.

### Non-CS Courses, Expanded as Pseudo-Courses

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
| CHEM_1 | CHEM101 + CHEM103 Chemistry I | 4 | — | Fall + Spring |
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

Each student receives their own `random.Random(seed + student_id)`, **re-instantiated fresh at the start of each scenario**. This means student 7 in Scenario A has the same random stream as student 7 in Scenario B; the only differences between scenario outcomes are structural, not random noise. This is what makes scenario comparisons causally valid and is the single most important methodological choice.

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

Values match `data/curriculum.json`.

| Course | Pass Rate | Course | Pass Rate |
|---|---|---|---|
| CMPS 151 | 0.78 | CMPS 310 | 0.72 |
| CMPS 200 | 0.98 | CMPE 355 | 0.72 |
| CMPS 205 | 0.76 | CMPS 380 | 0.75 |
| CMPS 251 | 0.72 | CMPS 405 | 0.65 |
| CMPS 303 | 0.71 | CMPS 350 | 0.76 |
| CMPS 323 | 0.65 | CMPS 307 (SUPP_1) | 0.92 |
| CMPE 263 | 0.76 | CMPS 493 | 0.88 |
| CMPS 351 | 0.75 | CMPS 499 | 0.90 |
| ELEC_X | 0.78 | MATH_1 / MATH_3 | 0.82 |
| MATH_2 | 0.85 | MATH_4 / MATH_5 | 0.82 |
| PHYS_1 | 0.84 | PHYS_2 | 0.80 |
| CHEM_1 | 0.88 | ENGL_X | 0.90 |
| GED_X | 0.92 | SUPP_2 (MAGT101) | 0.92 |

### 4.5 Grade Distribution
When a student passes a course, their letter grade is sampled from a weighted distribution based on the **course's base `pass_rate`** (not the student-shifted effective rate; ability affects whether you pass, not which tier the course belongs to):

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
- Cumulative GPA = Σ(grade_points × credits) / Σ(attempted_credits)
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
| Same course failed 4 times (`dropout_fails_threshold`) | 25% dropout per additional failure (`dropout_prob_on_repeated_fail`) |
| Exceeded 12-semester maximum | Censored (counted as non-completion, not academic dropout) |

### 4.10 Status Transitions
Status values (uppercase, as in `student.py` / `simulator.py`): `ACTIVE`, `DELAYED`, `GRADUATED`, `DROPPED`, `CENSORED`.

```
ACTIVE  → DELAYED    : current_semester > 8 (still progressing, past nominal plan)
ACTIVE  → GRADUATED  : all required courses passed
ACTIVE  → DROPPED    : academic dropout trigger fires (repeated-fail rule)
DELAYED → GRADUATED  : same as ACTIVE → GRADUATED
DELAYED → DROPPED    : same as ACTIVE → DROPPED
ACTIVE/DELAYED → CENSORED : still enrolled when the 12-semester horizon is reached
```

`CENSORED` (ran out of time) and `DROPPED` (academic withdrawal) are kept distinct; they have different causes and the metrics report them separately. This distinction matters: relieving a capacity/offering bottleneck converts `CENSORED` students (stuck waiting) into students who reach their courses, most of whom then graduate.

### 4.11 Four Distinct "Stuck" Types

Do **not** lump these together. They have different causes and different fixes, and are tracked as four separate counters that are never aggregated:

| Type | Definition | Tracked in (`History`) |
|---|---|---|
| `fail` | Student attempted the course and failed | `fail_counts` |
| `capacity_block` | Student is eligible and the course is offered, but no seat was allocated | `capacity_block_counts` |
| `offering_block` | Student is eligible but the course isn't offered this semester | `offering_block_counts` |
| `prereq_block` | Student is waiting on an upstream course to pass | `prereq_block_counts` |

**Unit caveat:** these four are *not* comparable in magnitude. `fail_counts` counts per-attempt events; `offering_block` and `prereq_block` accumulate one event per active eligible student per term they remain blocked, so they run an order of magnitude larger. Compare *within* a signal (across courses), never *across* signals.

**The dominant findings are scheduling-driven, not failure-driven.** Two structural patterns surface from these counters:
1. **The CMPS 310 senior-project gate**: CMPS 310 is Fall-only and required by the CMPS 493 compound rule, so a missed Fall offering delays the entire senior-project sequence by a year. It is the most pivotal `offering_block` in the curriculum.
2. **The CMPS 303 gateway**: the three courses gated by CMPS 303 (CMPS 405, CMPS 323, CMPS 380) carry the highest `prereq_block` counts outside the senior project, blocked in lockstep.

Both are availability/prerequisite bottlenecks, not failure ones; that distinction is the central finding of the simulation and is surfaced in the four-panel bottleneck figure.

---

## 5. How the Model Works (Execution Walkthrough)

The simulator is a **discrete-term agent-based model**. Time advances in whole semesters; the agents are 100 independent `Student` objects; and one shared `Simulator` drives them through the curriculum. There is no continuous time and no inter-student interaction except competition for finite seats. This section traces exactly what happens from start to finish, anchored to the real functions in `src/`.

### 5.1 Top-Level Run (`Simulator.run`)

```
1. _make_students()                     # build the 100-student cohort
2. for term_idx in 0 .. max_terms-1:    # 12 terms = Fall, Spring, Fall, ...
       season = term_season(term_idx)   # even idx → Fall, odd idx → Spring
       _run_term(term_idx, season)
3. any student still active at the horizon → status = CENSORED
4. return SimulationResult(history, students, scenario, config)
```

The cohort all starts in Fall of term 0. The loop runs at most 12 times. A student exits the loop early only by becoming `GRADUATED` or `DROPPED`; everyone left `ACTIVE`/`DELAYED` at term 12 is marked `CENSORED` (ran out of time, not academic failure).

### 5.2 Building a Student (`Student.__init__` → `_reset_rng_and_state`)

Each student gets:
- **A private RNG**: `random.Random(seed + student_id)`. Because the seed offset is the student's id, **student *i* draws the identical random sequence in every scenario**. This is the Common Random Numbers property (§4.2). Re-running with a structural change (a new offering season, more seats) isolates the *effect of that change* from random noise.
- **A fixed ability score**: `clip(Normal(0, 0.15), −0.30, +0.30)`, drawn once from that same RNG. It is a stable trait that shifts *all* of the student's pass probabilities (§4.3).
- **A tiebreak token**: `hash((seed, student_id))`, used only to break ties in seat allocation. It is computed separately so it never consumes the pass/fail RNG stream, keeping the random sequence stable regardless of how often ties occur.

State initialised to empty: no completed courses, no failed attempts, GPA 0, 0 CH, status `ACTIVE`, not on probation.

### 5.3 The Three-Phase Per-Term Loop (`_run_term`)

At the start of a term the simulator computes `available` = courses whose `offering` list contains this `season`, and `active` = students who are `ACTIVE` or `DELAYED`. Then three phases run in strict order.

**Phase 1: Desired enrollment (`Student.get_desired_courses`).**
Each active student independently builds an ordered wish-list:
1. Filter `available` to courses they *can* enroll in: not already passed, and with prerequisites satisfied (`prerequisites_met`, or `can_register_senior_project` for CMPS 493).
2. Sort eligible courses by `study_plan_order`.
3. Bucket them into a strict priority order: **retakes** (any course with a prior fail) → **new required** (`cs_core` / `college_req`) → **electives** (only once `completed_ch ≥ 60`) → **non-CS filler** (math/science/english/gen-ed).
4. Greedily fill the term up to the load cap (**18 CH** normally, **12 CH** if on probation), adding courses in that priority order until the next course would exceed the cap.

The result is a per-course list of requesters (`desired[course_code] → [students]`).

**Phase 2: Seat allocation (`_effective_capacity` + tier sort).**
For each requested course:
- If `requesters ≤ capacity`, everyone gets a seat.
- Otherwise, sort requesters by `(registration_tier(completed_ch), tiebreak_token)` (students with more completed credit hours have higher priority, per QU's real registration policy, §4.7/G), grant the first `capacity` seats, and record a **`capacity_block`** event for every student denied.

`_effective_capacity` applies the scenario's `capacity_multiplier` (and any per-course `capacity_overrides`), so capacity experiments need no code change, only a scenario field.

**Phase 3: Take courses (`_resolve_grade` → `Student.record_grade`).**
For each granted seat:
- Compute `effective_pass_rate = clip(base_rate + ability, 0.05, 0.98)`.
- Draw `student.rng.random()`. If below the effective rate, the student **passes** and a letter grade is sampled from the difficulty-tier distribution for that course (`grade_tier` picks hard/medium/easy by base pass rate; §4.5). Otherwise the grade is **F** and a **`fail`** event is recorded.
- `record_grade` updates GPA and credit hours (see §5.4).

**Post-phase bookkeeping (still inside `_run_term`):**
- **Dropout check**: for each student, if any single course has been failed `≥ dropout_fails_threshold` (4) times, roll `rng.random() < dropout_prob` (0.25); on success the student becomes `DROPPED`.
- **Graduation / delayed check**: a student who has passed *every* course in the curriculum becomes `GRADUATED` and their term number is appended to `graduation_times`; a still-active student past term 8 is flagged `DELAYED` (behind the nominal plan but still progressing).
- **Block recording (`_record_blocks`)**: for every active student and every not-yet-passed course, classify *why* they aren't taking it this term (see §5.5).
- **Snapshot (`History.record_snapshot`)**: tally `ACTIVE/DELAYED/GRADUATED/DROPPED/CENSORED` counts and the four credit-hour bands for the survivorship and stage-flow figures.

### 5.4 Grade, GPA, and Probation (`Student.record_grade`)

- **GPA** = Σ(grade_points × credits) / Σ(attempted credits), with **F = 0.0 points but still counted in the denominator**, so a fail drags the GPA down until it is replaced.
- **Grade replacement**: when a student passes a course they had previously failed, all prior F attempts for that course are removed from the denominator. Since F contributed 0 to the numerator, only the passing grade ends up counting. This models QU's grade-improvement policy and is the single biggest reason the probation rate lands in its realistic 15–25% range rather than above 30%.
- **Probation**: after recording a grade, if `completed_ch ≥ 25 and gpa < 2.0` the student goes on probation (load cap drops to 12 CH next term); recovering to `gpa ≥ 2.0` lifts it. `ever_probation` latches `True` the first time it happens, which is what the reported probation rate measures.

### 5.5 How the Four Block Signals Are Classified (`_record_blocks`)

Each term, for every active student and every course they have not yet passed, exactly one diagnostic is recorded:

```
if prerequisites NOT met            → prereq_block      (waiting on an upstream course)
elif prerequisites met but
     course not offered this season → offering_block    (eligible, wrong semester)
# (capacity_block is recorded separately, in Phase 2, when a seat is denied)
# (fail is recorded in Phase 3, on an F grade)
```

This is the heart of the model's contribution: it separates the *reason* a student is stuck into four non-interchangeable causes, each pointing to a different fix (better teaching vs. more seats vs. an added offering season vs. an upstream gateway). The four counters are never summed, only compared course-by-course within a signal.

### 5.6 Why This Design Answers the Research Question

The research question is *which prerequisite chains and scheduling constraints cause delay*. Because the model (a) advances in discrete Fall/Spring terms, it can represent a once-a-year course forcing a full-year wait; (b) enforces prerequisites and the senior-project compound rule exactly, it can represent a single gateway course (CMPS 303) stalling three dependents at once; and (c) records the four block signals separately, it can attribute each unit of delay to a specific, fixable cause. The CRN property then lets a single parameter change (e.g., CMPS 310 capacity 35 → 40) be read as a clean causal effect on graduation, which is precisely how the report's intervention recommendations are derived.

---

## 6. Class Architecture

This reflects the actual code (`src/`), not an idealized design.

```
src/
├── models/
│   ├── course.py
│   │   ├── Course (dataclass)
│   │   └── load_curriculum(path) -> dict[str, Course]
│   │
│   ├── student.py
│   │   ├── Student
│   │   │   ├── student_id, rng (random.Random(seed + student_id))
│   │   │   ├── ability_score                # sampled once at creation
│   │   │   ├── completed_courses: dict[str, str]   # code -> grade letter
│   │   │   ├── failed_attempts: dict[str, int]     # code -> fail count
│   │   │   ├── gpa, completed_ch
│   │   │   ├── status: str                  # ACTIVE/DELAYED/GRADUATED/DROPPED/CENSORED
│   │   │   ├── ever_probation: bool
│   │   │   ├── effective_pass_rate(course) -> float
│   │   │   ├── prerequisites_met(course, curriculum) -> bool
│   │   │   └── is_active() -> bool
│   │   └── registration_tier(completed_ch) -> int   # QU priority bands
│   │
│   └── semester.py
│       └── term_season(), term_year(), term_label()
│
├── simulator.py
│   ├── History (dataclass)                  # the four block signals + snapshots
│   │   ├── snapshots: list[dict]            # per-term cohort counts + CH bands
│   │   ├── fail_counts: dict[str, int]
│   │   ├── capacity_block_counts: dict[str, int]
│   │   ├── offering_block_counts: dict[str, int]
│   │   ├── prereq_block_counts: dict[str, int]
│   │   └── graduation_times: list[int]
│   │
│   ├── SimulationResult (dataclass)         # history + students + scenario/config + metrics
│   │
│   └── Simulator
│       ├── __init__(curriculum, config, scenario)
│       └── run() -> SimulationResult        # three-phase per-term loop (see §5.3)
│
├── analytics.py
│   ├── compute_metrics(result) -> dict
│   └── build_summary_csv(results, path) -> None
│
├── visualize.py
│   ├── save_all_figures(results, curriculum, config, dir)
│   └── per-figure functions: funnel, graduation_histogram,
│       bottlenecks_<scenario> (4-panel), curriculum_network, stage_flow_<scenario>
│
└── utils.py
    ├── load_json(path)
    └── grade_tier(pass_rate) -> str         # "hard" | "medium" | "easy"

run.py   # entry point: load → run scenario → compute_metrics → save figures + CSV
```

---

## 7. Scenarios

| Name | Description |
|---|---|
| A_baseline | Default pass rates, default capacities (1× multiplier). All semester constraints active. |

A single baseline scenario is implemented. The `capacity_multiplier` field in `simulation_config.json` allows future scenarios to scale all capacities uniformly. Per-course overrides are supported via `capacity_overrides` and `pass_rate_overrides` in the scenario dict.

---

## 8. Folder Structure

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
│   ├── curriculum.json      # 38 courses, 120 CH, source of truth
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

## 9. Face-Validity Checks

Before trusting results, verify these targets after Scenario A runs:

| Check | Expected range | A_baseline actual | Status |
|---|---|---|---|
| Graduation rate | 50–70% within 12 semesters | 71% (≈ 72.3% QU benchmark) | ✓ |
| On-time graduation (≤ 8 sem) | 30–50% | 21% | ✗ (structural; see assumptions §K) |
| Probation rate | 15–25% hit it at least once | 17% | ✓ |
| Top failure bottleneck | CMPS303 or CMPS323 | CMPS323 (49 failures) | ✓ |
| Academic dropout rate | 15–30% | 20% | ✓ |
| Censored rate (hit horizon) | — | 9% | — |

See `docs/assumptions.md §K` for the full discussion. The probation rate falls in range because of grade replacement (passing a retake removes prior F attempts from the GPA denominator); without it, probation exceeded 30%.

---

## 10. Output Metrics

| Metric | Description |
|---|---|
| Graduation rate | % of 100 students graduating within 12 semesters |
| Academic dropout rate | % who trigger the repeated-fail dropout rule (4 fails of same course → 25% per additional fail) |
| Censored rate | % still enrolled when the 12-semester horizon is hit |
| Average graduation time | Mean semesters among graduates |
| On-time graduation | % graduating in ≤ 8 semesters |
| Probation rate | % who hit probation at least once |
| Top failure bottleneck | Course with highest cumulative fail events |
| Top capacity block | Course with most denied seat-allocation requests |
| Top offering block | Course with most eligible-but-not-offered events |
| Top prereq block | Course with most prerequisite-not-met events |
