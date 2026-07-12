"""Auto-fill solver: search for the smallest set of course-capacity additions that make the
simulation meet every admission health target *at the current intake*.

Objective (chosen by the admin): hold `cohort_size` fixed and add the fewest seats needed to
satisfy `config['admission_targets']`, judged by the exact same `evaluate_health_criteria`
slacks the Settings targets and the admissions recommendation already use. Intake is only used
as a *fallback lever*: if capacity alone cannot clear a target (e.g. a grad-rate breach driven
by failures, not seats), the solver reports that and probes how far intake would have to drop.

Method is an honest, bounded greedy coordinate search — not a global optimum:
  each iteration runs one simulation, finds the course with the worst single-term seat
  shortfall, and bumps that course's capacity by that shortfall (the same "peak shortfall"
  heuristic the frontend's CapacityRecommendations already shows), then re-runs. Denials shrink
  monotonically as seats are added, so it converges; `run_budget` caps the cost.

No file I/O — this is a pure in-memory layer over `service.run_simulation`, mirroring how the
rest of the engine-as-a-service boundary works.
"""
from __future__ import annotations

import math
from typing import TYPE_CHECKING

from src.analytics import evaluate_health_criteria
from src.parallel import ordered_map, resolve_workers
from src.service import run_simulation

if TYPE_CHECKING:
    from src.models.course import Course
    from src.simulator import SimulationResult

# Keep a single web request bounded: each candidate is one full simulation (~1-2s).
DEFAULT_RUN_BUDGET = 20
MAX_RUN_BUDGET = 40
# How far intake is allowed to drop when capacity alone can't reach the targets.
_INTAKE_FLOOR_FRACTION = 0.4
_INTAKE_STEP_FRACTION = 0.1


def _mandatory_seasons(config: dict) -> set[str]:
    return set(config.get("mandatory_terms") or ["Fall", "Spring"])


def _peak_shortfalls(result: "SimulationResult", config: dict) -> dict[str, int]:
    """Per-course worst single-(mandatory-)term seat shortfall across the run — the same signal
    CapacityRecommendations uses. Optional Winter/Summer frames are excluded (their tiny,
    separately-modelled offerings shouldn't drive regular-term capacity sizing)."""
    mandatory = _mandatory_seasons(config)
    peak: dict[str, int] = {}
    for frame in result.history.timeline:
        if frame.get("season") not in mandatory:
            continue
        for code, stat in frame.get("courses", {}).items():
            denied = stat.get("denied", 0)
            if denied > peak.get(code, 0):
                peak[code] = denied
    return {code: n for code, n in peak.items() if n > 0}


def _criteria_of(result: "SimulationResult") -> list[dict]:
    health = evaluate_health_criteria(result)
    return health["criteria"] if health else []


def _metrics_snapshot(result: "SimulationResult") -> dict:
    m = result.metrics
    return {
        "graduation_rate": m["graduation_rate"],
        "on_time_rate": m["on_time_rate"],
        "avg_graduation_time": m["avg_graduation_time"],
        "academic_dropout_rate": m["academic_dropout_rate"],
        "censored_rate": m["censored_rate"],
    }


def _run(curriculum, config, overrides: dict[str, float], cohort_size: int | None):
    """One candidate simulation. `overrides` are per-course capacity *multipliers* (the engine's
    native scenario hook); `cohort_size` overrides intake when the fallback lever kicks in."""
    scenario = {"name": "autofill", "capacity_overrides": dict(overrides)}
    cfg = config if cohort_size is None else {**config, "cohort_size": cohort_size}
    out = run_simulation(curriculum, cfg, scenario)
    return out["result"]


def _all_met(criteria: list[dict]) -> bool:
    return bool(criteria) and all(c["slack"] >= 1 for c in criteria)


def solve_for_targets(
    curriculum: dict[str, "Course"],
    config: dict,
    *,
    run_budget: int = DEFAULT_RUN_BUDGET,
    tune_intake_fallback: bool = True,
) -> dict:
    """Greedy minimal-capacity solve at the current intake. See module docstring.

    Returns a JSON-ready dict: `feasible` (targets met by capacity alone), `recommended`
    (per-course current->recommended seats, changed courses only), `final_metrics`, `criteria`
    (observed/target/slack/met per target), `trace` (one row per iteration), `runs`, and
    `intake_suggestion` (a fallback when capacity alone can't reach the targets, else None).
    """
    run_budget = max(1, min(int(run_budget), MAX_RUN_BUDGET))
    base_caps = {code: c.capacity for code, c in curriculum.items()}
    current_intake = int(config["cohort_size"])

    overrides: dict[str, float] = {}  # code -> multiplier (only changed courses)
    trace: list[dict] = []
    runs = 0
    result = None
    criteria: list[dict] = []

    while runs < run_budget:
        result = _run(curriculum, config, overrides, None)
        runs += 1
        criteria = _criteria_of(result)
        worst = min(criteria, key=lambda c: c["slack"]) if criteria else None

        if _all_met(criteria):
            trace.append({"iteration": runs, "action": "targets met", "worst_slack": round(worst["slack"], 3) if worst else None})
            break

        # The only target adding seats *directly* fixes is seats-denied-per-student. Grad
        # rate / time-to-degree / throughput stability are driven by pass rates, dropout, and
        # admission cadence, not by seat count — so once seat-denial is satisfied we stop rather
        # than pour in seats that can't move the remaining breach (that would overstate what's
        # actually needed). The residual is reported and handed to the intake fallback instead.
        seats = next((c for c in criteria if c["name"] == "seats_denied_per_stud"), None)
        if seats is None or seats["slack"] >= 1:
            trace.append({"iteration": runs, "action": "seat-denial target met; residual breach is not capacity-driven",
                          "worst_criterion": worst["name"] if worst else None,
                          "worst_slack": round(worst["slack"], 3) if worst else None})
            break

        peak = _peak_shortfalls(result, config)
        if not peak:
            # Nothing left to relieve with seats — the residual breach isn't capacity-driven.
            trace.append({"iteration": runs, "action": "no capacity lever left",
                          "worst_criterion": worst["name"] if worst else None,
                          "worst_slack": round(worst["slack"], 3) if worst else None})
            break

        worst_code = max(peak, key=lambda c: peak[c])
        shortfall = peak[worst_code]
        base = base_caps[worst_code]
        cur_seats = math.floor(base * overrides.get(worst_code, 1.0))
        new_seats = cur_seats + shortfall
        overrides[worst_code] = new_seats / base if base else 1.0
        trace.append({
            "iteration": runs,
            "action": "add seats",
            "course": worst_code,
            "from": cur_seats,
            "to": new_seats,
            "worst_criterion": worst["name"] if worst else None,
            "worst_slack": round(worst["slack"], 3) if worst else None,
        })

    feasible = _all_met(criteria)

    recommended = {}
    for code, mult in overrides.items():
        base = base_caps[code]
        new_seats = math.floor(base * mult)
        if new_seats != base:
            recommended[code] = {"current": base, "recommended": new_seats, "added": new_seats - base}

    intake_suggestion = None
    if not feasible and tune_intake_fallback:
        intake_suggestion = _probe_intake(curriculum, config, overrides, current_intake)

    return {
        "feasible": feasible,
        "runs": runs,
        "current_intake": current_intake,
        "recommended": recommended,
        "total_seats_added": sum(r["added"] for r in recommended.values()),
        "final_metrics": _metrics_snapshot(result) if result else {},
        "criteria": [
            {"name": c["name"], "observed": c["observed"], "target": c["target"],
             "slack": round(c["slack"], 4), "met": c["slack"] >= 1}
            for c in criteria
        ],
        "trace": trace,
        "intake_suggestion": intake_suggestion,
        "note": (
            "Greedy heuristic: smallest capacity additions to meet every target at the current "
            "intake, judged by the same health-criteria slacks as the admissions recommendation. "
            "Single-seed per candidate — Monte-Carlo-verify the final pick before committing."
        ),
    }


def _probe_one(task: tuple) -> tuple[int, bool]:
    """One intake candidate: does intake `size` meet every target with the capacity additions
    fixed? Module-level (not a closure) so it pickles for the process pool. `task` is
    (curriculum, config, overrides, size)."""
    curriculum, config, overrides, size = task
    result = _run(curriculum, config, overrides, size)
    return size, _all_met(_criteria_of(result))


def _probe_intake(curriculum, config, overrides, current_intake: int) -> dict | None:
    """Fallback lever: with the capacity additions fixed, find the largest intake (smallest cut)
    that still meets every target. The candidate intakes are independent, so they run in
    parallel (`src.parallel`) and we pick the largest passing one — identical to stepping down
    sequentially and taking the first that passes, just without waiting on each in turn."""
    floor = max(1, int(current_intake * _INTAKE_FLOOR_FRACTION))
    step = max(1, int(current_intake * _INTAKE_STEP_FRACTION))
    sizes = list(range(current_intake - step, floor - 1, -step))  # descending: largest cut last

    tasks = [(curriculum, config, overrides, size) for size in sizes]
    outcomes = ordered_map(_probe_one, tasks, workers=resolve_workers(len(sizes)))

    for size, met in outcomes:  # sizes are descending, so the first that passes is the largest
        if met:
            return {
                "recommended_intake": size,
                "note": f"Capacity alone can't reach every target at intake {current_intake}. "
                        f"With the capacity additions above, dropping intake to {size}/year meets all targets.",
            }
    return {
        "recommended_intake": None,
        "note": f"Even cutting intake to {floor}/year with the capacity additions above did not meet "
                f"every target — the residual breach is not a capacity/intake problem (look at pass "
                f"rates or dropout settings).",
    }
