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
| `dropout_gpa_floor` | 2.0 | PRIMARY dropout cause: a per-term hazard applies while cumulative GPA sits below this floor (= probation line) |
| `dropout_base_hazard` | 0.18 | Per-term dropout prob at the floor; scales up as `×(1 + (floor − gpa))` the deeper a student is below it. Calibrated so aggregate 12-semester graduation lands near the middle of a plausible 50–70% range (an internally-chosen target, not fit to external data — see §J) |
| `dropout_early_multiplier` | 2.0 | Hazard doubled in a student's first few semesters (attrition is front-loaded in years 1–2) |
| `dropout_early_sem_cutoff` | 4 | Number of personal semesters the early multiplier applies to |
| `dropout_fails_threshold` | 3 | SECONDARY cause: same course failed 3× triggers probabilistic dropout |
| `dropout_prob_on_repeated_fail` | 0.15 | 15% chance of dropping after 3rd failure of same course (reduced from 0.25 now that low GPA is the primary driver) |
| `dropout_delay_hazard_scale` | 0.0 (off) | TERTIARY cause, opt-in: per-term hazard `= scale × (credit-hour deficit vs. on_time_terms pace) / total program CH`, independent of GPA — models students who withdraw once far enough behind schedule rather than riding it out to CENSORED. Left off by default in the baseline plan. |
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
They were set by curricular role and expected difficulty, then checked against the face-validity targets in §J. Lower rates are assigned to courses that introduce a new level of abstraction, combine mathematical reasoning with programming, or sit on high-pressure prerequisite paths. Higher rates are assigned to low-credit, capstone, and broad general-education requirements where students are expected to receive more structured completion support.

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

Capacities are **assumed**; no section-size data is publicly available. Each course's
per-term seats is a single `capacity` field on the course (`data/curriculum.json`), directly
auto-calibrated by [scripts/size_capacity.py](../scripts/size_capacity.py), then hand-tunable
per course (in the JSON file or Settings) with no derived arithmetic in between.

**Sizing policy — the required sequence is seated to peak; only electives are squeezed.** The
whole required path (`cs_core`) and all non-CS courses are sized to their **peak** unconstrained
per-term demand; only interchangeable electives (`cs_elective`) are squeezed to the **75th
percentile** to keep a deliberate bottleneck. This policy changed when the real single-term
offering schedule was restored: an all-Fall+Spring curriculum let a percentile squeeze on
required courses be harmless (a missed seat just meant retaking next term, half a year), but with
several once-a-year upper courses (§4.11 of technical_design.md) a missed seat in an *early*
gateway knocks a student off the annual rhythm, so they reach a single-term upper course
off-cycle and lose a full year — cascading into non-completion (CENSORED), not just delay.
Deliberate scarcity therefore lives on electives (4 interchangeable slots, no prerequisites,
where scarcity only redistributes), not on the critical path.

The residual bottleneck is now **timing, not seats**: with the required sequence seated to peak,
what still binds is the once-a-year scheduling of the single-term upper cluster (CMPE355,
CMPS405, CMPS323) and the CMPS303 gateway feeding several of them. Re-run and read
`outputs/reports/simulation_summary.csv` for the current per-signal top course.

---

## E. Prerequisite Grade Assumption

**Any passing grade (D or better) satisfies a prerequisite.**
There is no minimum-grade enforcement (e.g., no "C or better" requirement).
This is a simplification; QU may have course-specific grade thresholds not documented publicly.

**Grade replacement:** When a student retakes and passes a previously failed course, all prior F attempts for that course are removed from the GPA denominator (F = 0.0 pts, so the numerator is unaffected). Only the passing grade counts toward GPA. This models QU's grade improvement/replacement policy.

**Partial replacement only.** Grade replacement removes from the GPA denominator only the prior F attempts for the specific course being retaken. Failures on other courses are unaffected. A student who has failed three different courses and subsequently passes two of them still carries the third course's F in their cumulative GPA until they pass it. GPA recovery is therefore incremental, not reset-based — consistent with QU's published grade-improvement policy but more conservative than a full-reset interpretation.

**E2. Retake limits.** There is no per-course maximum retake cap beyond the gateway-dropout trigger (`dropout_fails_threshold = 3` failures of the same course). A student can fail a course more than three times without dropping if their overall GPA stays above the dropout floor and no single course has been failed three or more times. In reality QU may enforce a maximum attempt limit (commonly 3 attempts at most universities); this simplification means the simulator slightly understates dropout rates for students who persistently fail multiple different courses while keeping any single course's fail count below the threshold. The effect is expected to be small given that the GPA-hazard dropout path (Assumption A above) captures sustained low performance regardless of how it is distributed across courses.

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

## J. Face-Validity Results (baseline, seed=42, 30-seed Monte Carlo)

> These are a **snapshot** of the current default plan (8 yearly cohorts, the real single-term
> offering schedule, cs_core sized to peak). They move whenever the config changes — the ranges
> are the sanity check, not the exact numbers. Re-run `py run.py` for today's actual values.

| Metric | Expected Range | Actual (MC mean) | Status |
|---|---|---|---|
| Graduation rate | 50–70% | 65.5% (95% CI 65.0–66.0%) | ✓ PASS |
| On-time rate (≤ 8 sem) | 20–50% | 23.4% | ✓ PASS |
| Probation rate | 15–25% | 17.9% | ✓ PASS |
| Academic dropout rate | 15–30% | 14.9% | ✓ (just under) |
| Censored rate (hit horizon) | — | 22.0% | — |

**Graduation rate (~65%)**: Within the plausible range for a 12-semester program. The residual
non-completion is dominated by **once-a-year scheduling**: 8 core courses are single-term, so a
student who falls behind on the shared seat pool reaches one off-cycle and loses a full year,
which pushes the tail past the 12-semester horizon (→ CENSORED). `dropout_base_hazard` (0.18)
is calibrated so graduation lands mid-range — an internally-chosen target, not fit to external
data.

**Censored dominates dropout here** (22% vs. 15%): the binding constraint is *timing* (the
once-a-year sequence), not academic failure. This is why raising capacity on the **early**
gateways — which keeps students on the annual rhythm so they hit the single-term upper courses
on schedule — is what moves graduation, and why the required sequence (cs_core) is sized to
peak demand rather than squeezed. See `scripts/size_capacity.py`.

**Probation rate (~18%)**: Within the 15–25% target, driven by grade replacement (passing a
retake removes prior F attempts from the GPA denominator; without it, probation exceeds 30%).

**Which courses bind** (a snapshot — re-derive from a run): the capacity/offering/prereq
pressure concentrates on the single-term cluster (CMPE355, CMPS405, CMPS323) and the CMPS303
gateway that feeds several of them. Read `outputs/reports/simulation_summary.csv` after a run
for the current top course per signal.

---

## K. Key References (with assumption mapping)

Each reference below supports a specific design decision or calibration choice in the
simulator. This is the "why did we do it this way?" audit trail for each modelling assumption —
every entry was checked against its source before being added here (title, venue, and
year/page numbers confirmed independently, not taken on faith from a prior draft).

| Reference | Assumption / Design Decision Supported |
|---|---|
| Law & Kelton (2000), *Simulation Modeling and Analysis*, Ch. 11 | CRN (Assumption I) — variance reduction enables causal scenario comparison with n=100 per cohort |
| Banks, Carson, Nelson & Nicol (2010), *Discrete-Event System Simulation* | General discrete-event simulation methodology underlying the three-phase per-term loop (desired enrollment → seat allocation → take courses) |
| Saltzman & Roeder (2012), *J. Operational Research Society* 63(4) | Course-level congestion is invisible to aggregate graduation statistics — motivates the four-signal bottleneck decomposition (failures/capacity/offering/prerequisite) |
| Star, Sciortino, Deutschman, Spralja & Maples (n.d.), CSULB College of Engineering | ~6-year steady-state propagation time after an admissions/load shock — motivates seeding warm-start incumbent cohorts rather than starting from an empty university |
| Duarte & Márquez (2016), LACCEI Multi-Conference | Agent-based vs. aggregate model justification — motivates individual-level simulation over cohort-level pooled-count equations |
| Ishitani (2006), *J. Higher Education* 77(5) | `dropout_early_multiplier = 2.0` — empirical support for front-loaded early-semester attrition (Assumption A) |
| Singer & Willett (2003), *Applied Longitudinal Data Analysis* | Competing-risk/survival framing for graduation vs. dropout vs. censoring; censored-rate-as-lower-bound interpretation |
