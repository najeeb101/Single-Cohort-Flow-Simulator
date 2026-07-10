"""The flow-chart stage nodes and initial-state standing levels are derived from
`year_standing_thresholds`, not hardcoded to a 4-year Year1..Year4 structure — so a program
that isn't 4 years long produces matching stage nodes (and doesn't crash when a student reaches
a year band beyond Year4). See src/models/student.py::stage_node_names / standing_levels.
"""
from __future__ import annotations

from src.models.course import load_curriculum
from src.models.student import stage_node_names, standing_levels
from src.simulator import Simulator
from src.utils import load_json


def test_stage_node_names_scale_with_thresholds():
    # Default (3 thresholds -> 4 years)
    assert stage_node_names({"year_standing_thresholds": [30, 60, 90]}) == [
        "Admitted", "Year1", "Year2", "Year3", "Year4", "Graduated", "Dropped", "Censored"
    ]
    # A 5-year program (4 thresholds -> 5 years)
    assert stage_node_names({"year_standing_thresholds": [24, 48, 72, 96]}) == [
        "Admitted", "Year1", "Year2", "Year3", "Year4", "Year5", "Graduated", "Dropped", "Censored"
    ]
    # A 2-year program (1 threshold -> 2 years)
    assert stage_node_names({"year_standing_thresholds": [30]}) == [
        "Admitted", "Year1", "Year2", "Graduated", "Dropped", "Censored"
    ]
    # No config -> the default bands
    assert "Year4" in stage_node_names() and "Year5" not in stage_node_names()


def test_standing_levels_exclude_year1_and_scale():
    assert standing_levels({"year_standing_thresholds": [30, 60, 90]}) == ["Year2", "Year3", "Year4"]
    assert standing_levels({"year_standing_thresholds": [24, 48, 72, 96]}) == ["Year2", "Year3", "Year4", "Year5"]
    assert standing_levels({"year_standing_thresholds": [30]}) == ["Year2"]


def test_non_four_year_program_runs_and_uses_year5_nodes():
    """A plan with 4 year-standing thresholds (a 5-year program) runs end-to-end and its
    timeline frames carry a Year5 stage node — the case that used to KeyError when the stage
    nodes were hardcoded to Year1..Year4."""
    config = dict(load_json("data/simulation_config.json"))
    config["year_standing_thresholds"] = [24, 48, 72, 96]  # 5 year bands
    config["num_cohorts"] = 2
    curriculum = load_curriculum("data/curriculum.json")

    sim = Simulator(curriculum, config, config["scenarios"][0])
    assert "Year5" in sim.stage_nodes
    result = sim.run()  # must not raise

    # Every per-cohort/total node dict is keyed by exactly this plan's stage nodes, and Year5
    # is present as a band (students with >= 96 completed CH land there before graduating).
    expected = set(stage_node_names(config))
    for frame in result.history.timeline:
        assert set(frame["stages"]["totals"]["nodes"]) == expected
        for block in frame["stages"]["cohorts"].values():
            assert set(block["nodes"]) == expected
