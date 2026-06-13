"""Two runs with the same seed must produce byte-identical CSV output."""
from __future__ import annotations

import csv
import io

import pytest

from src.analytics import build_summary_csv, compute_metrics
from src.models.course import load_curriculum
from src.simulator import Simulator
from src.utils import load_json


def _run_all_scenarios():
    config     = load_json("data/simulation_config.json")
    curriculum = load_curriculum("data/curriculum.json")
    results = {}
    for scenario in config["scenarios"]:
        sim    = Simulator(curriculum, config, scenario)
        result = sim.run()
        result.metrics = compute_metrics(result)
        results[scenario["name"]] = result
    return results


def _results_to_csv_string(results) -> str:
    buf = io.StringIO()
    rows = []
    for name, result in results.items():
        m = result.metrics
        rows.append({
            "scenario":            name,
            "graduation_rate":       f"{m['graduation_rate']:.6f}",
            "academic_dropout_rate": f"{m['academic_dropout_rate']:.6f}",
            "censored_rate":         f"{m['censored_rate']:.6f}",
            "avg_graduation_time":   f"{m['avg_graduation_time']:.6f}",
            "on_time_rate":          f"{m['on_time_rate']:.6f}",
            "probation_rate":        f"{m['probation_rate']:.6f}",
        })
    if rows:
        writer = csv.DictWriter(buf, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)
    return buf.getvalue()


def test_same_seed_produces_identical_results():
    csv1 = _results_to_csv_string(_run_all_scenarios())
    csv2 = _results_to_csv_string(_run_all_scenarios())
    assert csv1 == csv2, "Simulation is not deterministic — RNG streams differ between runs"


def test_graduation_times_identical_across_runs():
    r1 = _run_all_scenarios()
    r2 = _run_all_scenarios()
    for name in r1:
        times1 = sorted(r1[name].history.graduation_times)
        times2 = sorted(r2[name].history.graduation_times)
        assert times1 == times2, f"Graduation times differ for {name}"
