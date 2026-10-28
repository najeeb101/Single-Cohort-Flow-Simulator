# The simulation engine

How one simulated student and one simulated term work. This is the per-student mechanics layer
that everything else (the intake analysis, the walkthrough, the bottleneck views) is built on.
For where the code lives see [architecture.md](architecture.md); for how the recommendation is
computed from many runs see [methodology.md](methodology.md); for every parameter and why it has
its value see [assumptions.md](assumptions.md).

The engine is a **discrete-term, agent-based model**. Time advances in whole terms. The agents
are independent `Student` objects, many cohorts at once. They interact only by competing for
finite course seats. There is no continuous time.

---

## 1. A run, start to finish (`Simulator.run`)

```
1. build the population via the DataSource seam (cohort specs -> Student objects)
2. for each calendar term from the earliest admission to the horizon:
       admit any cohort due this term
       run the term (three phases, section 3)
3. anyone still ACTIVE/DELAYED at their own horizon becomes CENSORED
4. return SimulationResult(history, students, scenario, config)
```

Terms follow the config-driven season cycle (`src/domain/semester.py`): Fall and Spring are
mandatory; Summer and Winter are optional and off by default. A cohort is only ever admitted in a
mandatory season. Each student has a **personal semester counter** that ticks only on mandatory
terms, so taking a Summer course never costs a semester of the `max_terms` budget.

## 2. Building a student

- **Private RNG.** `random.Random(seed + student_id)`. Student *i* draws the identical random
  stream in every scenario, so changing a structural input (more seats, a new offering season)
  changes outcomes only through that input, not through random noise. This is the **common
  random numbers** property. (Neighbouring seeds replay almost the same students, which is why
  the intake analysis uses *spaced* seeds; see methodology section 4.2.)
- **Fixed ability.** `clip(Normal(0, 0.15), -0.30, +0.30)`, drawn once. It shifts every pass
  probability: `effective_pass_rate = clip(base + ability, 0.05, 0.98)`.
- **Tiebreak token.** `hash((seed, student_id))`, used only to break seat-allocation ties. It is
  computed separately so it never consumes the pass/fail stream.

Initial state: nothing completed, GPA 0, status `ACTIVE`, not on probation.

## 3. The three-phase term (`Simulator._run_term`)

At the start of a term, `available` is the set of courses whose `offering` list contains the
season, and `active` is every student who is `ACTIVE` or `DELAYED`, across all cohorts.

**Phase 1: desired enrollment** (`Student.get_desired_courses`). Each active student builds an
ordered wish list: courses they can take (not yet passed, eligible by `prerequisites` or a
compound `rule_expr`), in this priority order: retakes first, then the config's
`enrollment_priority_tiers` (each tier is a set of categories with an optional `min_ch` gate; QU
CS default is required courses, then electives once 60 CH are done, then math/science/English/
general-education filler). The list is filled up to the credit-load cap: 18 CH normally, 12 CH on
probation.

**Phase 2: seat allocation.** For each requested course, if requesters fit in the free seats
everyone gets one. Otherwise requesters are sorted by `(registration_tier(completed_ch),
tiebreak_token)`, so seniors outrank freshmen, the first N get seats, and every other requester
records a `capacity_block`. Free seats are the course's `capacity` minus seats used by other
programs (`initial_state.occupancy`), floored at 0. Optional terms use a separate, smaller pool
(`optional_term_capacity_scale`).

**Phase 3: take courses.** For each granted seat, draw `student.rng.random()`. Below the
effective pass rate the student passes and a letter grade is sampled; otherwise the grade is F and
a `fail` is recorded.

Then, still inside the term: dropout checks, graduation check (all required courses passed),
`DELAYED` flag (past nominal semester 8), block recording, and a timeline snapshot.

## 4. Grades, GPA, probation

- **Grade tiers.** On a pass, the letter grade is sampled from a distribution chosen by the
  course's *base* pass rate (hard <= 0.72, medium 0.73-0.82, easy > 0.82), not the
  student-shifted rate. Ability affects whether you pass, not how hard the course is.

  | Grade | Points | Hard | Medium | Easy |
  |---|---|---|---|---|
  | A | 4.0 | 8% | 12% | 25% |
  | B+ | 3.3 | 15% | 18% | 25% |
  | B | 3.0 | 32% | 33% | 25% |
  | C+ | 2.3 | 22% | 22% | 12% |
  | C | 2.0 | 18% | 13% | 10% |
  | D | 1.0 | 5% | 2% | 3% |

- **GPA** = sum(points x credits) / sum(attempted credits). F counts 0 points but stays in the
  denominator.
- **Grade replacement.** Passing a course you previously failed removes the old F attempts from
  the denominator (QU's grade-improvement policy). This is why the probation rate lands in a
  realistic 15-25% range.
- **Probation.** `completed_ch >= 25 and gpa < 2.0` caps the next term's load at 12 CH. Recovering
  to `gpa >= 2.0` lifts it. `ever_probation` latches on first occurrence.
- **Prerequisites.** A grade of D or better satisfies a prerequisite.

## 5. Dropout and status

Two independent, config-driven triggers can end a student's career early:

| Trigger | Mechanism |
|---|---|
| Chronic low GPA | Each term GPA sits below `dropout_gpa_floor` (2.0) carries a per-term hazard of leaving, multiplied by `dropout_early_multiplier` (2.0) during the first `dropout_early_sem_cutoff` (4) semesters. |
| Stuck on one course | The same course failed at least `dropout_fails_threshold` (3) times gives `dropout_prob_on_repeated_fail` (0.15) per additional failure. |

Statuses: `ACTIVE`, `DELAYED`, `GRADUATED`, `DROPPED`, `CENSORED`.

```
ACTIVE   -> DELAYED   past nominal semester 8, still progressing
ACTIVE   -> GRADUATED all required courses passed
ACTIVE   -> DROPPED   a dropout trigger fires
DELAYED  -> GRADUATED / DROPPED   as above
ACTIVE/DELAYED -> CENSORED   still enrolled when their max_terms horizon ends
```

`CENSORED` (ran out of time) and `DROPPED` (academic withdrawal) are kept apart: relieving a seat
or offering bottleneck turns `CENSORED` students into graduates, which it would not do for a
`DROPPED` one.

Graduation is "every required course passed". `completed_ch >= 120` is deliberately **not** a
second gate: the catalog sums to exactly 120 CH, and a dual gate creates a silent failure mode
where the two disagree.

## 6. The four block signals

A student can be stuck for four different reasons. Each has a different fix, so they are counted
separately and never summed:

| Signal | Meaning | Recorded |
|---|---|---|
| `fail_counts` | Attempted and failed | Phase 3 |
| `capacity_block_counts` | Requested a seat and lost the allocation | Phase 2 |
| `offering_block_counts` | Eligible, but the course is not taught this term | `_record_blocks` |
| `prereq_block_counts` | Prerequisites not yet satisfied | `_record_blocks` |

Each has a `*_by_cohort` variant for per-cohort post-mortems. The units differ (`fail` counts
attempts; `offering` and `prereq` accumulate one event per waiting student per term), so compare
within a signal across courses, never across signals.

The three structural rankings (capacity, offering, prereq) count **mandatory terms only**, because
Summer seats are a deliberately small bonus pool and a Summer denial does not delay graduation.
`fail_counts` is not filtered. `_record_blocks` on an optional term sweeps only the courses
actually offered that term.

## 7. Why this supports an intake decision

An intake decision depends on how much *seat shortage* a given number of admitted students causes,
separately from the failures and dropouts that would have happened anyway. The model supports
that because it (a) advances in whole terms, so a once-a-year course forces a full-year wait when
a seat is missed; (b) enforces prerequisites and compound rules exactly, so one gateway course
(CMPS303) can stall three dependents at once; (c) lets every cohort and every other program
compete for the same seats by seniority; and (d) gives each student a private RNG stream, so an
unlimited-seat run of the same students isolates the outcome change caused by seat competition
alone.
