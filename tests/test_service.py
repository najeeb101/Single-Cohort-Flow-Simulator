"""Tests for the engine-as-a-service boundary (src/service.py). run_simulation() must
behave exactly like manually constructing Simulator + the analytics helpers, but as one
call that returns everything as a dict and touches no disk (docs/acip_transformation_plan.md §2.3).
"""
from __future__ import annotations

from pathlib import Path

from src.analytics import (
    compute_admissions_recommendation,
    compute_cohort_metrics,
    compute_metrics,
)
from src.models.course import load_curriculum
from src.service import run_simulation
from src.simulator import Simulator
from src.utils import load_json


def _setup():
    config = load_json("data/simulation_config.json")
    curriculum = load_curriculum("data/curriculum.json")
    return config, curriculum


def _snapshot(dirpath: Path) -> set[tuple[str, float]]:
    if not dirpath.exists():
        return set()
    return {
        (str(p.relative_to(dirpath)), p.stat().st_mtime)
        for p in dirpath.rglob("*") if p.is_file()
    }


def test_returns_expected_keys():
    config, curriculum = _setup()
    run = run_simulation(curriculum, config, config["scenarios"][0])
    assert set(run) == {
        "result", "metrics", "cohort_metrics", "admissions_recommendation", "flow_timeline",
    }
    assert set(run["flow_timeline"]) == {"meta", "frames", "summary"}


def test_matches_manual_construction():
    config, curriculum = _setup()
    scenario = config["scenarios"][0]

    run = run_simulation(curriculum, config, scenario)

    expected = Simulator(curriculum, config, scenario).run()
    expected.metrics = compute_metrics(expected)

    assert run["metrics"] == expected.metrics
    assert run["cohort_metrics"] == compute_cohort_metrics(expected)
    assert run["admissions_recommendation"] == compute_admissions_recommendation(expected)
    assert run["result"].history.timeline == expected.history.timeline


def test_writes_no_files():
    config, curriculum = _setup()
    outputs_before = _snapshot(Path("outputs"))

    run_simulation(curriculum, config, config["scenarios"][0])

    assert _snapshot(Path("outputs")) == outputs_before
