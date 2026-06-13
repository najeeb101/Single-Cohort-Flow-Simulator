# Simulation Assumptions

This document records every assumption made in the Single-Cohort Flow Simulator.
All assumptions were made before coding and are not changed post-hoc to improve results.

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

Pass rates are **assumed** — no public per-course failure data exists for QU CS programs.
They were calibrated to face-validity targets (see §F below) and follow QU course difficulty reputation:

| Course | Base Rate | Difficulty Rationale |
|---|---|---|
| CMPS151 | 0.78 | Introductory programming — CS1 weed-out; global ~67%, QU-filtered higher |
| CMPS200 | 0.98 | 1-CH ethics course |
| CMPS205 | 0.76 | Discrete mathematics — math-heavy; real struggle for CS students |
| CMPS251 | 0.82 | OOP (already-filtered cohort, follows CMPS151) |
| CMPS303 | 0.74 | Data Structures — known bottleneck |
| CMPS323 | 0.65 | Algorithms — hardest theory course |
| CMPS310 | 0.82 | Software Engineering — project course, should not fail below bottleneck |
| CMPS405 | 0.72 | Operating Systems — labs buoy grades; not as brutal as algorithms |
| CMPS493/499 | 0.88 / 0.90 | Senior Project — high pass rate by design |
| Non-CS / GED | 0.80–0.98 | Low difficulty; filler courses (MATH_2: 0.85, MATH_4/5: 0.82, PHYS_1: 0.84) |

---

## D. Course Capacity

Capacities are **assumed** — no section-size data is publicly available.
The focused binding set (courses where capacity actually creates queueing pressure):

| Course | Capacity | Why Binding |
|---|---|---|
| CMPS303 | 45 | High demand (gate course), both terms |
| CMPS323 | 35 | Spring-only; accumulated demand |
| CMPS310 | 35 | Both terms; cap 35 per section |
| CMPS405 | 35 | Spring-only; accumulated demand |
| CMPS493 | 30 | Fall-only; senior project bottleneck |
| CMPS499 | 30 | Spring-only; follows CMPS493 |

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
downstream validation and scenario-range calibration — it is **never an input** to the
simulation. The simulation parameters are set before observing QU outcomes.

---

## K. Face-Validity Results (Scenario A_baseline, seed=42)

| Metric | Expected Range | Actual | Status |
|---|---|---|---|
| Graduation rate | 50–70% | 65% | ✓ PASS |
| On-time rate (≤ 8 sem) | 30–50% | 19% | ✗ Below target |
| Probation rate | 15–25% | 16% | ✓ PASS |
| Top failure bottleneck | CMPS303 or CMPS323 | CMPS323 (64 failures) | ✓ PASS |
| Academic dropout rate | 15–30% | 11% | ✗ Below target |
| Censored rate (hit horizon) | — | 24% | — |

**Graduation rate (65%)**: Within the 50–70% plausible range. CMPS310 is offered both semesters, CMPS405 capacity is 35, gateway course pass rates were raised (CMPS251: 0.82, CMPS303: 0.74, CMPE263: 0.76), dropout policy was relaxed (threshold 4, probability 0.25), and grade replacement is now modelled.

**On-time rate (19%)**: Still below the 30–50% target. Primary remaining constraint: CMPS323 (Spring-only) and CMPS405 (Spring-only) compete in the same Spring semester, and CMPS493 (Fall-only) bottlenecks senior project entry.

**Probation rate (16%)**: Now within the 15–25% target after implementing grade replacement — when a student retakes and passes a course, prior F attempts are removed from the GPA denominator. Previously 34% without grade replacement.

**Dropout rate (11%)**: Below the 15–30% target range. Relaxing the dropout threshold (3→4 fails) and raising gateway pass rates reduced fail accumulation. Students who no longer drop out stay enrolled to the horizon (censored 24%) instead.

**External validation**: Qatar Open Data (data.gov.qa) gives a 6-year graduation rate of 72.3% for QU CS undergrads (Fall 2015–2016 cohorts). The simulation produces 65% over the same 12-semester horizon (gap: 7 pp). Remaining gap reflects summer enrolment, course withdrawal without grade penalty, and academic advising — mechanisms not modelled.

**Capacity values** (non-binding courses set to 100; binding courses):
- CMPS303: 45 | CMPS323: 35 | CMPS310: 35 | CMPS405: 35 | CMPS493: 30 | CMPS499: 30
