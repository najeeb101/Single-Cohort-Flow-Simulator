# Assumptions

This document records every assumption behind the CS Intake Planner: the engine's parameters
(§A to §J), the references that support them (§K), and the assumptions specific to the intake
analysis and seat plan (§L). The method itself is in [methodology.md](methodology.md). Most
inputs are currently **estimates** (tagged "Estimate" on the website until replaced by QU data),
so each assumption below says what it rests on.

---

## A. Fixed Parameters (from `data/simulation_config.json`)

| Parameter | Value | Justification |
|---|---|---|
| `seed` | 42 | Arbitrary; fixed for reproducibility |
| `cohort_size` | 100 | Default intake size; also the fallback size when no past intakes are entered (the intake analysis overrides it for each candidate intake) |
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

**Sizing policy (research-era calibration; the Intake Planner does not use it) — the required sequence is seated to peak; only electives are squeezed.** The
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

> **Caveat for the Intake Planner.** The four elective slots (CSEL1 to CSEL4) are modeled as
> single courses of 35 to 70 seats because of that squeeze. Real QU elective capacity is the sum
> of all elective sections, so the default seats make electives look more crowded than they are
> (in the default-data example CSEL2 is the first course to run out of seats). Replace them with
> real figures. On the website, seats are entered as sections times `section_size` (default 35).

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

## J. Face-Validity Checks (engine)

The engine's aggregate output was sanity-checked against plausible ranges for a 12-semester
program. These are **ranges, not targets**, and the exact values move whenever the config
changes (seats, past intakes, optional terms), so run `py run.py` for today's figures rather
than trusting a number written here. The intake recommendation does not depend on matching them
exactly; what matters is the comparison against the no-shortage reference and the calibration
check against the department's own historical outcomes (§L).

| Metric | Plausible range |
|---|---|
| Graduation rate (within 12 semesters) | 50 to 70% |
| On-time rate (within 8 semesters) | 20 to 50% |
| Probation rate | 15 to 25% |
| Academic dropout rate | 15 to 30% |

`dropout_base_hazard` (0.18) is chosen so graduation lands mid-range; it is an
internally-chosen target, not fit to external data. Censored students (those who hit the horizon
without graduating) typically outnumber dropouts, because the binding constraint is *timing*
(the once-a-year sequence), not academic failure. Probation near 18% is driven by grade
replacement (passing a retake removes prior F attempts from the GPA denominator; without it,
probation exceeds 30%).

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

---

## L. Intake Analysis and Seat Plan Assumptions

These apply to `src/intake.py`. Defaults are in `DEFAULT_POLICY` / `DEFAULT_ANALYSIS` and are
editable per plan (`intake_policy`, `intake_analysis`) or per run.

| Assumption | Value / meaning | Why |
|---|---|---|
| **Future intakes equal N** | The candidate intake N is admitted every year in the headline view (next intake plus 3 more) and in the sustainable view | The department asks "what number can we take"; a constant N is the simplest policy to compare |
| **Other-program seats are constant** | `initial_state.occupancy` is subtracted from each course's seats in every regular term, forever | Real figures are not yet available; a constant is the transparent default |
| **Other-season intakes are fixed** | An intake outside the primary admission season (for example a Spring intake in `admission_sizes`) does not vary with N | Only the primary intake is the decision variable |
| **Policy default "Balanced"** | Seat shortages may cost at most 2 points of graduation rate and 10 points of on-time rate; `min_grad_rate` off | Department-editable; chosen so a recommendation tolerates ordinary delay but not seat-driven non-completion |
| **Only seat-shortage harm is limited** | Loss is measured against a pooled unlimited-seat reference | Failures and dropout cannot be fixed by intake; including them would blame the intake |
| **Past intakes rebuild today's students** | Each past intake is a cohort that entered in the matching earlier year, with its own size | The Registrar's real current body is not yet available |
| **Padding of history** | Fewer than `min_history_years` (8) of intakes are padded with the mean of the real ones (or `cohort_size`) and flagged "estimated history" | Without it the oldest cohort starts in an empty university and the backlog is too small |
| **Replications use spaced seeds** | `base + k x 10,000,019` | Consecutive seeds replay about 99% of the same students |
| **Confidence** | One-sided 95% upper bound on the monotone-smoothed loss | Avoids recommending an intake on a lucky estimate |
| **Diminishing returns** | An extra admitted student that adds fewer than 0.25 graduates per year marks the upper limit | Graduates per year often plateau rather than peak |
| **Section size** | 35 seats (`section_size`) converts seats to sections | Typical QU lecture section; editable |
| **Seat sizing from demand** | 90th percentile of regular-term registrations plus other-program seats, rounded up to whole sections, then verified | Greedy sizing from real-seat shortfalls misses demand an upstream denial hides |
| **Robustness perturbations** | One fewer section (35 seats) in each of the 3 tightest courses; every pass rate 5 points lower | A coarse sensitivity range, not a full uncertainty analysis |
| **Summer** | Optional term; seats are 30% of regular capacity (`optional_term_capacity_scale`) for courses whose offering includes Summer; a Summer course does not cost a mandatory semester | Matches how QU offers high-demand service courses; real Summer schedules vary |
| **Calibration tolerance** | A simulated outcome is flagged only if its gap exceeds `2 x sqrt(p(1-p)/n_hist + SE^2)`; enrolled headcount within 10% | One historical cohort of 100 is itself noisy (about +/- 4.7 points) |
| **Data stays put** | Seats and sections are assumed roughly constant for the next 6 years | They change every semester; re-run when the schedule changes |
| **Students are synthetic** | No real student records are used (student-level history is a planned next phase) | None loaded yet |
