"""Thin HTTP wrapper around src.service.run_simulation (ACIP plan §2.3/§3.2).

Phase 2 (docs/input_system_plan.md §2.1/§2.2): curriculum/config live in a SQLite DB
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
    resolve_active_plan_id,
)
from src.db_models import AppConfig as AppConfigRow
from src.db_models import Course as CourseRow
from src.db_models import Plan as PlanRow
from src.db_models import Run, User
from src.models.course import Course
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
# next.config.ts rewrites, so the browser only ever calls localhost:3000 — this origin is
# for direct/manual API access (curl, TestClient) during development.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
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
VALID_OFFERINGS = {"Fall", "Spring"}


def _check_category(value: str) -> str:
    if value not in VALID_CATEGORIES:
        raise ValueError(f"category must be one of {sorted(VALID_CATEGORIES)}, got {value!r}")
    return value


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
        "num_incumbent_cohorts": config.get("num_incumbent_cohorts"),
        "admit_interval_terms": config.get("admit_interval_terms"),
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
        plan = import_plan(db, current_user.id, req.name, req.curriculum, req.config)
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
    return {
        "curriculum": [_course_to_dict(c) for c in sorted(curriculum.values(), key=lambda c: c.study_plan_order)],
        "config": config,
    }
