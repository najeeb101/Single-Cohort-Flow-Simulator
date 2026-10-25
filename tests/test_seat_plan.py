"""Seat plan (src/intake.py::run_seat_plan): "what would it take to admit N?" — answered in seats
rounded up to ``seat_step`` (not whole sections: sections vary in size and a course can grow by
widening them), never by rounding multipliers, and never cutting today's seats. Runs on a tiny
three-course chain so it stays fast.
"""
from __future__ import annotations

from src.intake import IntakePolicy, run_seat_plan
from src.models.course import Course
from src.utils import load_json

STEP = 5


def _curriculum(capacity: int = 35) -> dict[str, Course]:
    chain = [("C101", ()), ("C201", ("C101",)), ("C301", ("C201",))]
    return {
        code: Course(code=code, title=code, credits=3, prerequisites=pre, pass_rate=0.9,
                     offering=("Fall", "Spring"), category="cs_core", capacity=capacity,
                     study_plan_term=i + 1)
        for i, (code, pre) in enumerate(chain)
    }


def _config(step: int = STEP) -> dict:
    config = load_json("data/simulation_config.json")
    config["initial_state"] = {"occupancy": {}}
    config["current_students"] = {"past_intakes": [{"size": 30}, {"size": 30}]}
    config["seat_step"] = step
    return config


SMALL = {"seeds": 3, "reference_runs": 1, "min_history_years": 2, "steady_cohorts": 3, "steady_measured": 2}


def test_seat_plan_adds_seats_in_steps():
    curriculum = _curriculum()
    res = run_seat_plan(curriculum, _config(), 90, params_override=SMALL, run_budget=2, workers=1)
    assert res["target_intake"] == 90 and res["seat_step"] == STEP
    assert "section_size" not in res and "total_sections_added" not in res
    assert res["changes"], "a 35-seat chain can't carry 90 students a year"
    for change in res["changes"]:
        assert change["seats_added"] > 0 and change["recommended"] % STEP == 0
        assert change["recommended"] == curriculum[change["code"]].capacity + change["seats_added"]
        assert "sections_added" not in change
    assert res["total_seats_added"] == sum(c["seats_added"] for c in res["changes"])
    # More seats can only help the students admitted at the target.
    assert res["after"]["next"]["denials_per_student"] <= res["before"]["next"]["denials_per_student"]


def test_a_step_of_one_gives_exact_seat_counts():
    # Not rounded to any section size: with a step of 1 the suggestions are the measured demand,
    # so at least one course lands on a seat count that isn't a multiple of 5.
    res = run_seat_plan(_curriculum(), _config(step=1), 90, params_override=SMALL, run_budget=1, workers=1)
    assert res["seat_step"] == 1 and res["changes"]
    assert any(c["recommended"] % 5 for c in res["changes"])


def test_top_up_rounds_add_the_observed_shortfall_in_steps():
    # On this chain demand sizing alone meets the real limits, so force top-up rounds with limits
    # no seat count can meet. Each round adds the worst course's observed shortfall, rounded up
    # to the step: a few seats, not a whole section.
    impossible = IntakePolicy(max_grad_rate_loss_pts=-100, max_on_time_loss_pts=-100)
    res = run_seat_plan(_curriculum(), _config(), 150, policy=impossible, params_override=SMALL,
                        run_budget=4, workers=1)
    top_ups = [t for t in res["trace"] if t["action"] == "add seats"]
    assert top_ups
    for t in top_ups:
        assert t["seats"] > 0 and t["seats"] % STEP == 0


def test_seat_plan_never_cuts_existing_seats():
    curriculum = _curriculum(capacity=700)
    res = run_seat_plan(curriculum, _config(), 30, params_override=SMALL, run_budget=3, workers=1)
    assert res["changes"] == []
    # Nothing is short of seats, so no seats are ever added (even if 3 seeds are too few to
    # *confirm* the limits statistically).
    assert all(t["action"] != "add seats" for t in res["trace"])
    assert res["after"]["next"]["denials_per_student"] == 0


def test_run_budget_bounds_the_rounds():
    res = run_seat_plan(_curriculum(), _config(), 120, params_override=SMALL, run_budget=1, workers=1)
    assert len([t for t in res["trace"] if t["action"] == "add seats"]) == 0
