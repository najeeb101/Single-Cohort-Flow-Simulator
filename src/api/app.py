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

from src import jobs
from src.advisor import (
    AdvisorChatError,
    chat_enabled,
    extract_proposals,
    model_label,
    run_chat_detailed,
    summarize_analysis,
    summarize_plan,
    validate_proposals,
)
from src.analytics import (
    build_curriculum_graph,
    flow_timeline_payload,
)
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
    migrate_plan_configs,
    recover_interrupted_analyses,
    resolve_active_checkpoint_session,
    resolve_active_plan_id,
)
from src.db_models import Analysis as AnalysisRow
from src.db_models import AppConfig as AppConfigRow
from src.db_models import CheckpointSession as CheckpointSessionRow
from src.db_models import CheckpointSnapshot as CheckpointSnapshotRow
from src.db_models import Course as CourseRow
from src.db_models import Plan as PlanRow
from src.db_models import Run, User
from src.models.course import Course, course_from_dict
from src.models.semester import DEFAULT_TERMS, admission_seasons, get_mandatory_seasons, term_label
from src.models.student import stage_node_names
from src.intake import DEFAULT_ANALYSIS, DEFAULT_POLICY, analysis_params, policy_from_config
from src.montecarlo import run_monte_carlo
from src.plan_validation import (
    PlanValidationError,
    validate_admissions,
    validate_initial_state,
    validate_intake_analysis,
    validate_intake_policy,
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
    # Bring plans stored before the Intake Planner up to the current config shape, and fail any
    # analysis a killed server (e.g. a --reload restart) left mid-run.
    migrate_plan_configs(_session)
    recover_interrupted_analyses(_session)

app = FastAPI(title="CS Intake Planner API")
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
    initial_state: dict | None = None      # {occupancy: {code: seats}}
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
    settings PLUS the latest intake analysis. Dormant (200, configured=False) when no model is
    configured (see src/advisor.py), so the frontend can hide the box without a failed request."""
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
    # ...and in the latest finished intake analysis for this plan, so "why 80?" / "what would it
    # take to admit 120?" are answered from the real sweep, not reconstructed by the model.
    current_user = get_current_user(db)
    latest = (
        db.query(AnalysisRow)
        .filter(AnalysisRow.user_id == current_user.id,
                AnalysisRow.plan_id == resolve_active_plan_id(db, current_user),
                AnalysisRow.kind == "intake_sweep", AnalysisRow.status == "done")
        .order_by(AnalysisRow.id.desc())
        .first()
    )
    if latest is not None:
        context["intake_analysis"] = summarize_analysis(
            latest.result, label=latest.label,
            when=latest.finished_at.strftime("%Y-%m-%d") if latest.finished_at else None)
    try:
        answer = run_chat_detailed(msgs, context)
    except AdvisorChatError as e:
        raise HTTPException(status_code=502, detail=str(e))
    reply = answer["reply"]
    # Pull any concrete-change proposals out of the reply (so the user sees prose, not raw JSON) and
    # validate them against the real plan. The frontend renders these as one-click "Apply" cards
    # routed through PUT /curriculum / PUT /config — the model never writes anything itself.
    clean, raw_proposals = extract_proposals(reply)
    proposals = validate_proposals(raw_proposals, curriculum, config)
    return {"configured": True, "reply": clean, "proposals": proposals, "model": answer["model"]}


@app.get("/meta")
def meta(db: Session = Depends(get_db)) -> dict:
    curriculum, config, scenario = _load_plan_data(db)
    checkpoint_session = resolve_active_checkpoint_session(db, get_current_user(db))
    return {
        "graph": build_curriculum_graph(curriculum),
        "course_pass_rates": {code: c.pass_rate for code, c in curriculum.items()},
        "baseline_scenario": scenario,
        "cohort_size": config["cohort_size"],
        "num_cohorts": config.get("num_cohorts"),
        "num_incumbent_cohorts": config.get("num_incumbent_cohorts", 0),
        # Initial-state warm start (replaces incumbent cohorts) — per-course occupied seats.
        # See src/simulator.py::_effective_capacity / CLAUDE.md.
        "initial_state": config.get("initial_state", {"occupancy": {}}),
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
        # Which model answers the chat ("qwen3-coder:30b · on this PC"), shown under the chat box.
        "llm_model": model_label(),
        # Year-standing CH bands + the on-time-graduation cutoff — see student.py::curriculum_stage
        # and analytics.py's on_time_rate. Defaults mirror the engine's own fallback (QU's
        # 30/60/90 CH bands, 8-semester on-time cutoff) so a plan that predates these keys
        # reports its actual computed behavior.
        "year_standing_thresholds": config.get("year_standing_thresholds", [30, 60, 90]),
        "on_time_terms": config.get("on_time_terms", 8),
        # Intake Planner inputs (src/intake.py): the policy limits, the sweep knobs (merged with
        # their defaults so the frontend always sees every key), and the data that rebuilds
        # today's student body + labels how much of it is real QU data vs estimates.
        "intake_policy": {**DEFAULT_POLICY, **(config.get("intake_policy") or {})},
        "intake_analysis": {k: v for k, v in analysis_params(config).items() if k in DEFAULT_ANALYSIS},
        "seat_step": config.get("seat_step", 5),
        "planning": config.get("planning") or {},
        "current_students": config.get("current_students") or {"past_intakes": []},
        "historical_outcomes": config.get("historical_outcomes") or {},
        "data_sources": config.get("data_sources") or {},
        "intake_job_running": jobs.is_busy(),
        # Whether the caller has an in-progress Semester Checkpoint Mode session (see
        # /checkpoint below) — lets the nav/dashboard reflect it without a separate request.
        "checkpoint_active": checkpoint_session is not None,
        "checkpoint_next_term": checkpoint_session.next_term if checkpoint_session else None,
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
    """Guard an ephemeral /simulate override the same way `PUT /config` guards a persisted
    edit. Without this, `POST /simulate` could run against an out-of-season `admission_terms`,
    a malformed `initial_state`, or an occupancy that exceeds a course's capacity with no
    validation at all — `ScenarioRequest`'s pydantic `Field`s can't see across config keys or
    the plan's curriculum, so this is the same cross-object check `validate_plan_edits` runs on
    a persisted write, applied here too."""
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
        summary_json={"metrics": run["metrics"]},
    ))
    db.commit()

    return {
        "metrics": run["metrics"],
        "cohort_metrics": run["cohort_metrics"],
        "flow_timeline": flow_timeline,
    }


# ---------------------------------------------------------------------------- #
# Intake Planner: background analyses (src/intake.py via src/jobs.py)           #
# ---------------------------------------------------------------------------- #
# "How many students should we admit next?" (kind=intake_sweep) and "what seats would it take
# to admit N?" (kind=seat_plan). Each runs as a background job — one at a time, since a job
# already uses every CPU core — and is stored as an Analysis row with an exact snapshot of the
# inputs it ran on. Read-only with respect to the plan: applying a seat plan goes through the
# existing PUT /curriculum (or POST /checkpoint/edit for a walkthrough session).

class IntakeAnalysisRequest(BaseModel):
    kind: str = Field(default="intake_sweep", pattern="^(intake_sweep|seat_plan)$")
    label: str | None = Field(default=None, max_length=120)
    # seat_plan only: the intake the department wants to reach.
    target_intake: int | None = Field(default=None, ge=10, le=1000)
    # Run against the active plan, or against a walkthrough session's staged (working) data.
    source: str = Field(default="plan", pattern="^(plan|checkpoint)$")
    # One-off overrides for this run only (not persisted): policy limits and sweep knobs.
    policy: dict | None = None
    params: dict | None = None
    run_budget: int = Field(default=6, ge=1, le=20)


def _analysis_to_dict(row: AnalysisRow, *, full: bool) -> dict:
    out = {
        "id": row.id,
        "kind": row.kind,
        "source": row.source,
        "label": row.label,
        "status": row.status,
        "progress": row.progress,
        "progress_note": row.progress_note,
        "params": row.params,
        "error": row.error,
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "started_at": row.started_at.isoformat() if row.started_at else None,
        "finished_at": row.finished_at.isoformat() if row.finished_at else None,
    }
    result = row.result or {}
    if row.kind == "intake_sweep":
        rec = result.get("recommendation") or {}
        out["summary"] = {k: rec.get(k) for k in (
            "recommended_intake", "sustainable_intake", "upper_limit", "feasible", "binding_limit")}
        out["summary"]["illustrative"] = (result.get("data_quality") or {}).get("illustrative")
    else:
        out["summary"] = {k: result.get(k) for k in (
            "target_intake", "feasible", "total_seats_added")}
    if full:
        out["result"] = row.result
        out["inputs_snapshot"] = row.inputs_snapshot
    return out


def _require_analysis(db: Session, analysis_id: int) -> AnalysisRow:
    row = db.get(AnalysisRow, analysis_id)
    if row is None or row.user_id != get_current_user(db).id:
        raise HTTPException(status_code=404, detail="Analysis not found")
    return row


@app.post("/intake-analyses", status_code=202)
def start_intake_analysis(req: IntakeAnalysisRequest, db: Session = Depends(get_db)) -> dict:
    """Start an intake sweep or seat plan in the background; poll GET /intake-analyses/{id}."""
    if req.kind == "seat_plan" and req.target_intake is None:
        raise HTTPException(status_code=422, detail="target_intake is required for a seat plan")
    if jobs.is_busy():
        raise HTTPException(status_code=409, detail="Another analysis is already running; wait or cancel it")

    current_user = get_current_user(db)
    plan_id = resolve_active_plan_id(db, current_user)
    if req.source == "checkpoint":
        session_row = _require_checkpoint_session(db, current_user)
        curriculum = _checkpoint_curriculum(session_row)
        config = copy.deepcopy(session_row.working_config)
    else:
        curriculum, config, _scenario = _load_plan_data(db)

    try:
        validate_intake_policy({**DEFAULT_POLICY, **(config.get("intake_policy") or {}), **(req.policy or {})})
        validate_intake_analysis({**(config.get("intake_analysis") or {}), **(req.params or {})})
        validate_plan_edits(curriculum, config)
    except PlanValidationError as exc:
        _raise_plan_validation(exc)

    label = req.label or (config.get("planning") or {}).get("next_intake_label")
    job_params = {"policy": req.policy or {}, "params": req.params or {},
                  "target_intake": req.target_intake, "run_budget": req.run_budget}
    row = AnalysisRow(
        user_id=current_user.id,
        plan_id=plan_id,
        kind=req.kind,
        source=req.source,
        label=label,
        status="queued",
        params={**job_params, "policy": dataclasses.asdict(policy_from_config(config, req.policy))},
        inputs_snapshot={
            "curriculum": [_course_to_dict(c) for c in sorted(curriculum.values(), key=lambda c: c.study_plan_order)],
            "config": config,
        },
    )
    db.add(row)
    db.commit()
    try:
        jobs.start(row.id, req.kind, curriculum, config, job_params)
    except RuntimeError as exc:  # lost a race with another request for the single job slot
        row.status = "failed"
        row.error = str(exc)
        db.commit()
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    db.refresh(row)
    return _analysis_to_dict(row, full=False)


@app.get("/intake-analyses")
def list_intake_analyses(kind: str | None = None, limit: int = 20, db: Session = Depends(get_db)) -> list[dict]:
    """Past analyses for the caller's active plan, newest first (summaries only)."""
    current_user = get_current_user(db)
    plan_id = resolve_active_plan_id(db, current_user)
    q = db.query(AnalysisRow).filter(AnalysisRow.user_id == current_user.id, AnalysisRow.plan_id == plan_id)
    if kind:
        q = q.filter(AnalysisRow.kind == kind)
    rows = q.order_by(AnalysisRow.id.desc()).limit(max(1, min(limit, 100))).all()
    return [_analysis_to_dict(r, full=False) for r in rows]


@app.get("/intake-analyses/{analysis_id}")
def get_intake_analysis(analysis_id: int, db: Session = Depends(get_db)) -> dict:
    return _analysis_to_dict(_require_analysis(db, analysis_id), full=True)


@app.post("/intake-analyses/{analysis_id}/cancel")
def cancel_intake_analysis(analysis_id: int, db: Session = Depends(get_db)) -> dict:
    row = _require_analysis(db, analysis_id)
    if row.status not in ("queued", "running"):
        raise HTTPException(status_code=409, detail=f"Analysis is already {row.status}")
    if not jobs.request_cancel(analysis_id):
        row.status = "cancelled"
        row.progress_note = "Cancelled"
        db.commit()
    return {"id": analysis_id, "cancel_requested": True}


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

    if "admission_targets" in patch:
        raise HTTPException(status_code=422, detail="admission_targets was retired; set intake_policy instead")
    if "section_size" in patch:
        raise HTTPException(status_code=422, detail="section_size was retired (sections vary in size); "
                                                    "seat suggestions round to seat_step instead")

    plan_id = resolve_active_plan_id(db, get_current_user(db))
    row = db.query(AppConfigRow).filter_by(plan_id=plan_id).first()
    merged_config = {**row.data, **patch}

    try:
        # Judge admission seasons against the POST-patch config so a request changing
        # mandatory_terms and admission_terms together is validated against the new season set.
        validate_admissions(patch, merged_config)

        if "initial_state" in patch:
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


# ---------------------------------------------------------------------------- #
# Semester Checkpoint Mode: turn-based, resumable re-run of the active plan     #
# ---------------------------------------------------------------------------- #
# One step = one mandatory (Fall/Spring) term (see Simulator.step_one_mandatory_term). Between
# steps, the department head may edit future-facing knobs only (capacity/pass_rate/occupancy/
# intake) — never prerequisites/rule_expr/offering/category (locked, see the prereq-lock note
# above) or admission_terms/num_cohorts/max_terms/seed (would change the horizon and break the
# resume cursor). `working_curriculum`/`working_config` are a frozen-at-creation COPY of the
# active plan, so this never touches the plan's own Course/AppConfig rows — no Run row is
# written either, since this isn't the dashboard's baseline /simulate path.

def _checkpoint_curriculum(row: CheckpointSessionRow) -> dict[str, Course]:
    return {c["code"]: course_from_dict(c) for c in row.working_curriculum}


def _checkpoint_history(db: Session, session_id: int, config: dict) -> list[dict]:
    """Cheap {seq, next_term, label} listing of every step recorded for this session, so the
    frontend can render a "go back to an earlier term" step list without ever unpickling a
    snapshot blob just to build labels. Since Semester Checkpoint Mode now steps one calendar
    term at a time — including optional Summer/Winter terms, not just Fall/Spring (see
    Simulator.step_one_term) — `label` names the season/year actually completed at each step
    (e.g. "Summer Y2"), not just a bare term index, so an optional-term step reads as
    distinctly as a mandatory one. seq=0 is always "Start" (the state before any term ran).
    See POST /checkpoint/rewind."""
    rows = (
        db.query(CheckpointSnapshotRow)
        .filter(CheckpointSnapshotRow.session_id == session_id)
        .order_by(CheckpointSnapshotRow.seq)
        .all()
    )
    return [
        {
            "seq": r.seq,
            "next_term": r.next_term,
            "label": "Start" if r.seq == 0 else term_label(r.next_term - 1, config),
        }
        for r in rows
    ]


def _purge_checkpoint_snapshots(db: Session, session_id: int) -> None:
    """Delete every per-step snapshot row for a session — called when a session is discarded
    (explicitly, or superseded by a new POST /checkpoint), since those blobs have no further use
    once the session they belong to is gone."""
    db.query(CheckpointSnapshotRow).filter(CheckpointSnapshotRow.session_id == session_id).delete()


def _checkpoint_summary_from_sim(db: Session, row: CheckpointSessionRow, sim: Simulator) -> dict:
    counts = {"active": 0, "delayed": 0, "graduated": 0, "dropped": 0, "censored": 0}
    for s in sim.students:
        counts[s.status.lower()] += 1
    return {
        "id": row.id,
        "status": row.status,
        "next_term": row.next_term,
        # Season/year label for the upcoming term (e.g. "Summer Y2") — None once finished. Lets
        # the frontend show which season is next now that Summer/Winter are steppable too, not
        # just a bare calendar-term index.
        "next_term_label": None if sim.is_finished else term_label(row.next_term, sim.config),
        "is_finished": sim.is_finished,
        "working_curriculum": row.working_curriculum,
        "working_config": row.working_config,
        # Frames-so-far — same per-term shape as flow_timeline's `frames`, so the frontend can
        # reuse the exact same rendering (CurriculumGraph etc.) as the baseline dashboard.
        "frames": sim.history.timeline,
        "meta": {
            "graph": build_curriculum_graph(sim.curriculum),
            "stage_nodes": stage_node_names(sim.config),
        },
        "counts_so_far": counts,
        # Every step recorded so far (see POST /checkpoint/rewind) — lets the frontend offer
        # "go back to an earlier term" without a separate request.
        "history": _checkpoint_history(db, row.id, sim.config),
        # The exact {meta, frames, summary} shape a completed /simulate produces — every field
        # in compute_metrics/compute_cohort_metrics only reads .history/.config/.students, all
        # present on a Simulator mid-run, so this is safe to call on a partial population
        # (ratios guard their own zero-student/zero-graduate case). Lets Bottlenecks/
        # HeadlineKpis/CohortsTable read a checkpoint session exactly like the
        # baseline dashboard's flow_timeline — the frontend must still treat it as partial
        # (fewer terms run = less reliable), which is why it's a distinct field rather than the
        # baseline's own flow_timeline.
        "flow_timeline": flow_timeline_payload(sim, sim.curriculum),
    }


def _checkpoint_summary(db: Session, row: CheckpointSessionRow) -> dict:
    """Reconstruct the read-only view of a session from its persisted snapshot — used wherever
    the caller doesn't already have a live Simulator in hand (GET, and after an edit that
    doesn't itself advance any terms)."""
    curriculum = _checkpoint_curriculum(row)
    config = row.working_config
    scenario = config["scenarios"][0]
    sim = Simulator.from_snapshot(curriculum, config, scenario, row.snapshot)
    return _checkpoint_summary_from_sim(db, row, sim)


def _require_checkpoint_session(db: Session, user: User) -> CheckpointSessionRow:
    row = resolve_active_checkpoint_session(db, user)
    if row is None:
        raise HTTPException(status_code=404, detail="No active checkpoint session")
    return row


@app.post("/checkpoint")
def create_checkpoint(db: Session = Depends(get_db)) -> dict:
    """Start a new Semester Checkpoint Mode walkthrough from the caller's active plan. Only one
    active session per user — starting a new one discards any existing active session (the head
    starts over rather than juggling two in parallel)."""
    current_user = get_current_user(db)
    plan_id = resolve_active_plan_id(db, current_user)
    curriculum = load_curriculum_from_db(db, plan_id)
    config = load_config_from_db(db, plan_id)
    scenario = config["scenarios"][0]

    existing = resolve_active_checkpoint_session(db, current_user)
    if existing is not None:
        existing.status = "discarded"
        _purge_checkpoint_snapshots(db, existing.id)

    sim = Simulator(curriculum, config, scenario)
    row = CheckpointSessionRow(
        user_id=current_user.id,
        plan_id=plan_id,
        status="active",
        next_term=sim._next_term,
        snapshot=sim.snapshot(),
        working_curriculum=[_course_to_dict(c) for c in curriculum.values()],
        working_config=config,
    )
    db.add(row)
    db.commit()
    db.add(CheckpointSnapshotRow(session_id=row.id, seq=0, next_term=row.next_term, snapshot=row.snapshot))
    db.commit()
    return _checkpoint_summary_from_sim(db, row, sim)


@app.get("/checkpoint")
def get_checkpoint(db: Session = Depends(get_db)) -> dict:
    row = _require_checkpoint_session(db, get_current_user(db))
    return _checkpoint_summary(db, row)


class CheckpointEditRequest(BaseModel):
    """Future-facing knobs only. Deliberately excludes prerequisites/rule_expr/offering/
    category/study_plan_term (structural — locked, see the prereq-lock note above) and
    admission_terms/num_cohorts/max_terms/seed (would change the horizon and break the resume
    cursor) — there is no way to smuggle a structural edit through this endpoint since the
    fields simply don't exist on this model."""
    capacity: dict[str, int] = {}
    pass_rate: dict[str, float] = {}
    initial_state: dict | None = None
    cohort_size: int | None = Field(default=None, ge=1)
    admission_sizes: dict[str, int] | None = None


@app.post("/checkpoint/edit")
def edit_checkpoint(req: CheckpointEditRequest, db: Session = Depends(get_db)) -> dict:
    """Stage an edit to the session's working curriculum/config. Does not advance any terms —
    the edit takes effect starting with the next POST /checkpoint/advance. Validated the same
    way a persisted PUT /curriculum or PUT /config edit is (validate_plan_edits +
    validate_initial_state), against a COPY of the working state so a rejected edit never
    touches the stored session."""
    row = _require_checkpoint_session(db, get_current_user(db))
    if row.status != "active":
        raise HTTPException(status_code=422, detail=f"Checkpoint session is {row.status}, not active")

    working_curriculum = copy.deepcopy(row.working_curriculum)
    by_code = {c["code"]: c for c in working_curriculum}
    for code, value in req.capacity.items():
        if code not in by_code:
            raise HTTPException(status_code=422, detail=f"Unknown course {code!r} in this session")
        if value < 1:
            raise HTTPException(status_code=422, detail=f"capacity for {code!r} must be at least 1")
        by_code[code]["capacity"] = value
    for code, value in req.pass_rate.items():
        if code not in by_code:
            raise HTTPException(status_code=422, detail=f"Unknown course {code!r} in this session")
        if not (0.0 <= value <= 1.0):
            raise HTTPException(status_code=422, detail=f"pass_rate for {code!r} must be between 0 and 1")
        by_code[code]["pass_rate"] = value

    working_config = copy.deepcopy(row.working_config)
    if req.initial_state is not None:
        working_config["initial_state"] = req.initial_state
    if req.cohort_size is not None:
        working_config["cohort_size"] = req.cohort_size
    if req.admission_sizes is not None:
        working_config["admission_sizes"] = req.admission_sizes

    curriculum = {c["code"]: course_from_dict(c) for c in working_curriculum}
    try:
        if req.admission_sizes is not None:
            validate_admissions({"admission_sizes": req.admission_sizes}, working_config)
        if req.initial_state is not None:
            validate_initial_state(req.initial_state, working_config)
        validate_plan_edits(curriculum, working_config)
    except PlanValidationError as exc:
        _raise_plan_validation(exc)

    row.working_curriculum = working_curriculum
    row.working_config = working_config
    db.commit()
    return _checkpoint_summary(db, row)


@app.post("/checkpoint/advance")
def advance_checkpoint(db: Session = Depends(get_db)) -> dict:
    """Advance the session by exactly one calendar term — mandatory (Fall/Spring) OR optional
    (Summer/Winter), via Simulator.step_one_term — applying whatever edits have been staged
    since the last advance. Every term is its own step now, so a department head can pause and
    edit at a Summer boundary too, not just Fall/Spring. No-op (just returns the current state)
    if the session is already finished."""
    row = _require_checkpoint_session(db, get_current_user(db))
    if row.status != "active":
        raise HTTPException(status_code=422, detail=f"Checkpoint session is {row.status}, not active")

    curriculum = _checkpoint_curriculum(row)
    config = row.working_config
    scenario = config["scenarios"][0]
    sim = Simulator.from_snapshot(curriculum, config, scenario, row.snapshot)

    existing_steps = (
        db.query(CheckpointSnapshotRow)
        .filter(CheckpointSnapshotRow.session_id == row.id)
        .count()
    )
    if existing_steps == 0:
        # This session predates the per-step history table (created before this feature
        # shipped, or otherwise never got its seq=0 row) — back-fill its CURRENT (pre-advance)
        # state as seq=0 before stepping, so "go back to the start" means the earliest state we
        # actually have a snapshot for, not "one step past wherever it already was."
        db.add(CheckpointSnapshotRow(
            session_id=row.id, seq=0, next_term=row.next_term, snapshot=row.snapshot,
        ))
        existing_steps = 1

    if not sim.is_finished:
        sim.step_one_term()
        row.snapshot = sim.snapshot()
        row.next_term = sim._next_term
        db.add(CheckpointSnapshotRow(
            session_id=row.id, seq=existing_steps, next_term=row.next_term, snapshot=row.snapshot,
        ))

    if sim.is_finished:
        row.status = "completed"
    db.commit()
    return _checkpoint_summary_from_sim(db, row, sim)


@app.get("/checkpoint/peek/{seq}")
def peek_checkpoint(seq: int, db: Session = Depends(get_db)) -> dict:
    """Read-only view of an earlier step (from the `history` list every checkpoint response
    includes) — unlike POST /checkpoint/rewind, this never mutates the session row or deletes any
    CheckpointSnapshot rows, so looking at a past term costs nothing. Lets the frontend show what
    an earlier term looked like before the user commits to abandoning anything simulated after
    it (that commit is still POST /checkpoint/rewind, unchanged)."""
    row = _require_checkpoint_session(db, get_current_user(db))
    target = (
        db.query(CheckpointSnapshotRow)
        .filter(CheckpointSnapshotRow.session_id == row.id, CheckpointSnapshotRow.seq == seq)
        .one_or_none()
    )
    if target is None:
        raise HTTPException(status_code=422, detail=f"No step {seq} in this session")

    curriculum = _checkpoint_curriculum(row)
    config = row.working_config
    scenario = config["scenarios"][0]
    sim = Simulator.from_snapshot(curriculum, config, scenario, target.snapshot)

    # _checkpoint_summary_from_sim reads next_term/next_term_label off `row`, which still holds
    # the LIVE position since we never mutate it here — override with the peeked step's own
    # values so the preview reads as "if you were sitting at this point," not the live session.
    payload = _checkpoint_summary_from_sim(db, row, sim)
    payload["next_term"] = target.next_term
    payload["next_term_label"] = None if sim.is_finished else term_label(target.next_term, sim.config)
    payload["status"] = "completed" if sim.is_finished else "active"
    payload["viewed_seq"] = seq
    return payload


class CheckpointRewindRequest(BaseModel):
    seq: int = Field(ge=0)


@app.post("/checkpoint/rewind")
def rewind_checkpoint(req: CheckpointRewindRequest, db: Session = Depends(get_db)) -> dict:
    """Roll the session's simulated terms back to an earlier step (`seq`, from the `history` list
    every checkpoint response includes) — a linear undo: every step recorded after the target is
    discarded, and advancing again afterward records a new forward path starting from there
    (no branching/redo). Allowed on a "completed" session too (rewinding a finished walkthrough
    to try something different is the point) — reactivates it to "active" unless the target step
    itself was already the end of the horizon. Deliberately does NOT touch working_curriculum/
    working_config: staged capacity/pass_rate/occupancy/intake edits stay staged and apply
    starting with the next advance from the rewound point, exactly like any other edit (see
    POST /checkpoint/edit) — that's what makes "go back, then try a different number" useful."""
    row = _require_checkpoint_session(db, get_current_user(db))
    target = (
        db.query(CheckpointSnapshotRow)
        .filter(CheckpointSnapshotRow.session_id == row.id, CheckpointSnapshotRow.seq == req.seq)
        .one_or_none()
    )
    if target is None:
        raise HTTPException(status_code=422, detail=f"No step {req.seq} in this session")

    db.query(CheckpointSnapshotRow).filter(
        CheckpointSnapshotRow.session_id == row.id,
        CheckpointSnapshotRow.seq > req.seq,
    ).delete()

    curriculum = _checkpoint_curriculum(row)
    config = row.working_config
    scenario = config["scenarios"][0]
    sim = Simulator.from_snapshot(curriculum, config, scenario, target.snapshot)

    row.snapshot = target.snapshot
    row.next_term = target.next_term
    row.status = "completed" if sim.is_finished else "active"
    db.commit()
    return _checkpoint_summary_from_sim(db, row, sim)


@app.delete("/checkpoint")
def discard_checkpoint(db: Session = Depends(get_db)) -> dict:
    """Discard the active session. The static full-horizon baseline dashboard is completely
    unaffected — it never reads checkpoint state — so this just returns the head to it."""
    row = _require_checkpoint_session(db, get_current_user(db))
    row.status = "discarded"
    _purge_checkpoint_snapshots(db, row.id)
    db.commit()
    return {"ok": True}

