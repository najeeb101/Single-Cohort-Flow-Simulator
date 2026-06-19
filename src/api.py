"""Thin HTTP wrapper around src.service.run_simulation (ACIP plan §2.3/§3.2).

Phase 2 (docs/input_system_plan.md §2.1/§2.2): curriculum/config now live in a SQLite DB
(src/db.py), and every endpoint except /health and /auth/* requires a logged-in user
(src/auth.py::get_current_user). The browser never calls this API directly — it goes
through the Next.js dev server's rewrite (web/next.config.ts) to the same origin, so CORS
stays scoped to that one local origin rather than a wildcard.
"""
from __future__ import annotations

import copy
import dataclasses

from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from src.analytics import build_curriculum_graph
from src.auth import get_current_user
from src.auth import router as auth_router
from src.curriculum_validation import CycleError, check_no_cycle
from src.db import SessionLocal, get_db, init_db, load_config_from_db, load_curriculum_from_db, seed_if_empty
from src.db_models import Course as CourseRow
from src.db_models import Run, User
from src.db_models import AppConfig as AppConfigRow
from src.montecarlo import run_monte_carlo
from src.scenarios import router as scenarios_router
from src.service import run_simulation

init_db()
with SessionLocal() as _session:
    seed_if_empty(_session)
    CURRICULUM = load_curriculum_from_db(_session)
    BASE_CONFIG = load_config_from_db(_session)
BASE_SCENARIO = BASE_CONFIG["scenarios"][0]

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


class CourseUpdate(BaseModel):
    title: str | None = None
    credits: int | None = None
    prerequisites: list[str] | None = None
    pass_rate: float | None = Field(default=None, ge=0, le=1)
    offering: list[str] | None = None
    category: str | None = None
    capacity: int | None = None
    rule_expr: dict | None = None
    study_plan_order: int | None = None


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


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


@app.get("/meta")
def meta(current_user: User = Depends(get_current_user)) -> dict:
    return {
        "graph": build_curriculum_graph(CURRICULUM),
        "course_sections": BASE_CONFIG.get("course_sections", {}),
        "course_pass_rates": {code: c.pass_rate for code, c in CURRICULUM.items()},
        "seats_per_section": BASE_CONFIG.get("seats_per_section", 35),
        "baseline_scenario": BASE_SCENARIO,
        "cohort_size": BASE_CONFIG["cohort_size"],
        "num_cohorts": BASE_CONFIG.get("num_cohorts"),
        "num_incumbent_cohorts": BASE_CONFIG.get("num_incumbent_cohorts"),
        "admit_interval_terms": BASE_CONFIG.get("admit_interval_terms"),
        "max_terms": BASE_CONFIG.get("max_terms"),
        "seed": BASE_CONFIG.get("seed"),
        "dropout_gpa_floor": BASE_CONFIG.get("dropout_gpa_floor"),
        "dropout_base_hazard": BASE_CONFIG.get("dropout_base_hazard"),
        "dropout_early_multiplier": BASE_CONFIG.get("dropout_early_multiplier"),
        "dropout_early_sem_cutoff": BASE_CONFIG.get("dropout_early_sem_cutoff"),
        "dropout_fails_threshold": BASE_CONFIG.get("dropout_fails_threshold"),
        "dropout_prob_on_repeated_fail": BASE_CONFIG.get("dropout_prob_on_repeated_fail"),
        "registration_tier_thresholds": BASE_CONFIG.get("registration_tier_thresholds", []),
        "enrollment_priority_tiers": BASE_CONFIG.get("enrollment_priority_tiers", []),
    }


@app.post("/simulate")
def simulate(
    req: ScenarioRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    config = copy.deepcopy(BASE_CONFIG)
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

    scenario = dict(BASE_SCENARIO)
    if req.capacity_multiplier is not None:
        scenario["capacity_multiplier"] = req.capacity_multiplier
    if req.capacity_overrides:
        scenario["capacity_overrides"] = req.capacity_overrides
    if req.offering_overrides:
        scenario["offering_overrides"] = req.offering_overrides
    if req.pass_rate_overrides:
        scenario["pass_rate_overrides"] = req.pass_rate_overrides

    try:
        run = run_simulation(CURRICULUM, config, scenario)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    flow_timeline = run["flow_timeline"]
    if req.include_monte_carlo:
        monte_carlo = run_monte_carlo(CURRICULUM, config, scenario)
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
def list_curriculum(current_user: User = Depends(get_current_user)) -> list[dict]:
    return [_course_to_dict(c) for c in sorted(CURRICULUM.values(), key=lambda c: c.study_plan_order)]


@app.put("/curriculum/{code}")
def update_curriculum(
    code: str,
    patch: CourseUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    global CURRICULUM

    row = db.get(CourseRow, code)
    if row is None:
        raise HTTPException(status_code=404, detail=f"Course {code!r} not found")

    current = CURRICULUM[code]
    patch_fields = patch.model_dump(exclude_none=True)
    if "prerequisites" in patch_fields:
        patch_fields["prerequisites"] = tuple(patch_fields["prerequisites"])
    if "offering" in patch_fields:
        patch_fields["offering"] = tuple(patch_fields["offering"])
    updated_course = dataclasses.replace(current, **patch_fields)

    hypothetical = dict(CURRICULUM)
    hypothetical[code] = updated_course
    try:
        check_no_cycle(hypothetical)
    except CycleError as exc:
        raise HTTPException(status_code=422, detail={"message": str(exc), "cycle": exc.cycle}) from exc

    for field, value in patch.model_dump(exclude_none=True).items():
        setattr(row, field, value)
    db.commit()

    with SessionLocal() as _s:
        CURRICULUM = load_curriculum_from_db(_s)

    return _course_to_dict(CURRICULUM[code])


@app.get("/config")
def get_config(current_user: User = Depends(get_current_user)) -> dict:
    return BASE_CONFIG


@app.put("/config")
def update_config(
    patch: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    global BASE_CONFIG, BASE_SCENARIO

    if "registration_tier_thresholds" in patch:
        thresholds = patch["registration_tier_thresholds"]
        if not (isinstance(thresholds, list) and len(thresholds) == 5 and all(isinstance(t, int) for t in thresholds)):
            raise HTTPException(status_code=422, detail="registration_tier_thresholds must be a list of 5 ints")

    row = db.get(AppConfigRow, 1)
    row.data = {**row.data, **patch}
    db.commit()

    with SessionLocal() as _s:
        BASE_CONFIG = load_config_from_db(_s)
    BASE_SCENARIO = BASE_CONFIG["scenarios"][0]

    return BASE_CONFIG
