# ACIP Transformation Plan

**From:** Single-Cohort-Flow-Simulator (a research-grade, multi-cohort CS-curriculum simulator)
**To:** Academic Capacity Intelligence Platform (ACIP) — a deployable, multi-tenant higher-education analytics & planning product
**Owner:** Najeeb Barkhad
**Target:** Real deployable product (not a demo)
**Status:** Phase 0 complete — `DataSource` seam done (forward-simulation population only, per `src/datasource.py`'s own scoping note); curriculum-as-data (§2.1) done for compound rules (`rule_expr`) and enrollment category-priority (`enrollment_priority_tiers`) — `registration_tier()`'s seat-priority CH bands are a smaller still-hardcoded leftover; engine-as-service boundary (§2.3) done via `src/service.py::run_simulation`. Phase 1 started on three fronts: the FastAPI wrapper (`src/api.py` — `GET /health`, `GET /meta`, `POST /simulate`, no DB/auth) is done, unblocking §3.2's live scenario slider on the backend side; §2.2 measured calibration (`src/calibration.py` — pass-rate + dropout-hazard fitting) and the §2.4 replay/fit mode are now built and exercised end-to-end on the *synthetic* incumbent cohorts (`scripts/calibrate_from_history.py`), including a holdout validation harness — every calibration function consumes only the canonical `StudentRecord`/`EnrollmentRecord`/`OutcomeRecord` schema, so a future `RealDataSource` extraction is the only thing that changes when/if real data arrives (still undecided per the advisor). `RealDataSource` itself remains unbuilt — there is no real data yet to build it against.
**Data strategy (per advisor):** Build and prove the entire product on **synthetic data first**. Real student data will be provided *after* the platform demonstrates value, and will be **plugged into the same data seam** — no engine rewrite. This makes synthetic-first the sanctioned path, not a fallback.

---

## 0. How to read this document

This plan maps the [ACIP PRD](#) onto the **existing codebase** and classifies every piece of work as one of:

- **REUSE** — already built; wrap or expose, minimal change.
- **REFACTOR** — exists but must be generalized/restructured before it can serve a product.
- **BUILD** — net-new; not an extension of the current engine.

The guiding principle: **the simulation engine is the asset; everything else is scaffolding around it.** The engine (`src/simulator.py`, `src/analytics.py`, `src/montecarlo.py`) already solves the hard analytical problem — multi-cohort, shared-seat, prerequisite-aware flow with four separated bottleneck signals. The transformation is mostly about (a) feeding it *real* data instead of synthetic assumptions, (b) generalizing it beyond one hardcoded CS curriculum, and (c) wrapping it in a real product shell.

> **The single most important constraint (revised):** The advisor has sanctioned **synthetic-first** development and will supply real student data once the platform proves its worth. The gating risk is therefore *no longer data access* — it is **the data seam**. The synthetic generator must emit records in the **exact schema the real SIS export will arrive in**, and the engine must read through a **data-source interface** with two interchangeable implementations (`SyntheticDataSource`, `RealDataSource`). If that contract is right, "plug in the real data" is a config swap, not a rewrite. If it is wrong, the real-data handoff becomes a second project. **Getting the data contract right is now the central engineering bet.**

---

## 1. Module-by-module reuse map

| PRD Module | Current capability | Classification | Notes |
|---|---|---|---|
| **M1 Student Data Warehouse** | Static `data/*.json` (synthetic) | **BUILD** | Real SIS/registration/graduation ingestion into Postgres; the biggest single leap. |
| **M2 Cohort Analytics** | `compute_cohort_metrics`, `cohort_summary.csv`, per-cohort survival/retention/time-to-degree | **REUSE** | Strongest match. Expose via API; render as charts. |
| **M3 Student Flow Engine** | Stage nodes + term-over-term flows in `flow_timeline.json` (agent-based) | **REUSE / REFACTOR** | Agent model is *richer* than the PRD's transition-matrix framing. Optionally also derive a transition matrix for the Sankey view. |
| **M4 Course Bottleneck Detection** | Four block signals (fail / capacity / offering / prereq) + per-cohort variants | **REUSE** | The crown jewel. Already best-in-class. |
| **M5 Capacity Planning — seats** | Section-based seat utilization + heatmap | **REUSE** | Seats only. |
| **M5 Capacity Planning — faculty/rooms/labs** | *Nothing* | **BUILD** | Model has no faculty/room/lab entity at all. New domain modeling. |
| **M6 Graduation Forecasting** | Mechanistic expected-graduation-semester (falls out of simulation) | **REFACTOR / BUILD** | Per-student *probability* + risk score = trained ML over real outcomes. Needs Phase 0 data. |
| **M7 Admission Simulator** | Staggered multi-cohort admission + `compute_admissions_recommendation` | **REUSE / REFACTOR** | Add budget/resource outputs; multi-year horizon already natural. |
| **M8 Scenario Planning** | Scenario hooks (`capacity_multiplier`, `capacity_overrides`, `offering_overrides`, `pass_rate_overrides`) | **REUSE** | Bones exist; only one baseline wired. Generalize to user-defined scenarios. See §3.2 for the live-slider UI this enables. |
| **M9 Optimization Engine** | Heuristic `compute_admissions_recommendation` (binding-criterion) | **REFACTOR** | Replace single-run heuristic with an intake sweep / optimizer over MC runs. |
| **Dashboards (§6)** | Dependency-free static `frontend/` reading one JSON | **BUILD** | Next.js rewrite; no reuse of `app.js`. |
| **Auth / RBAC / multi-tenancy / audit (§8)** | *Nothing* | **BUILD** | First-class for a real product. |
| **AI features (§10)** | *Nothing* | **BUILD** | Defer to last phase. |

**Rough split:** ~30% REUSE/REFACTOR (the analytical core), ~70% BUILD (data, resources, ML, product shell).

---

## 2. Mandatory early refactors (do these before the product shell)

These are structural changes to the *existing* engine that get painful if deferred.

### 2.1 Curriculum-as-data (de-hardcode the domain)
**Problem.** CMPS 303, the CMPS 493 compound rule, and the Spring/Fall constraints are effectively baked into the model and config for one CS program. A product serving any program/college cannot hardcode a curriculum.
**Action.** Promote curriculum, prerequisites, offerings, compound rules, and study-plan order to **tenant-scoped data** with a clean schema. The senior-project compound rule must become a general "rule expression," not a special case in `student.py`.
**Why now.** Multi-program is a product requirement; retrofitting it after the web app exists means touching every layer.

### 2.2 Calibration: assumed → measured
**Status: started.** `src/calibration.py` + `scripts/calibrate_from_history.py` fit per-course
pass rates (direct frequency from historical `EnrollmentRecord`s) and the dropout base
hazard (binary-search re-running the engine, since `OutcomeRecord` carries no GPA
trajectory to read it off directly) against the *synthetic* incumbent cohorts, then
validate against a held-out cohort. Output is additive — a new `B_calibrated` scenario in
`simulation_config.json`, never a write to `curriculum.json` or to the documented
`A_baseline`/`dropout_base_hazard`.

**Problem.** Pass rates, dropout hazards, load caps are config *guesses*. v2 already proved (see `report/report_v2.md`) that some of these are not even the binding levers.
**Action.** Extend the `scripts/size_sections.py` calibration pattern so course pass rates, dropout parameters, and section demand are **fit from the partner institution's history**. The engine stays the same; its inputs become empirical. Done for pass rates + dropout hazard (above); section demand was already covered by `scripts/size_sections.py`. Still open: `normal_load_ch`/`probation_load_ch` and the dropout front-loading multiplier remain assumed — lower priority since report_v2.md shows the dropout knobs aren't the binding lever.
**Why now.** This is the difference between "a simulator" and "a digital twin." It also reuses your existing calibration discipline directly.

### 2.3 Engine-as-service boundary
**Problem.** The engine is invoked via `run.py` and writes files.
**Action.** Define a clean function boundary: `run_simulation(tenant_config, scenario) -> result_dict` with no file I/O. File writers (`analytics.py` CSV/JSON) become *optional* serializers. This is the seam FastAPI will call.
**Why now.** Cheap to do; everything in Phase 1+ depends on it.

### 2.4 The data seam (synthetic ⇄ real) — **the central bet**
**Problem.** Today, synthetic students are *created inside the simulator* (`_admit_cohort` instantiates `Student` objects from RNG + assumed pass rates). There is no boundary between "where the population comes from" and "how it flows." When real data arrives, there is nothing to plug it into.
**Action.** Introduce a **`DataSource` interface** that the engine reads through, with two implementations:
- `SyntheticDataSource` — wraps the current generator; produces a population (and, for calibration, pseudo-historical transcripts) from assumptions.
- `RealDataSource` — reads the institution's SIS/registration/graduation export.

Both must emit the **same canonical schema**. Define that schema *now*, modeled on a realistic SIS export, even though only the synthetic implementation exists yet:

| Entity | Key fields (canonical) |
|---|---|
| Student | `student_id`, `program_id`, `admission_term`, `status` |
| Enrollment (per term, per course) | `student_id`, `term`, `course_code`, `grade`, `credits`, `attempt_no` |
| Course catalog | `course_code`, `credits`, `prerequisites`, `offering_seasons`, `rule_expr` |
| Outcome | `student_id`, `graduation_term` (nullable), `exit_reason` |

**Two modes the engine must support against this schema:**
1. **Forward simulation** — generate a future population and flow it (current behavior; what the dashboards animate).
2. **Replay/fit** — consume *historical* transcripts to (a) calibrate pass rates / dropout hazards (§2.2) and (b) validate that the engine reproduces known cohorts. Synthetic mode fakes the history; real mode supplies it. **Same code path.** Status: built and exercised (`src/calibration.py`, driven by `scripts/calibrate_from_history.py`) — every function in it takes only `StudentRecord`/`EnrollmentRecord`/`OutcomeRecord` lists, never a `SimulationResult` or `DataSource` directly, so swapping the synthetic source for a real one only changes where those three lists come from.

**Why now.** This is the difference between "plug in the real data" being a one-day swap versus a second project. It is the contract the advisor's hand-off depends on, so it must be designed before the product is built around it.

---

## 3. Phased roadmap

### Phase 0 — Data contract + synthetic generator *(buildable now)*
**Goal:** lock the seam the real data will plug into, before building the product around it.
- Define the canonical schema (§2.4) modeled on a realistic SIS export.
- Implement the `DataSource` interface; refactor the current generator into `SyntheticDataSource` behind it.
- Make the synthetic source emit **both** a forward population *and* pseudo-historical transcripts, so the replay/fit path (§2.4) exercises the same code real data will.
- Implement §2.1 curriculum-as-data and §2.3 engine-as-service in the same pass (they touch the same code).
**Exit criteria:** the engine runs end-to-end reading *only* through `DataSource`; the existing `tests/` suite still passes (behavior pinned on QU CS); a documented schema a real SIS export can be mapped onto.

### Phase 1 — Calibration + validation harness *(reuses the core)*
- ✅ Implement §2.2 measured calibration: fit pass rates / dropout hazards from the (synthetic) historical transcripts via the replay path — `src/calibration.py` + `scripts/calibrate_from_history.py`.
- ✅ Build the validation harness that checks the engine reproduces a held-out cohort — run it on synthetic now; it becomes the real-data acceptance test later, unchanged.
- ✅ Wrap the engine behind FastAPI (§2.3) — `src/api.py`. **No database yet** — persist the canonical schema as typed models + JSON/CSV (or SQLite if querying is needed). Postgres is deferred to the real-data hand-off (Phase 2.5) and multi-tenant deployment (Phase 5), when data is large, relational, and not regenerable.
**Exit criteria:** calibration + validation run automatically (done); "swap to real data" is a `DataSource` config change with the harness ready to grade it (true today for the calibration/validation path — still blocked on `RealDataSource` itself not existing, which needs real data to exist first).

### Phase 2 — Web MVP + the "proof of worth" demo *(your four strengths, productized)*
- Next.js/TypeScript app with: Cohort Analytics (M2), Student Flow / Sankey (M3), Course Bottleneck (M4), Admission Simulator (M7), Scenario Planning (M8).
- Seat-based Capacity dashboard (M5 partial — the part you already have).
- Single tenant, single program, one admin user. No faculty/rooms, no ML yet.
- **This phase produces the artifact that unlocks the real data** (see §3.1).
**Exit criteria:** the advisor agrees the platform demonstrates value → real-data hand-off triggered.

### Phase 2.5 — Real-data plug-in *(the hand-off)*
- Map the institution's SIS export onto the canonical schema; implement `RealDataSource`.
- Run the Phase 1 validation harness against real history; report honest fit.
- Recalibrate from real transcripts.
**Exit criteria:** the *same* dashboards now run on real data; validation harness reports real-cohort reproduction error.

### Phase 3 — Resource capacity *(net-new domain)*
- Introduce faculty, classroom, and lab entities linked to course sections.
- Student-to-faculty ratio, room occupancy, scheduling conflicts, lab utilization (M5 full).
- Overload alerts + future-shortage projections.
**Exit criteria:** capacity dashboard surfaces a real overload the partner recognizes.

### Phase 4 — ML forecasting *(after real-data hand-off, Phase 2.5)*
- Train per-student graduation-probability + risk-score models on the real labeled history (M6).
- Position as a complement to the mechanistic simulation, not a replacement — and report honest accuracy, only once measurable.
**Exit criteria:** risk scores validated against held-out real outcomes.

### Phase 5 — Productization & scale
- Multi-tenancy (tenant isolation from the schema up), RBAC, audit logs, encryption (§8).
- Optimization engine upgrade (M9: intake sweep over Monte Carlo, not single-run heuristic).
- AI advisor / NL simulation (M10).
**Exit criteria:** a second institution can be onboarded without code changes.

### 3.1 What "proves it's worth it" — the gate to real data
The advisor releases real data once the synthetic platform demonstrates value, so **define that bar explicitly** rather than leaving it to a vibe. A defensible proof-of-worth demo shows the platform doing something a spreadsheet cannot:

1. **A decision the tool makes legible.** e.g. "raising CMPS 310 to a Spring offering lifts graduation +X pp and cuts time-to-degree by Y semesters" — shown live via the scenario sliders, with confidence intervals, not a static chart.
2. **A bottleneck the tool surfaces that a dean would not have ranked first** — your four-signal separation already does this (seasonal scheduling > difficulty; the CMPS 303 gateway lockstep). That counterintuitive finding *is* the sales pitch.
3. **Reproducibility under uncertainty** — Monte Carlo CIs, so recommendations come with error bars (you already have this).
4. **A credible "plug in real data" story** — demonstrate the `DataSource` swap by loading a *second* synthetic institution with different parameters and showing the same dashboards adapt. This proves the real hand-off is a config change, which is itself reassuring to the data owner.

Treat these four as Phase 2's acceptance criteria; agree them with the advisor *up front* so "worth it" is a checklist, not a judgment call.

### 3.2 Live scenario slider — design sketch
**Backend status: done.** `src/api.py` now exposes `POST /simulate` (scenario overrides in, the same `flow_timeline` contract back out) and `GET /meta` (curriculum graph + slider-relevant config), both calling existing engine pieces unchanged. What's left is the frontend half below — a control panel wired into `frontend/` that calls these endpoints.

**Inspiration.** Liaison/Othot's student-success dashboard lets a user drag a lever (e.g. a scholarship) and see a real-time re-forecast. The mechanism doesn't transfer (that's a trained ML model; this engine is mechanistic), but the *interaction pattern* directly matches what §3.1's acceptance criterion #1 already asks for: "shown live via the scenario sliders, with confidence intervals, not a static chart."

**Target shape (Phase 2, once the FastAPI wrapper from Phase 1 exists).**
- A control panel (capacity sliders per gateway course, admit-size stepper, offering toggles) maps directly onto the scenario keys the engine already accepts: `capacity_multiplier`, `capacity_overrides`, `offering_overrides`, `pass_rate_overrides`.
- On change (debounced), POST the modified scenario dict to a `/simulate` endpoint that calls `run_simulation()` (§2.3 — already file-I/O-free, already returns the full `flow_timeline` contract in memory). No new engine work needed; this is purely a thin HTTP wrapper plus a frontend control panel.
- Re-render the existing Sankey/bottleneck/cohort panels from the returned payload in place — same JSON contract the static frontend already consumes.
- Stretch: run the changed scenario through `montecarlo.run_monte_carlo` (already built) so the live re-forecast carries a CI band, not a single point estimate, matching criterion #3.

**Cheap interim version (ships before Phase 1's API, no backend required).**
The current dependency-free `frontend/` reads one static `flow_timeline.json`. Before standing up FastAPI, a slider can still feel "live" by precomputing a small grid of scenarios offline (e.g. `course_sections[CMPS303]` at 3/4/5/6 sections) into one JSON with multiple named payloads, and having the slider simply switch between precomputed payloads client-side (no network call, instant). This validates the UX and the "decision the tool makes legible" pitch (§3.1 #1) without waiting for the product-shell rewrite — useful as a Phase 2 demo asset even if the final implementation is the API-backed version above.

**Why it's low-risk:** both versions are additive to existing pieces (`run_simulation`, `flow_timeline_payload`, `run_monte_carlo`) — no engine changes, just a new consumer of the contract that already exists.

---

## 4. Architecture decisions to lock in now

| Decision | Recommendation | Rationale |
|---|---|---|
| Engine reuse | **Wrap, don't rewrite** | The analytical core is the asset and is correct. |
| **Data seam** | **`DataSource` interface, canonical schema (§2.4)** | The bet that makes the real-data hand-off a swap, not a rewrite. |
| Multi-tenancy | **Design from Phase 1 schema** | Retrofitting tenant isolation later is a rewrite. |
| Curriculum | **Data, not code** (§2.1) | Required for multi-program. |
| Calibration | **Fit from history — synthetic now, real later, same path** (§2.2) | "Twin" vs "toy" distinction; replay path must be data-source-agnostic. |
| Frontend | **Full Next.js rewrite** | Static `app.js` does not scale to the PRD's dashboards. |
| ML scope | **Defer to Phase 4 (post real-data hand-off)** | Needs real labeled outcomes; don't let it block the MVP. |
| Faculty/rooms | **Defer to Phase 3** | Net-new and not needed to prove value. |

---

## 5. Risks & honest caveats

1. **Wrong data contract = the hand-off becomes a second project.** This replaces "no data partner" as the dominant risk. The advisor *will* supply real data, but only the §2.4 schema/`DataSource` discipline makes "plug it in" a swap rather than a rewrite. Mitigate by modeling the canonical schema on a realistic SIS export *now* and validating it against the synthetic generator before building the product around it.
2. **Synthetic ≠ real, and the demo can flatter itself.** A platform tuned on synthetic data can look impressive while encoding the very assumptions that generated the data. Guard against this by keeping the validation harness (Phase 1) and calibration honest, and by reporting reproduction error openly at the Phase 2.5 hand-off — expect the real fit to be worse than synthetic, and say so.
3. **"Forecast accuracy > 90%" is unprovable until after the real-data hand-off** (Phase 2.5/4) and may not be achievable; do not promise the number before it can be measured against real outcomes.
4. **PII / data governance** becomes a hard gate at Phase 2.5, not before — but plan the security posture (storage, access, encryption) ahead of the hand-off so it isn't a blocker the day the data arrives.
5. **Scope size.** As a solo effort the full PRD is a ~12–18 month build. Phases 0–2 are a few months and produce the proof-of-worth that unlocks the data; Phases 3–5 are each roughly the size of the current project again.
6. **M5 faculty/rooms is sneakily large** — the model has zero such entities today. Keep it out of the MVP.

---

## 6. Recommended immediate next step

Start **Phase 0** — and within it, the **`DataSource` seam (§2.4) + curriculum-as-data (§2.1)** together, since they touch the same code. This is the one body of work that:
- is fully within the current repo (no product infrastructure needed),
- unblocks every later phase (multi-program, real calibration, API, and crucially the real-data hand-off),
- de-risks the advisor's promise: by the time real data arrives, there is a defined slot for it,
- and is low-risk because the existing test suite (`tests/`) pins current behavior, so the refactor can be proven non-regressive on the QU CS curriculum before anything new is added.

Concretely, the first PR: define the canonical schema, introduce `DataSource` with the current generator refactored into `SyntheticDataSource` behind it, and route the engine through it — with the existing tests green as the acceptance gate.
