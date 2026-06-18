"""Tests for src/calibration.py (ACIP plan §2.2/§2.4 measured calibration + holdout
validation) and the scripts/calibrate_from_history.py driver. Every calibration function
consumes only canonical-schema records (StudentRecord/EnrollmentRecord/OutcomeRecord), so
these tests build small hand-crafted record lists rather than running the full engine
wherever possible — the one exception is fit_dropout_base_hazard, which must re-run the
forward simulation by construction (see src/calibration.py's module docstring).
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))

from src.calibration import (
    cohort_metrics_from_records,
    fit_dropout_base_hazard,
    fit_load_cap,
    fit_pass_rates,
    observed_dropout_rate,
    split_by_admission_term,
    validate_against_holdout,
)
from src.datasource import EnrollmentRecord, OutcomeRecord, StudentRecord
from src.models.course import load_curriculum
from src.service import run_simulation
from src.utils import load_json

SEED = 42
CURRICULUM = load_curriculum("data/curriculum.json")

# Small, fast config for the engine-rerunning tests (fit_dropout_base_hazard) — mirrors
# the CONFIG_STUB pattern already used in tests/test_capacity.py.
SMALL_CONFIG = {
    "seed": SEED,
    "cohort_size": 20,
    "max_terms": 8,
    "num_cohorts": 2,
    "num_incumbent_cohorts": 0,
    "admit_interval_terms": 2,
    "normal_load_ch": 18,
    "probation_load_ch": 12,
    "probation_gpa_threshold": 2.0,
    "probation_min_ch": 25,
    "enrollment_priority_tiers": [
        {"categories": ["cs_core", "college_req"]},
        {"categories": ["cs_elective"], "min_ch": 60},
        {"categories": ["math", "science", "english", "gen_ed"]},
    ],
    "dropout_gpa_floor": 2.0,
    "dropout_base_hazard": 0.18,
    "dropout_early_multiplier": 2.0,
    "dropout_early_sem_cutoff": 4,
    "dropout_fails_threshold": 3,
    "dropout_prob_on_repeated_fail": 0.15,
    "ability_sd": 0.15,
    "ability_clip": 0.30,
    "grade_tiers": {
        "hard_max": 0.72, "medium_max": 0.82,
        "hard":   {"A": 0.05, "B+": 0.10, "B": 0.25, "C+": 0.20, "C": 0.30, "D": 0.10},
        "medium": {"A": 0.10, "B+": 0.15, "B": 0.30, "C+": 0.20, "C": 0.20, "D": 0.05},
        "easy":   {"A": 0.25, "B+": 0.25, "B": 0.25, "C+": 0.12, "C": 0.10, "D": 0.03},
    },
}
SMALL_SCENARIO = {"name": "test", "capacity_multiplier": 1.0}


# ─── fit_pass_rates ──────────────────────────────────────────────────────── #

def test_fit_pass_rates_exact_frequency():
    enrollments = (
        [EnrollmentRecord(1, 0, "CMPS151", "A", 3, 1)] * 15
        + [EnrollmentRecord(1, 0, "CMPS151", "F", 3, 1)] * 5
    )
    fitted = fit_pass_rates(enrollments, CURRICULUM, min_attempts=10)
    assert fitted["CMPS151"]["n_attempts"] == 20
    assert fitted["CMPS151"]["observed_rate"] == pytest.approx(0.75)
    assert fitted["CMPS151"]["used"] is True


def test_fit_pass_rates_falls_back_below_min_attempts():
    enrollments = [EnrollmentRecord(1, 0, "CMPS151", "A", 3, 1)] * 5
    fitted = fit_pass_rates(enrollments, CURRICULUM, min_attempts=10)
    assert fitted["CMPS151"]["used"] is False
    assert fitted["CMPS151"]["assumed_rate"] == CURRICULUM["CMPS151"].pass_rate


def test_fit_pass_rates_covers_every_course_even_with_no_attempts():
    fitted = fit_pass_rates([], CURRICULUM, min_attempts=10)
    assert set(fitted) == set(CURRICULUM)
    assert all(v["used"] is False and v["observed_rate"] is None for v in fitted.values())


# ─── observed_dropout_rate ───────────────────────────────────────────────── #

def test_observed_dropout_rate():
    outcomes = [
        OutcomeRecord(1, 8, "graduated"),
        OutcomeRecord(2, None, "dropped"),
        OutcomeRecord(3, None, "dropped"),
        OutcomeRecord(4, None, "censored"),
    ]
    assert observed_dropout_rate(outcomes) == pytest.approx(0.5)
    assert observed_dropout_rate([]) == 0.0


# ─── fit_load_cap ─────────────────────────────────────────────────────────── #

def test_fit_load_cap_percentile_of_per_student_term_credits():
    # Student 1 takes 18 CH every term; student 2 takes 12 CH every term.
    enrollments = (
        [EnrollmentRecord(1, 0, "CMPS151", "A", 9, 1), EnrollmentRecord(1, 0, "CMPS200", "A", 9, 1)]
        + [EnrollmentRecord(2, 0, "CMPS151", "A", 6, 1), EnrollmentRecord(2, 0, "CMPS200", "A", 6, 1)]
    )
    fitted = fit_load_cap(enrollments, percentile=1.0)  # max
    assert fitted["observed_load_percentile"] == pytest.approx(18)
    assert fitted["n_student_terms"] == 2

    fitted_min = fit_load_cap(enrollments, percentile=0.0)
    assert fitted_min["observed_load_percentile"] == pytest.approx(12)


def test_fit_load_cap_empty():
    fitted = fit_load_cap([])
    assert fitted["observed_load_percentile"] is None
    assert fitted["n_student_terms"] == 0


# ─── split_by_admission_term ─────────────────────────────────────────────── #

def test_split_by_admission_term():
    students = [
        StudentRecord(1, "CS", -4, "GRADUATED"),
        StudentRecord(2, "CS", -4, "DROPPED"),
        StudentRecord(3, "CS", -2, "GRADUATED"),
    ]
    enrollments = [
        EnrollmentRecord(1, -4, "CMPS151", "A", 3, 1),
        EnrollmentRecord(3, -2, "CMPS151", "A", 3, 1),
    ]
    outcomes = [
        OutcomeRecord(1, 4, "graduated"),
        OutcomeRecord(2, None, "dropped"),
        OutcomeRecord(3, 6, "graduated"),
    ]
    fit_e, fit_o, hold_e, hold_o = split_by_admission_term(
        students, enrollments, outcomes, fit_terms={-4}, holdout_term=-2,
    )
    assert {r.student_id for r in fit_e} == {1}
    assert {r.student_id for r in fit_o} == {1, 2}
    assert {r.student_id for r in hold_e} == {3}
    assert {r.student_id for r in hold_o} == {3}


# ─── cohort_metrics_from_records ─────────────────────────────────────────── #

def test_cohort_metrics_from_records():
    students = [StudentRecord(i, "CS", -2, "x") for i in range(1, 5)]
    outcomes = [
        OutcomeRecord(1, -2 + 8 - 1, "graduated"),   # personal sem 8 -> on-time
        OutcomeRecord(2, -2 + 10 - 1, "graduated"),  # personal sem 10 -> not on-time
        OutcomeRecord(3, None, "dropped"),
        OutcomeRecord(4, None, "censored"),
    ]
    m = cohort_metrics_from_records(students, outcomes)
    assert m["graduation_rate"] == pytest.approx(0.5)
    assert m["academic_dropout_rate"] == pytest.approx(0.25)
    assert m["censored_rate"] == pytest.approx(0.25)
    assert m["on_time_rate"] == pytest.approx(0.25)  # 1 of 4 students on-time
    assert m["avg_time_to_degree"] == pytest.approx(9.0)  # mean(8, 10)


# ─── fit_dropout_base_hazard (must rerun the engine; keep it small + cheap) ─ #

def test_fit_dropout_base_hazard_moves_toward_target():
    low = fit_dropout_base_hazard(
        CURRICULUM, SMALL_CONFIG, SMALL_SCENARIO, target_dropout_rate=0.05,
        search_range=(0.0, 0.5), tol=0.05, max_iter=5,
    )
    high = fit_dropout_base_hazard(
        CURRICULUM, SMALL_CONFIG, SMALL_SCENARIO, target_dropout_rate=0.45,
        search_range=(0.0, 0.5), tol=0.05, max_iter=5,
    )
    # Single-seed stochastic noise means exact convergence isn't guaranteed within a
    # handful of iterations — what must hold is the monotonic direction.
    assert low["fitted_base_hazard"] < high["fitted_base_hazard"]
    assert low["iterations"] and high["iterations"]


# ─── validate_against_holdout ────────────────────────────────────────────── #

def test_validate_against_holdout_shape():
    holdout_metrics = {
        "graduation_rate": 0.7, "academic_dropout_rate": 0.2,
        "on_time_rate": 0.3, "avg_time_to_degree": 9.0,
    }
    report = validate_against_holdout(CURRICULUM, SMALL_CONFIG, SMALL_SCENARIO, holdout_metrics)
    assert set(report) == {"graduation_rate", "academic_dropout_rate", "on_time_rate", "avg_graduation_time"}
    for v in report.values():
        assert set(v) == {"observed", "simulated", "abs_error"}
        assert v["abs_error"] >= 0


# ─── scripts/calibrate_from_history.py end-to-end (tmp paths only) ──────── #

def test_calibrate_from_history_end_to_end(tmp_path):
    import calibrate_from_history as driver

    config_copy = tmp_path / "simulation_config.json"
    config_copy.write_text(Path("data/simulation_config.json").read_text(encoding="utf-8"), encoding="utf-8")
    report_path = tmp_path / "calibration_report.json"

    report = driver.main(
        config_path=config_copy,
        curric_path=Path("data/curriculum.json"),
        report_path=report_path,
    )

    assert report_path.exists()
    assert "holdout_validation" in report
    assert "load_cap_fit" in report

    written = load_json(config_copy)
    names = [s["name"] for s in written["scenarios"]]
    assert names.count("B_calibrated") == 1
    assert names[0] == "A_baseline"  # original scenario untouched, still first
    assert written["dropout_base_hazard"] == 0.18  # global default not overwritten
    assert written["normal_load_ch"] == 18  # load-cap fit is informational, not auto-applied

    calibrated_scenario = next(s for s in written["scenarios"] if s["name"] == "B_calibrated")
    assert set(calibrated_scenario["pass_rate_overrides"]) <= set(CURRICULUM)

    # The produced scenario must actually be runnable through the engine-as-a-service seam.
    run = run_simulation(CURRICULUM, written, calibrated_scenario)
    assert "flow_timeline" in run
