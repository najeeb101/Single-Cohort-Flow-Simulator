# Simulation Assumptions

This document records every assumption made in the Single-Cohort Flow Simulator.
Assumptions are documented here and were fixed before the final baseline run; calibration choices are noted explicitly where they affect the reported results.

---

## A. Fixed Parameters (from `data/simulation_config.json`)

| Parameter | Value | Justification |
|---|---|---|
| `seed` | 42 | Arbitrary; fixed for reproducibility |
| `cohort_size` | 100 | T3.1 specification |
| `max_terms` | 12 (6 academic years) | QU maximum study duration for BS programs |
| `normal_load_ch` | 18 | QU standard full-time load cap |
| `probation_load_ch` | 12 | QU academic probation load restriction |
| `probation_min_ch` | 25 | QU policy: probation evaluated after first year (~25 CH) |
| `probation_gpa_threshold` | 2.0 | QU minimum cumulative GPA requirement |
| `dropout_fails_threshold` | 4 | Same course failed 4× triggers probabilistic dropout |
| `dropout_prob_on_repeated_fail` | 0.25 | 25% chance of dropping after 4th failure of same course |
| `ability_sd` | 0.15 | Assumed; calibrated so ~2.5% of students have ability > ±0.30 |
| `ability_clip` | 0.30 | Hard clip to keep effective pass rates in [0.05, 0.98] |

---

## B. Student Ability Model

- Each student has a fixed `ability_score ~ Normal(0, 0.15)`, clipped to `[-0.30, 0.30]`.
- This score shifts all course pass probabilities: `effective_pass_rate = clip(base_rate + ability, 0.05, 0.98)`.
- Ability is drawn once per student at cohort creation, before the semester loop.
- **Assumption**: ability is a stable trait, not course-specific.

---

## C. Per-Course Pass Rates

Pass rates are **assumed**; no public per-course failure data exists for QU CS programs.
They were set by curricular role and expected difficulty, then checked against the face-validity targets in §K. Lower rates are assigned to courses that introduce a new level of abstraction, combine mathematical reasoning with programming, or sit on high-pressure prerequisite paths. Higher rates are assigned to low-credit, capstone, and broad general-education requirements where students are expected to receive more structured completion support.

| Course | Base Rate | Difficulty Rationale |
|---|---|---|
| CMPS151 | 0.78 | First programming course; many students are still building syntax, debugging, and problem-decomposition habits |
| CMPS200 | 0.98 | Low-credit ethics requirement with limited technical barrier |
| CMPS205 | 0.76 | Discrete structures introduces proof, logic, sets, relations, and combinatorics before many students have mature CS theory skills |
| CMPS251 | 0.72 | First major programming step after CS1; object-oriented design, larger assignments, and abstraction make it an early progression filter |
| CMPS303 | 0.71 | Data structures combines implementation, algorithmic thinking, and prerequisite pressure for several upper-level courses |
| CMPS350 | 0.76 | Applied web-development course; project work is demanding but more concrete than theory-heavy courses |
| CMPS351 | 0.75 | Database course with modeling, SQL, and design concepts; moderate technical load rather than a primary failure course |
| CMPS323 | 0.65 | Algorithms is the most theory-intensive required course, emphasizing proofs, asymptotic analysis, and abstract problem solving |
| CMPS310 | 0.72 | Software engineering requires team/project execution and documentation, creating coordination and delivery risk beyond exams |
| CMPS380 | 0.75 | Cybersecurity introduces specialized concepts but remains less mathematically intensive than algorithms or operating systems |
| CMPE263 | 0.76 | Computer architecture shifts students toward hardware-level reasoning, representation, and low-level execution models |
| CMPE355 | 0.72 | Networks combines protocols, layered abstractions, and quantitative reasoning, so it is modeled below the mid-tier applied courses |
| CMPS405 | 0.65 | Operating systems is conceptually dense, combining concurrency, memory, processes, scheduling, and low-level systems reasoning |
| CMPS493/499 | 0.88 / 0.90 | Senior project courses occur after major prerequisites; students are advanced and receive supervision, so failure is less common |
| Non-CS / GED | 0.80–0.98 | Broad service and general-education courses vary by technical load; math/science are moderate, English/GED are high-completion |

---

## D. Course Capacity

Capacities are **assumed**; no section-size data is publicly available.
The focused binding set (courses where capacity actually creates queueing pressure):

| Course | Capacity | Why Binding |
|---|---|---|
| CMPS205 | 70 | Both terms; large early demand |
| CMPS251 | 70 | Both terms; whole cohort funnels through |
| CMPS303 | 40 | Gateway course (unlocks CMPS323/380/405), both terms |
| CMPS350 | 35 | Both terms; CMPS493 compound-rule option |
| CMPE263 | 35 | Both terms |
| CMPS310 | 40 | **Fall-only**; required for CMPS493 compound rule (capacity raised 35→40, +4pp graduation) |
| CMPS351 | 40 | **Spring-only**; accumulated demand |
| CMPS380 | 40 | **Fall-only**; gated by CMPS303 |
| CMPS323 | 40 | **Spring-only**; accumulated demand |
| CMPS405 | 40 | **Spring-only**; accumulated demand |
| CMPE355 | 40 | **Fall-only**; difficulty-driven |
| CMPS493 | 30 | Both terms; senior project compound-rule gate |
| CMPS499 | 30 | Both terms; follows CMPS493 |

All non-CS pseudo-courses have capacity 100 (non-binding for a 100-student cohort).

---

## E. Prerequisite Grade Assumption

**Any passing grade (D or better) satisfies a prerequisite.**
There is no minimum-grade enforcement (e.g., no "C or better" requirement).
This is a simplification; QU may have course-specific grade thresholds not documented publicly.

**Grade replacement:** When a student retakes and passes a previously failed course, all prior F attempts for that course are removed from the GPA denominator (F = 0.0 pts, so the numerator is unaffected). Only the passing grade counts toward GPA. This models QU's grade improvement/replacement policy.

---

## F. Graduation Condition

Graduation = all 38 required courses/pseudo-courses passed.
The catalog reconciles to exactly 120 CH, so a separate `completed_ch >= 120` gate is not needed
(and would risk a silent dual-gate failure).

---

## G. Seat Allocation Priority

When more students request a course than seats allow, priority follows QU's registration schedule:

| Completed CH | Registration Tier | Priority |
|---|---|---|
| ≥ 90 | 0 | Highest |
| ≥ 75 | 1 | |
| ≥ 60 | 2 | |
| ≥ 45 | 3 | |
| ≥ 30 | 4 | |
| < 30  | 5 | Lowest |

Ties within the same tier are broken by a stable `tiebreak_token = hash((seed, student_id))`,
which is computed once and never consumes the pass/fail RNG stream.

---

## H. GED Credit Hour Reconciliation

The QU catalogue lists "Core Curriculum Requirements = 33 CH (11 courses)" and
"General Education = 21 CH (7 courses)". In the simulation these are modelled as
7 pseudo-courses (GED_1–GED_7) at 3 CH each = 21 CH. This brings the total to exactly 120 CH:

| Category | CH |
|---|---|
| CS Core (15 courses) | 49 |
| CS Electives (4 slots) | 12 |
| Major Supporting (2) | 5 |
| Math (5) | 15 |
| Physics (2) | 8 |
| Chemistry (1) | 4 |
| English (2) | 6 |
| General Education (7) | 21 |
| **Total** | **120** |

---

## I. Common Random Numbers (CRN)

Each student owns `rng = random.Random(seed + student_id)`, **re-instantiated fresh at the
start of each scenario**. This means the same student has the same random stream in every
scenario. Scenario differences reflect structural interventions, not RNG noise.

---

## J. External Validation (Downstream Only)

Qatar Open Data (QU registered/graduated students per semester) is used **only** for
downstream validation and scenario-range calibration; it is **never an input** to the
simulation. The simulation parameters are set before observing QU outcomes.

---

## K. Face-Validity Results (Scenario A_baseline, seed=42)

| Metric | Expected Range | Actual | Status |
|---|---|---|---|
| Graduation rate | 50–70% | 71% | ✓ PASS (≈ benchmark) |
| On-time rate (≤ 8 sem) | 30–50% | 21% | ✗ Below target |
| Probation rate | 15–25% | 17% | ✓ PASS |
| Top failure bottleneck | CMPS303 or CMPS323 | CMPS323 (49 failures) | ✓ PASS |
| Academic dropout rate | 15–30% | 20% | ✓ PASS |
| Censored rate (hit horizon) | — | 9% | — |

**Graduation rate (71%)**: Within the 50–70% plausible range and within 1.3 pp of the QU 6-year benchmark (72.3%). Reflects the full once-a-year offering set (CMPS323/405/351 Spring; CMPS310/380/355 Fall), gateway pass rates (CMPS251: 0.72, CMPS303: 0.71), grade replacement, and CMPS310 capacity raised to 40.

**On-time rate (21%)**: Below the 30–50% target. Primary constraint: six upper-curriculum courses are offered once per year, and CMPS310 (Fall-only) gates the CMPS493 senior-project compound rule.

**Probation rate (17%)**: Within the 15–25% target after implementing grade replacement: when a student retakes and passes a course, prior F attempts are removed from the GPA denominator. Previously >30% without grade replacement.

**Dropout rate (20%)**: Within the 15–30% target. Note the censored↔dropout tradeoff: raising CMPS310 capacity (35→40) converted students who previously timed out *waiting* (censored 19%→9%) into students who reach their courses and sometimes *fail* (dropout up to 20%), a net graduation gain.

**External validation**: Qatar Open Data (data.gov.qa) gives a 6-year graduation rate of 72.3% for QU CS undergrads (Fall 2015–2016 cohorts). The simulation produces 71% over the same 12-semester horizon (gap: 1.3 pp). The remaining gap reflects summer enrolment and withdrawal flexibility not modelled.

**Top bottleneck signals (current run):**
- Failures: CMPS323 (49), CMPS405 (47), CMPE263 (45), CMPS303 (45), CMPS251 (44)
- Capacity blocks: CMPS351 (58), CMPS380 (37), CMPS350 (36)
- Offering blocks: CMPS351 (189), CMPS323 (162), CMPS310 (161)
- Prereq blocks: CMPS499 (748), CMPS493 (648), then the CMPS303 cluster: CMPS405 (368), CMPS323 (345), CMPS380 (341)

**Capacity values** (non-binding courses set to 100; binding courses):
- CMPS205: 70 | CMPS251: 70 | CMPS303: 40 | CMPS350: 35 | CMPE263: 35 | CMPS310: 40
- CMPS351: 40 | CMPS380: 40 | CMPS323: 40 | CMPS405: 40 | CMPE355: 40 | CMPS493: 30 | CMPS499: 30
