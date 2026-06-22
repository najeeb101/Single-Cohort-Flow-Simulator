# How This Simulator Actually Works (a CS student's walkthrough)

This is a teaching document, not a spec. It's written so you can explain the system to
someone else (or to yourself, six months from now) without re-reading every source file.
For the formal spec and the full assumption list, see [`technical_design.md`](technical_design.md)
and [`assumptions.md`](assumptions.md) — this document is the "why does it work this way"
companion to those.

---

## 1. The one-paragraph mental model

This is a **discrete-event, agent-based simulation**. There is no continuous time — the
clock only ever advances in whole semesters (Fall, Spring, Fall, Spring...). The "agents"
are `Student` objects, each one an independent little state machine (GPA, completed
courses, status). Nothing about the simulation is solved analytically with an equation;
instead, every semester, every student "tries" to register for courses, some requests get
denied because of seat scarcity, and a weighted coin-flip (seeded, so it's reproducible)
decides who passes and who fails. Run that loop twelve times per student and look at what
comes out the other end — that's the whole simulation. Everything else in the codebase
(analytics, figures, the API, the web dashboard) is just *reporting* on what happened
during those discrete-term loops.

---

## 2. The data model (the OOP part)

Two plain dataclasses carry almost all the state:

- **`Course`** (`src/models/course.py`) — code, title, credits, `prerequisites` (a flat
  list), an optional `rule_expr` (for compound rules — see §5), `pass_rate`, `offering`
  (which seasons it runs), `category` (cs_core, cs_elective, math, gen_ed, ...).
- **`Student`** (`src/models/student.py`) — `student_id`, a *private* `rng`, `ability_score`,
  `completed_courses` (code → grade), `failed_attempts` (code → count), `gpa`,
  `completed_ch`, `status` (`ACTIVE` / `DELAYED` / `GRADUATED` / `DROPPED` / `CENSORED`),
  `ever_probation`.

Neither class knows anything about *time* or *other students* — a `Student` can tell you
whether it's eligible for a course, but it has no idea whether a seat is actually
available. That's deliberate: eligibility (a property of one student) and seat scarcity
(a property of the whole cohort, shared) are different concerns, and keeping them in
different objects is what makes the three-phase loop in §4 possible.

The actual orchestration — building the cohort(s), advancing the clock, allocating seats —
lives in one class: `Simulator` (`src/simulator.py`). It is the only thing that has a
"god's eye view" of every student at once.

---

## 3. The clock: global term vs. personal semester

There are **two different "semester counters"** in this codebase, and confusing them is
the easiest way to misread the code:

- **`term_idx` (global term)** — one shared clock for the whole university. Term 0 is the
  first study cohort's Fall semester. Negative terms exist too: `num_incumbent_cohorts`
  cohorts are admitted *before* term 0 as a "warm start," so by the time term 0 begins,
  some upper-level courses are already partly full — exactly like a real university,
  which never starts from an empty campus.
- **`personal_semester` (= `global_term − student.entry_term + 1`)** — every student's own
  semester count, starting at 1 the term *they* were admitted. The 12-semester graduation
  cap, the "delayed" flag (semester > 8), and `CENSORED` (ran out of time) are all judged
  against personal semester, never the global one. A student admitted in global term 6
  still gets a full 12 personal semesters, exactly like a student admitted in term 0.

`term_season(term_idx)` just does `term_idx % 2` (even → Fall, odd → Spring) — it works
the same for negative indices, which is why the incumbent warm-start is "free": no special
case anywhere else in the code needs to know a term is negative.

---

## 4. The per-term loop — the actual engine

Every term, `Simulator._run_term()` runs **three phases, strictly in order**, for *every
active student from every cohort at once* (this is the detail that makes it a multi-cohort
model and not just four copies of a single-cohort model — they all compete for the same
seats).

### Phase 1 — Desired enrollment (`Student.get_desired_courses`)

Each student, independently, builds a wish-list:
1. Filter this term's offered courses down to ones they're eligible for and haven't
   already passed.
2. Sort by priority: **retakes first** (any course they've previously failed), then by
   `enrollment_priority_tiers` from `simulation_config.json` — e.g. required courses, then
   electives (only once they've reached 60 completed credit hours), then filler courses.
3. Greedily add courses in that order until the next one would blow past their credit-hour
   cap (18 normal, 12 if on academic probation).

Nothing here touches seats yet — a student can "want" a course that turns out to be full.

### Phase 2 — Seat allocation

For every course with requesters: if seats ≥ requesters, everyone gets in. Otherwise,
requesters are sorted by `(registration_tier(completed_ch), tiebreak_token)` and only the
top `capacity` get a seat. `registration_tier` mirrors a real university's priority
registration: students with more completed credit hours register first. This is the
mechanism that makes "shared seat pool" meaningful — a backlog of held-back juniors in one
cohort will out-rank a fresh batch of incoming freshmen for a popular gateway course, term
after term, which is exactly the congestion effect the whole project exists to study.

### Phase 3 — Take the course

For each granted seat, draw one random number against the student's `effective_pass_rate`
(base course pass rate + their personal `ability_score`, clamped to `[0.05, 0.98]`). Pass →
sample a letter grade from a difficulty-tiered distribution; fail → grade is `F`.

### After all three phases (still inside the same term)

- **Dropout check** — two independent triggers, both calibrated against a real external
  benchmark (§7): a per-term hazard that grows the longer a student's GPA sits below 2.0
  (front-loaded — more likely in their first 4 semesters), and a separate "stuck on one
  course" trigger if a single course has been failed 3+ times.
- **Graduation / delayed / censored** — checked against *personal* semester, not global.
- **Block-signal bookkeeping** (§5) and a timeline frame get recorded for the dashboard.

---

## 5. The "why are they stuck" engine — four signals that are never added together

This is the actual intellectual contribution of the project, so it's worth understanding
precisely. Every term, for every course a student hasn't passed yet, the simulator records
**exactly one** of four reasons:

| Signal | Means | Real-world fix it points to |
|---|---|---|
| `fail` | Took it, failed | Better teaching support / tutoring |
| `capacity_block` | Wanted it, no seat | Add sections |
| `offering_block` | Eligible, but not taught this season | Offer it more often |
| `prereq_block` | Hasn't passed the prerequisite yet | Fix the upstream bottleneck |

These four counters are tracked completely separately and the codebase deliberately never
sums them — they're not the same unit (`fail` is per-attempt; `offering_block` and
`prereq_block` accumulate once per student per term they're stuck, so they're naturally an
order of magnitude bigger). The finding that matters is *which signal dominates for which
course*, not the raw totals. In the current calibration, the dominant story is **scheduling**,
not teaching quality: a Fall-only senior-project prerequisite (CMPS310) and a single
gateway course (CMPS303, which unlocks three other courses at once) generate far more
`offering_block`/`prereq_block` events than anything generates `fail` events.

Compound prerequisites (e.g., "needs CMPS310 AND (CMPS350 OR CMPS405) AND ≥84 credit
hours" for the senior project) are handled by a tiny generic expression evaluator in
`src/rules.py` (`evaluate_rule` / `gate_edges`), not hardcoded `if` statements — so a
different program's weirder eligibility rules are a JSON edit, not a code change.

---

## 6. Why the randomness is trustworthy (Common Random Numbers)

Each student's random stream is `random.Random(seed + student_id)`, re-created fresh every
time a scenario runs. That means **student #47 draws the exact same sequence of random
numbers in every scenario you compare** — so if you, say, add five more seats to CMPS303
and graduation rate goes up, you know that's because of the extra seats, not because the
dice happened to land differently this run. This is what makes "what-if" scenario
comparisons in the Scenario Builder causally meaningful instead of just noisy.

Two other random draws exist per student, deliberately kept on separate generators/values
so they don't perturb the pass/fail stream: a fixed `ability_score` (drawn once at
creation) and a `tiebreak_token` (a hash, not even a random draw) used only to break ties
in seat allocation.

---

## 7. How the whole thing is wired together (the pipeline)

```
data/curriculum.json, simulation_config.json
        │  (one-time seed into SQLite, then DB is authoritative)
        ▼
src/simulator.py  Simulator.run()  ──► History (raw counters + per-term snapshots)
        ▼
src/analytics.py  compute_metrics() / per-cohort metrics / flow_timeline JSON
        ▼
   ┌────┴─────────────────────────────┐
   ▼                                   ▼
src/visualize.py                 src/service.py::run_simulation()
(Matplotlib PNGs, run.py only)   (in-memory dict, zero file I/O — the API's seam)
                                        ▼
                                  src/api.py (FastAPI)
                                        ▼
                                  web/ (Next.js dashboard: Scenario Builder,
                                  animated curriculum graph, Plans, Settings...)
```

`run.py` is the offline/batch path (writes PNGs + CSVs to `outputs/`). `src/api.py` is the
live path the web dashboard talks to — same `Simulator` underneath, just returned as JSON
instead of written to disk. Both ultimately call the exact same simulation code; there is
only one engine.

---

## 8. Limitations — what this system deliberately does *not* model

This section matters as much as the mechanics above. Be ready to say these out loud in a
pitch — claiming more than this model actually does is the fastest way to lose credibility
with a technical audience.

1. **The numbers are assumed, not measured.** Per-course pass rates, section counts, and
   the dropout-hazard constants are *calibrated estimates*, not real QU institutional data
   (no public dataset of per-course pass rates exists). They were tuned so the *aggregate*
   outputs (graduation rate, probation rate, dropout rate) land near one public external
   benchmark — QU's reported 72.3% six-year CS graduation rate. That benchmark validates
   the *aggregate*, not any individual course's assumed pass rate.
   → **Practical consequence:** trust *relative* comparisons between scenarios (same seeds,
   one structural change) far more than any single scenario's absolute numbers.

2. **No minimum-grade prerequisites.** A D satisfies any prerequisite in this model. If
   the real program requires a C or better in some course, this model doesn't know that.

3. **No summer terms, no withdrawals, no leave of absence.** Real students have more
   scheduling flexibility (summer courses, official withdrawals that don't count as
   dropout) than this model allows, which is part of why the model's on-time rate doesn't
   land exactly on the real benchmark.

4. **No non-academic attrition causes.** Financial hardship, transferring to another
   university or major, health, family obligations — none of that exists here. The only
   exit paths are: graduate, get pushed out by chronic low GPA, get pushed out by failing
   one course repeatedly, or run out of the 12-semester clock.

5. **Ability is one scalar per student, not per-subject.** A student is either generally
   "stronger" or "weaker" across *every* course by the same fixed offset for their whole
   simulated career. Real students are strong in some subjects and weak in others, and
   their relative strength can change over time (maturing, burning out, etc.) — this model
   captures none of that.

6. **No instructor- or section-level quality variation.** Every section of a course has
   the same pass rate. A real course's outcomes can vary a lot by instructor; this model
   averages that away.

7. **The curriculum is static for the whole run.** Courses, prerequisites, and pass rates
   don't change over the 6+ years simulated. Real curricula get revised.

8. **It's not a predictive tool for a *named*, real individual student.** This is a
   population-level "what if" tool, not an early-warning system for "will Ahmed pass
   CMPS303 next term." Don't pitch it as the latter.

9. **Closed-system assumption.** No transfer students arrive mid-program, nobody changes
   major into or out of the cohort, no course substitutions or AP/transfer credit. Every
   student starts at zero credit hours and exits through one of the four terminal states.

10. **Monte Carlo here means "resample the model's own randomness," not "quantify
    real-world uncertainty."** Running 30 seeds and reporting a 95% CI tells you how
    sensitive *this model, with these fixed assumptions* is to randomness — it is not a
    confidence interval over whether the *assumptions themselves* are correct.

If asked in a pitch "how do you know your numbers are right?" — the honest, defensible
answer is: *the assumptions are documented and individually justified (`docs/assumptions.md`),
the aggregate outputs were checked against one real external benchmark and landed within
~1.3 percentage points of it, and every scenario comparison uses identical random seeds per
student so the *differences* between scenarios are real, even where the *absolute* numbers
are estimates.*

---

## 9. The tech stack, exactly

### Backend (Python)
| Tool | Used for |
|---|---|
| Python 3, plain `dataclasses` + `random` | The simulation engine itself — no ML/optimization framework, just deterministic discrete-event logic |
| **FastAPI** + **uvicorn** | The HTTP API (`src/api.py`) — auth, simulate, scenarios, plans, curriculum CRUD |
| **SQLAlchemy** + **SQLite** | Persistent storage (`data/app.db`): users, plans, courses, config, saved scenarios/runs |
| **PyJWT** + **passlib[bcrypt]** | Auth — JWT cookies, bcrypt password hashing |
| **Matplotlib** | Every static figure in `outputs/figures/` |
| **NetworkX** | Lays out the prerequisite graph for `curriculum_network.png` |
| **pytest** + **httpx** | Test suite, including hitting the FastAPI app directly in tests |

### Frontend (TypeScript)
| Tool | Used for |
|---|---|
| **Next.js 16** (App Router, Turbopack) | The whole `web/` dashboard — routing, API proxy rewrites |
| **React 19** | All UI: Scenario Builder, animated curriculum graph, Plans, Settings |
| **TypeScript** | Type safety across the frontend |
| **Tailwind CSS v4** | All styling — utility classes plus a small `globals.css` for the few things Tailwind can't reach (e.g. native `<input type=range>` thumb styling) |
| **ESLint** | Linting |

Notably absent: no state-management library (Redux/Zustand — `SimulationContext` is plain
React context), no charting/graph-visualization library (the curriculum graph is hand-rolled
React + raw SVG, not D3), no ORM-bypassing raw SQL.

---

## 10. Design tradeoffs — choices that traded one good thing for another

Every one of these was a deliberate choice, not an oversight. Knowing *why* lets you
defend the choice instead of just describing it.

| Tradeoff | What was gained | What was given up |
|---|---|---|
| **Calibrate to one aggregate benchmark, not per-course real data** | Buildable at all — no public per-course QU pass-rate dataset exists | Absolute numbers per course are estimates; only relative (scenario-to-scenario) comparisons are fully trustworthy (§8.1) |
| **Common Random Numbers (paired seeds per student across scenarios)** | Causally clean scenario comparisons — a graduation-rate change can be attributed to the structural change you made, not noise | Less "realistic" randomness — you can't read a single scenario's output as an independent random draw from the real world |
| **Semester-level discrete time, not weekly/continuous** | Simple, fast (12 ticks per student vs. hundreds), matches how registration actually works | Can't model within-term events: mid-term withdrawal, add/drop deadlines, summer sessions |
| **One static `ability_score` per student (not per-subject)** | One number, one RNG draw, trivially reproducible | Can't represent "strong at math, weak at writing" — every course is shifted by the same offset |
| **Section-count capacity model, hand/auto-calibrated (`size_sections.py`)** | Capacity is config data, not code — tunable per-course without touching the engine | Calibration is a manual/semi-automatic step (75th-percentile demand sizing) rather than driven by real staffing data |
| **Hand-rolled SVG layout for the curriculum graph instead of a graph library (D3/dagre)** | Zero extra dependency, full control over rendering | Had to hand-implement layering, zoom, and pan ourselves — and hand-fix real bugs in that pan/zoom logic this session that a mature library would already have solved |
| **No caching on `/simulate`** (`src/api.py` resolves curriculum/config fresh per request, no module-global cache) | No shared mutable state — two users on two different active Plans can never race each other or see stale data | Every API call fully re-runs the simulation; identical repeated requests aren't free |
| **JWT-in-cookie auth, no server-side session table** | Simple, no session storage/cleanup needed | Rotating `AUTH_SECRET` (e.g., restarting the dev server with a new value) invalidates *every* existing login at once with no individual revocation — which is exactly what happened earlier in this dev session |
| **SQLite, not Postgres/MySQL** | Zero setup for local dev — `app.db` is just a file | Not built for concurrent multi-process write load; fine for a course project/demo, not a production multi-tenant deployment |
| **`DataSource` seam (synthetic population generator behind an interface) instead of hardcoding student creation in the engine** | A future `RealDataSource` (real admissions data) can plug in without touching `Simulator` at all | Adds a layer of indirection today for a capability (real data) that isn't built yet |
| **Plain Python loops over students, not vectorized (NumPy/pandas)** | Simple, debuggable, matches the "one agent at a time" mental model | Doesn't scale gracefully — fine at 400-2,000 simulated students, would need rework for a much larger university |
| **Full duplication of curriculum/config rows per Plan, not a diff/inheritance model** | Each Plan is fully isolated — editing one can never accidentally corrupt another | Two plans that are 95% identical still store two full, separate copies of every course row |

The common thread: almost every tradeoff above favors **simplicity, reproducibility, and
isolation** over **realism, performance, or storage efficiency** — appropriate for a
research/teaching tool meant to answer one comparative question ("which bottleneck matters
most"), not a production university information system.
