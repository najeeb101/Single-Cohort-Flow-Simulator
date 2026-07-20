"""Thin HTTP wrapper around src.service.run_simulation.

Curriculum/config live in a SQLite DB (src/db.py). Every request auto-resolves to a single
shared demo user (src/auth.py::get_current_user) — no login required. The browser calls
this API through the Next.js dev server's rewrite (web/next.config.ts) to stay same-origin.

Multi-plan support: curriculum/config are resolved fresh per request from the DB, keyed by
the active plan (`_load_plan_data`), so no shared mutable state.
"""
from __future__ import annotations

import copy
import dataclasses
import os

from src.env import load_dotenv

# Load a repo-root .env (if present) BEFORE anything below reads os.environ — so LLM_API_KEY,
# DATABASE_URL, CORS_ORIGINS, etc. can live in .env instead of being exported on every launch.
# Real environment variables still win (load_dotenv uses setdefault).
load_dotenv()

from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from src.advisor import (
    AdvisorChatError,
    chat_enabled,
    extract_proposals,
    run_chat,
    summarize_plan,
    validate_proposals,
)
from src.analytics import build_curriculum_graph, compute_student_trace, find_students_matching
from src.auth import get_current_user
from src.curriculum_validation import CycleError, PlanImportError, check_no_cycle
from src.db import (
    SessionLocal,
    _course_to_row,
    get_db,
    get_or_create_default_plan,
    import_plan,
    init_db,
    load_config_from_db,
    load_curriculum_from_db,
    resolve_active_plan_id,
)
from src.db_models import AppConfig as AppConfigRow
from src.db_models import Course as CourseRow
from src.db_models import Plan as PlanRow
from src.db_models import Run, User
from src.models.course import Course
from src.models.semester import DEFAULT_TERMS, admission_seasons, get_mandatory_seasons
from src.montecarlo import run_monte_carlo
from src.optimizer import DEFAULT_RUN_BUDGET, MAX_RUN_BUDGET, solve_for_targets
from src.plan_validation import (
    PlanValidationError,
    validate_admissions,
    validate_initial_state,
    validate_plan_edits,
    validate_prerequisites_locked,
)
from src.rules import gate_edges
from src.scenarios import router as scenarios_router
from src.service import run_simulation
from src.simulator import Simulator

init_db()
with SessionLocal() as _session:
    get_or_create_default_plan(_session)

app = FastAPI(title="Single-Cohort-Flow-Simulator API")
app.include_router(scenarios_router)

# The Next.js dev server (web/, npm run dev on :3000) proxies to this API via
# next.config.ts rewrites, so the browser only ever calls its own origin — this middleware is
# for direct/manual API access (curl, TestClient, deployed health checks) rather than something
# the browser flow actually depends on. CORS_ORIGINS (comma-separated) lets a deployed frontend
# origin be added without a code change; defaults to today's local-dev-only value.
_cors_origins = os.environ.get("CORS_ORIGINS", "http://localhost:3000").split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _load_plan_data(db: Session) -> tuple[dict, dict, dict]:
    """Resolve (curriculum, config, scenario) for the active plan."""
    current_user = get_current_user(db)
    plan_id = resolve_active_plan_id(db, current_user)
    curriculum = load_curriculum_from_db(db, plan_id)
    config = load_config_from_db(db, plan_id)
    scenario = config["scenarios"][0]
    return curriculum, config, scenario


class ScenarioRequest(BaseModel):
    capacity_multiplier: float | None = None
    capacity_overrides: dict[str, float] = {}
    offering_overrides: dict[str, list[str]] = {}
    pass_rate_overrides: dict[str, float] = {}
    cohort_size: int | None = Field(default=None, ge=1)   # config override, not a scenario hook
    num_cohorts: int | None = Field(default=None, ge=1)
    num_incumbent_cohorts: int | None = Field(default=None, ge=0)
    admission_terms: list[str] | None = None      # which seasons admit (Fall-only / Fall+Spring)
    admission_sizes: dict[str, int] | None = None  # per-season cohort size override (e.g. Spring)
    max_terms: int | None = Field(default=None, ge=1)
    seed: int | None = None
    initial_state: dict | None = None      # {occupancy: {code: seats}, standing: {Year2/3/4: n}}
    dropout_gpa_floor: float | None = Field(default=None, ge=0, le=4)
    dropout_base_hazard: float | None = Field(default=None, ge=0, le=1)
    dropout_early_multiplier: float | None = Field(default=None, ge=0, le=10)
    dropout_early_sem_cutoff: int | None = Field(default=None, ge=0, le=20)
    dropout_fails_threshold: int | None = Field(default=None, ge=1, le=10)
    dropout_prob_on_repeated_fail: float | None = Field(default=None, ge=0, le=1)
    registration_tier_thresholds: list[int] | None = None
    enrollment_priority_tiers: list[dict] | None = None
    include_monte_carlo: bool = False     # opt-in; MC reruns the engine 30x
    scenario_id: int | None = None        # bookkeeping only — which saved Scenario (if any)
                                           # this run came from; doesn't affect simulation


# The valid offering seasons are per-plan, not a global enum — they are exactly the plan's own
# `terms_per_year` cycle. This is checked in the create/update-course handlers (which have the
# active plan's config), not in a pydantic validator (which doesn't), so a typo'd or out-of-cycle
# season fails fast with a clear 422 without hardcoding a season list. Course.category
# (src/models/course.py) is free text — different plans use different taxonomies, so only
# presence is checked, matching how bulk plan-import already treats it.
def _valid_seasons(config: dict) -> list[str]:
    return list(config.get("terms_per_year") or DEFAULT_TERMS)


def _validate_offering_seasons(offering: list[str], config: dict) -> None:
    valid = set(_valid_seasons(config))
    if not set(offering) <= valid:
        raise HTTPException(
            status_code=422,
            detail=f"offering entries must be among the plan's seasons {sorted(valid)}, got {sorted(set(offering))}",
        )


def _check_category(value: str) -> str:
    if not value.strip():
        raise ValueError("category is required")
    return value


def _raise_plan_validation(exc: PlanValidationError) -> None:
    raise HTTPException(status_code=422, detail=str(exc)) from exc


def _check_offering(value: list[str]) -> list[str]:
    # Plan-independent shape check only (a course must run in at least one season). Which
    # seasons are *valid* depends on the active plan's cycle and is enforced per-request in the
    # create/update handlers via _validate_offering_seasons — a pydantic validator can't see the
    # plan.
    if not value:
        raise ValueError("offering must list at least one season")
    return value


class CourseUpdate(BaseModel):
    title: str | None = None
    credits: int | None = Field(default=None, ge=0, le=6)
    prerequisites: list[str] | None = None
    pass_rate: float | None = Field(default=None, ge=0, le=1)
    offering: list[str] | None = None
    category: str | None = None
    capacity: int | None = Field(default=None, ge=1)
    rule_expr: dict | None = None
    study_plan_order: int | None = None
    study_plan_term: int | None = Field(default=None, ge=0, le=20)

    @field_validator("category")
    @classmethod
    def _validate_category(cls, v: str | None) -> str | None:
        return v if v is None else _check_category(v)

    @field_validator("offering")
    @classmethod
    def _validate_offering(cls, v: list[str] | None) -> list[str] | None:
        return v if v is None else _check_offering(v)


class PlanImportRequest(BaseModel):
    name: str
    curriculum: list[dict]
    config: dict


class CourseCreate(BaseModel):
    code: str
    title: str
    credits: int = Field(ge=0, le=6)
    prerequisites: list[str] = []
    pass_rate: float = Field(ge=0, le=1)
    offering: list[str]
    category: str
    capacity: int = Field(ge=1)
    rule_expr: dict | None = None
    study_plan_order: int = 99
    study_plan_term: int = Field(default=0, ge=0, le=20)

    @field_validator("code")
    @classmethod
    def _validate_code(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("code must not be blank")
        return v

    @field_validator("title")
    @classmethod
    def _validate_title(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("title must not be blank")
        return v

    @field_validator("category")
    @classmethod
    def _validate_category(cls, v: str) -> str:
        return _check_category(v)

    @field_validator("offering")
    @classmethod
    def _validate_offering(cls, v: list[str]) -> list[str]:
        return _check_offering(v)


def _course_to_dict(course) -> dict:
    return {
        "code": course.code,
        "title": course.title,
        "credits": course.credits,
        "prerequisites": list(course.prerequisites),
        "pass_rate": course.pass_rate,
        "offering": list(course.offering),
        "category": course.category,
        "capacity": course.capacity,
        "rule_expr": course.rule_expr,
        "study_plan_order": course.study_plan_order,
        "study_plan_term": course.study_plan_term,
    }


def _plan_to_dict(plan: PlanRow, user: User) -> dict:
    return {
        "id": plan.id,
        "name": plan.name,
        "is_default": plan.owner_user_id is None,
        "is_active": plan.id == user.active_plan_id,
    }


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


class AdvisorChatMessage(BaseModel):
    role: str
    content: str


class AdvisorChatRequest(BaseModel):
    messages: list[AdvisorChatMessage]
    # Compact run-facts blob the frontend builds from its /simulate summary (headline/criteria/
    # bottlenecks/scenario). The LLM is grounded in this — see src/advisor.py::build_system_prompt.
    context: dict = Field(default_factory=dict)


@app.post("/advisor/chat")
def advisor_chat(req: AdvisorChatRequest, db: Session = Depends(get_db)) -> dict:
    """Phase B: LLM chat grounded in one run's numbers PLUS the active plan's full curriculum and
    settings. Dormant (200, configured=False) when no LLM_API_KEY is set, so the frontend can hide
    the box without a failed request."""
    if not chat_enabled():
        return {"configured": False, "reply": None}
    # Only forward real turns, cap history so prompts stay small, and require a trailing user turn.
    msgs = [{"role": m.role, "content": m.content} for m in req.messages if m.role in ("user", "assistant")][-12:]
    if not msgs or msgs[-1]["role"] != "user":
        raise HTTPException(status_code=400, detail="The last message must be from the user.")
    # Ground the model in the real curriculum + settings (authoritative, from the active plan) on
    # top of the run summary the frontend sent — so it can answer per-course questions, not guess.
    curriculum, config, _scenario = _load_plan_data(db)
    context = {**(req.context or {}), "plan": summarize_plan(curriculum, config)}
    try:
        reply = run_chat(msgs, context)
    except AdvisorChatError as e:
        raise HTTPException(status_code=502, detail=str(e))
    # Pull any concrete-change proposals out of the reply (so the user sees prose, not raw JSON) and
    # validate them against the real plan. The frontend renders these as one-click "Apply" cards
    # routed through PUT /curriculum / PUT /config — the model never writes anything itself.
    clean, raw_proposals = extract_proposals(reply)
    proposals = validate_proposals(raw_proposals, curriculum, config)
    return {"configured": True, "reply": clean, "proposals": proposals}


@app.get("/meta")
def meta(db: Session = Depends(get_db)) -> dict:
    curriculum, config, scenario = _load_plan_data(db)
    return {
        "graph": build_curriculum_graph(curriculum),
        "course_pass_rates": {code: c.pass_rate for code, c in curriculum.items()},
        "baseline_scenario": scenario,
        "cohort_size": config["cohort_size"],
        "num_cohorts": config.get("num_cohorts"),
        "num_incumbent_cohorts": config.get("num_incumbent_cohorts", 0),
        # Initial-state warm start (replaces incumbent cohorts) — per-course occupied seats +
        # year-standing head-counts. See src/simulator.py::_effective_capacity / CLAUDE.md.
        "initial_state": config.get("initial_state", {"occupancy": {}, "standing": {}}),
        # Which seasons admit a new study cohort (Fall-only by default; add Spring for a second
        # yearly intake). Replaces the old admit_interval_terms knob — admission cadence is now a
        # choice of seasons, not an opaque term count. admission_sizes lets the department set a
        # different intake size per season (e.g. a smaller Spring cohort); a season absent from it
        # uses cohort_size. Both computed through the engine's own helper so /meta reports exactly
        # what the simulator will do, even for a plan seeded before these keys existed.
        "admission_terms": admission_seasons(config),
        "admission_sizes": config.get("admission_sizes", {}),
        # True is the engine's own fallback (src/models/semester.py) when the key is absent —
        # mirrored here so a plan seeded before this flag existed reports its *actual* behavior
        # rather than a hardcoded value that could disagree with what the engine just ran.
        "optional_terms_enabled": config.get("optional_terms_enabled", True),
        # The plan's full season cycle — the set of seasons a course may be offered in. The
        # frontend season pickers and offering validation both read this instead of a hardcoded
        # list, so changing a plan's calendar (add/remove a season) needs no code change.
        # Defaults to the engine's DEFAULT_TERMS when a plan predates the key.
        "terms_per_year": list(config.get("terms_per_year") or DEFAULT_TERMS),
        # Which of those seasons advance a student's clock (Fall/Spring by default). The frontend
        # treats these as the "regular" terms: seat denials in the other (optional) seasons are a
        # deliberately-scarce bonus pool, so capacity views (recommendations + advisor grounding)
        # count only these — matching the engine's capacity_block_counts_mandatory ranking.
        "mandatory_terms": list(get_mandatory_seasons(config)),
        "max_terms": config.get("max_terms"),
        "seed": config.get("seed"),
        "dropout_gpa_floor": config.get("dropout_gpa_floor"),
        "dropout_base_hazard": config.get("dropout_base_hazard"),
        "dropout_early_multiplier": config.get("dropout_early_multiplier"),
        "dropout_early_sem_cutoff": config.get("dropout_early_sem_cutoff"),
        "dropout_fails_threshold": config.get("dropout_fails_threshold"),
        "dropout_prob_on_repeated_fail": config.get("dropout_prob_on_repeated_fail"),
        "registration_tier_thresholds": config.get("registration_tier_thresholds", []),
        "enrollment_priority_tiers": config.get("enrollment_priority_tiers", []),
        # Phase B advisor: whether the optional LLM chat is configured (LLM_API_KEY set). The
        # frontend uses this to show the chat box or a "not configured" note — see src/advisor.py.
        "llm_chat_enabled": chat_enabled(),
        # Year-standing CH bands + the on-time-graduation cutoff — see student.py::curriculum_stage
        # and analytics.py's on_time_rate. Defaults mirror the engine's own fallback (QU's
        # 30/60/90 CH bands, 8-semester on-time cutoff) so a plan that predates these keys
        # reports its actual computed behavior.
        "year_standing_thresholds": config.get("year_standing_thresholds", [30, 60, 90]),
        "on_time_terms": config.get("on_time_terms", 8),
        "admission_targets": config.get("admission_targets", {
            "target_grad_rate": 0.70,
            "max_avg_time_to_degree": 10.0,
            "max_seats_denied_per_student": 1.0,
            "min_throughput_stability": 0.85,
        }),
    }


def _apply_scenario_overrides(
    req: ScenarioRequest, base_config: dict, base_scenario: dict
) -> tuple[dict, dict]:
    """Apply a ScenarioRequest's non-None overrides onto fresh copies of the plan's base
    config/scenario, returning (config, scenario)."""
    config = copy.deepcopy(base_config)
    if req.cohort_size is not None:
        config["cohort_size"] = req.cohort_size
    if req.num_cohorts is not None:
        config["num_cohorts"] = req.num_cohorts
    if req.num_incumbent_cohorts is not None:
        config["num_incumbent_cohorts"] = req.num_incumbent_cohorts
    if req.admission_terms is not None:
        config["admission_terms"] = req.admission_terms
    if req.admission_sizes is not None:
        config["admission_sizes"] = req.admission_sizes
    if req.max_terms is not None:
        config["max_terms"] = req.max_terms
    if req.seed is not None:
        config["seed"] = req.seed
    if req.initial_state is not None:
        config["initial_state"] = req.initial_state
    if req.dropout_gpa_floor is not None:
        config["dropout_gpa_floor"] = req.dropout_gpa_floor
    if req.dropout_base_hazard is not None:
        config["dropout_base_hazard"] = req.dropout_base_hazard
    if req.dropout_early_multiplier is not None:
        config["dropout_early_multiplier"] = req.dropout_early_multiplier
    if req.dropout_early_sem_cutoff is not None:
        config["dropout_early_sem_cutoff"] = req.dropout_early_sem_cutoff
    if req.dropout_fails_threshold is not None:
        config["dropout_fails_threshold"] = req.dropout_fails_threshold
    if req.dropout_prob_on_repeated_fail is not None:
        config["dropout_prob_on_repeated_fail"] = req.dropout_prob_on_repeated_fail
    if req.registration_tier_thresholds is not None:
        config["registration_tier_thresholds"] = req.registration_tier_thresholds
    if req.enrollment_priority_tiers is not None:
        config["enrollment_priority_tiers"] = req.enrollment_priority_tiers

    scenario = dict(base_scenario)
    if req.capacity_multiplier is not None:
        scenario["capacity_multiplier"] = req.capacity_multiplier
    if req.capacity_overrides:
        scenario["capacity_overrides"] = req.capacity_overrides
    if req.offering_overrides:
        scenario["offering_overrides"] = req.offering_overrides
    if req.pass_rate_overrides:
        scenario["pass_rate_overrides"] = req.pass_rate_overrides
    return config, scenario


def _validate_scenario_overrides(req: ScenarioRequest, curriculum: dict, config: dict) -> None:
    """Guard an ephemeral /simulate-family override the same way `PUT /config` guards a
    persisted edit. Without this, `POST /simulate` (and `/simulate/students/search` +
    `/simulate/students/{id}/trace`, which share `_apply_scenario_overrides`) could run against
    an out-of-season `admission_terms`, a malformed `initial_state`, or an occupancy that
    exceeds a course's capacity with no validation at all — `ScenarioRequest`'s pydantic
    `Field`s can't see across config keys or the plan's curriculum, so this is the same
    cross-object check `validate_plan_edits` runs on a persisted write, applied here too."""
    patch: dict = {}
    if req.admission_terms is not None:
        patch["admission_terms"] = req.admission_terms
    if req.admission_sizes is not None:
        patch["admission_sizes"] = req.admission_sizes
    try:
        validate_admissions(patch, config)
        if req.initial_state is not None:
            validate_initial_state(req.initial_state, config)
        validate_plan_edits(curriculum, config)
    except PlanValidationError as exc:
        _raise_plan_validation(exc)


@app.post("/simulate")
def simulate(
    req: ScenarioRequest,
    db: Session = Depends(get_db),
) -> dict:
    current_user = get_current_user(db)
    curriculum, base_config, base_scenario = _load_plan_data(db)
    plan_id = resolve_active_plan_id(db, current_user)

    config, scenario = _apply_scenario_overrides(req, base_config, base_scenario)
    _validate_scenario_overrides(req, curriculum, config)

    try:
        run = run_simulation(curriculum, config, scenario)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    flow_timeline = run["flow_timeline"]
    if req.include_monte_carlo:
        monte_carlo = run_monte_carlo(curriculum, config, scenario)
        flow_timeline["summary"]["headline"]["confidence_intervals"] = monte_carlo

    db.add(Run(
        user_id=current_user.id,
        scenario_id=req.scenario_id,
        overrides_json=req.model_dump(exclude_none=True),
        summary_json={"metrics": run["metrics"], "admissions_recommendation": run["admissions_recommendation"]},
    ))
    db.commit()

    return {
        "metrics": run["metrics"],
        "cohort_metrics": run["cohort_metrics"],
        "admissions_recommendation": run["admissions_recommendation"],
        "flow_timeline": flow_timeline,
    }


# ---------------------------------------------------------------------------- #
# Per-student trace: "watch one synthetic student's term-by-term journey"       #
# ---------------------------------------------------------------------------- #
# Because the engine is fully deterministic (CRN: seed + student_id), both endpoints just
# re-run it from the same overrides the dashboard used — no per-run persistence needed. Search
# runs cheaply (no trace recording); trace flips on record_traces to also capture per-student
# block events + per-term state, then extracts one student's slice.

class StudentSearchRequest(ScenarioRequest):
    filter_cohort_id: int | None = None
    filter_final_status: str | None = None      # graduated | dropped | censored (case-insensitive)
    filter_ever_probation: bool | None = None
    limit: int = Field(default=8, ge=1, le=50)

    @field_validator("filter_final_status")
    @classmethod
    def _validate_status(cls, v: str | None) -> str | None:
        if v is None:
            return v
        if v.lower() not in {"graduated", "dropped", "censored"}:
            raise ValueError("filter_final_status must be graduated, dropped, or censored")
        return v


@app.post("/simulate/students/search")
def search_students(req: StudentSearchRequest, db: Session = Depends(get_db)) -> dict:
    """Find a few representative students matching a profile, for the trace picker. Re-runs the
    baseline (or the supplied overrides) and filters the finished population — no block-event
    recording, so it stays a cheap single run. See src/analytics.py::find_students_matching."""
    curriculum, base_config, base_scenario = _load_plan_data(db)
    config, scenario = _apply_scenario_overrides(req, base_config, base_scenario)
    _validate_scenario_overrides(req, curriculum, config)
    try:
        result = Simulator(curriculum, config, scenario).run()
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return find_students_matching(
        result,
        cohort_id=req.filter_cohort_id,
        final_status=req.filter_final_status,
        ever_probation=req.filter_ever_probation,
        limit=req.limit,
    )


@app.post("/simulate/students/{student_id}/trace")
def student_trace(
    student_id: int, req: ScenarioRequest, db: Session = Depends(get_db)
) -> dict:
    """One student's full term-by-term journey (courses taken + pass/fail, blocked-and-why,
    GPA/probation/status per term, final outcome). Re-runs the engine with record_traces=True
    against the same overrides, so the trace matches what the dashboard shows for that run.
    See src/analytics.py::compute_student_trace."""
    curriculum, base_config, base_scenario = _load_plan_data(db)
    config, scenario = _apply_scenario_overrides(req, base_config, base_scenario)
    _validate_scenario_overrides(req, curriculum, config)
    try:
        result = Simulator(curriculum, config, scenario, record_traces=True).run()
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    trace = compute_student_trace(result, curriculum, student_id)
    if trace is None:
        raise HTTPException(status_code=404, detail=f"No student {student_id} in this run")
    return trace


class AutofillRequest(BaseModel):
    # How many candidate simulations the solver may run (each is one full run). Clamped to
    # [1, MAX_RUN_BUDGET] inside solve_for_targets so a request can't wedge the server.
    run_budget: int = Field(default=DEFAULT_RUN_BUDGET, ge=1, le=MAX_RUN_BUDGET)
    # Whether to probe intake reductions when capacity alone can't meet every target.
    tune_intake_fallback: bool = True


@app.post("/autofill")
def autofill(req: AutofillRequest, db: Session = Depends(get_db)) -> dict:
    """Auto-fill solver: search the smallest capacity additions that meet the active plan's
    admission health targets at the current intake. Read-only — returns a recommendation the
    caller applies itself via PUT /curriculum/{code} + PUT /config. See src/optimizer.py."""
    curriculum, config, _scenario = _load_plan_data(db)
    try:
        return solve_for_targets(
            curriculum, config,
            run_budget=req.run_budget,
            tune_intake_fallback=req.tune_intake_fallback,
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.get("/curriculum")
def list_curriculum(db: Session = Depends(get_db)) -> list[dict]:
    curriculum, _config, _scenario = _load_plan_data(db)
    return [_course_to_dict(c) for c in sorted(curriculum.values(), key=lambda c: c.study_plan_order)]


@app.post("/curriculum")
def create_course(
    req: CourseCreate,
    db: Session = Depends(get_db),
) -> dict:
    plan_id = resolve_active_plan_id(db, get_current_user(db))
    curriculum = load_curriculum_from_db(db, plan_id)

    if req.code in curriculum:
        raise HTTPException(status_code=409, detail=f"Course {req.code!r} already exists in this plan")

    config = load_config_from_db(db, plan_id)
    _validate_offering_seasons(req.offering, config)

    new_course = Course(
        code=req.code,
        title=req.title,
        credits=req.credits,
        prerequisites=tuple(req.prerequisites),
        pass_rate=req.pass_rate,
        offering=tuple(req.offering),
        category=req.category,
        capacity=req.capacity,
        rule_expr=req.rule_expr,
        study_plan_order=req.study_plan_order,
        study_plan_term=req.study_plan_term,
    )

    hypothetical = dict(curriculum)
    hypothetical[req.code] = new_course
    try:
        check_no_cycle(hypothetical)
    except CycleError as exc:
        raise HTTPException(status_code=422, detail={"message": str(exc), "cycle": exc.cycle}) from exc
    try:
        validate_plan_edits(hypothetical, config)
    except PlanValidationError as exc:
        _raise_plan_validation(exc)

    db.add(_course_to_row(new_course, plan_id))
    try:
        db.commit()
    except IntegrityError:
        # Belt-and-suspenders against the TOCTOU window between the `code in curriculum`
        # check above and this commit (e.g. a duplicate concurrent create) — the unique
        # constraint on (plan_id, code) is the real guarantee; this just turns the
        # resulting low-level DB error into the same 409 the pre-check gives.
        db.rollback()
        raise HTTPException(status_code=409, detail=f"Course {req.code!r} already exists in this plan")

    return _course_to_dict(new_course)


@app.delete("/curriculum/{code}")
def delete_course(
    code: str,
    db: Session = Depends(get_db),
) -> dict:
    plan_id = resolve_active_plan_id(db, get_current_user(db))

    row = db.query(CourseRow).filter_by(plan_id=plan_id, code=code).first()
    if row is None:
        raise HTTPException(status_code=404, detail=f"Course {code!r} not found")

    if db.query(CourseRow).filter_by(plan_id=plan_id).count() <= 1:
        raise HTTPException(status_code=422, detail="Cannot delete the last course in a plan")

    curriculum = load_curriculum_from_db(db, plan_id)
    referencing = []
    for other in curriculum.values():
        if other.code == code:
            continue
        referenced_codes = set(other.prerequisites)
        if other.rule_expr is not None:
            referenced_codes.update(c for c, _kind in gate_edges(other.rule_expr))
        if code in referenced_codes:
            referencing.append(other.code)

    if referencing:
        raise HTTPException(
            status_code=422,
            detail=f"Cannot delete {code!r}: still required as a prerequisite by {', '.join(sorted(referencing))}",
        )

    db.delete(row)
    db.commit()
    return {"ok": True}


@app.put("/curriculum/{code}")
def update_curriculum(
    code: str,
    patch: CourseUpdate,
    db: Session = Depends(get_db),
) -> dict:
    plan_id = resolve_active_plan_id(db, get_current_user(db))
    curriculum = load_curriculum_from_db(db, plan_id)

    row = db.query(CourseRow).filter_by(plan_id=plan_id, code=code).first()
    if row is None:
        raise HTTPException(status_code=404, detail=f"Course {code!r} not found")

    current = curriculum[code]
    config = load_config_from_db(db, plan_id)
    patch_fields = patch.model_dump(exclude_none=True)
    if "prerequisites" in patch_fields:
        patch_fields["prerequisites"] = tuple(patch_fields["prerequisites"])
    if "offering" in patch_fields:
        _validate_offering_seasons(patch_fields["offering"], config)
        patch_fields["offering"] = tuple(patch_fields["offering"])
    try:
        validate_prerequisites_locked(current, patch_fields)
    except PlanValidationError as exc:
        _raise_plan_validation(exc)
    updated_course = dataclasses.replace(current, **patch_fields)

    hypothetical = dict(curriculum)
    hypothetical[code] = updated_course
    try:
        check_no_cycle(hypothetical)
    except CycleError as exc:
        raise HTTPException(status_code=422, detail={"message": str(exc), "cycle": exc.cycle}) from exc
    try:
        validate_plan_edits(hypothetical, config)
    except PlanValidationError as exc:
        _raise_plan_validation(exc)

    for field, value in patch.model_dump(exclude_none=True).items():
        setattr(row, field, value)
    db.commit()

    return _course_to_dict(updated_course)


@app.get("/config")
def get_config(db: Session = Depends(get_db)) -> dict:
    _curriculum, config, _scenario = _load_plan_data(db)
    return config


@app.put("/config")
def update_config(
    patch: dict,
    db: Session = Depends(get_db),
) -> dict:
    if "registration_tier_thresholds" in patch:
        thresholds = patch["registration_tier_thresholds"]
        if not (isinstance(thresholds, list) and len(thresholds) == 5 and all(isinstance(t, int) for t in thresholds)):
            raise HTTPException(status_code=422, detail="registration_tier_thresholds must be a list of 5 ints")

    if "optional_terms_enabled" in patch and not isinstance(patch["optional_terms_enabled"], bool):
        raise HTTPException(status_code=422, detail="optional_terms_enabled must be a boolean")

    plan_id = resolve_active_plan_id(db, get_current_user(db))
    row = db.query(AppConfigRow).filter_by(plan_id=plan_id).first()
    merged_config = {**row.data, **patch}

    try:
        # Judge admission seasons against the POST-patch config so a request changing
        # mandatory_terms and admission_terms together is validated against the new season set.
        validate_admissions(patch, merged_config)

        if "initial_state" in patch:
            # Validate standing against the POST-patch config, so a request that changes
            # year_standing_thresholds and standing together is judged against the new year bands.
            validate_initial_state(patch["initial_state"], merged_config)

        # Cross-object guardrails (cohort_size positivity, capacity-vs-occupancy) against the
        # POST-patch config and this plan's curriculum.
        curriculum = load_curriculum_from_db(db, plan_id)
        validate_plan_edits(curriculum, merged_config)
    except PlanValidationError as exc:
        _raise_plan_validation(exc)

    row.data = merged_config
    db.commit()

    return row.data


@app.get("/plans")
def list_plans(db: Session = Depends(get_db)) -> list[dict]:
    current_user = get_current_user(db)
    rows = (
        db.query(PlanRow)
        .filter((PlanRow.owner_user_id.is_(None)) | (PlanRow.owner_user_id == current_user.id))
        .order_by(PlanRow.created_at)
        .all()
    )
    return [_plan_to_dict(p, current_user) for p in rows]


@app.post("/plans/import")
def import_plan_endpoint(
    req: PlanImportRequest,
    db: Session = Depends(get_db),
) -> dict:
    current_user = get_current_user(db)
    try:
        plan = import_plan(db, current_user.id, req.name, req.curriculum, req.config)
    except PlanImportError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return _plan_to_dict(plan, current_user)


def _get_visible_plan(db: Session, plan_id: int, user: User) -> PlanRow:
    plan = db.get(PlanRow, plan_id)
    if plan is None or (plan.owner_user_id is not None and plan.owner_user_id != user.id):
        raise HTTPException(status_code=404, detail="Plan not found")
    return plan


@app.post("/plans/{plan_id}/activate")
def activate_plan(
    plan_id: int, db: Session = Depends(get_db)
) -> dict:
    current_user = get_current_user(db)
    plan = _get_visible_plan(db, plan_id, current_user)
    current_user.active_plan_id = plan.id
    db.commit()
    return _plan_to_dict(plan, current_user)


@app.patch("/plans/{plan_id}")
def rename_plan(
    plan_id: int, body: dict, db: Session = Depends(get_db)
) -> dict:
    current_user = get_current_user(db)
    plan = _get_visible_plan(db, plan_id, current_user)
    name = (body.get("name") or "").strip()
    if not name:
        raise HTTPException(status_code=422, detail="Name must not be empty")
    plan.name = name
    db.commit()
    return _plan_to_dict(plan, current_user)


@app.delete("/plans/{plan_id}")
def delete_plan(
    plan_id: int, db: Session = Depends(get_db)
) -> dict:
    current_user = get_current_user(db)
    plan = db.get(PlanRow, plan_id)
    if plan is None or plan.owner_user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Plan not found")

    db.query(CourseRow).filter_by(plan_id=plan.id).delete()
    db.query(AppConfigRow).filter_by(plan_id=plan.id).delete()
    if current_user.active_plan_id == plan.id:
        current_user.active_plan_id = get_or_create_default_plan(db).id
    db.delete(plan)
    db.commit()
    return {"ok": True}


@app.get("/plans/{plan_id}/export")
def export_plan(
    plan_id: int, db: Session = Depends(get_db)
) -> dict:
    plan = _get_visible_plan(db, plan_id, get_current_user(db))
    curriculum = load_curriculum_from_db(db, plan.id)
    config = load_config_from_db(db, plan.id)
    return {
        "curriculum": [_course_to_dict(c) for c in sorted(curriculum.values(), key=lambda c: c.study_plan_order)],
        "config": config,
    }

