# CS Intake Planner: Project Overview and Technical Guide

> **A note on this document.** It explains what the project does and how it works, in enough
> depth to understand and extend it, without claiming any specific output as "the" answer.
> Results depend on the data entered (seats, pass rates, past intakes, policy limits), and that
> data changes every semester, so any number written here would go stale quickly. Run the
> analysis for today's figures. For the exact method behind the recommendation, see
> [methodology.md](methodology.md); for day-to-day use, see [user_guide.md](user_guide.md).

---

## 1. What this project is

Qatar University's CS department has to decide each year how many students to admit. The honest
answer depends on things a headcount cannot show: the program has deep prerequisite chains,
several core courses are taught only once a year, and every cohort in the department competes
for the same limited course seats, together with students from other programs. Admit too many
and a gateway course runs out of seats; students who miss it lose a semester or a full year,
some never finish. Admit too few and the department under-serves its mission.

The question this tool answers is:

> **How many students should we admit into the next CS intake, and what course seats does that number need?**

It does so by simulating the whole department. Synthetic students move through the real CS
study plan one semester at a time, register by seniority priority, pass or fail each course at
its pass rate, and compete with the students already enrolled and with other programs for seats.
The analysis runs this for many intake sizes and many random replications, compares each against
a no-seat-shortage reference, and finds the largest intake whose *seat-shortage harm* stays
within limits the department sets. A second tool, the seat planner, answers the follow-up "what
would it take to admit more?" in seats per course.

The tool is deliberately **not** a prediction for any named, real student, and it does not use
real student records (none are loaded yet). It is a structural model: given the curriculum's
rules, the seats, and reasonable assumptions about pass rates and attrition, how much does
crowding cost at each intake size? See §6 for what it does and does not claim to know.

It runs locally on a department PC, started with `start.bat`. Computer Engineering may be added
later as a second program on the same engine (a separate Plan with its own curriculum).

---

## 2. The university being modeled

**The curriculum.** QU's 2024 CS study plan is 41 courses, 120 credit hours, on a nominal
8-semester path. A handful of upper-level courses are taught in only one season a year (for
example a Fall-only software engineering course, Spring-only algorithms and database courses):
missing one is not a one-semester slip, it is a full-year wait. Data Structures is a *gateway*:
passing it is a prerequisite for three other courses at once. The senior-project sequence has a
*compound* eligibility rule (several specific courses passed and a minimum credit-hour count),
the curriculum's hardest gate.

**One shared seat pool.** A real registrar does not size a course for one entering class: every
cohort currently enrolled shows up wanting the same course in the same term. The simulator runs
several cohorts at once from the same per-course seat pool, term after term. Seats are also used
by students from **other programs** (for example Computer Engineering students in CMPS151 or
MATH101); that permanent load is the `initial_state.occupancy` input and is subtracted from a
course's free seats in every regular term.

**Today's student body is rebuilt from past intakes.** The department enters how many students
entered CS in each of the last several years. The engine turns each into a cohort that entered
in the corresponding earlier year, padding with estimated older years so the oldest cohort does
not start in an empty university, and the next intake walks into the department that results.

**The term calendar.** Fall and Spring are *mandatory*: they advance a student's personal
graduation clock, and cohorts are only ever admitted into them. Summer (and Winter, if a plan
defines it) are *optional*: a course is offered only if its own offering list includes that
season, seats are scaled down (30% of regular capacity by default), and using one does not cost
a student a mandatory semester. The optional-term switch is an admin setting; the season data
sits in the configuration whether or not it is on.

---

## 3. How the simulation works

### 3.1 The mental model

A **discrete-term, agent-based simulation**. Time advances in whole semesters. The agents are
`Student` objects, each a small state machine (GPA, completed courses, status). Each term every
student tries to register, some requests are denied for lack of seats, and a seeded coin-flip
decides who passes. Everything else (analytics, the API, the website) reports on what happened.

### 3.2 Two clocks

A global clock runs the whole university. A student's graduation deadline is judged on a
**personal clock**, their own semester count since admission, which ticks only on a mandatory
term. A student admitted years into the run gets the same personal budget as the first cohort,
and taking a Summer course never costs a semester.

### 3.3 The three-phase term loop

Every term, for every active student across every cohort at once:

1. **Desired enrollment.** Each student builds a wish-list: retakes first, then required courses,
   then electives once past a credit-hour threshold, then filler, stopping at the per-term
   credit-hour cap (lower on probation). Seat availability is not checked yet.
2. **Seat allocation.** If a course has enough seats for everyone who wants it, all get in.
   Otherwise requesters are ranked by completed credit hours (priority registration) with a
   stable random tiebreak, and only the top N get seats. The rest are **capacity-blocked**.
   Seniors out-rank freshmen, which is why a shared multi-cohort pool matters.
3. **Outcome resolution.** Each granted seat resolves pass or fail from the course pass rate
   adjusted by the student's fixed ability; a pass draws a letter grade. GPA, probation and the
   dropout check update in the same term.

### 3.4 The four block signals

Every term, for every course a student has not yet passed, the simulator records which of four
distinct reasons applies. They are never added together: they are different units.

| Signal | Means | Points to |
|---|---|---|
| **Failure** | They took it and failed | Course difficulty or teaching support |
| **Capacity block** | They wanted a seat and did not get one | Add sections |
| **Offering block** | Eligible, but not taught this term | Offer it more often |
| **Prerequisite block** | The prerequisite is not yet passed | Fix the upstream course |

The Bottlenecks page uses these to show which courses limit intake. The intake recommendation
itself uses the capacity signal (seat denials), because that is the part intake controls.

### 3.5 GPA, probation, and dropout

GPA is credit-weighted with failed attempts counted in the denominator, so chronic failure drags
it down. Below the probation threshold a student's load cap is reduced. A retaken, passed course
removes its earlier failing attempts from the denominator. Two independent triggers end a
student's career early: chronic low GPA (front-loaded in the first semesters) and repeatedly
failing the same course. A student who neither drops nor finishes within the personal semester
budget is "censored".

### 3.6 Determinism and replication

Every student owns a private random stream seeded by `seed + student_id`, so a given
configuration reproduces exactly, and the same simulated student draws the same pass/fail
sequence in any scenario being compared. That makes paired what-if comparisons causally
meaningful. The same property has a consequence for *replication*: two seeds that differ by 1
replay about 99% of the same students, so independent replications must use **widely spaced
seeds** (`spaced_seeds()`, stride 10,000,019). The intake analysis and Monte Carlo both do.

### 3.7 Capacity

Each course has a per-term `capacity` (seats). On the website seats are entered as sections
times a section size (default 35); other-program usage is subtracted every regular term; and
optional terms use the smaller scaled pool. An unlimited-seat scenario hook exists only to
produce the analysis's no-shortage reference and its demand sizing.

### 3.8 The intake analysis

On top of the engine, `src/intake.py` runs the sweep described in [methodology.md](methodology.md):
two views of every candidate intake (next year given today's students; sustainable every year),
many spaced-seed replications, a pooled unlimited-seat reference, monotone smoothing, one-sided
95% bounds, and a decision rule that returns a recommended intake, a sustainable intake, an upper
limit, the reason, and a robustness range. It runs as a background job (`src/jobs.py`), one at a
time, and stores a snapshot of its inputs with its result.

### 3.9 How it is all wired together

```
data/curriculum.json, simulation_config.json
        |  (one-time seed into the database; the database is authoritative after that)
        v
Simulator.run()  -->  History (counters, per-term snapshots, the four block signals)
        v
   +----+-------------------------------+
   v                                     v
intake.py (sweep, seat plan)        analytics.py / service.py
 run by jobs.py in the background    (metrics, flow_timeline, the API's in-memory seam)
   v                                     v
              FastAPI backend (src/api.py)
                          v
   Next.js website: Intake Planner (home), Bottlenecks, Walkthrough
   (advance one semester at a time), Advisor, Data, Programs (Plans, Plan Builder),
   Methodology
```

There is one simulation engine. The command line (`py run.py`, `py run.py --intake`) and the
website call the same code.

---

## 4. What kind of insight this produces

- **How many to admit.** The recommended, sustainable and upper-limit intakes, each with the
  reason and a robustness range, and an honest "no feasible intake" when today's students and
  other programs already fill the seats.
- **What breaks first.** The first policy limit to fail and the course that runs out of seats,
  not just a graduation rate.
- **What it would take.** For a target intake, the sections to add per course, sized from
  simulated demand and verified against the policy, with predicted outcomes before and after.
- **Which obstacle is responsible.** Because the four signals are tracked separately, the
  Bottlenecks page can tell a hard course from a scheduling gap, an upstream prerequisite chokepoint,
  or a too-small section. A delay at a gateway shows up as a prerequisite-block spike on every
  course behind it even though nothing is wrong with those courses.
- **Whether a fix helps.** The Advisor can propose a change (one more section, a pass-rate gain)
  and **Test** it as a what-if before anything is saved.

What it does **not** do is hand over a single "true" number. Every result carries uncertainty
and an indication of how much of it rests on real QU data.

---

## 5. Design decisions and tradeoffs

| Decision | What it buys | What it gives up |
|---|---|---|
| **Agent-based (individual students)** | Delay attributable to a specific course-level cause | More computation than a pooled-counts model |
| **Per-student seeds, spaced across replications** | Exact repeatability and clean paired comparisons; independent replications | A single run is not an independent draw of the real world |
| **Compare against an unlimited-seat reference** | Isolates the harm that intake controls from failures and dropout it cannot fix | One more set of simulations per analysis |
| **Monotone (isotonic) smoothing and one-sided 95% bounds** | No jagged "fails at 70, passes at 80" answers; no recommendation on a lucky estimate | A slightly conservative recommendation |
| **Four separate, never-summed block signals** | Separates difficulty, scheduling, prerequisites and seats | More to interpret than one score |
| **Multi-cohort shared pool, student body rebuilt from past intakes** | Real priority-registration competition; today's students included | Padding older years is an estimate |
| **Config-driven calendar, optional terms as an admin setting** | Summer behavior can change without code | More branching in the season and capacity helpers |
| **Multi-plan architecture** | Plans cannot corrupt each other; a second program is a new Plan | Two similar plans store two full copies |
| **SQLite, local, one analysis at a time** | Zero setup, runs on a department PC | Not a multi-user production system |

---

## 6. What this model deliberately does not know

1. **Inputs are partly estimates.** Pass rates, seats, past intakes and dropout parameters are
   tagged QU data or estimate. Until student-level history is available, pass rates and dropout
   are assumed, not measured. Trust relative comparisons (same seeds, one change) more than
   any absolute figure. Results built mostly on estimates are marked illustrative.
2. **Electives are modeled as slots.** The default plan has four elective slots (CSEL1 to CSEL4)
   as single courses; real elective capacity is the sum of all elective sections. Enter real
   seats before relying on elective-driven results.
3. **No minimum-grade prerequisites.** Any passing grade satisfies a prerequisite.
4. **Optional terms are narrow.** Only courses whose offering list includes Summer or Winter
   run then, with a deliberately small seat pool. Course withdrawal is not modeled.
5. **No non-academic attrition.** Financial hardship, transfers, health and family are absent.
   Exits are graduation, chronic low GPA, repeatedly failing one course, or running out of
   semesters.
6. **Ability is one scalar per student**, not per subject or time-varying.
7. **No instructor or section quality variation.** Every section shares the course's pass rate.
8. **The curriculum is static** for the whole run.
9. **Future intakes are assumed equal to N**, and other-program seat use constant.
10. **Closed system.** No transfers in, no changes of major, no transfer or AP credit.
11. **Confidence ranges describe the model**, with fixed assumptions, not whether the assumptions
    themselves are right.

If asked "how do you know the numbers are right?", the defensible answer is: the assumptions are
individually documented ([assumptions.md](assumptions.md)); a calibration check compares the
simulation with the historical outcomes and headcount the department enters, flagging only gaps
larger than chance; every analysis stores the inputs it used; and comparisons use identical
seeds so differences are real even where absolute numbers are estimates.

---

## 7. How the department uses it

- **First-run setup.** A required screen asks for past intakes and for seats used by other
  programs (zero is accepted). CSV or Excel import fills many rows at once. The same editor
  stays on the Data page.
- **Data.** Edit courses and seats (sections times size), pass rates, current students (past
  intakes), other-program seats, policy limits and analysis settings, with QU data or
  estimate tags. Edits persist immediately as the new baseline.
- **Intake Planner (home).** Check the policy, press Run analysis, read the recommendation card,
  chart and per-intake table, use the seat planner and Apply, review the calibration check, and
  print or export past analyses for the committee.
- **Bottlenecks.** Which courses limit intake, and how many sections they need.
- **Walkthrough.** Advance one semester at a time, editing seats, pass rates, occupancy and the
  next intake between steps, with a term history that can be previewed and rewound.
- **Advisor.** A rules-based reading of the analysis, plus an optional chat with a local model
  (Qwen through Ollama) grounded in the plan and the latest analysis. The AI explains and
  proposes; it never produces the intake number and never writes anything on its own.
- **Programs.** Separate curriculum and configuration combinations (Plans, Plan Builder), the
  route to adding Computer Engineering.

---

## 8. Where this could go next

The most valuable next step is **student-level history**: pass rates, dropout and course loads
measured from a de-identified Registrar export (hashed IDs, no names), the real current student
body as the starting point, and a true back-test. The engine already has the seam
(`src/datasource.py`, `RealDataSource`). No live Banner login is involved, and any
student-level data would stay on the local PC. See the last section of
[methodology.md](methodology.md).
