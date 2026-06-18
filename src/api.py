"""Thin HTTP wrapper around src.service.run_simulation (ACIP plan §2.3/§3.2).

No database, no auth — matches Phase 1's stated scope ("no database yet"). Every
endpoint is a read-only view over one in-memory run; nothing here touches disk beyond
the one-time module-load of curriculum/config. This is the prerequisite for §3.2's live
scenario slider: web/'s LiveWhatIfPanel POSTs scenario overrides to /simulate and
re-renders the same flow_timeline contract the dashboard already knows how to draw.
"""
from __future__ import annotations

import copy

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from src.analytics import build_curriculum_graph
from src.models.course import load_curriculum
from src.montecarlo import run_monte_carlo
from src.service import run_simulation
from src.utils import load_json

CURRICULUM = load_curriculum("data/curriculum.json")
BASE_CONFIG = load_json("data/simulation_config.json")
BASE_SCENARIO = BASE_CONFIG["scenarios"][0]

app = FastAPI(title="Single-Cohort-Flow-Simulator API")

# Local-dev only: the dashboard (web/, npm run dev on :3000) and this API (:8001) run on
# different origins/ports. Tighten this before any real deployment (see plan §5/§8 — auth
# and multi-tenancy are explicitly deferred, not yet built).
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
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


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


@app.get("/meta")
def meta() -> dict:
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
def simulate(req: ScenarioRequest) -> dict:
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

    return {
        "metrics": run["metrics"],
        "cohort_metrics": run["cohort_metrics"],
        "admissions_recommendation": run["admissions_recommendation"],
        "flow_timeline": flow_timeline,
    }
