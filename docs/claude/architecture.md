# Architecture: module map and web layout

Reference split out of `CLAUDE.md`; read it when touching any module under `src/` or the layout of `web/`.

## Architecture

```
src/
├── models/
│   ├── course.py       # Course dataclass + load_curriculum() (incl. study_plan_term = the
│   │                   # recommended semester column 1..N for the semester-grid flow chart)
│   ├── student.py      # Student (state, GPA, enrollment, cohort_id/entry_term, curriculum_stage())
│   └── semester.py     # term_season(), term_year(), term_label()
├── datasource.py        # DataSource seam: CohortSpec + SyntheticDataSource (population creation, decoupled from the engine)
├── rules.py             # evaluate_rule() / gate_edges() — generic compound prerequisite/eligibility expressions
├── simulator.py         # Simulator (staggered admission + 3-phase per-term loop) + History + SimulationResult
├── intake.py             # THE DECISION LAYER: run_intake_sweep() (two views, spaced seeds, pooled
│                         # unlimited-seat reference, isotonic smoothing, one-sided 95% bounds,
│                         # decision rule), run_seat_plan(), calibration_check(). Engine imports only.
├── jobs.py               # background runner for analyses: one at a time, daemon thread + own DB
│                         # session, throttled progress, cancel, inline mode for tests
├── analytics.py         # metrics, per-cohort metrics, curriculum graph, flow_timeline JSON, CSV writers
├── service.py            # run_simulation() — engine-as-a-service boundary, no file I/O (the seam an API layer calls)
├── db.py                 # SQLAlchemy engine/session, plan-scoped DB<->engine-shape loaders,
│                         # get_or_create_default_plan(), import_plan(), resolve_active_plan_id()
├── db_models.py          # User/Plan/Course/AppConfig/Scenario/Run ORM tables
│                         # (Course/AppConfig are per-Plan; User.active_plan_id
│                         # picks which Plan drives that user)
├── auth.py               # Auth removed — get_current_user gets-or-creates a single shared
│                         # demo user on every call (no token/cookie check); kept only so
│                         # every endpoint's Depends() signature is unchanged
├── scenarios.py          # Persistent /scenarios + /runs endpoints, scoped to the demo user
├── curriculum_validation.py  # check_no_cycle() — networkx prerequisite-cycle check, now only
│                         # reachable from course *creation* (Plan Builder / POST /curriculum),
│                         # never a PUT edit — see "Prerequisite Lock" below
├── plan_validation.py    # validate_plan_edits() etc. — single entry point for cross-object
│                         # guardrails (cohort_size positivity, capacity-vs-occupancy, admission
│                         # season/size shape) called by every write/simulate path; also
│                         # validate_prerequisites_locked() for the write-once prereq guard
├── api.py                # FastAPI wrapper: /health, /meta, /simulate, /intake-analyses, /scenarios, /runs,
│                         # /curriculum (GET/POST/PUT/DELETE), /config, /plans — no
│                         # login required (see auth.py); see docs/api.md for the full reference
├── montecarlo.py         # run_monte_carlo() — mean ± 95% CI over spaced seeds (parallel across
│                         # seeds via src/parallel.py; results collected in seed order so they're
│                         # byte-identical to a serial run)
├── parallel.py           # ordered_map() — process-pool helper for the embarrassingly-parallel
│                         # workloads (MC seeds); make_pool()/iter_ordered() drive intake analyses (one pool
│                         # per job, no silent serial fallback). See "Parallel Workloads"
├── visualize.py          # save_all_figures() + per-figure functions
└── utils.py              # load_json(), grade_tier()
web/                   # Next.js/TypeScript website — talks to src/api.py via next.config.ts's
                       # /api/backend/* rewrite (same-origin; no auth). Nav: Intake Planner (/, the
                       # home page: run analysis, recommendation card, chart, per-N table, seat
                       # planner, calibration, past analyses) · Bottlenecks · Walkthrough
                       # (/walkthrough, the Semester Checkpoint Mode) · Advisor · Data (the former
                       # Settings: courses & seats, pass rates, current students, other-program
                       # seats, policy & analysis, advanced) · Programs (Plans, Plan Builder) ·
                       # Methodology (/about). Figures, Scenarios and Run History pages were removed.
```
