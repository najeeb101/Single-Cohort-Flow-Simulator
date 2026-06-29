"""Thin HTTP wrapper around src.service.run_simulation (ACIP plan §2.3/§3.2).

Phase 2 (docs/input_system_history.md §2.1/§2.2): curriculum/config live in a SQLite DB
(src/db.py), and every endpoint except /health and /auth/* requires a logged-in user
(src/auth.py::get_current_user). The browser never calls this API directly — it goes
through the Next.js dev server's rewrite (web/next.config.ts) to the same origin, so CORS
stays scoped to that one local origin rather than a wildcard.

Multi-plan support: curriculum/config are no longer cached module globals — each request
resolves them fresh from the DB, keyed by the requesting user's *own* active plan
(`_load_plan_data`), so two users can have two different active plans at once with no
shared mutable state to race on.
"""
from __future__ import annotations

import copy
import dataclasses
import os

from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from src.analytics import build_curriculum_graph
from src.auth import get_current_user
from src.auth import router as auth_router
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
    load_instructors_from_db,
    resolve_active_plan_id,
)
from src.db_models import AppConfig as AppConfigRow
from src.db_models import Course as CourseRow
from src.db_models import Instructor as InstructorRow
from src.db_models import LiveSimulation, LiveTermSnapshot
from src.db_models import Plan as PlanRow
from src.db_models import Run, User
from src.livesim import LiveRunner
from src.models.course import Course
from src.models.semester import effective_admit_interval_terms
from src.montecarlo import run_monte_carlo
from src.rules import gate_edges
from src.scenarios import router as scenarios_router
from src.service import run_simulation

init_db()
with SessionLocal() as _session:
    get_or_create_default_plan(_session)

app = FastAPI(title="Single-Cohort-Flow-Simulator API")
app.include_router(auth_router)
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


def _load_plan_data(db: Session, current_user: User) -> tuple[dict, dict, dict]:
    """Resolve (curriculum, config, scenario) for the current user's active plan."""
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
    cohort_size: int | None = None        # config override, not a scenario hook
    num_cohorts: int | None = Field(default=None, ge=1)
    num_incumbent_cohorts: int | None = Field(default=None, ge=0)
    admit_interval_terms: int | None = Field(default=None, ge=1)
    max_terms: int | None = Field(default=None, ge=1)
    seed: int | None = None
    initial_state: dict | None = None      # {occupancy: {code: seats}, standing: {Year2/3/4: n}}
    course_sections_overrides: dict[str, int] = {}
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


# Course.category (src/models/course.py) and the offering seasons are conceptually enums
# but stored as plain strings in JSON/the DB — validate against the known set here so a
# typo'd category/season fails fast with a clear 422 instead of silently producing a course
# the engine's enrollment-priority-tier / offering logic never matches against.
VALID_CATEGORIES = {"cs_core", "cs_elective", "college_req", "math", "science", "english", "gen_ed"}
VALID_OFFERINGS = {"Fall", "Spring", "Summer", "Winter"}


def _check_category(value: str) -> str:
    if value not in VALID_CATEGORIES:
        raise ValueError(f"category must be one of {sorted(VALID_CATEGORIES)}, got {value!r}")
    return value


VALID_STANDING = {"Year2", "Year3", "Year4"}


def _validate_initial_state(value: object) -> None:
    """Shape-check the initial-state warm start: {occupancy: {code: int>=0}, standing:
    {Year2|Year3|Year4: int>=0}}. Both keys optional; raises HTTP 422 on a bad shape."""
    if not isinstance(value, dict):
        raise HTTPException(status_code=422, detail="initial_state must be an object")
    occupancy = value.get("occupancy", {})
    if not isinstance(occupancy, dict) or not all(
        isinstance(v, int) and not isinstance(v, bool) and v >= 0 for v in occupancy.values()
    ):
        raise HTTPException(status_code=422, detail="initial_state.occupancy must map course codes to non-negative integers")
    standing = value.get("standing", {})
    if not isinstance(standing, dict) or not set(standing) <= VALID_STANDING or not all(
        isinstance(v, int) and not isinstance(v, bool) and v >= 0 for v in standing.values()
    ):
        raise HTTPException(
            status_code=422,
            detail=f"initial_state.standing keys must be a subset of {sorted(VALID_STANDING)} with non-negative integer values",
        )


def _check_offering(value: list[str]) -> list[str]:
    if not value:
        raise ValueError("offering must list at least one season")
    if not set(value) <= VALID_OFFERINGS:
        raise ValueError(f"offering entries must be one of {sorted(VALID_OFFERINGS)}, got {value!r}")
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
    instructors: list[dict] = []


def _check_categories(values: list[str]) -> list[str]:
    if not set(values) <= VALID_CATEGORIES:
        raise ValueError(f"categories must be a subset of {sorted(VALID_CATEGORIES)}, got {values!r}")
    return values


class InstructorCreate(BaseModel):
    name: str
    categories: list[str] = []
    max_sections_per_term: int = Field(ge=0)

    @field_validator("name")
    @classmethod
    def _validate_name(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("name must not be blank")
        return v

    @field_validator("categories")
    @classmethod
    def _validate_categories(cls, v: list[str]) -> list[str]:
        return _check_categories(v)


class InstructorUpdate(BaseModel):
    name: str | None = None
    categories: list[str] | None = None
    max_sections_per_term: int | None = Field(default=None, ge=0)

    @field_validator("name")
    @classmethod
    def _validate_name(cls, v: str | None) -> str | None:
        if v is None:
            return v
        v = v.strip()
        if not v:
            raise ValueError("name must not be blank")
        return v

    @field_validator("categories")
    @classmethod
    def _validate_categories(cls, v: list[str] | None) -> list[str] | None:
        return v if v is None else _check_categories(v)


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


def _instructor_to_dict(row: InstructorRow) -> dict:
    return {
        "id": row.id,
        "name": row.name,
        "categories": list(row.categories),
        "max_sections_per_term": row.max_sections_per_term,
    }


def _plan_to_dict(plan: PlanRow, current_user: User) -> dict:
    return {
        "id": plan.id,
        "name": plan.name,
        "is_default": plan.owner_user_id is None,
        "is_active": plan.id == current_user.active_plan_id,
    }


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


@app.get("/meta")
def meta(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)) -> dict:
    curriculum, config, scenario = _load_plan_data(db, current_user)
    return {
        "graph": build_curriculum_graph(curriculum),
        "course_sections": config.get("course_sections", {}),
        "course_pass_rates": {code: c.pass_rate for code, c in curriculum.items()},
        "seats_per_section": config.get("seats_per_section", 35),
        "baseline_scenario": scenario,
        "cohort_size": config["cohort_size"],
        "num_cohorts": config.get("num_cohorts"),
        "num_incumbent_cohorts": config.get("num_incumbent_cohorts", 0),
        # Initial-state warm start (replaces incumbent cohorts) — per-course occupied seats +
        # year-standing head-counts. See src/simulator.py::_effective_capacity / CLAUDE.md.
        "initial_state": config.get("initial_state", {"occupancy": {}, "standing": {}}),
        "admit_interval_terms": config.get("admit_interval_terms"),
        # True is the engine's own fallback (src/models/semester.py) when the key is absent —
        # mirrored here so a plan seeded before this flag existed reports its *actual* behavior
        # rather than a hardcoded value that could disagree with what the engine just ran.
        "optional_terms_enabled": config.get("optional_terms_enabled", True),
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
    }


@app.post("/simulate")
def simulate(
    req: ScenarioRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    curriculum, base_config, base_scenario = _load_plan_data(db, current_user)
    plan_id = resolve_active_plan_id(db, current_user)
    instructors = load_instructors_from_db(db, plan_id)
    config = copy.deepcopy(base_config)
    if req.cohort_size is not None:
        config["cohort_size"] = req.cohort_size
    if req.num_cohorts is not None:
        config["num_cohorts"] = req.num_cohorts
    if req.num_incumbent_cohorts is not None:
        config["num_incumbent_cohorts"] = req.num_incumbent_cohorts
    if req.admit_interval_terms is not None:
        config["admit_interval_terms"] = req.admit_interval_terms
    if req.max_terms is not None:
        config["max_terms"] = req.max_terms
    if req.seed is not None:
        config["seed"] = req.seed
    if req.initial_state is not None:
        config["initial_state"] = req.initial_state
    if req.course_sections_overrides:
        config["course_sections"] = {
            **config.get("course_sections", {}),
            **req.course_sections_overrides,
        }
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

    try:
        run = run_simulation(curriculum, config, scenario, instructors=instructors)
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


@app.get("/curriculum")
def list_curriculum(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)) -> list[dict]:
    curriculum, _config, _scenario = _load_plan_data(db, current_user)
    return [_course_to_dict(c) for c in sorted(curriculum.values(), key=lambda c: c.study_plan_order)]


@app.post("/curriculum")
def create_course(
    req: CourseCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    plan_id = resolve_active_plan_id(db, current_user)
    curriculum = load_curriculum_from_db(db, plan_id)

    if req.code in curriculum:
        raise HTTPException(status_code=409, detail=f"Course {req.code!r} already exists in this plan")

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
    current_user: User = Depends(get_current_user),
) -> dict:
    plan_id = resolve_active_plan_id(db, current_user)

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
    current_user: User = Depends(get_current_user),
) -> dict:
    plan_id = resolve_active_plan_id(db, current_user)
    curriculum = load_curriculum_from_db(db, plan_id)

    row = db.query(CourseRow).filter_by(plan_id=plan_id, code=code).first()
    if row is None:
        raise HTTPException(status_code=404, detail=f"Course {code!r} not found")

    current = curriculum[code]
    patch_fields = patch.model_dump(exclude_none=True)
    if "prerequisites" in patch_fields:
        patch_fields["prerequisites"] = tuple(patch_fields["prerequisites"])
    if "offering" in patch_fields:
        patch_fields["offering"] = tuple(patch_fields["offering"])
    updated_course = dataclasses.replace(current, **patch_fields)

    hypothetical = dict(curriculum)
    hypothetical[code] = updated_course
    try:
        check_no_cycle(hypothetical)
    except CycleError as exc:
        raise HTTPException(status_code=422, detail={"message": str(exc), "cycle": exc.cycle}) from exc

    for field, value in patch.model_dump(exclude_none=True).items():
        setattr(row, field, value)
    db.commit()

    return _course_to_dict(updated_course)


@app.get("/instructors")
def list_instructors(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)) -> list[dict]:
    plan_id = resolve_active_plan_id(db, current_user)
    return load_instructors_from_db(db, plan_id)


@app.post("/instructors")
def create_instructor(
    req: InstructorCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    plan_id = resolve_active_plan_id(db, current_user)

    existing = db.query(InstructorRow).filter_by(plan_id=plan_id, name=req.name).first()
    if existing is not None:
        raise HTTPException(status_code=409, detail=f"Instructor {req.name!r} already exists in this plan")

    row = InstructorRow(
        plan_id=plan_id,
        name=req.name,
        categories=req.categories,
        max_sections_per_term=req.max_sections_per_term,
    )
    db.add(row)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail=f"Instructor {req.name!r} already exists in this plan")

    return _instructor_to_dict(row)


@app.put("/instructors/{instructor_id}")
def update_instructor(
    instructor_id: int,
    patch: InstructorUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    plan_id = resolve_active_plan_id(db, current_user)
    row = db.query(InstructorRow).filter_by(plan_id=plan_id, id=instructor_id).first()
    if row is None:
        raise HTTPException(status_code=404, detail=f"Instructor {instructor_id} not found")

    for field, value in patch.model_dump(exclude_none=True).items():
        setattr(row, field, value)

    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail=f"Instructor name {patch.name!r} already exists in this plan")

    return _instructor_to_dict(row)


@app.delete("/instructors/{instructor_id}")
def delete_instructor(
    instructor_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    plan_id = resolve_active_plan_id(db, current_user)
    row = db.query(InstructorRow).filter_by(plan_id=plan_id, id=instructor_id).first()
    if row is None:
        raise HTTPException(status_code=404, detail=f"Instructor {instructor_id} not found")

    db.delete(row)
    db.commit()
    return {"ok": True}


@app.get("/config")
def get_config(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)) -> dict:
    _curriculum, config, _scenario = _load_plan_data(db, current_user)
    return config


@app.put("/config")
def update_config(
    patch: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    if "registration_tier_thresholds" in patch:
        thresholds = patch["registration_tier_thresholds"]
        if not (isinstance(thresholds, list) and len(thresholds) == 5 and all(isinstance(t, int) for t in thresholds)):
            raise HTTPException(status_code=422, detail="registration_tier_thresholds must be a list of 5 ints")

    if "optional_terms_enabled" in patch and not isinstance(patch["optional_terms_enabled"], bool):
        raise HTTPException(status_code=422, detail="optional_terms_enabled must be a boolean")

    if "initial_state" in patch:
        _validate_initial_state(patch["initial_state"])

    plan_id = resolve_active_plan_id(db, current_user)
    row = db.query(AppConfigRow).filter_by(plan_id=plan_id).first()
    row.data = {**row.data, **patch}
    db.commit()

    return row.data


@app.get("/plans")
def list_plans(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)) -> list[dict]:
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
    current_user: User = Depends(get_current_user),
) -> dict:
    try:
        plan = import_plan(db, current_user.id, req.name, req.curriculum, req.config, req.instructors)
    except PlanImportError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return _plan_to_dict(plan, current_user)


def _get_visible_plan(db: Session, plan_id: int, current_user: User) -> PlanRow:
    plan = db.get(PlanRow, plan_id)
    if plan is None or (plan.owner_user_id is not None and plan.owner_user_id != current_user.id):
        raise HTTPException(status_code=404, detail="Plan not found")
    return plan


@app.post("/plans/{plan_id}/activate")
def activate_plan(
    plan_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)
) -> dict:
    plan = _get_visible_plan(db, plan_id, current_user)
    current_user.active_plan_id = plan.id
    db.commit()
    return _plan_to_dict(plan, current_user)


@app.delete("/plans/{plan_id}")
def delete_plan(
    plan_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)
) -> dict:
    plan = db.get(PlanRow, plan_id)
    if plan is None or plan.owner_user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Plan not found")

    db.query(CourseRow).filter_by(plan_id=plan.id).delete()
    db.query(InstructorRow).filter_by(plan_id=plan.id).delete()
    db.query(AppConfigRow).filter_by(plan_id=plan.id).delete()
    if current_user.active_plan_id == plan.id:
        current_user.active_plan_id = get_or_create_default_plan(db).id
    db.delete(plan)
    db.commit()
    return {"ok": True}


@app.get("/plans/{plan_id}/export")
def export_plan(
    plan_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)
) -> dict:
    plan = _get_visible_plan(db, plan_id, current_user)
    curriculum = load_curriculum_from_db(db, plan.id)
    config = load_config_from_db(db, plan.id)
    instructors = load_instructors_from_db(db, plan.id)
    return {
        "curriculum": [_course_to_dict(c) for c in sorted(curriculum.values(), key=lambda c: c.study_plan_order)],
        "config": config,
        "instructors": instructors,
    }


# ------------------------------------------------------------------ #
# Phase 3: live, stepwise simulation                                  #
# ------------------------------------------------------------------ #
# A LiveSimulation is shared within a plan: any user whose *active* plan matches the live
# sim's plan_id can view/advance/list it (not owner-scoped like Plan/Scenario) — see
# CLAUDE.md and src/livesim.py's module docstring for the replay model this builds on.

class LiveSimCreateRequest(BaseModel):
    name: str
    initial_state: dict | None = None  # {occupancy: {code: seats}, standing: {Year2/3/4: n}}


class LiveSimEditPatch(BaseModel):
    course_sections: dict[str, int] | None = None
    pass_rate_overrides: dict[str, float] | None = None
    offering_overrides: dict[str, list[str]] | None = None
    cohort_size: int | None = Field(default=None, ge=1)
    capacity_overrides: dict[str, float] | None = None


class LiveSimAdvanceRequest(BaseModel):
    edits: LiveSimEditPatch | None = None


def _livesim_to_dict(sim: LiveSimulation, total_terms: int) -> dict:
    return {
        "id": sim.id,
        "name": sim.name,
        "plan_id": sim.plan_id,
        "created_by_user_id": sim.created_by_user_id,
        "current_term": sim.current_term,
        "status": sim.status,
        "total_terms": total_terms,
        "created_at": sim.created_at.isoformat(),
    }


def _snapshot_to_dict(snap: LiveTermSnapshot) -> dict:
    return {
        "term_index": snap.term_index,
        "season": snap.season,
        "label": snap.label,
        "frame": snap.frame,
        "summary": snap.summary,
        "edits_applied": snap.edits_applied,
    }


def _cheap_running_summary(frame: dict) -> dict:
    """A few free-to-compute running counts straight off this term's already-built frame —
    deliberately not a re-run of compute_metrics (that needs the full SimulationResult, not
    just one frame). Totals nodes already fold in initial_state.standing background, so
    Graduated/Dropped/Censored/active-band counts here are the same headline numbers the
    dashboard's flow chart is already showing for this term."""
    nodes = frame.get("stages", {}).get("totals", {}).get("nodes", {})
    active = sum(nodes.get(n, 0) for n in ("Admitted", "Year1", "Year2", "Year3", "Year4"))
    return {
        "active": active,
        "graduated": nodes.get("Graduated", 0),
        "dropped": nodes.get("Dropped", 0),
        "censored": nodes.get("Censored", 0),
    }


def _get_visible_live_sim(db: Session, live_sim_id: int, plan_id: int) -> LiveSimulation:
    sim = db.get(LiveSimulation, live_sim_id)
    if sim is None or sim.plan_id != plan_id:
        raise HTTPException(status_code=404, detail="Live simulation not found")
    return sim


@app.post("/livesim")
def create_live_sim(
    req: LiveSimCreateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    plan_id = resolve_active_plan_id(db, current_user)
    config = load_config_from_db(db, plan_id)  # already a deep copy (load_config_from_db)
    if req.initial_state is not None:
        _validate_initial_state(req.initial_state)
        config["initial_state"] = req.initial_state
    scenario = copy.deepcopy(config["scenarios"][0])

    sim = LiveSimulation(
        plan_id=plan_id,
        created_by_user_id=current_user.id,
        name=req.name,
        current_term=None,
        status="active",
        base_config=config,
        base_scenario=scenario,
        edits=[],
    )
    db.add(sim)
    db.commit()

    runner = LiveRunner({}, sim.base_config, sim.base_scenario)
    _start, end_term = runner.horizon(sim.edits)
    return _livesim_to_dict(sim, end_term)


@app.get("/livesim")
def list_live_sims(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)) -> list[dict]:
    plan_id = resolve_active_plan_id(db, current_user)
    rows = (
        db.query(LiveSimulation)
        .filter_by(plan_id=plan_id)
        .order_by(LiveSimulation.created_at.desc())
        .all()
    )
    out = []
    for sim in rows:
        runner = LiveRunner({}, sim.base_config, sim.base_scenario)
        _start, end_term = runner.horizon(sim.edits)
        out.append(_livesim_to_dict(sim, end_term))
    return out


@app.get("/livesim/{live_sim_id}")
def get_live_sim(
    live_sim_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    plan_id = resolve_active_plan_id(db, current_user)
    sim = _get_visible_live_sim(db, live_sim_id, plan_id)
    curriculum = load_curriculum_from_db(db, plan_id)

    runner = LiveRunner(curriculum, sim.base_config, sim.base_scenario)
    _start, end_term = runner.horizon(sim.edits)

    snapshots = (
        db.query(LiveTermSnapshot)
        .filter_by(live_sim_id=sim.id)
        .order_by(LiveTermSnapshot.term_index)
        .all()
    )

    # cohorts_meta: the admission schedule is pure config math (cohort_size patches only
    # change a cohort's *size*, never its entry term or count), so this can be read
    # straight off base_config without paying for a replay — mirrors
    # src.livesim.LiveRunner.replay's own cohorts_meta construction.
    num_cohorts = sim.base_config.get("num_cohorts", 1)
    num_incumbents = sim.base_config.get("num_incumbent_cohorts", 0)
    interval = effective_admit_interval_terms(sim.base_config)
    cohorts_meta = sorted(
        [{"id": c, "is_incumbent": False, "entry_term": c * interval} for c in range(num_cohorts)]
        + [{"id": -k, "is_incumbent": True, "entry_term": -k * interval} for k in range(1, num_incumbents + 1)],
        key=lambda c: c["entry_term"],
    )

    return {
        "live_sim": _livesim_to_dict(sim, end_term),
        "meta": {
            "graph": build_curriculum_graph(curriculum),
            "stage_nodes": ["Admitted", "Year1", "Year2", "Year3", "Year4",
                            "Graduated", "Dropped", "Censored"],
            "cohorts": cohorts_meta,
            "initial_state": sim.base_config.get("initial_state", {"occupancy": {}, "standing": {}}),
        },
        "snapshots": [_snapshot_to_dict(s) for s in snapshots],
    }


@app.post("/livesim/{live_sim_id}/advance")
def advance_live_sim(
    live_sim_id: int,
    req: LiveSimAdvanceRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    plan_id = resolve_active_plan_id(db, current_user)
    sim = _get_visible_live_sim(db, live_sim_id, plan_id)

    if sim.status == "finished":
        raise HTTPException(status_code=409, detail="Live simulation has already finished")

    next_term = (sim.current_term if sim.current_term is not None else -1) + 1
    next_term = max(next_term, 0)

    patch = req.edits.model_dump(exclude_none=True) if req.edits else {}
    edit_entry = {"effective_from_term": next_term, "patch": patch}
    edits = list(sim.edits) + [edit_entry]

    curriculum = load_curriculum_from_db(db, plan_id)
    runner = LiveRunner(curriculum, sim.base_config, sim.base_scenario)
    _start, end_term = runner.horizon(edits)

    if next_term >= end_term:
        raise HTTPException(status_code=409, detail="Live simulation has already finished")

    try:
        result = runner.replay(edits, next_term)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    frame = result.frames[-1]
    if frame["term"] != next_term:
        raise HTTPException(status_code=500, detail="Replay did not reach the requested term")

    snapshot = LiveTermSnapshot(
        live_sim_id=sim.id,
        term_index=next_term,
        season=frame["season"],
        label=frame["label"],
        frame=frame,
        summary=_cheap_running_summary(frame),
        edits_applied=patch,
    )
    db.add(snapshot)

    sim.edits = edits
    sim.current_term = next_term
    if next_term >= end_term - 1:
        sim.status = "finished"
    db.commit()
    db.refresh(snapshot)

    return {
        "live_sim": _livesim_to_dict(sim, end_term),
        "snapshot": _snapshot_to_dict(snapshot),
    }


@app.delete("/livesim/{live_sim_id}")
def delete_live_sim(
    live_sim_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    plan_id = resolve_active_plan_id(db, current_user)
    sim = _get_visible_live_sim(db, live_sim_id, plan_id)

    if sim.created_by_user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Only the creator may delete this live simulation")

    db.query(LiveTermSnapshot).filter_by(live_sim_id=sim.id).delete()
    db.delete(sim)
    db.commit()
    return {"ok": True}
