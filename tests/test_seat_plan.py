"""Seat plan (src/intake.py::run_seat_plan): "what would it take to admit N?" — answered in
whole sections, never by rounding multipliers, and never cutting today's seats. Runs on a tiny
three-course chain so it stays fast.
"""
from __future__ import annotations

from src.intake import run_seat_plan
from src.models.course import Course
from src.utils import load_json

SECTION = 35


def _curriculum(capacity: int = 35) -> dict[str, Course]:
    chain = [("C101", ()), ("C201", ("C101",)), ("C301", ("C201",))]
    return {
        code: Course(code=code, title=code, credits=3, prerequisites=pre, pass_rate=0.9,
                     offering=("Fall", "Spring"), category="cs_core", capacity=capacity,
                     study_plan_term=i + 1)
        for i, (code, pre) in enumerate(chain)
    }


def _config() -> dict:
    config = load_json("data/simulation_config.json")
    config["initial_state"] = {"occupancy": {}}
    config["current_students"] = {"past_intakes": [{"size": 30}, {"size": 30}]}
    config["section_size"] = SECTION
    return config


SMALL = {"seeds": 3, "reference_runs": 1, "min_history_years": 2, "steady_cohorts": 3, "steady_measured": 2}


def test_seat_plan_adds_whole_sections_only():
    curriculum = _curriculum()
    res = run_seat_plan(curriculum, _config(), 90, params_override=SMALL, run_budget=2, workers=1)
    assert res["target_intake"] == 90 and res["section_size"] == SECTION
    assert res["changes"], "a 35-seat chain can't carry 90 students a year"
    for change in res["changes"]:
        assert change["seats_added"] > 0 and change["seats_added"] % SECTION == 0
        assert change["recommended"] == curriculum[change["code"]].capacity + change["seats_added"]
        assert change["sections_added"] == change["seats_added"] // SECTION
    assert res["total_seats_added"] == sum(c["seats_added"] for c in res["changes"])
    # More seats can only help the students admitted at the target.
    assert res["after"]["next"]["denials_per_student"] <= res["before"]["next"]["denials_per_student"]


def test_seat_plan_never_cuts_existing_seats():
    curriculum = _curriculum(capacity=700)
    res = run_seat_plan(curriculum, _config(), 30, params_override=SMALL, run_budget=3, workers=1)
    assert res["changes"] == []
    # Nothing is short of seats, so no section is ever added (even if 3 seeds are too few to
    # *confirm* the limits statistically).
    assert all(t["action"] != "add section" for t in res["trace"])
    assert res["after"]["next"]["denials_per_student"] == 0


def test_run_budget_bounds_the_rounds():
    res = run_seat_plan(_curriculum(), _config(), 120, params_override=SMALL, run_budget=1, workers=1)
    assert len([t for t in res["trace"] if t["action"] == "add section"]) == 0
