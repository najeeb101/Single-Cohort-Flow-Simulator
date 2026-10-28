"""Engine hooks behind the intake analysis: the unlimited-seat reference really is unlimited,
its outcome doesn't depend on the intake (students don't interact without contention), and
replication seeds don't replay the same students.
"""
from __future__ import annotations

from src.planner.intake import _Views, _run_task, analysis_params, estimate_reference, resolve_incumbent_sizes
from src.domain.course import load_curriculum
from src.engine.simulator import Simulator
from src.engine.utils import SEED_STRIDE, load_json, spaced_seeds

CURRICULUM = load_curriculum("data/curriculum.json")
CONFIG = load_json("data/simulation_config.json")


def _small(**overrides) -> dict:
    return {**CONFIG, "cohort_size": 40, "num_cohorts": 3, **overrides}


def test_unlimited_all_records_no_denials():
    result = Simulator(CURRICULUM, _small(), {"name": "ref", "unlimited_seats": "all"}).run()
    assert sum(result.history.capacity_block_counts.values()) == 0
    assert all(not st["full"] for f in result.history.timeline for st in f["courses"].values())


def test_unlimited_regular_lifts_only_mandatory_terms():
    result = Simulator(CURRICULUM, _small(cohort_size=120), {"name": "demand", "unlimited_seats": "regular"}).run()
    assert sum(result.history.capacity_block_counts_mandatory.values()) == 0


def test_real_seats_do_deny_at_high_intake():
    # Sanity check the other direction: the same layout with real seats is congested.
    result = Simulator(CURRICULUM, _small(cohort_size=200), {"name": "real"}).run()
    assert sum(result.history.capacity_block_counts_mandatory.values()) > 0


def test_reference_is_flat_across_intakes():
    params = analysis_params(CONFIG, {"min_history_years": 2, "steady_cohorts": 3})
    views = _Views(CURRICULUM, CONFIG, params, resolve_incumbent_sizes(CONFIG, 2))
    scen = {"name": "reference", "unlimited_seats": "all"}
    seeds = spaced_seeds(7, 2)
    low = estimate_reference([_run_task(views.steady_task(40, s, scen, measured="all")) for s in seeds])
    high = estimate_reference([_run_task(views.steady_task(140, s, scen, measured="all")) for s in seeds])
    assert low["denials"] == 0 and high["denials"] == 0
    assert abs(low["grad_rate"] - high["grad_rate"]) < 0.05
    assert abs(low["on_time_rate"] - high["on_time_rate"]) < 0.05


def test_spaced_seeds_do_not_overlap_students():
    seeds = spaced_seeds(42, 5)
    assert len(set(seeds)) == 5
    assert all(b - a == SEED_STRIDE for a, b in zip(seeds, seeds[1:]))
    # A run never has anywhere near SEED_STRIDE students, so `seed + student_id` ranges are disjoint.
    assert SEED_STRIDE > 100_000
