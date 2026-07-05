# Code Walkthrough (Deep Technical Reference)

This is the code-level companion to `docs/technical_design.md` (mechanics/decisions in prose)
and `docs/project_overview.md` (narrative/tradeoffs). This document is for reading **with the
source open**: real function signatures, real code, module by module, so you can point at a line
in a meeting and say "this is where X happens." Line numbers are omitted deliberately (they drift
every edit) — search for the quoted signature instead.

---

## 1. Module map

| File | Owns |
|---|---|
| `src/models/course.py` | `Course` (frozen dataclass) + `load_curriculum()` |
| `src/models/student.py` | `Student` (mutable, stateful) + `registration_tier()`, `curriculum_stage()` |
| `src/models/semester.py` | Term/season arithmetic, config-driven cycle |
| `src/rules.py` | Generic compound-eligibility expression evaluator |
| `src/datasource.py` | `DataSource` seam: how the student population is created |
| `src/simulator.py` | `Simulator` (the engine loop) + `History` + `SimulationResult` |
| `src/analytics.py` | Every derived metric/report/JSON payload, no simulation logic |
| `src/service.py` | `run_simulation()` — the in-memory, zero-file-I/O API boundary |
| `src/livesim.py` | `LiveRunner` — deterministic term-by-term replay for Live Simulation |
| `src/montecarlo.py` | `run_monte_carlo()` — re-run across seeds for CIs |
| `src/curriculum_validation.py` | `check_no_cycle()` — prerequisite-cycle guard |
| `src/db.py` / `src/db_models.py` | SQLAlchemy engine/session + ORM tables (multi-plan) |
| `src/auth.py` | `get_current_user` — a stub shared-demo-user dependency, not real auth |
| `src/api.py` | FastAPI routes; resolves `(curriculum, config)` per-request from the active `Plan` |
| `src/visualize.py` | Matplotlib figure writers (offline `py run.py` path only) |
| `run.py` | Entry point: load JSON → `run_simulation()` per scenario → write figures/CSVs |

---

## 2. Core data model

### `Course` (`src/models/course.py`) — frozen, immutable

```python
@dataclass(frozen=True)
class Course:
    code: str
    title: str
    credits: int
    prerequisites: tuple[str, ...]
    pass_rate: float
    offering: tuple[str, ...]          # ('Fall',), ('Spring',), or ('Fall','Spring')
    category: str                       # cs_core|cs_elective|college_req|math|science|english|gen_ed
    capacity: int                       # seats per offering-instance
    rule_expr: Optional[dict] = None    # compound gate (see src/rules.py); None = plain prerequisites
    study_plan_order: int = 99          # lower = earlier in the study plan
    study_plan_term: int = 0            # recommended semester column (1..N) for the flow chart
```

`course_from_dict()` parses one `data/curriculum.json` entry and raises `ValueError` (not
`KeyError`) naming the offending course code on a missing required field — important because
`src/db.py::import_plan()` calls this on **untrusted uploaded JSON** (a Plan import) and needs a
clean 422 message, not a bare traceback.

### `Student` (`src/models/student.py`) — mutable, one per simulated person

Construction seeds the private RNG and draws the fixed ability score, both from the *same* stream:

```python
def _reset_rng_and_state(self) -> None:
    self.rng = random.Random(self._seed + self.student_id)
    raw = self.rng.gauss(0.0, 0.15)
    self.ability_score: float = max(-0.30, min(0.30, raw))
    ...
    self.personal_semester: int = 0
```

`tiebreak_token` is computed separately in `__init__` (`hash((seed, student_id)) & 0xFFFF_FFFF`)
specifically so it **never consumes the pass/fail RNG stream** — seat-allocation ties are broken
without perturbing the sequence of pass/fail draws that everything else depends on for
determinism.

Key methods, exactly as named in code:
- `is_active()` → `status in ("ACTIVE", "DELAYED")`
- `has_passed(code)` → in `completed_courses` and grade is in `PASSING_GRADES` (`{A,B+,B,C+,C,D}`)
- `effective_pass_rate(course, pass_rate_overrides)` → `clip(base + ability_score, 0.05, 0.98)`
- `is_eligible_for(course, curriculum)` → dispatches to `rules.evaluate_rule()` if
  `course.rule_expr` is set, else plain `prerequisites_met()`
- `get_desired_courses(available_courses, curriculum, config)` → Phase 1 of the per-term loop (§4)
- `record_grade(course, grade)` → GPA/probation update (§5)

**A precise, easy-to-miss detail**: the probation trigger is **hardcoded** in `record_grade`,
not read from config:

```python
if self.completed_ch >= 25 and self.gpa < 2.0:
    self.on_probation = True
    self.ever_probation = True
elif self.gpa >= 2.0:
    self.on_probation = False
```

This is a different `25`/`2.0` from the *dropout* hazard's config-driven `probation_min_ch` /
`dropout_gpa_floor` used in `simulator.py`'s dropout check (§4). Two different mechanisms
(probation entry vs. dropout hazard) happen to use similar-looking numbers; only one of them is
config-driven today. Worth knowing before you tell a curriculum committee "you can tune the
probation threshold in Settings" — you currently can't, only the dropout-hazard's GPA floor.

---

## 3. The three-phase per-term loop (`Simulator._run_term`)

This is the heart of the engine. One call per calendar term, for every active student across
every cohort at once.

**Setup**: which courses are offered this season, who's active, and a fresh `course_stats` dict
seeded so even a *Spring-only* course reports its Fall waiting-list:

```python
available = [c for c in self.curriculum.values() if season in self._effective_offering(c)]
active = [s for s in self.students if s.is_active()]
```

### Phase 1 — desired enrollment (`Student.get_desired_courses`)

```python
eligible = sorted(
    [c for c in available_courses if can_enroll(c)],
    key=lambda c: c.study_plan_order,
)
retakes = [c for c in eligible if self.failed_attempts.get(c.code, 0) > 0]
# ... bucket the rest into config["enrollment_priority_tiers"], in order, first match wins
for course in retakes + [c for bucket in tiers for c in bucket]:
    if total_ch + course.credits <= load_cap:
        selected.append(course)
```

No seats are checked here — a student can "want" a course that turns out full. Note the exact
line building `desired`, since it's also where per-cohort seat-request totals get tallied for the
cohort ledger:

```python
for student in active:
    for course in student.get_desired_courses(available, self.curriculum, self.config):
        desired[course.code].append(student)
        seats_requested[student.cohort_id] += 1
```

### Phase 2 — seat allocation

```python
if len(requesters) <= cap:
    winners, losers = requesters, []
else:
    sorted_req = sorted(
        requesters,
        key=lambda s: (registration_tier(s.completed_ch, self.config), s.tiebreak_token),
    )
    winners, losers = sorted_req[:cap], sorted_req[cap:]
for s in losers:
    self.history.capacity_block_counts[code] += 1
```

`cap` comes from `_effective_capacity()`, which is worth reading in full since it's where three
separate levers compose:

```python
def _effective_capacity(self, course, season=None) -> int:
    seats = course.capacity
    if not self._is_mandatory_season(season):
        scale = float(self.config.get("optional_term_capacity_scale", 0.3))
        seats = max(1, math.floor(seats * scale))
    multiplier = float(self.scenario.get("capacity_multiplier", 1.0))
    overrides = self.scenario.get("capacity_overrides", {})
    if course.code in overrides:
        multiplier = float(overrides[course.code])
    seats = max(1, math.floor(seats * multiplier))
    if self._is_mandatory_season(season):
        occupied = self._initial_occupancy(course.code)
        if occupied:
            seats = max(0, seats - occupied)
    return seats
```

Order matters: the course's own `capacity`, scaled down first on an optional term, then the
scenario's capacity multiplier/override, *then* subtract initial-state occupancy — and the
occupancy subtraction is skipped entirely on an optional (non-mandatory) term, since that's a
separate, smaller capacity model.

### Phase 3 — take courses (`_resolve_grade`)

```python
def _resolve_grade(self, student, course) -> str:
    overrides = self.scenario.get("pass_rate_overrides", {})
    effective = student.effective_pass_rate(course, overrides)
    if student.rng.random() < effective:
        tier = grade_tier(course.pass_rate, self.config)
        tier_dist = self.config["grade_tiers"][tier]
        return student.rng.choices(list(tier_dist.keys()), weights=list(tier_dist.values()))[0]
    return "F"
```

Note `grade_tier` is keyed off the course's **base** `pass_rate`, not the student's shifted
`effective` rate — ability affects *whether* you pass, not which difficulty tier the course
belongs to for grade sampling.

### Post-phase: dropout, graduation, block recording

Two independent dropout triggers run every term, both directly in `_run_term` (not delegated to
`Student`):

```python
if student.completed_ch >= min_ch and student.gpa < gpa_floor:
    severity = gpa_floor - student.gpa
    hazard = base_hazard * (1.0 + severity)
    if student.personal_semester <= early_cut:
        hazard *= early_mult
    if student.rng.random() < hazard:
        self._record_outcome(student, "DROPPED", term_idx)
        continue
for code, attempts in student.failed_attempts.items():
    if attempts >= threshold:
        if student.rng.random() < drop_prob:
            self._record_outcome(student, "DROPPED", term_idx)
            break
```

Graduation/delay/censoring is judged on `student.personal_semester`, never a recomputed
`global_term - entry_term`:

```python
if self._has_graduated(student):
    self._record_outcome(student, "GRADUATED", term_idx)
elif personal_semester >= self.max_terms:
    self._record_outcome(student, "CENSORED", term_idx)
elif personal_semester > 8:
    student.status = "DELAYED"
```

Block classification (`_record_blocks`) is the one diagnostic that's genuinely `elif`-shaped —
every not-yet-passed course gets exactly one of two labels here (capacity/fail are recorded
elsewhere, in Phases 2/3):

```python
prereqs_met = student.is_eligible_for(course, self.curriculum)
if prereqs_met:
    if season not in self._effective_offering(course):
        self.history.offering_block_counts[code] += 1
else:
    self.history.prereq_block_counts[code] += 1
```

On a mandatory term this sweeps the *entire* curriculum; on an optional term it only sweeps
courses actually offered that term (`courses_to_check`), so adding Summer/Winter terms doesn't
inflate `offering_block`/`prereq_block` purely from extra calendar terms with almost nothing
offered.

---

## 4. Determinism: Common Random Numbers (CRN)

Every student's RNG is `random.Random(seed + student_id)`, re-created identically whenever a
scenario runs. The practical guarantee: **student #47 draws the exact same sequence of
"random" numbers in every scenario you compare them across** — so if graduation rate moves after
you add five seats to a gateway course, that's attributable to the seats, not to different dice.
Three separate draws per student are kept deliberately independent so they don't perturb each
other: the pass/fail roll (`student.rng.random()` in `_resolve_grade`), the ability score
(`rng.gauss` at construction), and the tiebreak token (a `hash()`, not an RNG draw at all).

---

## 5. The `DataSource` seam (`src/datasource.py`)

The engine **never constructs students itself** — `Simulator.__init__` asks a `DataSource`:

```python
self.data_source: DataSource = data_source or SyntheticDataSource(config)
specs = self.data_source.cohort_specs()
```

```python
class DataSource(ABC):
    @abstractmethod
    def cohort_specs(self) -> list[CohortSpec]: ...
    @abstractmethod
    def create_students(self, spec: CohortSpec) -> list[Student]: ...
```

`SyntheticDataSource` is the only implementation today; it owns cohort sizing, the (mostly
unused-by-default) incumbent warm-start count, and student-id assignment:

```python
def create_students(self, spec: CohortSpec) -> list[Student]:
    base = (spec.cohort_id + self.num_incumbent_cohorts) * self.cohort_size
    return [Student(base + i, self.seed, cohort_id=spec.cohort_id, entry_term=spec.entry_term)
            for i in range(spec.size)]
```

This interface is why a hypothetical `RealDataSource` (reading a real SIS export) could plug in
without touching `Simulator` at all — it's unbuilt today, but the seam is real and load-bearing:
`LiveRunner`'s `_TimeVaryingCohortDataSource` (§7) is a second, real implementation already living
in the codebase, proving the interface works for more than the one synthetic case.

Also defined here: the canonical `StudentRecord`/`EnrollmentRecord`/`OutcomeRecord` dataclasses —
a portable schema deliberately leaner than the internal `Student` (no RNG stream, no ability
score), consumed by `analytics.compute_historical_transcripts()`.

---

## 6. Compound eligibility rules (`src/rules.py`)

A tiny recursive evaluator, so CMPS493's "CMPS310 AND (CMPS350 OR CMPS405) AND ≥84 CH" rule is
data (`Course.rule_expr`), not a hardcoded `if` in `student.py`:

```python
def evaluate_rule(expr, student) -> bool:
    if isinstance(expr, str):
        return student.has_passed(expr)
    if "all" in expr:
        return all(evaluate_rule(sub, student) for sub in expr["all"])
    if "any" in expr:
        return any(evaluate_rule(sub, student) for sub in expr["any"])
    if "min_ch" in expr:
        return student.completed_ch >= expr["min_ch"]
    raise ValueError(f"Unrecognized rule_expr node: {expr!r}")
```

`gate_edges()` walks the same shape to flatten it into `(course_code, "all"|"any")` edges for
graph rendering (solid edge = hard requirement, dashed = either-or) — used by both the
prerequisite-network figure and `curriculum_validation.check_no_cycle()`.

---

## 7. Term/season arithmetic (`src/models/semester.py`)

Everything here is config-driven with a legacy-safe default (`DEFAULT_TERMS = ("Fall", "Spring")`
when a config omits the new keys entirely).

```python
def term_season(term_index: int, config=None) -> str:
    terms = get_terms(config)
    return terms[term_index % len(terms)]
```

The one non-trivial function is `mandatory_horizon_end_term`, which replaced a naive
`entry_term + max_terms` that silently broke once optional (non-mandatory) seasons existed in the
cycle:

```python
def mandatory_horizon_end_term(entry_term, max_terms, config=None) -> int:
    mandatory = get_mandatory_seasons(config)
    count, t = 0, entry_term
    while count < max_terms:
        if term_season(t, config) in mandatory:
            count += 1
        t += 1
    return t
```

It walks the calendar counting only mandatory seasons, so a student still gets exactly
`max_terms` *real* semesters even when Winter/Summer terms are sprinkled in between.

---

## 8. Engine-as-a-service boundary (`src/service.py`)

The single function every caller (script, test, API) goes through:

```python
def run_simulation(
    curriculum: dict[str, Course],
    config: dict,
    scenario: dict,
    data_source: DataSource | None = None,
) -> dict:
    result = Simulator(curriculum, config, scenario, data_source=data_source).run()
    result.metrics = compute_metrics(result)
    return {
        "result": result,
        "metrics": result.metrics,
        "cohort_metrics": compute_cohort_metrics(result),
        "admissions_recommendation": compute_admissions_recommendation(result),
        "flow_timeline": flow_timeline_payload(result, curriculum),
    }
```

Zero file I/O, zero `print`. `run.py` is a thin wrapper that calls this once per configured
scenario, then hands `result` to `analytics.py`'s CSV/JSON writers and `visualize.py`'s figure
writers — the only two file-I/O modules left in the engine. Monte Carlo (`src/montecarlo.py`)
is a deliberately separate, opt-in call, since re-running a scenario 30 times isn't something
every caller wants paid for by default:

```python
def run_monte_carlo(curriculum, config, scenario) -> dict:
    n_runs = int(config.get("monte_carlo", {}).get("n_runs", 30))
    base_seed = int(config.get("monte_carlo", {}).get("base_seed", config["seed"]))
    for k in range(n_runs):
        run_config = copy.deepcopy(config)
        run_config["seed"] = base_seed + k
        result = Simulator(curriculum, run_config, scenario).run()
        ...  # mean, stdev, 95% CI per metric via 1.96 * sd / sqrt(n)
```

---

## 9. Live Simulation replay (`src/livesim.py`)

The whole mechanism in one sentence: **advancing to term N replays the engine from term 0**,
folding in every edit whose `effective_from_term <= N`, so earlier terms reproduce
byte-identically no matter how many later edits are added.

```python
CONFIG_PATCH_KEYS = ("cohort_size",)
SCENARIO_PATCH_KEYS = ("pass_rate_overrides", "offering_overrides", "capacity_overrides")

def _cumulative_patch(edits: list[dict], term_idx: int) -> dict:
    applicable = sorted(
        (e for e in edits if e.get("effective_from_term", 0) <= term_idx),
        key=lambda e: e.get("effective_from_term", 0),
    )
    merged: dict = {}
    for edit in applicable:
        merged.update(edit.get("patch") or {})
    return merged
```

This cumulative patch is turned into an `OverlayProvider` — a plain closure matching
`simulator.py`'s hook type (`Callable[[int], tuple[dict, dict]]`) — and handed to `Simulator`:

```python
sim = Simulator(
    self.curriculum, config, scenario,
    data_source=data_source, overlay_provider=overlay_provider,
)
```

Inside `Simulator.run()`, that hook is invoked once per term via `_apply_overlay`, which
recomputes `self.config`/`self.scenario` fresh from the **untouched base** every time (never
compounding onto a previous term's already-patched dict):

```python
def _apply_overlay(self, term_idx: int) -> None:
    if self.overlay_provider is None:
        return
    config_patch, scenario_patch = self.overlay_provider(term_idx)
    self.config = {**self._base_config, **(config_patch or {})}
    self.scenario = {**self._base_scenario, **(scenario_patch or {})}
```

When `overlay_provider` is `None` (every caller except `LiveRunner`), this is a no-op and
`Simulator` behaves exactly as if the hook didn't exist — the entire Live Simulation feature is
additive to the core engine, not a fork of it.

`cohort_size` edits need special handling because it changes *population creation*, not a
per-term config value — `_TimeVaryingCohortDataSource` looks up the cohort-size-in-effect at each
cohort's own entry term, so a cohort admitted before an edit keeps the size it was actually
admitted with even after a later edit changes `cohort_size` going forward.

---

## 10. Persistence (`src/db_models.py`)

SQLAlchemy 2.0-style `Mapped[...]` models. The load-bearing relationship: `Course`/`AppConfig`
are all scoped to a `plan_id`, not global rows —

```python
class Course(Base):
    __table_args__ = (UniqueConstraint("plan_id", "code", name="uq_course_plan_code"),)
    plan_id: Mapped[int] = mapped_column(ForeignKey("plans.id"), nullable=False)
    code: Mapped[str] = mapped_column(String, nullable=False)
    ...
```

— so `"CMPS151"` is unique *within* a plan, not across the whole database, letting two plans each
define their own course with the same code. `User.active_plan_id` is what makes "which plan am I
looking at" a per-user setting rather than one shared mutable global.

`LiveSimulation`/`LiveTermSnapshot` back Live Simulation: `base_config`/`base_scenario` are frozen
at creation and never mutated in place; every forward change is an append-only row in `edits`,
consumed by `LiveRunner.replay()` (§9) — never by editing the base dicts directly, which is what
keeps earlier snapshots valid.

---

## 11. API surface (`src/api.py`)

Every route resolves `(curriculum, config)` fresh per request from the requesting user's *active*
`Plan` — there is no module-level cache, so two users on two different active plans never share
mutable state or race each other.

| Route | Purpose |
|---|---|
| `GET /health` | liveness check |
| `GET /meta` | curriculum graph, stage nodes, cohorts, config summary — the dashboard's pre-run payload |
| `POST /simulate` | run one scenario against the active plan, return the full `flow_timeline` contract |
| `GET/POST/PUT/DELETE /curriculum[/{code}]` | curriculum CRUD on the active plan, cycle-checked |
| `GET/PUT /config` | active plan's baseline `AppConfig` |
| `GET /plans`, `POST /plans/import`, `POST /plans/{id}/activate`, `DELETE /plans/{id}`, `GET /plans/{id}/export` | multi-plan management |
| `POST /livesim`, `GET /livesim[/{id}]`, `POST /livesim/{id}/advance`, `DELETE /livesim/{id}` | Live Simulation |

`get_current_user` (`src/auth.py`) is a dependency on every route except `/health` — today it's a
stub that gets-or-creates one shared `demo@local` user rather than checking a real
token/session, so every request is "logged in" as the same user. The dependency's *shape* (a
`User` object with `active_plan_id`) is what the rest of the code depends on, which is why
re-introducing real auth later would only mean swapping this one function's implementation.

---

## 12. Analytics (`src/analytics.py`)

No simulation logic lives here — every function is a pure derivation over a finished
`SimulationResult`:

| Function | Produces |
|---|---|
| `compute_metrics(result)` | headline rates (graduation, dropout, censored, probation, on-time, avg time-to-degree) |
| `compute_cohort_metrics(result)` | the same, per `cohort_id` |
| `compute_historical_transcripts(result, incumbents_only=True)` | canonical `StudentRecord`/`EnrollmentRecord`/`OutcomeRecord` export |
| `compute_admissions_recommendation(result)` | binding-constraint intake-scaling heuristic |
| `build_course_utilization(result)` | per-course seat utilization for the heatmap |
| `build_curriculum_graph(curriculum)` | node/edge graph for the prerequisite network + roadmap |
| `flow_timeline_payload(result, curriculum)` | the full frontend contract (`meta`/`frames`/`summary`) |
| `build_summary_csv` / `build_cohort_flow_csv` / `build_cohort_summary_csv` / `build_course_utilization_csv` / `build_monte_carlo_csv` | the offline `outputs/reports/*.csv` writers |

---

## 13. End-to-end data flow

```
data/curriculum.json, simulation_config.json
        │  one-time seed (src/db.py::get_or_create_default_plan)
        ▼
data/app.db (SQLite)  ── per-plan Course/AppConfig rows
        │
        ├─ py run.py:  load from disk → run_simulation() per scenario
        │              → analytics.py CSV/JSON writers + visualize.py figures → outputs/
        │
        └─ src/api.py: resolve active Plan → run_simulation() (or LiveRunner.replay()
                        for /livesim) → flow_timeline dict → JSON response
                                              │
                                              ▼
                                   web/ (Next.js) renders the same
                                   flow_timeline shape either way
```

There is exactly **one** simulation engine (`Simulator`); everything above and below it is
either population supply (`DataSource`), replay orchestration (`LiveRunner`), or reporting
(`analytics.py`/`visualize.py`/`api.py`).
