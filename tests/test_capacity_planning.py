"""Tests for src/capacity.py — the instructor/seat/admissions capacity-planning report."""
from __future__ import annotations

import copy

from src.capacity import build_capacity_report, build_instructor_capacity
from src.models.course import load_curriculum
from src.simulator import Simulator
from src.utils import load_json


def _run():
    config = load_json("data/simulation_config.json")
    config["max_terms"] = 6  # keep the test run short; full report logic is config-agnostic
    curriculum = load_curriculum("data/curriculum.json")
    result = Simulator(curriculum, config, config["scenarios"][0]).run()
    return result, curriculum


def test_shortfall_when_pool_under_peak_demand():
    result, curriculum = _run()
    instructors = [{"name": "Solo Prof", "categories": ["cs_core"], "max_sections_per_term": 0}]
    report = build_instructor_capacity(result, instructors, curriculum)
    cs_core = next(r for r in report["by_category"] if r["category"] == "cs_core")
    assert cs_core["status"] == "shortfall"
    assert cs_core["shortfall"] > 0
    assert cs_core["peak_sections_needed"] > 0


def test_ok_status_when_pool_is_ample():
    result, curriculum = _run()
    instructors = [
        {"name": f"Prof {i}", "categories": ["cs_core", "math", "science", "english",
                                              "gen_ed", "cs_elective", "college_req"],
         "max_sections_per_term": 50}
        for i in range(5)
    ]
    report = build_instructor_capacity(result, instructors, curriculum)
    assert all(r["status"] == "ok" for r in report["by_category"])
    assert report["course_staffing_risks"] == []


def test_top_driver_flagged_in_understaffed_category():
    result, curriculum = _run()
    instructors = [{"name": "Solo Prof", "categories": ["cs_core"], "max_sections_per_term": 1}]
    report = build_instructor_capacity(result, instructors, curriculum)
    cs_core_risks = [r for r in report["course_staffing_risks"] if r["category"] == "cs_core"]
    assert cs_core_risks, "expected at least one cs_core course flagged as a staffing risk"
    top_drivers = [r for r in cs_core_risks if r["top_driver"]]
    assert len(top_drivers) == 1
    assert top_drivers[0]["peak_sections"] == max(r["peak_sections"] for r in cs_core_risks)


def test_build_capacity_report_composes_all_three_sections():
    result, curriculum = _run()
    instructors = [{"name": "Prof X", "categories": ["cs_core"], "max_sections_per_term": 3}]
    report = build_capacity_report(result, instructors, curriculum)
    assert set(report.keys()) == {"seat_utilization", "instructor_capacity", "admissions_recommendation"}
    assert isinstance(report["seat_utilization"], list)
    assert "by_category" in report["instructor_capacity"]


def test_no_instructors_means_every_demanded_category_short():
    result, curriculum = _run()
    report = build_instructor_capacity(result, [], curriculum)
    demanded = [r for r in report["by_category"] if r["peak_sections_needed"] > 0]
    assert demanded, "expected at least one category with offered courses"
    assert all(r["status"] == "shortfall" for r in demanded)


def test_default_seed_roster_flags_cs_core_shortfall():
    """data/instructors.json is hand-tuned to show a real cs_core shortfall on the default
    plan, mirroring scripts/size_sections.py's hand-tuned-CMPS303 demo philosophy."""
    result, curriculum = _run()
    instructors = load_json("data/instructors.json")
    report = build_instructor_capacity(result, instructors, curriculum)
    cs_core = next(r for r in report["by_category"] if r["category"] == "cs_core")
    assert cs_core["status"] in {"shortfall", "tight"}
    risk_courses = {r["course"] for r in report["course_staffing_risks"] if r["category"] == "cs_core"}
    assert "CMPS303" in risk_courses
