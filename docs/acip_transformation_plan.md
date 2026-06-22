# ACIP Transformation Plan

**From:** Single-Cohort-Flow-Simulator (a research-grade, multi-cohort CS-curriculum simulator)
**To:** Academic Capacity Intelligence Platform (ACIP) — a deployable, multi-tenant higher-education analytics & planning product
**Owner:** Najeeb Barkhad
**Target:** Real deployable product (not a demo)
**Status (revised — see each section for detail):** Phase 0 complete — `DataSource` seam done (forward-simulation population only, per `src/datasource.py`'s own scoping note); curriculum-as-data (§2.1) done, including `registration_tier()`'s seat-priority CH bands (`registration_tier_thresholds` in config, no longer hardcoded); engine-as-service boundary (§2.3) done via `src/service.py::run_simulation`. Phase 1: the FastAPI wrapper is done and has grown well past its original scope (`src/api.py` now covers auth, plans, curriculum CRUD, scenarios, runs — see Phase 2 below); §2.2 measured calibration + the §2.4 holdout validation harness were **built, then deliberately removed** — `src/calibration.py`, `scripts/calibrate_from_history.py`, and `tests/test_calibration.py` were deleted when `docs/input_system_plan.md` re-prioritized shipping the Scenario Builder over the fit-from-synthetic-history pipeline (the project collapsed to one `baseline` scenario, dropping `B_calibrated`). What survives of §2.4's groundwork: the canonical `StudentRecord`/`EnrollmentRecord`/`OutcomeRecord` schema and `src/analytics.py::compute_historical_transcripts` (tested by `tests/test_historical_transcripts.py`) — calibration fitting itself would need to be rebuilt on top of that before this checkbox is true again. `RealDataSource` remains unbuilt (still undecided per the advisor). Phase 2 ("Web MVP") is **substantially complete and well beyond its original scope**: all 4 web slices shipped (animated curriculum graph, static figures as React/SVG, the prerequisite-network diagram) and `frontend/` was retired; on top of that, `web/` gained a SQLite DB + hand-rolled JWT auth (single-tenant — every logged-in user has equal permissions, no RBAC yet), persistent per-user scenarios + run history, a Settings page for in-place curriculum/baseline-config edits, **multi-plan support** (each user can hold several named curriculum+config combos — import/activate/export/delete — via a Plan Builder wizard), and a light/dark theme + a full visual design pass. The Scenario Builder (multi-tab, Simple/Advanced) superseded the old 2-slider `LiveWhatIfPanel`. See §3's Phase 2 entry and `docs/input_system_plan.md` (marked historical — its Phases 1+2 are exactly this work) for the as-built detail. Net effect: parts of what §4 deferred to **Phase 5** (auth, persistence) already have a working single-tenant first pass, ahead of the original phase order — true multi-tenancy/RBAC is still unbuilt.
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
| **M8 Scenario Planning** | **Done.** Multi-tab Scenario Builder (Capacity / Pass Rates & Dropout / Admissions / Registration Policy, Simple/Advanced) + persistent per-user `Scenario`/`Run` storage | **REUSE** | User-defined scenarios shipped, replacing the single-baseline limitation. See §3.2. |
| **M9 Optimization Engine** | Heuristic `compute_admissions_recommendation` (binding-criterion) | **REFACTOR** | Replace single-run heuristic with an intake sweep / optimizer over MC runs. |
| **Dashboards (§6)** | Next.js/TypeScript app, multi-page, `frontend/` retired | **DONE** | See Phase 2. |
| **Auth / RBAC / multi-tenancy / audit (§8)** | Hand-rolled JWT + httpOnly-cookie auth, single-tenant (every user has equal permissions over their own `Plan`s) | **PARTIAL / REFACTOR** | Auth exists; RBAC, true tenant isolation, and audit logs are still Phase 5. |
| **AI features (§10)** | *Nothing* | **BUILD** | Defer to last phase. |

**Rough split:** ~30% REUSE/REFACTOR (the analytical core), ~70% BUILD (data, resources, ML, product shell).

---

## 2. Mandatory early refactors (do these before the product shell)

These are structural changes to the *existing* engine that get painful if deferred.

### 2.1 Curriculum-as-data (de-hardcode the domain)
**Status: done.** Compound rules (`rule_expr` / `src/rules.py`), enrollment category-priority (`enrollment_priority_tiers`), and seat-priority CH bands (`registration_tier_thresholds`) are all config data now — `student.py::registration_tier()` was the last hardcoded piece, fixed with a backward-compatible default so existing call sites/tests didn't need a config in hand.

**Problem.** CMPS 303, the CMPS 493 compound rule, and the Spring/Fall constraints are effectively baked into the model and config for one CS program. A product serving any program/college cannot hardcode a curriculum.
**Action.** Promote curriculum, prerequisites, offerings, compound rules, and study-plan order to **tenant-scoped data** with a clean schema. The senior-project compound rule must become a general "rule expression," not a special case in `student.py`.
**Why now.** Multi-program is a product requirement; retrofitting it after the web app exists means touching every layer.

### 2.2 Calibration: assumed → measured
**Status: built, then reverted.** `src/calibration.py` + `scripts/calibrate_from_history.py`
fit per-course pass rates (direct frequency from historical `EnrollmentRecord`s) and the
dropout base hazard (binary-search re-running the engine, since `OutcomeRecord` carries no
GPA trajectory to read it off directly) against the *synthetic* incumbent cohorts, then
validated against a held-out cohort, additively as a `B_calibrated` scenario. All of this
was **deleted** in the Phase 1 re-prioritization documented in `docs/input_system_plan.md`
§1.1 — the project collapsed to a single `baseline` scenario so the Scenario Builder could
ship faster, and the calibration pipeline (plus `tests/test_calibration.py`) went with it.
Pass rates/dropout hazards/load caps are config *assumptions* again today, not measured.
Reviving this would mean rebuilding the fitting code on top of the canonical schema that
*did* survive (§2.4).

**Problem.** Pass rates, dropout hazards, load caps are config *guesses*. v2 already proved (see `report/report_v2.md`) that some of these are not even the binding levers.
**Action.** Extend the `scripts/size_sections.py` calibration pattern so course pass rates, dropout parameters, and section demand are **fit from the partner institution's history**. The engine stays the same; its inputs become empirical. Done for pass rates + dropout hazard (above); section demand was already covered by `scripts/size_sections.py`. `normal_load_ch` now has a measured sanity check too (`fit_load_cap` — empirical p95 per-student-term credit load from history, same demand-percentile idea as section sizing), reported but not auto-applied since it's a registration policy, not an observed rate. Still open: `probation_load_ch` and the dropout front-loading multiplier remain assumed — lower priority since report_v2.md shows the dropout knobs aren't the binding lever, and `probation_load_ch` only applies to an already-small probation subpopulation.
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
2. **Replay/fit** — consume *historical* transcripts to (a) calibrate pass rates / dropout hazards (§2.2) and (b) validate that the engine reproduces known cohorts. Synthetic mode fakes the history; real mode supplies it. **Same code path.** Status: the *extraction* half survives — `src/analytics.py::compute_historical_transcripts` emits canonical `StudentRecord`/`EnrollmentRecord`/`OutcomeRecord` lists (tested by `tests/test_historical_transcripts.py`), never a `SimulationResult` or `DataSource` directly, so swapping the synthetic source for a real one still only changes where those three lists come from. The *fitting* half built on top of it (`src/calibration.py`/`scripts/calibrate_from_history.py`) was deleted — see §2.2.

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
- ⏪ Built, then deleted: §2.2 measured calibration (fit pass rates / dropout hazards from
  synthetic historical transcripts via the replay path) and its holdout validation harness —
  `src/calibration.py` + `scripts/calibrate_from_history.py`, removed per
  `docs/input_system_plan.md` §1.1 to ship the Scenario Builder faster. See §2.2.
- ✅ Wrap the engine behind FastAPI (§2.3) — `src/api.py`, since grown far past this phase's
  original scope (auth, plans, curriculum CRUD, scenarios, runs — see Phase 2).
- ✅ **Database shipped** (ahead of the original plan, which deferred it to Phase 2.5/5) —
  SQLite (`data/app.db`) via SQLAlchemy, holding `User`/`Plan`/`Course`/`AppConfig`/
  `Scenario`/`Run`. Postgres migration is still open, deferred until data volume/relational
  needs justify it.
**Exit criteria (revised):** the FastAPI + DB pieces are done; the calibration/validation
half of this phase is **not** — "swap to real data" still has no fitting code to grade it
with, on top of being blocked on `RealDataSource` not existing.

### Phase 2 — Web MVP + the "proof of worth" demo *(your four strengths, productized)*
**Status: slices 1–4 done.** `web/` is a real Next.js/TypeScript app (App Router,
Tailwind v4) talking directly to `src/api.py` (`GET /meta`, `POST /simulate` — no backend
changes needed in slices 1–2, and only an additive field for slice 3, the contract
already existed and is tested). It now ports
Cohort Analytics (M2), Student Flow / Sankey (M3 — the animated semester-by-semester
curriculum graph, playback controls, narrative panel, and per-cohort stage/flow side
panel, faithfully re-derived from `frontend/app.js`'s layering layout and render logic),
Course Bottleneck (M4), Admission Simulator (M7), and Scenario Planning (M8 — the live
what-if sliders) as real React components. Two vanilla-JS behaviors that are easy to
silently break in a React port were deliberately preserved: the graph layout is computed
once and never rebuilt on a live what-if update (curriculum structure is scenario-
invariant), and a live update clamps/pauses playback rather than reseeking to term 0 —
both verified directly (Playwright: same node `transform` reference before/after a live
update, frame position unchanged, playback paused not reset). Slice 3 ports
`src/visualize.py`'s static figures (university population over time, per-cohort flow,
time-to-graduate distribution, seat-utilization heatmap) as dependency-free React/SVG,
matching `web/`'s existing no-chart-library convention (`CurriculumGraph`); three of the
four needed no backend change (already in `flow_timeline.frames`), the histogram needed
one additive field (`headline.graduation_time_distribution`, covered by
`tests/test_graduation.py` + `tests/test_api.py`). Slice 4 ports the last figure —
the prerequisite-network diagram (`curriculum_network.png`), as `PrerequisiteNetwork`
— reusing the layered `computeLayout` positions already built for the animated
`CurriculumGraph` (a spring layout, like the static PNG's, adds nothing a reader can't
get from the layered one) and shading nodes by total failures summed across
`flow_timeline.frames`, no backend change needed. With every figure ported, `frontend/`
had no remaining reason to exist and was deleted; `src/visualize.py` still writes
`curriculum_network.png` (and the rest) to `outputs/figures/` for the static
report/README embeds.

**Beyond the original Phase 2 scope, also shipped:** a SQLite DB + hand-rolled JWT/
httpOnly-cookie auth (`src/auth.py`, `web/src/proxy.ts` — hand-rolled instead of next-auth
because this Next.js version renamed Middleware to Proxy); persistent per-user `Scenario`/
`Run` storage (`/scenarios`, `/runs`) replacing file export/import as the only save path;
a Settings page (`web/.../settings/`) for in-place curriculum + baseline-config edits, with
a prerequisite-cycle guard; **multi-plan support** — `Course`/`AppConfig` scoped to a `Plan`
row instead of one global baseline, so each user can import/activate/export/delete several
named curriculum+config combos (`src/db_models.py::Plan`, `CLAUDE.md`'s "Multi-Plan Model");
a 4-step **Plan Builder wizard** to construct a plan from scratch or by cloning the default;
and a light/dark theme + a full visual design pass (ambient elevation, bento layouts, a
Sankey-style stage-flow diagram, pan/zoom on the curriculum graph). None of this was
planned in this doc — it came out of `docs/input_system_plan.md`'s own re-scoping (now
marked historical, i.e. shipped). The net result is still single-tenant (no RBAC, every
user has equal permissions over their own plans) — true multi-tenancy is still Phase 5.

- Next.js/TypeScript app with: Cohort Analytics (M2), Student Flow / Sankey (M3), Course Bottleneck (M4), Admission Simulator (M7), Scenario Planning (M8).
- Seat-based Capacity dashboard (M5 partial — the part you already have).
- Auth + persistence shipped early (single user accounts, not multi-tenant); multi-program
  groundwork shipped too (multi-plan = multiple curricula per user, though not yet
  tenant-isolated). No faculty/rooms, no ML yet.
- **This phase produces the artifact that unlocks the real data** (see §3.1) — **not yet
  explicitly packaged as that demo; see §6.**
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
**Status: done, then superseded by something bigger.** `src/api.py` exposes `POST /simulate` (scenario overrides in, the same `flow_timeline` contract back out) and `GET /meta` (curriculum graph + slider-relevant config). The original control panel, `web/src/components/LiveWhatIfPanel.tsx` (2 sliders), was deleted and replaced by the multi-tab **Scenario Builder** (`web/src/components/scenario-builder/` — Capacity / Pass Rates & Dropout / Admissions / Registration Policy, each with a Simple/Advanced toggle) per `docs/input_system_plan.md` §1.3, which covers far more of the engine's levers than this sketch originally scoped. Rest of this section kept as the original design sketch.

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

*(Originally: "start Phase 0." That's done now — superseded.)*

Phase 0, Phase 1's API/DB, and Phase 2's web MVP are all functionally complete, with one
regression: §2.2/2.4's calibration-*fitting* code was built then deleted (§2.2). The
roadmap's own dependency chain says what's next: Phase 2.5 (real-data hand-off) is gated on
"the advisor agrees the platform demonstrates value" — i.e. on §3.1's four-criterion
proof-of-worth demo — and Phases 3/4 are independent-of or blocked-on that same gate. So the
highest-leverage next step is **closing out §3.1's checklist explicitly, then taking it to
the advisor**:

1. ✅ have it — live scenario sliders with CIs (Scenario Builder + Monte Carlo).
2. ✅ have it — the four-signal bottleneck story (Bottlenecks page).
3. ✅ have it — Monte Carlo CIs on the headline KPIs.
4. ⚠️ probably have it, unverified — "load a second synthetic institution with different
   parameters and show the same dashboards adapt." The **multi-plan / Plan Builder**
   feature (built for an unrelated reason — letting one user hold several curricula) may
   already satisfy this almost exactly: build a second plan with different parameters via
   the Plan Builder, activate it, and confirm the same dashboards re-render correctly. Worth
   explicitly trying and confirming as *this* demo, rather than building something new.

Secondary, lower priority: decide whether to rebuild §2.2's calibration-fitting pipeline —
it was deleted, not just deferred, so this is a "build it again" decision, not a "finish
it" one. Only worth doing once real data (or at least a calibration demo) is wanted again.
