# Technical Design Document
## CS Flow Simulator: Qatar University CS Program

> **Note (multi-cohort extension):** §§1–10 below describe the per-student mechanics, which still
> hold exactly. The simulator now runs **many cohorts on a shared seat pool**, warm-started by an
> admin-entered initial state (not a simulated incumbent cohort, by default) and emits a frontend
> timeline. See **§11. Multi-Cohort Extension** for that layer.
>
> **Note (curriculum data model):** §2's course catalog below predates a later switch from
> abstracted "pseudo-courses" (`MATH_1`, `PHYS_1`, `GED_1`, `ELEC_1`...) to the real official QU
> course codes (`MATH101`, `PHYS191`-`194`, `CSEL1`-`4`, etc.) actually used by
> `data/curriculum.json` today. Offerings went through two revisions: the pseudo-course era had
> hand-picked Fall-only/Spring-only restrictions; those were dropped when the real codes came in
> (briefly every course ran Fall+Spring); then the **real QU schedule** was restored — **8 core
> courses are single-term** (Fall-only {CMPS200, CMPS310, CMPE355, CMPS380}, Spring-only {CMPE263,
> CMPS323, CMPS351, CMPS405}) and the 22 non-CS service courses additionally run in Summer. See
> `CLAUDE.md`'s "Key Constraints" section for the canonical current summary.

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

**As of this revision, `data/curriculum.json` uses the real official QU course codes directly**
(no abstracted "pseudo-courses"), and offerings mirror QU's **real schedule**: most courses run
Fall+Spring, but **8 core courses are single-term** — Fall-only {CMPS200, CMPS310, CMPE355,
CMPS380} and Spring-only {CMPE263, CMPS323, CMPS351, CMPS405} — and the 22 non-CS service
courses (math/science/english/gen_ed) additionally run in **Summer** (CS courses never do).
`study_plan_term` (1-8) records each course's *recommended* semester (used to lay out the roadmap
UI); it is not the offering restriction — the `offering` array is. All 41 courses, in
`study_plan_term` order:

| Code | Title | CH | Prerequisites | Category | Term | Pass rate* |
|---|---|---|---|---|---|---|
| CMPS151 | Programming Concepts | 3 | — | cs_core | 1 | 0.80 |
| MATH101 | Calculus I | 3 | — | math | 1 | 0.78 |
| CHEM101 | General Chemistry I | 3 | — | science | 1 | 0.82 |
| CHEM103 | Experimental General Chemistry I | 1 | — | science | 1 | 0.92 |
| ENGL202 | English Language I | 3 | — | english | 1 | 0.88 |
| HIS121 | History of Qatar | 3 | — | gen_ed | 1 | 0.92 |
| CMPS251 | Object-Oriented Programming | 4 | CMPS151 | cs_core | 2 | 0.78 |
| MATH102 | Calculus II | 3 | MATH101 | math | 2 | 0.76 |
| MATH231 | Linear Algebra | 3 | MATH101 | math | 2 | 0.78 |
| PHYS191 | General Physics for Engineering I | 3 | — | science | 2 | 0.80 |
| PHYS192 | Experimental General Physics for Engineering I | 1 | — | science | 2 | 0.92 |
| ENGL203 | English Language II | 3 | ENGL202 | english | 2 | 0.88 |
| CMPS205 | Discrete Structures | 3 | CMPS151 | cs_core | 3 | 0.80 |
| CMPS200 | Computer Ethics | 1 | — | cs_core | 3 | 0.92 |
| CMPS303 | Data Structures | 4 | CMPS251 | cs_core | 3 | 0.76 |
| PHYS193 | General Physics for Engineering II | 3 | PHYS191 | science | 3 | 0.80 |
| PHYS194 | Experimental General Physics for Engineering II | 1 | PHYS192 | science | 3 | 0.92 |
| ARAB100 | Arabic Language I | 3 | — | gen_ed | 3 | 0.92 |
| CMPE263 | Computer Architecture and Organization I | 3 | CMPS205 | cs_core | 4 | 0.78 |
| CMPS323 | Design and Analysis of Algorithms | 3 | CMPS303, CMPS205 | cs_core | 4 | 0.76 |
| CMPS351 | Fundamentals of Database | 4 | CMPS303 | cs_core | 4 | 0.80 |
| GENG200 | Probability and Statistics | 3 | MATH102 | math | 4 | 0.80 |
| CORE201 | Core Knowledge and Skills Package | 3 | — | gen_ed | 4 | 0.90 |
| CMPS310 | Software Engineering | 4 | CMPS251 | cs_core | 5 | 0.82 |
| CMPE355 | Data Communication and Computer Networks I | 4 | CMPE263 | cs_core | 5 | 0.78 |
| CMPS380 | Cybersecurity Fundamentals | 3 | CMPS303 | cs_core | 5 | 0.82 |
| CSEL1 | Major Elective I | 3 | — | cs_elective | 5 | 0.85 |
| NSMP201 | Natural Science/Mathematics Package | 3 | — | gen_ed | 5 | 0.90 |
| CMPS405 | Operating Systems | 4 | CMPS303, CMPE263 | cs_core | 6 | 0.76 |
| CMPS350 | Web Development | 3 | CMPS251 | cs_core | 6 | 0.84 |
| CSEL2 | Major Elective II | 3 | — | cs_elective | 6 | 0.85 |
| GENG300 | Numerical Methods | 3 | MATH231 | math | 6 | 0.80 |
| DAWA111 | Islamic Culture | 3 | — | gen_ed | 6 | 0.92 |
| CMPS493 | Senior Project I | 3 | see §1 special rule | cs_core | 7 | 0.88 |
| CSEL3 | Major Elective III | 3 | — | cs_elective | 7 | 0.85 |
| CMPS307 | Intro to Project Management & Entrepreneurship | 2 | — | gen_ed | 7 | 0.90 |
| HUMF201 | Humanities/Fine Arts Package | 3 | — | gen_ed | 7 | 0.90 |
| CMPS499 | Senior Project II | 3 | CMPS493 | cs_core | 8 | 0.90 |
| CSEL4 | Major Elective IV | 3 | — | cs_elective | 8 | 0.85 |
| MAGT101 | Principles of Management | 3 | — | gen_ed | 8 | 0.90 |
| SOCB201 | Social and Behavioral Package | 3 | — | gen_ed | 8 | 0.90 |

\*Pass rates are calibrated *estimates* in `data/curriculum.json`, hand-tunable per course; treat
the values above as a snapshot, not a fixed constant — check the JSON file for the current value
before quoting a specific number.

**The CMPS303 gateway**: CMPS303 (Data Structures) is the prerequisite for exactly three courses:
CMPS380, CMPS323, and CMPS405. It is the highest-leverage node in the prerequisite graph; a
failure or deferral here blocks all three simultaneously. This is still the model's headline
structural finding (§4.11), but it now shows up purely as a `prereq_block` effect, not an
`offering_block` one, since (per the note above) no course is season-restricted anymore.

**Major Electives (`CSEL1`-`4`, 4 x 3 CH = 12 CH)**: available once the student has completed
≥ 60 CH (config: `enrollment_priority_tiers`), no course-level prerequisites.

**Credit-hour reconciliation**: the 41 real courses above sum to exactly 120 CH (verified
directly from `data/curriculum.json`, not a separately-maintained table) — completing all of them
guarantees the 120-CH graduation requirement (§3).

---

## 3. Graduation Condition

**Graduation = all required courses/pseudo-courses passed.**

Do **not** use `completed_ch ≥ 120` as a separate gate. Because the catalog is reconciled to exactly 120 CH, completing all courses guarantees 120 CH. A dual gate creates a silent failure mode where the two conditions disagree and graduation rate becomes 0%.

---

## 4. Simulation Assumptions

### 4.1 Cohort
- `cohort_size` students per cohort (config default: 100), all starting the same admission term
- Maximum study duration: `max_terms` regular semesters (config default: 12, i.e. 6 academic years)
- Reproducible via fixed seed (default 42)
- This section describes the mechanics for *one* cohort in isolation; the shipped configuration
  actually runs several cohorts admitted over time on one shared seat pool — see §11.

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

See §2's course table for the current per-course pass rates (`data/curriculum.json` is the
source of truth; they're hand-tunable and change as the model gets recalibrated).

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
Priority order per semester (config: `enrollment_priority_tiers`):
1. Retakes of any previously-failed course, always first
2. `cs_core` / `college_req` courses (required), in `study_plan_order`
3. `cs_elective` slots (`CSEL1`-`4`), once ≥ 60 completed CH
4. `math` / `science` / `english` / `gen_ed` courses (fill remaining credit space)

Subject to: Normal ≤ `normal_load_ch` CH (18) | Probation ≤ `probation_load_ch` CH (12). A
different program redefines these tiers/thresholds in config, not in code.

### 4.9 Dropout Rules

Two independent, config-driven triggers can end a student's career early (values below are the
current `simulation_config.json` defaults, hand-tunable):

| Trigger | Mechanism |
|---|---|
| **Chronic low GPA** | Once a student has enough credits for GPA to be meaningful, each term their GPA sits below `dropout_gpa_floor` (2.0) carries a real per-term hazard of leaving; that hazard is front-loaded, multiplied by `dropout_early_multiplier` (2.0) for a student's first `dropout_early_sem_cutoff` (4) semesters, matching how real first-year/sophomore attrition is heavily weighted toward the early years. |
| **Stuck on one course** | Same course failed ≥ `dropout_fails_threshold` (3) times → `dropout_prob_on_repeated_fail` (0.15) chance of dropping, per additional failure past the threshold — independent of overall GPA. |
| Exceeded `max_terms` (12) | `CENSORED` (non-completion, not counted as an academic dropout). |

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

**Once-a-year scheduling is back as a headline finding.** Offerings now mirror QU's real
schedule (§2): 8 core courses are single-term (Fall-only {CMPS200, CMPS310, CMPE355, CMPS380},
Spring-only {CMPE263, CMPS323, CMPS351, CMPS405}). This makes `offering_block` a real, large
signal again — and, more importantly, makes *capacity* on the required sequence matter for
completion, not just delay: a student who misses an early gateway seat falls off the annual
rhythm, reaches a single-term upper course off-cycle, and loses a full year, which pushes the
tail past the horizon into CENSORED (see §11.4). The 22 non-CS service courses additionally run
in Summer (an optional term) as a partial catch-up path; CS courses never do.

**What still holds as the headline structural finding**: **the CMPS303 gateway**. CMPS303 (Data
Structures) gates CMPS380, CMPS323, and CMPS405 simultaneously, so a delay or failure at CMPS303
now shows up as a `prereq_block` spike on all three at once, even though nothing is actually wrong
with those three courses themselves — that lockstep pattern is what points you at the real
chokepoint (CMPS303) instead of its three symptoms. Whether `capacity_block` (seat scarcity) or
`prereq_block` (this gateway effect) dominates in a given run now depends on the configured
configured per-course `capacity` values and cohort size, not on a hardcoded seasonal restriction, so
this is a claim to re-check against a current run rather than treat as a fixed fact — see
`docs/project_overview.md` §6 on why point-in-time output numbers go stale.

---

## 5. How the Model Works (Execution Walkthrough)

The simulator is a **discrete-term agent-based model**. Time advances in whole semesters; the agents are independent `Student` objects (one cohort's worth at a time in this section's walkthrough, `cohort_size` per cohort, several cohorts at once in the real shipped model per §11); and one shared `Simulator` drives them through the curriculum. There is no continuous time and no inter-student interaction except competition for finite seats. This section traces exactly what happens from start to finish, anchored to the real functions in `src/`.

> **Update**: this walkthrough predates the multi-cohort model (§4 below covers that) and now
> also predates the generalized term/season model — the 2-season ("Fall, Spring, Fall, ...")
> assumption below is the *legacy default*, not the only supported cycle. See CLAUDE.md's
> "Term/Season Model" section for the current, config-driven behavior (optional Winter/Summer
> intersessions, the `personal_semester` clock, `mandatory_horizon_end_term`), which is more
> current than this section for that topic.

### 5.1 Top-Level Run (`Simulator.run`)

```
1. _make_students()                     # build the cohort (cohort_size students)
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
1. Filter `available` to courses they *can* enroll in: not already passed, and eligible (`is_eligible_for` — plain `prerequisites_met`, or a compound `rule_expr` for gated courses like CMPS 493).
2. Sort eligible courses by `study_plan_order`.
3. Bucket them into a strict priority order: **retakes** (any course with a prior fail) first, then config-driven `enrollment_priority_tiers` from `simulation_config.json` in order — each tier is a set of categories plus an optional `min_ch` gate. QU CS's defaults: **required** (`cs_core` / `college_req`) → **electives** (`cs_elective`, only once `completed_ch ≥ 60`) → **non-CS filler** (math/science/english/gen-ed). A different program redefines the tiers, not this code.
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
- **Dropout check**: two independent triggers, both config-driven (§4.9) — a repeated-fail check
  (any single course failed `≥ dropout_fails_threshold` times rolls `dropout_prob_on_repeated_fail`
  per additional failure) and a chronic-low-GPA hazard, front-loaded toward early semesters. Either
  success marks the student `DROPPED`.
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

This reflects the actual code (`src/`) as of this revision — see `CLAUDE.md`'s own
"Architecture" section for the living, most-current version of this map.

```
src/
├── models/
│   ├── course.py       # Course (dataclass) + load_curriculum()
│   ├── student.py      # Student (rng, ability, GPA, status, registration_tier())
│   └── semester.py     # term_season()/term_year()/term_label(), config-driven season cycle
│
├── datasource.py        # DataSource seam: CohortSpec + SyntheticDataSource (population
│                         # creation, decoupled from the engine so a future real-data source
│                         # can plug in without touching Simulator); also the canonical
│                         # EnrollmentRecord/OutcomeRecord record types
├── rules.py             # evaluate_rule()/gate_edges() — generic compound prerequisite
│                         # expressions (how CMPS493's rule is expressed, not hardcoded)
├── simulator.py         # Simulator (staggered admission + 3-phase per-term loop) + History
│                         # (the four block signals + snapshots) + SimulationResult
├── analytics.py         # compute_metrics(), per-cohort metrics, admissions recommendation,
│                         # curriculum graph, flow_timeline JSON, CSV writers
├── service.py           # run_simulation(curriculum, config, scenario, data_source=None)
│                         # -> dict — the engine-as-a-service boundary: Simulator + every
│                         # analytics.py derivation, in memory, zero file I/O
├── optimizer.py          # solve_for_targets() — Auto-fill's bounded greedy capacity search
│                         # (§11.10)
├── db.py / db_models.py  # SQLAlchemy engine/session + User/Plan/Course/AppConfig/
│                         # Scenario/Run tables (per-plan, multi-plan support) — see
│                         # docs/database.md for the full schema
├── auth.py               # get_current_user — a stub shared demo user today, not real
│                         # login/JWT (that was built, then removed in a later simplification
│                         # pass; the DB/route plumbing for it is gone from api.py)
├── curriculum_validation.py  # check_no_cycle() — prerequisite-cycle guard for Settings
│                         # edits and Plan imports
├── scenarios.py          # persistent /scenarios + /runs endpoints (saved scenario-builder
│                         # presets), scoped to the demo user
├── api.py                # FastAPI wrapper: /health, /meta, /simulate, /autofill, /curriculum,
│                         # /config, /plans — every route resolves the requester's
│                         # active Plan fresh, no cached globals; see docs/api.md
├── montecarlo.py         # run_monte_carlo() — mean ± 95% CI over many seeds
├── visualize.py          # save_all_figures() + per-figure functions (offline `py run.py` path)
└── utils.py              # load_json(), grade_tier()

web/         Next.js/TypeScript dashboard — Dashboard (Semester Checkpoint Mode: advance one
             semester at a time, editing capacity/pass rate/occupancy/intake between steps),
             Advisor (grounded LLM chat + what-if Test/Apply on proposed changes), Bottlenecks
             (capacity recommendations + Auto-fill solver), Figures, Settings
             (curriculum + config editing), Plans/Plan Builder, Run History
run.py       # entry point: load -> run_simulation() per scenario -> save figures + CSV
```

---

## 7. Scenarios

| Name | Description |
|---|---|
| baseline | Default pass rates, default capacities (1x multiplier). All semester constraints active. |

A single `baseline` scenario ships in `simulation_config.json` (renamed from an earlier
`A_baseline`, after a second calibrated scenario was tried and later dropped). The
`capacity_multiplier` field allows a future scenario to scale all capacities uniformly.
Per-course overrides are supported via `capacity_overrides`, `offering_overrides`, and
`pass_rate_overrides` in a scenario/override dict — these are the hooks the Advisor's what-if
(Test on a proposed change) builds on.

---

## 8. Folder Structure

```
Single-Cohort-Flow-Simulator/
├── src/                     # see §6 for the full module map
├── web/                     # Next.js/TypeScript dashboard
├── data/
│   ├── curriculum.json      # 41 courses, 120 CH, source of truth (one-time DB seed)
│   ├── simulation_config.json
│   └── app.db                # gitignored SQLite DB; authoritative after first API boot
├── outputs/
│   ├── figures/              # university_enrollment, cohort_flow, bottlenecks_<scenario>,
│   │                        # curriculum_network, survival_curve, etc.
│   └── reports/              # simulation_summary.csv, flow_timeline.json, etc.
├── scripts/
│   ├── size_capacity.py      # recalibrates each course's capacity to peak demand
│   └── migrate_json_to_db.py # (re)seeds data/app.db from the JSON files
├── tests/                    # pytest suite
├── docs/
│   ├── project_overview.md
│   ├── technical_design.md   # this file
│   ├── code_walkthrough.md   # code-level companion (real signatures, module by module)
│   ├── database.md           # DB schema reference
│   ├── api.md                # HTTP API reference
│   └── assumptions.md
├── run.py
├── render.yaml                # Render deployment blueprint
└── CLAUDE.md
```

---

## 9. Face-Validity Checks

> **These numbers are a historical snapshot** from an earlier single-cohort, 100-student,
> pseudo-course calibration run (the original `A_baseline` scenario) — before the curriculum
> switched to real course codes, the Fall/Spring offering restrictions were dropped, and the
> multi-cohort/initial-state model replaced the single isolated cohort. They no longer reflect
> today's configuration and shouldn't be quoted as current. The *targets/ranges* (what a sane
> run should roughly look like) are still a reasonable sanity check; for the actual current
> numbers, run the simulation (`py run.py`) and read `outputs/reports/simulation_summary.csv`.

Targets to sanity-check any run against:

| Check | Expected range | Current snapshot (MC mean) | Status |
|---|---|---|---|
| Graduation rate | 50-70% within 12 semesters | 65.5% | checked out |
| On-time graduation (≤ 8 sem) | 20-50% | 23% | checked out |
| Probation rate | 15-25% hit it at least once | 18% | checked out |
| Academic dropout rate | 15-30% | 15% | checked out (just under) |
| Censored rate (hit horizon) | — | 22% (once-a-year timing tail) | — |

See `docs/assumptions.md §J` for the full discussion. The probation rate falls in range because
of grade replacement (passing a retake removes prior F attempts from the GPA denominator);
without it, probation exceeded 30%.

---

## 10. Output Metrics

| Metric | Description |
|---|---|
| Graduation rate | % of a cohort graduating within `max_terms` semesters |
| Academic dropout rate | % who trigger either dropout rule (repeated-fail or chronic-low-GPA, §4.9) |
| Censored rate | % still enrolled when the `max_terms` horizon is hit |
| Average graduation time | Mean semesters among graduates |
| On-time graduation | % graduating in ≤ 8 semesters |
| Probation rate | % who hit probation at least once |
| Top failure bottleneck | Course with highest cumulative fail events |
| Top capacity block | Course with most denied seat-allocation requests |
| Top offering block | Course with most eligible-but-not-offered events |
| Top prereq block | Course with most prerequisite-not-met events |

---

## 11. Multi-Cohort Extension

The model layers a **steady-state university** on top of the single-student mechanics in §§1–10.

### 11.1 Admissions & the global clock
- `num_cohorts` study cohorts are admitted in the seasons named by `admission_terms` (default `["Fall"]` → **8 cohorts**, one per year, entry terms 0, 3, 6, … under the current 3-season config — the calendar is walked and a cohort admitted on each Fall). Adding `"Spring"` gives a second yearly intake (entry terms 0, 1, 3, 4, … — Fall then Spring, never the optional Summer). `admission_sizes` (`{season: size}`) sets a per-season intake, defaulting to `cohort_size`. Eight cohorts is chosen for steady state: a ~6-year program with yearly admission has ~6 cohorts enrolled simultaneously, so fewer would under-represent the shared-pool competition that is the whole point of §11.3.
- **Warm start, current default: initial state, not simulated incumbents.** Rather than admitting
  `num_incumbent_cohorts` prior cohorts at negative terms, the shipped config instead defines
  `initial_state.occupancy` (seats already taken per course by the existing, un-simulated student
  body), subtracted from every course's free seats on every mandatory term. The starting student
  body is driven entirely by occupancy — an earlier `initial_state.standing` head-count (folded
  into the aggregate stage-node counts for display) was removed; occupancy alone was judged
  sufficient. `num_incumbent_cohorts` still exists as a lower-level
  engine knob (admitting cohorts at negative terms, fully simulated from their negative entry
  forward — walked backward from term −1 along the same `admission_terms` rhythm — so the global
  loop's `start_term` is the earliest such negative entry) but defaults to 0 in the shipped config.
- `term_season` works for negative indices regardless (`−6 % 2 == 0` → Fall under the legacy
  2-season cycle), so the incumbent-cohort option still works if an admin re-enables it.

### 11.2 Personal vs. global time

> **Update**: this section predates the generalized term/season model. `personal_semester` is no
> longer recomputed as `global_term − entry_term + 1` — it's a stateful counter
> (`Student.personal_semester`) incremented once per *mandatory* term only (never during an
> optional Winter/Summer term), so taking courses in an optional term doesn't cost a semester.
> See CLAUDE.md's "Term/Season Model" for the current mechanics; the rest of this section still
> holds.

Each horizon rule uses the student's own `personal_semester`, so every student gets exactly `max_terms` (mandatory) semesters measured from their own admission. GRADUATED/DELAYED/CENSORED and `graduation_times` are all personal-time based. Headline metrics are scoped to **study cohorts** (`entry_term ≥ 0`); incumbents appear only in the per-cohort ledger.

### 11.3 Shared seat pool (the core dynamic)
All active students from all cohorts enter the same Phase-2 allocation. Because requesters are already sorted by `registration_tier(completed_ch)`, seniors from older cohorts outrank freshmen automatically — a delayed senior class starves incoming freshmen of gateway seats, and congestion compounds cohort over cohort. This is the phenomenon the model exists to study.

### 11.4 Capacity model
Per-term seats for a course = its own `capacity` field (`data/curriculum.json`), minus any
`initial_state.occupancy` for that course (§11.1). `scripts/size_capacity.py` auto-calibrates it
and writes the integer directly into `curriculum.json`; it is then hand-tunable per course (the
realistic lever an administrator pulls). **Sizing policy: the whole required sequence (cs_core)
and all non-CS courses are sized to peak per-term demand; only interchangeable electives
(cs_elective) are squeezed to the 75th demand percentile.** This is a direct consequence of the
single-term offerings (§4.11): under an all-Fall+Spring curriculum, under-provisioning a required
course only added *delay* (retake next term), so a percentile squeeze was safe. With several
once-a-year upper courses, a missed seat in an *early* gateway knocks a student off the annual
rhythm and into a full-year wait that cascades into non-completion (CENSORED) — so the critical
path must be seated to peak, and the deliberate scarcity lives on electives (4 interchangeable
slots, no prerequisites, where scarcity only redistributes). Scenario `capacity_overrides` still
apply as a per-course multiplier for what-if experiments, and on the optional Summer term
capacity is scaled down further by `optional_term_capacity_scale`.

### 11.5 Identity, RNG, determinism
Study cohorts get `cohort_id` `0..n−1`; incumbents `−1, −2, −3`. Globally-unique `student_id = (cohort_id + num_incumbent_cohorts) × cohort_size + i`; RNG seed remains `seed + student_id`, so CRN and full determinism are preserved.

### 11.6 Per-cohort post-mortems & admissions recommendation
Four `*_by_cohort` block counters (`cohort_id → {course → count}`) let each cohort report *where it got stuck*. `compute_admissions_recommendation` is a single-run heuristic: it scores the representative study cohort against four `admission_targets` (graduation rate, time-to-degree, seats-denied-per-student, throughput stability), takes the binding (worst) slack factor, and scales next year's intake by it (growth capped at 1.25×).

### 11.7 Outputs & the frontend contract
Beyond the legacy reports, the engine emits `flow_timeline.json`:
- `meta` — stage nodes, cohort registry, and the static prerequisite **graph** (course nodes + prereq/senior-project edges).
- `frames` — one per semester: per-course stats (capacity/registered/granted/denied/pass/fail/waiting/full) and per-cohort stage **node counts + flows** (`from → to` counts, e.g. Year2 → Year3).
- `summary` — headline metrics (+ Monte Carlo CIs), per-cohort metrics + bottlenecks, and the admissions recommendation.

The `web/` Next.js dashboard lays out the graph by longest-path layering and replays the frames as an animation, ending in a dashboard rendered from `summary`. A later phase may add an AI step that classifies a raw prerequisite chart into `curriculum.json`; the export is producer-agnostic, so that step would change nothing downstream.

### 11.8 Monte Carlo
`run_monte_carlo` re-runs the baseline across `n_runs` seeds (`base_seed + k`) and reports mean ± 95% CI per headline metric. The canonical timeline/animation stays on the single base seed (deterministic for the frontend); the CIs only annotate the dashboard.

### 11.9 Engine-as-a-service boundary
`src/service.py::run_simulation(curriculum, config, scenario, data_source=None) -> dict` is the
single function boundary between the engine and any caller: script, test, or the FastAPI layer
(`src/api.py`). It runs one scenario and returns `result` (the raw `SimulationResult`), `metrics`,
`cohort_metrics`, `admissions_recommendation`, and `flow_timeline` as a plain dict; it never
touches disk or prints. `run.py` is a thin wrapper: load JSON from disk → `run_simulation` per
scenario → hand the returned `SimulationResult` to `analytics.py`'s CSV/JSON writers and
`visualize.py`'s figure writers, which remain the only file-I/O layer. Monte Carlo stays a
separate, opt-in call (§11.8) rather than folded into `run_simulation`, since re-running a
scenario dozens of times isn't something every caller wants paid for by default.

### 11.10 Advisor + Auto-fill

Two decision-support layers on top of a completed run, both reading `evaluate_health_criteria`'s
per-criterion slack against `config['admission_targets']` — the same four criteria §11.6's
admissions recommendation scores (graduation rate, time-to-degree, seats-denied-per-student,
throughput stability).

- **Advisor** is a rules-based (no LLM) frontend read of a run's existing `flow_timeline.summary`
  into prioritized plain-language recommendations — a pure derivation from data the `/simulate`
  response already contains, no extra backend call.
- **Auto-fill** (`src/optimizer.py::solve_for_targets`) is a bounded greedy solver: each iteration
  runs one simulation, finds the course with the worst single-term seat shortfall, and bumps its
  capacity by that shortfall, until the seats-denied target is met or `run_budget` (default 20,
  max 40) is exhausted. It only drives the one target capacity actually fixes (seats denied),
  reporting grad-rate/time-to-degree/throughput-stability breaches as non-capacity so it never
  overstates the seats needed. `POST /autofill` is read-only; the frontend panel applies the
  winning capacities itself via the existing `PUT /curriculum/{code}` + `PUT /config` writes.
