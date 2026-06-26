# Single-Cohort Flow Simulator — Project Overview & Technical Guide

**Author:** Najeeb Barkhad

> **A note on this document.** Earlier versions of this write-up were a research-paper-style
> report with a Results section full of percentages (graduation rate, dropout rate, bottleneck
> counts, confidence intervals). Those numbers depend on the simulator's current configuration —
> pass rates, section counts, dropout parameters, whether optional Winter/Summer terms are
> switched on — and that configuration is meant to change as the curriculum committee tunes it.
> Every number in a fixed write-up like that goes stale the moment someone edits
> `simulation_config.json` or flips a Settings toggle, which already happened twice during this
> project. This version instead explains **what the project does and how it works**, in enough
> technical depth to actually understand and extend it, without claiming any specific output as
> "the" answer. If you want today's actual numbers, run the simulation — that's what it's for.

---

## 1. What this project is

Qatar University's BSc Computer Science program, like most CS programs, has deep prerequisite
chains and courses that are only taught once a year. A student who fails a once-a-year course, or
gets stuck waiting on a prerequisite, doesn't lose a semester — they lose a full year. The
question this project exists to answer is: **when a student doesn't graduate on time, which kind
of obstacle was actually responsible** — a hard course, a once-a-year scheduling gap, an upstream
prerequisite, or a too-small lecture section — and which of those is the curriculum committee's
most effective lever to pull?

You can't answer that from a transcript spreadsheet, because a spreadsheet only tells you a
student was *delayed*, not *why*. So this project builds a small, fast, deterministic simulation
of the whole department: synthetic students move through the curriculum one semester at a time,
competing for the same limited course seats as every other cohort enrolled at the same time, and
every time someone gets stuck, the simulator records **which one of four distinct reasons** caused
it. Run that for a few thousand simulated student-careers and you get a clean, attributable answer
instead of a guess.

It is deliberately **not** a prediction tool for any real, named student, and it does not use real
QU student records (none are public). It is a *structural* model: given the rules of the
curriculum (prerequisites, seasonal offerings, seat counts) and reasonable assumptions about pass
rates and attrition, what does the *shape* of delay look like, and which structural fix would
relieve the most of it? See §6 for exactly what it does and doesn't claim to know.

---

## 2. The university being modeled

**The curriculum.** QU's 2024 CS study plan is 38 courses, 120 credit hours, on a nominal
8-semester path. A handful of upper-level courses are only taught in one season a year (e.g. a
Fall-only software engineering course, Spring-only algorithms/operating-systems/database
courses) — missing one of those isn't a one-semester slip, it's a full-year wait. One course
(Data Structures) is a *gateway*: passing it is the prerequisite for three other courses at once,
so any delay there cascades into three separate downstream delays simultaneously. The
senior-project sequence has a *compound* eligibility rule — it requires several specific courses
passed *and* a minimum credit-hour count, all at once — which is the curriculum's hardest gate to
satisfy cleanly.

**One shared seat pool, not one cohort in isolation.** A real registrar doesn't size a course's
seats for one entering class — every cohort currently enrolled (freshmen through seniors) shows
up wanting the same popular course in the same term, and someone has to decide who gets in. A
single-cohort model can't represent that competition at all. This simulator runs several cohorts
at once: a new cohort is admitted every year, and a handful of "incumbent" cohorts are seeded in
*before* the study window starts specifically so that, by the time the cohorts you actually care
about arrive, the gateway courses are already realistically full — not an artificially empty
campus. All cohorts draw from the exact same per-course seat pool, term after term.

**The term calendar.** Every cohort always has a guaranteed Fall and Spring term — those are
*mandatory*: they're what advances a student's personal graduation clock and what every cohort is
admitted into. Winter and Summer intersessions exist as an **optional, admin-controlled feature**
(Settings → "Enable optional Winter/Summer intersessions", off by default): when off, the
simulator runs a plain two-season academic year; when on, a handful of high-demand courses get a
smaller bonus section in Winter/Summer that a student can use to retake a failed course or get
ahead, without it costing them a mandatory semester on their personal clock. Turning it on or off
doesn't require re-entering any data — the optional-term course list and section sizes live in the
configuration the whole time, inert until switched on.

---

## 3. How the simulation actually works

### 3.1 The mental model

This is a **discrete-term, agent-based simulation**. There's no continuous time — the clock only
ever advances in whole semesters. The "agents" are `Student` objects, each an independent little
state machine (GPA, completed courses, status). Nothing is solved with an equation; every term,
every student tries to register for courses, some requests get denied because of seat scarcity,
and a seeded, reproducible coin-flip decides who passes and who fails. Run that loop for up to
twelve semesters per student and look at what comes out the other end. Everything else in the
codebase — analytics, charts, the API, the web dashboard — is just *reporting* on what happened
during those term-by-term loops.

### 3.2 Two clocks, not one

There's a single **global clock** shared by the whole university (term 0, term 1, term 2, ...,
running negative for the incumbent warm-start cohorts admitted before the study window). But a
student's own graduation deadline is judged on their **personal clock** — their own semester count
since *their* admission, which only ticks forward on a mandatory term. A student admitted years
into the simulation still gets a full personal budget of semesters, exactly like the first cohort
admitted. This distinction is also what makes an optional Winter/Summer term "free": a student can
take a course then, and it updates their GPA/credits/failed-attempts normally, but it does not
advance their personal clock — so using the bonus term never costs them a mandatory semester, even
if it happens to be the term that finishes their degree.

### 3.3 The three-phase term loop

Every term, for **every active student across every cohort at once** (this is what makes it a
genuine multi-cohort model rather than four separate copies of a single-cohort one — they all
compete for the same seats), three phases run in strict order:

1. **Desired enrollment.** Each student independently builds a wish-list: retakes of previously
   failed courses first, then required courses in priority order, then electives only once
   they've crossed a credit-hour threshold, then filler courses — stopping once the next course
   would exceed their per-term credit-hour cap (a lower cap applies if they're on academic
   probation). Nothing about seat availability is checked yet — a student can "want" a course that
   turns out to be full.
2. **Seat allocation.** For each course, if there are enough seats for everyone who wants it,
   everyone gets in. Otherwise, requesters are ranked by completed credit hours (more credits =
   registers first, mirroring real priority registration) with a stable random tiebreak, and only
   the top N — N being that course's actual section count times seats-per-section — get a seat.
   Everyone else is recorded as **capacity-blocked**. A backlog of held-back juniors will
   out-rank a fresh batch of freshmen for a popular gateway course every single term — that
   seniority effect is the whole reason a shared, multi-cohort seat pool matters.
3. **Outcome resolution.** For each granted seat, the student's personal pass probability (a base
   course pass rate adjusted by their own fixed ability score) decides pass or fail; a pass draws
   a letter grade from a difficulty-tiered distribution, a fail is an F. GPA, academic probation,
   and the dropout check (§3.5) update immediately afterward, in the same term.

### 3.4 The four-signal bottleneck model

This is the project's actual contribution. Every term, for every course a student hasn't yet
passed, the simulator records **exactly one** of four mutually-exclusive reasons they're not
enrolled in (or didn't pass) that course:

| Signal | Means | Points to |
|---|---|---|
| **Failure** | They took it and failed | Course difficulty / teaching support |
| **Capacity block** | They wanted a seat and didn't get one | Add sections |
| **Offering block** | They're eligible, but it isn't taught this term | Offer it more often |
| **Prerequisite block** | They haven't passed the prerequisite yet | Fix the *upstream* course |

These four counters are tracked completely separately, per course **and** per cohort, and the
codebase deliberately never adds them together — they aren't even the same kind of unit. A failure
is one event per attempt. An offering/prerequisite block accumulates once per *eligible, still-
blocked student, per term* they remain stuck, so they're naturally an order of magnitude larger
than failure counts — that's a property of the unit, not a sign that scheduling is "worse" than
academic difficulty. The right way to read the output is *within* each signal (which courses rank
highest for that one specific cause), never by comparing raw totals *across* signals, and never by
summing them into one "trouble score." This separation is what lets you tell the difference
between "this course is genuinely hard" and "this course is fine, but the one upstream of it is
a chokepoint" — two problems that look identical from a graduation-rate spreadsheet but call for
completely different fixes.

A capacity caveat worth knowing if optional terms are switched on: a course's capacity-block count
can mix a comfortably-staffed mandatory-term offering with a tiny, easily-saturated optional-term
bonus section — so a course can show up with a large capacity-block total purely from its Winter/
Summer section being oversubscribed, while its actual Fall/Spring offering has no problem at all.
The fix differs (add one bonus section vs. redesign the regular-term schedule), so it's worth
checking *which* term a capacity block came from, not just the total.

### 3.5 GPA, probation, and dropout

GPA is the standard credit-weighted average, with failed attempts counted in the denominator (an F
is 0 points but the credits attempted still count) — so chronic failure visibly drags GPA down,
the way it does in reality. A student whose GPA falls below the probation threshold gets a reduced
per-term credit-hour cap until it recovers. When a student retakes and passes a previously failed
course, the *prior failing attempts of that specific course* are removed from the GPA denominator
(a grade-replacement policy) — but failures on *other* courses are untouched, so GPA recovery is
gradual, not a clean reset.

Two independent triggers can end a student's simulated career early:
- **Chronic low GPA** — once a student has enough credits for GPA to be meaningful, each term
  their GPA sits below the probation line carries a real, front-loaded risk of leaving (more
  likely in their first few semesters, the way real first-year/sophomore attrition is heavily
  weighted toward the early years).
- **Stuck on one course** — failing the *same* course repeatedly enough times carries its own
  separate risk of leaving, even for a student whose overall GPA would otherwise be survivable.

A student who neither drops nor finishes all requirements within their personal semester budget
exits as "censored" — not a failure, just someone the simulation's window wasn't long enough to
resolve either way.

### 3.6 Determinism: why the randomness is trustworthy

Every student owns their own private random-number stream, seeded by a combination of a global
seed and that student's own unique ID, re-created identically every time a given configuration is
run. That means **the same simulated student draws the exact same sequence of "random" pass/fail
outcomes in every scenario you compare them across** — so if you add five seats to a gateway course
and graduation rate moves, you know that's because of the seats, not because the dice happened to
land differently. This is what makes structural what-if comparisons (Scenario Builder) causally
meaningful instead of just noisy. A student's fixed ability score and their seat-allocation
tiebreak token are deliberately kept on separate draws so they don't perturb the pass/fail stream
itself.

### 3.7 Capacity: sections, not a flat cap

Per-term seats for a course are *sections × seats-per-section* — not an arbitrary flat number. A
calibration script auto-sizes each course's section count to a configurable percentile of its own
historical peak demand (high enough that ordinary enrollment bulges don't bind, not so high that
sections sit empty), and that result is then hand-tunable per course — relieving a bottleneck is
"add a section" in the config, not a code change. When optional terms are enabled, that bonus
session uses its *own*, separately-sized (and typically much smaller) section count, because the
demand for a one-off recovery session is a different, smaller thing than regular-term demand.

### 3.8 The admissions-recommendation heuristic

The simulator also produces a single-run sizing heuristic: it scores a representative cohort
against four target health criteria (graduation rate, average time-to-degree, seats denied per
student, and *throughput stability* — how evenly graduates come out year over year rather than in
lumpy batches) and recommends scaling next year's intake up or down by whichever criterion is
closest to breaching its target. It's explicitly a decision-support nudge, not a calibrated
forecast — the right way to use it is as a starting point for a real intake-sensitivity
discussion, not as the answer itself.

### 3.9 How it's all wired together

```
data/curriculum.json, simulation_config.json
        │  (one-time seed into the database; the database is authoritative after that)
        ▼
Simulator.run()  ──►  History (raw counters, per-term snapshots, the four block signals)
        ▼
analytics.py  (headline metrics, per-cohort metrics, the bottleneck/capacity-planning report)
        ▼
   ┌────┴───────────────────────────────┐
   ▼                                     ▼
visualize.py                       service.py::run_simulation()
(static charts, the offline/batch     (the same engine, returned as an
 `py run.py` path)                     in-memory dict — the API's seam)
                                              ▼
                                        FastAPI backend
                                              ▼
                                  Next.js dashboard — Scenario Builder,
                                  animated curriculum graph, Settings,
                                  Capacity Planning, multiple saved Plans
```

There is only **one** simulation engine. The offline batch run and the live web dashboard call the
exact same code; the only difference is whether the result gets written to disk as PNGs/CSVs or
returned as JSON to a browser.

---

## 4. What kind of insight this actually produces

Because the four signals (§3.4) are tracked separately rather than collapsed into one
"graduation rate," the simulator can answer questions a transcript spreadsheet can't, for example:

- *Is a course's low pass-through rate because students aren't ready for it (a prerequisite
  problem one course upstream), because it's only offered once a year (a scheduling problem),
  because there aren't enough seats (a capacity problem), or because it's just a hard course (an
  academic-support problem)?* These four causes look identical from the outside — "students don't
  finish this course on time" — but call for completely different fixes, and the simulator
  attributes each blocked student-term to exactly one of them.
- *Does a single upstream gateway course explain why three unrelated-looking downstream courses
  all seem to be bottlenecks at once?* If course X is the prerequisite for courses A, B, and C,
  a delay at X shows up as a prerequisite-block spike on A, B, *and* C simultaneously, even though
  nothing is actually wrong with A, B, or C themselves. Watching for that lockstep pattern across
  courses is how the model points you at the real chokepoint instead of its symptoms.
- *If we relieve one specific bottleneck (add a section, add a second offering season, raise a
  pass rate), does the overall graduation rate actually move, or was that never the binding
  constraint?* This is what the Scenario Builder is for — Common Random Numbers (§3.6) make the
  *difference* between two scenarios trustworthy even when neither scenario's absolute number is.
- *How much does the shared seat pool's behavior vary year to year just from cohort-to-cohort
  noise, at a fixed intake size?* — which is the actual question behind the admissions
  recommendation (§3.8): whether the pool can absorb a given intake size *smoothly*, not just on
  average.

What it deliberately does **not** do is hand you a single number and tell you that's "the"
graduation rate QU should expect — see §6.

---

## 5. Design decisions and tradeoffs

Every choice below traded something away on purpose. Knowing *why* matters more than just knowing
*what*.

| Decision | What it buys | What it gives up |
|---|---|---|
| **Agent-based (individual students), not an aggregate flow model** | Delay can be attributed to a specific course-level cause for a specific (simulated) student, not just inferred from pooled counts | More computation than a pooled-counts model; doesn't scale to a much larger university without rework |
| **Common Random Numbers (paired seeds per student across scenarios)** | Causally clean scenario comparisons — a metric change can be attributed to the structural change you made, not random noise | A single scenario's output isn't an independent draw from "the real world"; only *comparisons* are fully trustworthy |
| **Four separate, never-summed block signals** | Distinguishes course difficulty from scheduling from prerequisite structure from seat capacity — the actual point of the project | More to interpret than one combined "trouble score"; requires reading each panel on its own terms |
| **Multi-cohort, shared seat pool, warm-started incumbents** | Captures real priority-registration competition between simultaneously-enrolled cohorts, not just one cohort in an empty university | More moving parts than a single-cohort model; per-cohort outcomes need their own bookkeeping |
| **Config-driven term calendar, with optional terms as an explicit admin toggle** | Winter/Summer behavior can be switched on or off without touching code or re-entering data; generalizes beyond a strict 2-season assumption | More branching logic in the season/capacity helpers than a single hardcoded calendar would need |
| **Section-based capacity (sections × seats-per-section), auto-calibrated then hand-tunable** | Capacity is data, not code — relieving a bottleneck is a config edit | Calibration is a manual/semi-automatic demand-percentile step, not driven by real staffing data |
| **One fixed ability score per student, not per-subject or time-varying** | Simple, one RNG draw, trivially reproducible | Can't represent "strong at math, weak at writing," or a student maturing/burning out over time |
| **Multi-plan architecture (each plan a full, independent copy of curriculum + config + instructors)** | Two plans can never accidentally corrupt each other; switching plans is instant and per-user | Two 95%-similar plans store two full separate copies of every course row, not a diff |
| **No caching on the simulate endpoint** | No shared mutable state between users on different active plans — nothing to race | Every API call fully re-runs the simulation; identical repeated requests aren't free |
| **SQLite, not Postgres/MySQL, for local dev** | Zero setup — the database is just a file | Not built for concurrent multi-process write load; fine for this scale, not a production multi-tenant system |

---

## 6. What this model deliberately does not know

This section matters as much as the mechanics above — overclaiming what a model like this can
tell you is the fastest way to lose credibility with anyone technical reviewing it.

1. **The numbers feeding it are assumed, not measured.** Per-course pass rates, section counts,
   and dropout-hazard parameters are calibrated *estimates*, tuned so the model's aggregate output
   lands near one public external benchmark (QU's published multi-year graduation rate) — not
   real QU per-course institutional data, because no public dataset like that exists. That
   benchmark validates the aggregate, not any individual course's assumed pass rate. Trust
   *relative* comparisons between two scenarios (same seeds, one structural change) far more than
   any single scenario's absolute output.
2. **No minimum-grade prerequisites.** Any passing grade satisfies a prerequisite here. If the
   real program enforces a higher minimum grade for some prerequisite, this model doesn't know
   that and will look slightly more optimistic than reality on courses where it matters.
3. **Optional terms, when enabled, are deliberately narrow.** Only a small, hand-picked list of
   high-demand courses get a Winter/Summer bonus section — most of the curriculum still can only
   be taken in a mandatory Fall/Spring term. Course withdrawal (a real escape hatch students have)
   isn't modeled at all: every enrolled student receives either a pass or an F, with no option to
   withdraw before it counts against them.
4. **No non-academic attrition causes.** Financial hardship, transferring schools or majors,
   health, family obligations — none of that exists here. The only exits are: graduate, get pushed
   out by chronic low GPA, get pushed out by repeatedly failing one course, or run out of personal
   semesters.
5. **Ability is one scalar per student, not per-subject and not time-varying.** A student is
   generically "stronger" or "weaker" by the same fixed amount across *every* course, for their
   entire simulated career. Real students are uneven across subjects and can improve or decline
   over time; this model captures neither.
6. **No instructor- or section-level quality variation.** Every section of a course shares the
   same pass rate. Real outcomes vary a lot by instructor; this model averages that away.
7. **The curriculum itself is static for the whole run.** Courses, prerequisites, and pass rates
   don't change over the years simulated, even though real curricula get revised.
8. **It is not a predictive tool for any named, real individual student.** This is a
   population-level what-if instrument, not an early-warning system for whether one particular
   student will pass their next course.
9. **Closed-system assumption.** No transfer students arrive mid-program, nobody changes major
   into or out of a cohort, no transfer or AP credit. Every simulated student starts at zero
   credit hours and exits through one of four terminal states.
10. **Re-running with many random seeds tells you about the model's own sensitivity to chance, not
    about real-world uncertainty.** A confidence interval here describes how much *this model,
    with these fixed assumptions,* varies run to run — it is not a statement about whether the
    underlying assumptions themselves are correct.

If asked "how do you know the numbers are right?" — the honest, defensible answer is: the
assumptions are individually documented and justified (`docs/assumptions.md`), the aggregate
output was checked against one real external benchmark, and every scenario comparison uses
identical seeds per student so the *differences* between scenarios are real even where the
*absolute* numbers underneath them are estimates.

---

## 7. How a curriculum committee actually uses this

- **Settings** — edit the curriculum (courses, prerequisites, offerings, pass rates), the
  instructor roster, and the baseline configuration in place. This is where the optional-term
  toggle lives. Edits here persist immediately as the new baseline for every future run.
- **Scenario Builder** — try a structural change (add a section, change a course's offering
  season, adjust a dropout parameter) as a one-off comparison against the current baseline,
  without touching it. This is the right tool for "what if we did X" questions.
- **Capacity Planning** — a combined seat-capacity and instructor-staffing feasibility report:
  which course categories are tight or in shortfall given the current configured demand and the
  current (synthetic/configurable) faculty roster, plus the admissions recommendation (§3.8).
- **Plans** — more than one full curriculum + configuration combination can exist at once (e.g.
  to compare the current 2024 study plan against a hypothetical revised one), each fully
  independent, switchable per user.

---

## 8. Where this could go next

The most valuable next step isn't a bigger feature — it's **real data**. The engine's population
source is already built behind a swappable interface specifically so that a future real-data
integration (an actual institutional transcript export) is a configuration change, not a rewrite
of the simulation logic. Short of that, the most useful refinements would be: course withdrawal as
a real exit path, minimum-grade prerequisites where the real program enforces them, and widening
which courses get an optional-term bonus session based on actual observed summer-enrollment
patterns rather than a hand-picked list.
