"""Fit pass rates + dropout hazard from historical transcripts, then validate against a
held-out cohort (ACIP plan §2.2/§2.4).

There is no real institutional history yet (and may never be — see acip_transformation_
plan.md's synthetic-first data strategy), so this calibrates against the *synthetic*
incumbent cohorts, which exist precisely to stand in for "the institution's history" until
a RealDataSource does. The two fit cohorts and the held-out cohort are split by
admission_term from the canonical StudentRecord schema — the same field a real SIS export
carries — so the only thing a future real-data run replaces is where the three record
lists below come from; everything after that line is unchanged.

This is additive, not destructive:
  - data/curriculum.json is never written (course pass rates only ever move via the
    pass_rate_overrides scenario hook, never by editing the curriculum file).
  - The existing "A_baseline" scenario and the global `dropout_base_hazard` are left
    alone — report/report_v2.md already validates that baseline against QU's benchmark,
    and silently moving it would invalidate that report without anyone asking for it.
  - Output is a new "B_calibrated" scenario appended to data/simulation_config.json's
    `scenarios` list, plus a report at outputs/reports/calibration_report.json. The fitted
    dropout hazard is reported, not auto-applied — adopting it is a deliberate config edit.

    py scripts/calibrate_from_history.py
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from src.calibration import (
    cohort_metrics_from_records,
    fit_dropout_base_hazard,
    fit_load_cap,
    fit_pass_rates,
    observed_dropout_rate,
    split_by_admission_term,
    validate_against_holdout,
)
from src.datasource import StudentRecord
from src.models.course import load_curriculum
from src.simulator import Simulator
from src.utils import load_json

CONFIG_PATH = Path("data/simulation_config.json")
CURRIC_PATH = Path("data/curriculum.json")
REPORT_PATH = Path("outputs/reports/calibration_report.json")
MIN_ATTEMPTS = 20


def _historical_records(result):
    """Incumbent cohorts as canonical records — the synthetic stand-in for a SIS export.
    Mirrors analytics.compute_historical_transcripts()'s own incumbent filter, but returns
    the EnrollmentRecord/OutcomeRecord dataclass instances directly instead of asdict()'d
    plain dicts, since the calibration functions key off their attributes."""
    students = [s for s in result.students if s.entry_term < 0]
    keep_ids = {s.student_id for s in students}
    program_id = result.config.get("program_id", "CS")
    student_records = [
        StudentRecord(student_id=s.student_id, program_id=program_id,
                       admission_term=s.entry_term, status=s.status)
        for s in students
    ]
    enrollments = [r for r in result.history.transcript if r.student_id in keep_ids]
    outcomes = [r for r in result.history.outcomes if r.student_id in keep_ids]
    return student_records, enrollments, outcomes


def main(
    config_path: Path = CONFIG_PATH,
    curric_path: Path = CURRIC_PATH,
    report_path: Path = REPORT_PATH,
) -> dict:
    """Runs the full fit + validate + write pipeline; returns the report dict (also
    written to `report_path`) so callers/tests can inspect results without re-parsing
    JSON. Paths are parameterized so tests can point at temp files instead of the real
    data/ directory."""
    config = load_json(config_path)
    curriculum = load_curriculum(curric_path)
    baseline_scenario = config["scenarios"][0]

    print("Running engine once to produce the historical stand-in (incumbent cohorts)...")
    result = Simulator(curriculum, config, baseline_scenario).run()
    students, enrollments, outcomes = _historical_records(result)

    terms = sorted({s.admission_term for s in students})
    if len(terms) < 2:
        sys.exit(
            f"Need >=2 incumbent cohorts to fit + hold one out; config has "
            f"num_incumbent_cohorts={config.get('num_incumbent_cohorts', 0)} (terms={terms})."
        )
    holdout_term = max(terms)   # nearest to the study window
    fit_terms = set(terms) - {holdout_term}

    fit_enrollments, fit_outcomes, _holdout_enrollments, holdout_outcomes = split_by_admission_term(
        students, enrollments, outcomes, fit_terms, holdout_term,
    )

    # ── Fit pass rates ──────────────────────────────────────────────── #
    pass_rate_fit = fit_pass_rates(fit_enrollments, curriculum, min_attempts=MIN_ATTEMPTS)
    pass_rate_overrides = {
        code: round(v["observed_rate"], 4)
        for code, v in pass_rate_fit.items() if v["used"]
    }

    calibrated_scenario = {
        "name": "B_calibrated",
        "capacity_multiplier": 1.0,
        "pass_rate_overrides": pass_rate_overrides,
    }

    # ── Fit dropout hazard against the fit set's observed rate ───────── #
    target_rate = observed_dropout_rate(fit_outcomes)
    hazard_fit = fit_dropout_base_hazard(curriculum, config, calibrated_scenario, target_rate)

    # ── Load-cap sanity check (informational only — normal_load_ch is a registration
    # policy, not auto-written, same reasoning as the dropout hazard above) ──────── #
    load_cap_fit = fit_load_cap(fit_enrollments)

    # ── Validate against the held-out cohort (canonical records only — no cohort_id,
    # no live Student objects, exactly what a real SIS export's students+outcomes
    # tables would supply) ─────────────────────────────────────────────── #
    holdout_students = [s for s in students if s.admission_term == holdout_term]
    holdout_metrics = cohort_metrics_from_records(holdout_students, holdout_outcomes)

    validation_config = dict(config)
    validation_config["dropout_base_hazard"] = hazard_fit["fitted_base_hazard"]
    validation = validate_against_holdout(curriculum, validation_config, calibrated_scenario, holdout_metrics)

    # ── Apply the additive scenario; never touch curriculum.json or A_baseline.
    # Idempotent: re-running replaces a prior "B_calibrated" instead of duplicating it. ── #
    config["scenarios"] = [s for s in config["scenarios"] if s["name"] != "B_calibrated"]
    config["scenarios"].append(calibrated_scenario)
    with open(config_path, "w", encoding="utf-8") as f:
        json.dump(config, f, indent=2)

    report = {
        "fit_terms": sorted(fit_terms),
        "holdout_term": holdout_term,
        "pass_rates": pass_rate_fit,
        "dropout_hazard_fit": hazard_fit,
        "load_cap_fit": load_cap_fit,
        "holdout_validation": validation,
    }
    report_path.parent.mkdir(parents=True, exist_ok=True)
    with open(report_path, "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2)

    # ── Print summary ──────────────────────────────────────────────── #
    print(f"\nFit cohorts (admission_term): {sorted(fit_terms)}   Holdout cohort: {holdout_term}\n")
    print("Pass rates (used = enough historical attempts to fit; else kept curriculum default):")
    for code in sorted(pass_rate_fit, key=lambda c: -pass_rate_fit[c]["n_attempts"]):
        v = pass_rate_fit[code]
        tag = "fit  " if v["used"] else "kept "
        obs = f"{v['observed_rate']:.3f}" if v["observed_rate"] is not None else "  n/a"
        print(f"  {tag}{code:10s} n={v['n_attempts']:4d}  observed={obs}  assumed={v['assumed_rate']:.3f}")

    print(f"\nDropout base hazard: fitted={hazard_fit['fitted_base_hazard']:.4f} "
          f"(target dropout rate {hazard_fit['target_dropout_rate']:.3f}, "
          f"config default {config.get('dropout_base_hazard')})")
    print("  (reported only - A_baseline's dropout_base_hazard was NOT modified)")

    if load_cap_fit["observed_load_percentile"] is not None:
        print(f"\nLoad cap sanity check: observed p{load_cap_fit['percentile']*100:.0f} "
              f"per-student-term load={load_cap_fit['observed_load_percentile']:.1f} CH "
              f"(n={load_cap_fit['n_student_terms']} student-terms) vs. "
              f"config normal_load_ch={config.get('normal_load_ch')}")
        print("  (informational only - normal_load_ch was NOT modified)")

    print(f"\nHoldout validation (cohort {holdout_term}):")
    for metric, v in validation.items():
        print(f"  {metric:24s} observed={v['observed']:.4f}  simulated={v['simulated']:.4f}  "
              f"abs_error={v['abs_error']:.4f}")

    print(f"\nAppended scenario 'B_calibrated' to {config_path}")
    print(f"Wrote full report to {report_path}")
    return report


if __name__ == "__main__":
    main()
