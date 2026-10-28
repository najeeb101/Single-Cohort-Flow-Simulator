# Methodology: how the intake recommendation is computed

This document explains how the CS Intake Planner turns the department's data into a
recommended intake, what it assumes, and where it can be wrong. It is written for the
committee and for technical reviewers. The code behind it is `src/planner/intake.py` (analysis),
`src/planner/jobs.py` (background runner) and the unchanged simulation engine in `src/engine/simulator.py`.
Setup instructions are in the [README](../README.md) and [user guide](user_guide.md).

---

## 1. The question

> How many students should the department admit in the next CS intake, and what course seats does that number need?

An intake is "acceptable" when admitting that many students does not make the *seat shortages*
they create cost too many graduates or too many on-time graduates. The department sets the
limits (the **policy**); the analysis finds the largest intake that stays inside them.

The default policy, called **Balanced**, is:

- seat shortages may lower the 6-year graduation rate by at most **2 percentage points**;
- seat shortages may lower the on-time graduation rate (within 8 semesters) by at most **10 percentage points**;
- optionally, an absolute floor on the graduation rate (off by default).

These are editable on the site, and each analysis records the policy it used.

---

## 2. Inputs and where each comes from

Every input is tagged **QU data** or **Estimate** with an "as of" date. Real QU data is only
partly available today, so most of the default inputs are estimates, and results built mostly on
estimates are marked **illustrative**.

| Input | Source | Used for |
|---|---|---|
| Curriculum: courses, prerequisites, offered semesters | QU CS roadmap 2024 (loaded) | Who can take what, and when |
| Seats per course per regular semester (all its sections together, whatever their sizes) | Class schedule or the department | How many students fit |
| Pass rate per course | Registrar grade distributions, or an estimate | Repeats and delays |
| Past intakes (last five or more years) | Admissions office | Rebuilds today's student body |
| Seats used by other programs (for example Computer Engineering students in CMPS151 or MATH101) | Department or Registrar | A permanent load on shared courses (`initial_state.occupancy`) |
| Policy limits | Department decision | Defines an acceptable intake |
| Optional: historical outcomes (6-year graduation rate, 4-year on-time rate, sample size) and current enrolled headcount | Registrar | Calibration check |

**Today's student body is rebuilt from past intakes.** Each past intake becomes a cohort that
entered in the corresponding earlier year, and the simulation runs forward from there. If fewer
than 8 years of intakes are known, older years are **padded** with the mean of the real ones
(or the default cohort size if none are entered) and flagged "estimated history". Padding
matters: without it the oldest cohort starts in an empty university, the backlog of delayed
students is too small, and the next cohort looks better off than it is.

---

## 3. The model in brief

The simulation engine is unchanged from earlier versions.

- Students follow the real prerequisite chain, including compound rules (for example Senior
  Project needs CMPS310, plus CMPS350 or CMPS405, plus 84 completed credit hours).
- Each term, students request courses (retakes first, then required courses, then electives),
  subject to a credit-hour load cap.
- Seats are allocated by seniority: students with more completed credit hours go first. All
  cohorts compete for the same seats.
- Each attempt passes or fails at the course's pass rate. Failing repeatedly or having a low GPA
  leads to probation and can lead to dropout.
- Summer is modeled as an **optional** term: it does not use up a student's semester budget, and
  only some courses are offered, with seats scaled down (30% of regular capacity by default).
- Each student's random stream is `Random(seed + student_id)`, so any run is exactly repeatable.

---

## 4. The analysis

### 4.1 Two views of every candidate intake N

- **"Admit N next year" (the headline).** Today's students are rebuilt from the past intakes
  (padded to 8 years). Then the next intake of N is admitted, followed by one more intake of N
  that is also measured, and two further intakes of N that only add realistic load. The result
  is measured on the first two intakes. This is the question the department is actually asking.
- **"Sustainable standard intake".** A long-run department that has always admitted N: 8 earlier
  intakes of N, then 6 intakes of N, measured on the first 4. This is the check for "can we do
  this every year?".

If the headline answer is higher than the sustainable one, the card warns: *you could take N
once, but only M is sustainable every year.* If it is lower, the card explains that today's
students from past intakes already crowd the seats.

Intakes outside the primary admission season (for example a fixed Spring intake in
`admission_sizes`) are held constant and counted in graduates per year.

### 4.2 The sweep, with spaced seeds

Candidate intakes run from 20 to 200 in steps of 10 by default. Each is simulated with many
independent replications.

**Why spaced seeds.** A student's random stream is `Random(seed + student_id)`. Two runs whose
seeds differ by 1 therefore replay about 99% of the same students, shifted by one id. Averaging
over consecutive seeds gives a spread that is far too narrow (measured: 0.83 points instead of
1.39 points). Replication seeds are therefore spaced `10,000,019` apart (`spaced_seeds()`,
`SEED_STRIDE` in `src/engine/utils.py`), larger than any run's student count, so replications are
genuinely independent. The same helper now drives the Monte Carlo module.

Default effort: 20 seeds per intake for the headline view, 12 for the sustainable view (it
measures four cohorts per run, so fewer runs give the same precision), 12 for robustness runs.

The sweep runs in batches of 4 intakes in ascending order and **stops early** once every limit
has clearly failed (its smoothed value is past the limit at the last two points) and, for the
sustainable view, the diminishing-returns point has been passed by two more points. High
intakes are both the most expensive to simulate and the least informative.

**Refine pass.** For the headline view, the analysis then adds intakes in steps of 5 inside
each limit's crossing bracket, and tops up the bracket's endpoints, so that the decision is made
with about 40 seeds where it matters.

A full analysis on the default data is about 570 simulations, roughly 2.5 minutes on a 20-core
PC. Simulations run in parallel in worker processes.

### 4.3 The unlimited-seat reference

To measure harm *from seat shortages*, the analysis needs to know what would have happened
without them. It runs the same department with **unlimited seats in every term**
(`unlimited_seats: "all"` in the scenario). With no seat competition, students no longer affect
one another, so their outcomes do not depend on N at all. One **pooled** reference (8 runs,
about 10,000 students) therefore serves every N. The reference runs assert that no seat was ever
denied; if one was, the analysis fails rather than report a wrong baseline.

> **Loss from seat shortages** = reference outcome minus real-seat outcome, for the graduation
> rate and the on-time rate.

This isolates what intake can control. Failures and dropout (which a smaller intake cannot fix)
appear in both the reference and the real-seat runs and cancel out. Without a reference, the
tool would blame the intake for students who simply failed a course.

The result also reports the share of denials that happen in **Summer** catch-up terms. Summer
seats are a deliberately small bonus pool that regular sections only partly relieve, so the
card warns when most denials at the binding intake occur there.

### 4.4 Isotonic smoothing

Losses can only grow with N (more students never means fewer shortages), but a noisy estimate
can wobble: 0.9 points at 60, 0.7 at 70, 1.2 at 80. If the decision read those raw means, a
limit could appear to "fail at 70 but pass at 80". The per-N mean losses are therefore fitted to
a **monotone non-decreasing curve** (weighted pool-adjacent-violators isotonic regression,
weights proportional to 1 over the squared standard error). The decision rule reads the fitted
curve, never the raw means.

### 4.5 One-sided 95% bounds

For each N the analysis computes an upper bound on the fitted loss:

> upper = fitted loss + t(0.95, df) × sqrt(SE_block² + SE_reference²)

where `SE_block` is the standard error of the pooled block of intakes the isotonic fit merged
for that point, `SE_reference` is the reference's standard error, and `t` is a one-sided
Student-t quantile. A limit counts as met at N only if this **upper bound** is within the limit,
so the tool does not recommend an intake on a lucky estimate.

Merged intakes are **not independent estimates**. Every N reuses the same seed list, and in the
"admit N next year" view the next intake's first students keep the same random draws at every
N, so neighbouring points move together. On the default data the correlation between
neighbouring points is 0.4 to 0.8 in that view and about 0 to 0.4 in the sustainable view (whose
student ids shift with N). Pooling correlated points as if they were independent would shrink
the margin by up to a third. So `SE_block` is computed from the measured covariance: each pair
of merged points is correlated over the seeds they share (clamped to 0..1), and the weighted
mean's variance is `Σ a_i a_j ρ_ij SE_i SE_j · shared / sqrt(m_i m_j)`, with weights `a`, seed
counts `m`, and `ρ_ii = 1`. `df` counts the shared seeds once (the largest seed count in the
block, minus 1). An intake that is not merged keeps its own standard error and `seeds − 1`.
On the default data this widens the merged blocks' bounds by 0.2 to 0.5 points and changes no
recommendation.

The same correlation explains why noise at low intakes can look like a pattern rather than
scatter. On the default data the sweep's 20-seed estimate at intake 20 showed graduation 2.5
points *above* the unlimited-seat reference; with 1,200 seeds the gap is 0.3 points, i.e. none.
Seat shortages at low intakes cost on-time graduation, not graduation.

---

## 5. The decision rule

1. **Per-limit maximum.** For each limit, the largest N where the upper bound is within the
   limit **and every smaller tested N also passes**.
2. **Recommended intake = the smallest of these maxima.** The limit that gives the smallest is
   the **binding limit**.
3. **Honest "no feasible intake".** If a limit fails even at the lowest tested N, the card says
   so and does not invent a number. It names the cause (existing students or other-program
   load fill the seats even before the new intake arrives) and points to the seat plan or to
   relaxing the limit. If the estimate is inside the limit but too uncertain to confirm, the
   status is "imprecise" and the card asks for more seeds.
4. **Upper limit (diminishing returns).** On the sustainable view, the smoothed graduation
   rate gives graduates per year at each N, `(N + other-season intake) × graduation rate`. The
   upper limit is the first N beyond which an extra admitted student adds fewer than **0.25**
   graduates per year. For example, "beyond 90, about 9 of 10 extra students don't become extra
   graduates." Marginal gain is used instead of the maximum because graduates per year often
   level off rather than peak.
5. **Why.** One sentence naming the first limit to break, the intake where it breaks, and the
   course with the most seat denials at that intake.
6. **Robustness range.** The headline view is re-run on a window of intakes around the
   recommendation under two harsher assumptions: (a) the three tightest courses lose 10% of
   their seats (at least one seat each), and (b) every pass rate 5 points lower (with its own
   reference).
   The recommendation under each is shown together with the base one as a range, for example
   "72 to 80". A harsher input can move the answer in either direction (lower pass rates thin
   out later cohorts and can ease crowding), so the range spans both.
7. **Precision warning.** Shown when the confidence margin at the deciding intake is more than
   half the limit, which suggests running with more seeds.

The card also warns when most inputs are estimates ("illustrative") and how many past intakes
were padded.

---

## 6. The seat plan ("what would it take to admit 120?")

The seat planner replaces the earlier greedy "Auto-fill". It answers in **seats**, not
sections: QU sections vary in size (20, 35, 40 and more), and a course can often grow by
widening the sections it already has instead of opening a new one. Suggestions are rounded up
to a small step (`seat_step`, default 5 seats, set on the Data page) so they read as practical
numbers. How to split the extra seats into sections is the department's call. It works in
three steps.

1. **Size from demand.** Run the target intake with unlimited *regular-term* seats (Summer keeps
   its normal small pool), 10 seeds on each view. For each course take the **90th percentile of
   regular-term registrations**, add the seats used by other programs, and round up to the seat
   step. A course is only ever raised, never cut. Sizing from real-seat shortfalls would miss
   demand that an upstream denial hides: students refused a gateway course never show up asking
   for the next one.
2. **Verify.** Re-run the target with the proposed seats, 20 seeds on both views, and check each
   policy limit at that single intake (mean loss plus a one-sided 95% margin, no smoothing).
   If a limit still fails, give the course with the most denials the seats it was short: the
   90th percentile, across seeds, of its worst regular-term shortfall, rounded up to the step.
   Then check again, up to a run budget (default 6 rounds, at most 20).
3. **Report.** For each changed course: current seats, recommended seats, and seats added
   (for example "CMPS303: 105 to 120, +15 seats"), plus predicted outcomes before and after,
   and whether the limits are met. Seats are changed as exact integers, never with
   multipliers, so rounding cannot lose a seat.

The plan can be applied to the active plan, or to a walkthrough session's staged data. If the
limits still fail after the budget, the plan says so; it does not claim the target is reachable.

---

## 7. Calibration check

The simulation is compared with what the department knows:

- outcomes of intakes that entered at least 6 years ago (these do not depend on N): the 6-year
  graduation rate and the 4-year on-time rate;
- today's actual enrolled headcount (flagged if more than 10% off).

The comparison is made at the department's usual intake (the mean of the past intakes) on the
sustainable view. A gap is flagged only when it is larger than chance allows:

> allowed gap = 2 × sqrt( p(1 − p) / n_hist + SE² )

where `p` is the historical rate, `n_hist` the number of students it is based on, and `SE` the
simulation's standard error. One historical cohort of 100 is noisy on its own (about ±4.7
points), so small gaps are not treated as errors. When a gap is flagged, the card names the
outcome that is off and suggests checking pass rates and dropout settings.

---

## 8. Honesty about changing data

- **Snapshot.** Every analysis stores an exact copy of the curriculum and configuration it ran
  on, with its "as of" label, so a number can always be traced back to its inputs.
- **Standing notice.** Sections and seats change every semester. A recommendation assumes the
  entered seats stay roughly the same for the next 6 years. Update the data and re-run when the
  schedule changes.
- **Data-quality strip.** For example "Pass rates: 19 of 41 QU data, 22 estimated; Past
  intakes: 5 real plus 3 estimated". A result is flagged illustrative if fewer than half of the
  seats or pass rates are QU data, or no real past intakes were entered.
- **The AI Advisor never produces the number.** It explains the result and proposes changes to
  test. Proposals are validated and nothing is written without an administrator's click.

---

## 9. Limitations

- **Synthetic students.** Students are generated, not real records. Ability, grades and dropout
  follow configured distributions. Until student-level history is available (section 10), pass
  rates and dropout are estimates, not measurements.
- **Estimated inputs.** Seats, pass rates and past intakes are partly estimates today. The
  illustrative badge and data-quality strip exist because of this.
- **Electives as slots.** The default plan models elective slots (CSEL1 to CSEL4) as single
  courses with 35 to 70 seats, inherited from an earlier version that squeezed electives on
  purpose. Real elective capacity is the sum of all elective sections. This makes electives
  look more crowded than they are and can make them the binding course (it did in the
  example in the README). Entering real elective seats fixes it.
- **Future intakes equal N.** The analysis assumes the same N is admitted every year in the
  future, and that other-program seat use stays constant.
- **Summer is a small bonus pool.** Summer seats are modeled as a fixed fraction (30%) of
  regular capacity for courses offered in Summer. Real Summer schedules vary.
- **Seats, not sections.** The model knows each course's total seats, not how they are split
  into sections. Seat suggestions are totals rounded up to `seat_step`; whether to widen
  sections or open one is left to the department.
- **Negative loss at low intakes.** At small intakes the measured graduation loss can come out
  slightly negative (on the default data, a 20-seed sweep showed real seats about 2.5 points
  *better* than unlimited seats at intake 20). This is sampling noise: with 1,200 seeds the gap
  is 0.3 points, and switching off each dropout mechanism in turn never produced a real gap.
  It looks like a pattern because neighbouring intakes share seeds and students, so their
  noise moves together (section 4.5). The decision rule only asks whether a loss exceeds its
  limit, and the site shows any loss at or below zero as "no measurable loss".
- **No back-test yet.** The calibration check compares aggregates. It is not a replay of a
  past year against the real outcome.

---

## 10. Next phase: student-level history and Banner

**What student-level history adds**

- measured pass rates, dropout and course loads in place of estimates;
- the *real* current student body as the starting point instead of one rebuilt from intake sizes;
- a true back-test: replay, say, Fall 2019 and compare with what actually happened.

**How it would work.** The engine already has the seam for it: `src/engine/datasource.py` defines the
`StudentRecord`, `EnrollmentRecord` and `OutcomeRecord` schema and a `RealDataSource` placeholder.
The route is a **de-identified Registrar export** (hashed IDs, no names) that the department
imports locally.

**What it does not involve.** There is no live Banner login and no credentials are stored or
sent anywhere. A public Banner class-schedule search could supply real seats per section if QU
exposes one; automated collection of it would need clearance from QU IT. Any student-level data
must be handled under Qatar's personal-data protection law (Law No. 13 of 2016), and imported
data would stay on the local PC.

This phase needs QU approval and is not built.

---

## Appendix: the AI Advisor

The Advisor's chat model never produces the intake number. It receives the plan and the latest
analysis as grounding and explains them. By default it is a local Qwen model
(`qwen3:4b-instruct-2507-q4_K_M`, about 25 seconds per grounded answer) served by Ollama on the
same PC; larger models such as `qwen3-coder:30b` need about 32 GB of RAM. For a local Ollama
server the backend uses Ollama's native `/api/chat` with a context of 8192 tokens, because the
grounding prompt (about 3,000 tokens) would otherwise be silently truncated by Ollama's
4096-token default. Other servers are called through the OpenAI-compatible endpoint. Proposed
changes are validated against the plan and applied only on an administrator's click.
