"""src/parallel.py + the parallel Monte Carlo path must be order-preserving and byte-identical
to the serial path — the property the aggregated CI numbers depend on (optimization plan item 2)."""
from __future__ import annotations

from src.models.course import load_curriculum
from src.montecarlo import run_monte_carlo
from src.parallel import ordered_map, resolve_workers
from src.utils import load_json


def _square(x):  # module-level so it pickles for the process pool
    return x * x


def test_ordered_map_matches_serial_list_comprehension():
    items = list(range(10))
    expected = [x * x for x in items]
    assert ordered_map(_square, items, workers=1) == expected      # forced serial
    assert ordered_map(_square, items, workers=4) == expected      # process pool, order preserved


def test_ordered_map_below_threshold_still_correct():
    # Fewer items than the parallel threshold: runs serially but must still be right.
    assert ordered_map(_square, [2, 3], workers=8) == [4, 9]
    assert ordered_map(_square, [], workers=8) == []


def test_resolve_workers_precedence():
    assert resolve_workers(30, requested=3, config_workers=7) == 3      # explicit request wins
    assert resolve_workers(30, requested=None, config_workers=7) == 7   # then config value
    assert resolve_workers(1, requested=None, config_workers=None) >= 1  # else cpu-based, never 0


def _fast_mc_config() -> dict:
    """A small, fast Monte Carlo config so the parallel==serial check runs in a second or two."""
    config = dict(load_json("data/simulation_config.json"))
    config["num_cohorts"] = 2
    config["cohort_size"] = 20
    config["monte_carlo"] = {"enabled": True, "n_runs": 5, "base_seed": 42}
    return config


def test_monte_carlo_parallel_equals_serial():
    config = _fast_mc_config()
    curriculum = load_curriculum("data/curriculum.json")
    scenario = config["scenarios"][0]

    serial = run_monte_carlo(curriculum, config, scenario, workers=1)
    parallel = run_monte_carlo(curriculum, config, scenario, workers=4)

    assert serial == parallel, "parallel Monte Carlo must match the serial result byte-for-byte"
