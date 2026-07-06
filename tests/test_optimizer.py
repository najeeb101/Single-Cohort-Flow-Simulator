"""Tests for the auto-fill solver (src/optimizer.py). It searches the smallest capacity
additions that meet the admission health targets at the current intake, judged by the same
evaluate_health_criteria slacks the rest of the app uses.
"""
from __future__ import annotations

from src.models.course import load_curriculum
from src.optimizer import MAX_RUN_BUDGET, solve_for_targets
from src.utils import load_json


def _setup():
    config = load_json("data/simulation_config.json")
    curriculum = load_curriculum("data/curriculum.json")
    return config, curriculum


def test_result_shape_and_monotonicity():
    config, curriculum = _setup()
    res = solve_for_targets(curriculum, config, run_budget=3)

    assert set(res) >= {
        "feasible", "runs", "current_intake", "recommended", "total_seats_added",
        "final_metrics", "criteria", "trace", "intake_suggestion", "note",
    }
    # The solver never *reduces* a course's seats — every recommendation is a strict increase.
    for code, rec in res["recommended"].items():
        assert rec["recommended"] > rec["current"], code
        assert rec["added"] == rec["recommended"] - rec["current"], code
    assert res["total_seats_added"] == sum(r["added"] for r in res["recommended"].values())
    # Each criterion's met flag matches its slack.
    for c in res["criteria"]:
        assert c["met"] == (c["slack"] >= 1)


def test_run_budget_respected():
    config, curriculum = _setup()
    res = solve_for_targets(curriculum, config, run_budget=2)
    assert res["runs"] <= 2


def test_budget_is_clamped():
    config, curriculum = _setup()
    # An absurd budget can't wedge the server: it's clamped to MAX_RUN_BUDGET, and the greedy
    # loop stops early once the seat-denial target is met anyway.
    res = solve_for_targets(curriculum, config, run_budget=10_000)
    assert res["runs"] <= MAX_RUN_BUDGET


def test_already_feasible_needs_no_changes():
    config, curriculum = _setup()
    # Loosen every target so the baseline trivially passes: floors at 0, ceilings enormous.
    config["admission_targets"] = {
        "target_grad_rate": 0.0,
        "max_avg_time_to_degree": 1e9,
        "max_seats_denied_per_student": 1e9,
        "min_throughput_stability": 0.0,
    }
    res = solve_for_targets(curriculum, config, run_budget=5)
    assert res["feasible"] is True
    assert res["recommended"] == {}
    assert res["total_seats_added"] == 0
    assert res["runs"] == 1
    assert res["intake_suggestion"] is None


def test_deterministic():
    config, curriculum = _setup()
    a = solve_for_targets(curriculum, config, run_budget=4)
    b = solve_for_targets(curriculum, config, run_budget=4)
    # The engine is seeded per student, so an identical search must reproduce byte-for-byte.
    assert a["recommended"] == b["recommended"]
    assert a["criteria"] == b["criteria"]
    assert a["feasible"] == b["feasible"]
