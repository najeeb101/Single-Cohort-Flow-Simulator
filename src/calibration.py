"""Measured calibration + holdout validation (ACIP plan §2.2/§2.4).

Every function here consumes only the canonical-schema records already defined in
src/datasource.py (StudentRecord, EnrollmentRecord, OutcomeRecord) — never a SimulationResult
or DataSource directly. That's deliberate: src.analytics.compute_historical_transcripts()
extracts these three record types from a finished synthetic run today; a future
RealDataSource would hand the exact same three record types straight from a SIS export.
Nothing in this module needs to change when that happens — only the caller that produces
the records does.

Pass rates are fit by direct frequency (a transcript either has the attempts or it doesn't).
The dropout hazard has no such direct readout — OutcomeRecord carries no GPA trajectory —
so it's calibrated the only way report/report_v2.md's own sweep already established works:
re-running the forward simulation at trial values and matching the resulting aggregate
dropout rate, exactly the way src/montecarlo.py already re-runs the engine for statistics.
"""
from __future__ import annotations

import copy
from collections import defaultdict
from typing import TYPE_CHECKING

from src.analytics import compute_metrics
from src.models.student import PASSING_GRADES
from src.simulator import Simulator

if TYPE_CHECKING:
    from src.datasource import EnrollmentRecord, OutcomeRecord, StudentRecord
    from src.models.course import Course

_HOLDOUT_METRIC_MAP = {
    "graduation_rate": "graduation_rate",
    "academic_dropout_rate": "academic_dropout_rate",
    "on_time_rate": "on_time_rate",
    "avg_graduation_time": "avg_time_to_degree",
}


def fit_pass_rates(
    enrollments: list["EnrollmentRecord"],
    curriculum: dict[str, "Course"],
    min_attempts: int = 20,
) -> dict[str, dict]:
    """Empirical per-course pass rate from historical attempts.

    A course with fewer than `min_attempts` observed attempts keeps the curriculum's
    assumed rate instead of fitting one from a handful of noisy samples — `used=False`
    marks which courses that applies to, so callers can report confidence honestly.
    """
    attempts: dict[str, int] = defaultdict(int)
    passes: dict[str, int] = defaultdict(int)
    for r in enrollments:
        attempts[r.course_code] += 1
        if r.grade in PASSING_GRADES:
            passes[r.course_code] += 1

    fitted: dict[str, dict] = {}
    for code, course in curriculum.items():
        n = attempts.get(code, 0)
        used = n >= min_attempts
        fitted[code] = {
            "observed_rate": (passes.get(code, 0) / n) if n else None,
            "n_attempts": n,
            "assumed_rate": course.pass_rate,
            "used": used,
        }
    return fitted


def observed_dropout_rate(outcomes: list["OutcomeRecord"]) -> float:
    """Fraction of a historical population whose terminal outcome was a dropout."""
    total = len(outcomes)
    if not total:
        return 0.0
    dropped = sum(1 for o in outcomes if o.exit_reason == "dropped")
    return dropped / total


def fit_dropout_base_hazard(
    curriculum: dict[str, "Course"],
    config: dict,
    scenario: dict,
    target_dropout_rate: float,
    search_range: tuple[float, float] = (0.05, 0.4),
    tol: float = 0.02,
    max_iter: int = 8,
) -> dict:
    """Binary-search `dropout_base_hazard` so the engine's own simulated study-cohort
    dropout rate matches `target_dropout_rate`. Assumes the monotonic relationship a higher
    hazard -> more drops per term, which is mechanistic (simulator.py applies the hazard as
    an independent per-term draw), not fit. `scenario` should already carry any fitted
    pass-rate overrides, since pass rates affect who is even at risk of the GPA-floor hazard.
    """
    lo, hi = search_range
    iterations: list[dict] = []
    fitted = (lo + hi) / 2
    for _ in range(max_iter):
        mid = (lo + hi) / 2
        trial_config = copy.deepcopy(config)
        trial_config["dropout_base_hazard"] = mid
        result = Simulator(curriculum, trial_config, scenario).run()
        rate = compute_metrics(result)["academic_dropout_rate"]
        iterations.append({"base_hazard": mid, "simulated_dropout_rate": rate})
        fitted = mid
        if abs(rate - target_dropout_rate) <= tol:
            break
        if rate < target_dropout_rate:
            lo = mid
        else:
            hi = mid

    return {
        "fitted_base_hazard": fitted,
        "target_dropout_rate": target_dropout_rate,
        "iterations": iterations,
    }


def cohort_metrics_from_records(
    students: list["StudentRecord"],
    outcomes: list["OutcomeRecord"],
) -> dict:
    """Aggregate outcome metrics computed purely from canonical records — derivable from a
    real SIS export's students + outcomes tables joined on student_id, no engine internals
    (cohort_id, live Student objects) involved. Same key shape as analytics.compute_cohort_
    metrics()'s per-cohort dict, so it slots directly into validate_against_holdout below.
    """
    admission_by_id = {s.student_id: s.admission_term for s in students}
    n = len(students) or 1
    graduated = [o for o in outcomes if o.exit_reason == "graduated"]
    dropped = [o for o in outcomes if o.exit_reason == "dropped"]
    censored = [o for o in outcomes if o.exit_reason == "censored"]
    personal_times = [
        o.graduation_term - admission_by_id[o.student_id] + 1
        for o in graduated if o.student_id in admission_by_id and o.graduation_term is not None
    ]
    return {
        "graduation_rate": len(graduated) / n,
        "academic_dropout_rate": len(dropped) / n,
        "censored_rate": len(censored) / n,
        "on_time_rate": sum(1 for t in personal_times if t <= 8) / n,
        "avg_time_to_degree": (sum(personal_times) / len(personal_times)) if personal_times else 0.0,
    }


def validate_against_holdout(
    curriculum: dict[str, "Course"],
    config: dict,
    scenario: dict,
    holdout_metrics: dict,
) -> dict[str, dict]:
    """Forward-simulate with the fitted config/scenario and compare against a held-out
    cohort's own observed metrics (from analytics.compute_cohort_metrics). This is the
    validation harness: run on a synthetic holdout now, the same comparison becomes the
    real-data acceptance test once a held-out real cohort exists.
    """
    result = Simulator(curriculum, config, scenario).run()
    simulated = compute_metrics(result)

    report: dict[str, dict] = {}
    for sim_key, holdout_key in _HOLDOUT_METRIC_MAP.items():
        observed = holdout_metrics[holdout_key]
        sim_value = simulated[sim_key]
        report[sim_key] = {
            "observed": observed,
            "simulated": sim_value,
            "abs_error": abs(sim_value - observed),
        }
    return report


def split_by_admission_term(
    students: list["StudentRecord"],
    enrollments: list["EnrollmentRecord"],
    outcomes: list["OutcomeRecord"],
    fit_terms: set[int],
    holdout_term: int,
) -> tuple[list["EnrollmentRecord"], list["OutcomeRecord"], list["EnrollmentRecord"], list["OutcomeRecord"]]:
    """Split canonical records into a fit set and a holdout set by admission_term — a real
    SIS export carries this field too, so this split works unchanged on real data."""
    fit_ids = {s.student_id for s in students if s.admission_term in fit_terms}
    holdout_ids = {s.student_id for s in students if s.admission_term == holdout_term}

    fit_enrollments = [r for r in enrollments if r.student_id in fit_ids]
    holdout_enrollments = [r for r in enrollments if r.student_id in holdout_ids]
    fit_outcomes = [r for r in outcomes if r.student_id in fit_ids]
    holdout_outcomes = [r for r in outcomes if r.student_id in holdout_ids]
    return fit_enrollments, fit_outcomes, holdout_enrollments, holdout_outcomes
