"""Monte Carlo: re-run the baseline across many seeds and report mean ± 95% CI.

The canonical animation/timeline is built from the single base-seed run (deterministic for
the frontend); these confidence intervals only annotate the headline metrics so the reported
numbers carry uncertainty instead of being a single-seed point estimate.
"""
from __future__ import annotations

import copy
import math
import statistics

from src.analytics import compute_metrics
from src.models.course import Course
from src.simulator import Simulator

_METRICS = [
    "graduation_rate", "academic_dropout_rate", "censored_rate",
    "avg_graduation_time", "on_time_rate", "probation_rate", "mean_gpa_at_graduation",
]


def run_monte_carlo(
    curriculum: dict[str, Course],
    config: dict,
    scenario: dict,
) -> dict:
    mc = config.get("monte_carlo", {})
    n_runs = int(mc.get("n_runs", 30))
    base_seed = int(mc.get("base_seed", config["seed"]))

    samples: dict[str, list[float]] = {k: [] for k in _METRICS}
    for k in range(n_runs):
        run_config = copy.deepcopy(config)
        run_config["seed"] = base_seed + k
        result = Simulator(curriculum, run_config, scenario).run()
        result.metrics = compute_metrics(result)
        for metric in _METRICS:
            samples[metric].append(result.metrics[metric])

    out: dict[str, dict] = {}
    for metric, values in samples.items():
        mean = statistics.fmean(values)
        sd = statistics.stdev(values) if len(values) > 1 else 0.0
        half = 1.96 * sd / math.sqrt(len(values)) if values else 0.0
        out[metric] = {
            "mean": mean,
            "stdev": sd,
            "ci_low": mean - half,
            "ci_high": mean + half,
            "n_runs": n_runs,
        }
    return out
