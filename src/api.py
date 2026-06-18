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
from pydantic import BaseModel

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
    include_monte_carlo: bool = False     # opt-in; MC reruns the engine 30x


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


@app.get("/meta")
def meta() -> dict:
    return {
        "graph": build_curriculum_graph(CURRICULUM),
        "course_sections": BASE_CONFIG.get("course_sections", {}),
        "seats_per_section": BASE_CONFIG.get("seats_per_section", 35),
        "baseline_scenario": BASE_SCENARIO,
        "cohort_size": BASE_CONFIG["cohort_size"],
    }


@app.post("/simulate")
def simulate(req: ScenarioRequest) -> dict:
    config = copy.deepcopy(BASE_CONFIG)
    if req.cohort_size is not None:
        config["cohort_size"] = req.cohort_size

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
