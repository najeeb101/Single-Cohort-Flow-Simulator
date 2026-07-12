"""Monte Carlo: re-run the baseline across many seeds and report mean ± 95% CI.

The canonical animation/timeline is built from the single base-seed run (deterministic for
the frontend); these confidence intervals only annotate the headline metrics so the reported
numbers carry uncertainty instead of being a single-seed point estimate.

The seeds are independent full simulations, so they fan across CPU cores via `src.parallel`
(optimization plan item 2). Results are collected **in seed order**, so the aggregated
mean/stdev/CI are byte-identical whether the run was serial or parallel — see
`tests/test_multicohort.py`'s determinism check and `tests/test_parallel.py`.
"""
from __future__ import annotations

import copy
import math
import statistics

from src.analytics import compute_metrics
from src.models.course import Course
from src.parallel import ordered_map, resolve_workers
from src.simulator import Simulator

_METRICS = [
    "graduation_rate", "academic_dropout_rate", "censored_rate",
    "avg_graduation_time", "on_time_rate", "probation_rate", "mean_gpa_at_graduation",
]


def _run_one(task: tuple[dict, dict, dict, int]) -> list[float]:
    """One seed's simulation, returning the `_METRICS` values in order. Module-level (not a
    closure) so it pickles for the process pool. `task` is (curriculum, config, scenario, seed)."""
    curriculum, config, scenario, seed = task
    run_config = copy.deepcopy(config)
    run_config["seed"] = seed
    result = Simulator(curriculum, run_config, scenario).run()
    result.metrics = compute_metrics(result)
    return [result.metrics[m] for m in _METRICS]


def run_monte_carlo(
    curriculum: dict[str, Course],
    config: dict,
    scenario: dict,
    *,
    workers: int | None = None,
) -> dict:
    """Run `monte_carlo.n_runs` seeded simulations and return per-metric mean/stdev/95% CI.

    `workers` sets the process-pool size; `None` (default) uses `monte_carlo.workers` from the
    config if present, else one worker per CPU. `workers=1` forces the serial path (identical
    results). Seeds are `base_seed + k`, exactly as before this was parallelized.
    """
    mc = config.get("monte_carlo", {})
    n_runs = int(mc.get("n_runs", 30))
    base_seed = int(mc.get("base_seed", config["seed"]))

    tasks = [(curriculum, config, scenario, base_seed + k) for k in range(n_runs)]
    n_workers = resolve_workers(n_runs, requested=workers, config_workers=mc.get("workers"))
    rows = ordered_map(_run_one, tasks, workers=n_workers)

    # rows[k] is the metric vector for seed base_seed+k; transpose into per-metric sample lists
    # in that same order so aggregation matches the old serial loop exactly.
    samples: dict[str, list[float]] = {
        m: [rows[k][i] for k in range(n_runs)] for i, m in enumerate(_METRICS)
    }

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
