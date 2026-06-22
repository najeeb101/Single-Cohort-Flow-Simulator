"""Tests for the multi-cohort steady-state university model + data exports."""
from __future__ import annotations

import math

import pytest

from src.analytics import (
    build_course_utilization,
    build_curriculum_graph,
    compute_admissions_recommendation,
    compute_cohort_metrics,
    compute_metrics,
)
from src.datasource import DataSource
from src.models.course import load_curriculum
from src.models.semester import mandatory_horizon_end_term
from src.montecarlo import run_monte_carlo
from src.simulator import Simulator
from src.utils import load_json

SEED = 42


def _setup():
    config = load_json("data/simulation_config.json")
    curriculum = load_curriculum("data/curriculum.json")
    return config, curriculum


def _run():
    config, curriculum = _setup()
    result = Simulator(curriculum, config, config["scenarios"][0]).run()
    result.metrics = compute_metrics(result)
    return result, config, curriculum


class _EmptyDataSource(DataSource):
    def cohort_specs(self):
        return []

    def create_students(self, spec):
        return []


def test_empty_cohort_specs_raises():
    config, curriculum = _setup()
    with pytest.raises(ValueError):
        Simulator(curriculum, config, config["scenarios"][0], data_source=_EmptyDataSource())


# ── Cohort identity & admission schedule ─────────────────────────── #

def test_unique_student_ids_and_cohort_assignment():
    result, config, _ = _run()
    ids = [s.student_id for s in result.students]
    assert len(ids) == len(set(ids)), "student ids must be globally unique"

    n_cohorts = config["num_cohorts"]
    n_inc = config["num_incumbent_cohorts"]
    expected = config["cohort_size"] * (n_cohorts + n_inc)
    assert len(result.students) == expected

    cohort_ids = {s.cohort_id for s in result.students}
    assert cohort_ids == set(range(n_cohorts)) | {-k for k in range(1, n_inc + 1)}


def test_entry_terms_match_schedule():
    result, config, _ = _run()
    interval = config["admit_interval_terms"]
    entry = {s.cohort_id: s.entry_term for s in result.students}
    # study cohorts at 0, interval, 2*interval, ...
    for c in range(config["num_cohorts"]):
        assert entry[c] == c * interval
    # incumbents before term 0
    for k in range(1, config["num_incumbent_cohorts"] + 1):
        assert entry[-k] == -k * interval


# ── Warm start: incumbents occupy seats before study cohort 0 ────── #

def test_warm_start_incumbents_present_and_progressed():
    result, _, _ = _run()
    # By the first study term (global term 0), incumbents have been progressing for
    # several semesters: they are present and have completed credit hours / hold seats.
    incumbents = [s for s in result.students if s.cohort_id < 0]
    assert incumbents, "incumbent cohorts must exist"
    assert any(s.completed_ch > 0 for s in incumbents), \
        "incumbents should have made academic progress before study cohort 0 arrives"
    # The university is genuinely multi-cohort at term 0 (more than one cohort's worth active).
    frame0 = next(f for f in result.history.timeline if f["term"] == 0)
    total_registered = sum(c["registered"] for c in frame0["courses"].values())
    assert total_registered > 0


def test_effective_capacity_is_sections_times_section_size():
    config, curriculum = _setup()
    sim = Simulator(curriculum, config, config["scenarios"][0])
    sps = config["seats_per_section"]
    for code in ["CMPS303", "CMPS405", "GED_1"]:
        course = curriculum[code]
        expected = config["course_sections"][code] * sps
        assert sim._effective_capacity(course) == expected
        assert sim._section_count(course) == config["course_sections"][code]


# ── Shared pool: seniors beat freshmen across cohorts ────────────── #

def test_shared_pool_seniors_outrank_freshmen():
    from src.models.student import Student, registration_tier
    # two cohorts: 25 seniors (90 CH) + 25 freshmen (0 CH) compete for 25 seats
    seniors = [Student(i, SEED, cohort_id=0, entry_term=0) for i in range(25)]
    freshmen = [Student(100 + i, SEED, cohort_id=1, entry_term=2) for i in range(25)]
    for s in seniors:
        s.completed_ch = 90
    requesters = seniors + freshmen
    cap = 25
    ranked = sorted(requesters, key=lambda s: (registration_tier(s.completed_ch), s.tiebreak_token))
    winners = {s.student_id for s in ranked[:cap]}
    assert all(s.student_id in winners for s in seniors)


# ── Per-cohort metrics reconcile with aggregate ──────────────────── #

def test_cohort_metrics_reconcile():
    result, _, _ = _run()
    cm = compute_cohort_metrics(result)
    # one entry per cohort
    assert set(cm) == {s.cohort_id for s in result.students}

    # study-cohort graduate counts sum to the aggregate graduate count
    study = [s for s in result.students if s.entry_term >= 0]
    agg_grads = sum(1 for s in study if s.status == "GRADUATED")
    summed = sum(round(cm[c]["graduation_rate"] * cm[c]["n"])
                 for c in cm if not cm[c]["is_incumbent"])
    assert summed == agg_grads


def test_per_cohort_bottlenecks_sum_to_global():
    result, _, _ = _run()
    h = result.history
    global_total = sum(h.capacity_block_counts.values())
    per_cohort_total = sum(
        sum(courses.values()) for courses in h.capacity_block_by_cohort.values()
    )
    assert per_cohort_total == global_total


# ── Admissions recommendation ────────────────────────────────────── #

def test_admissions_recommendation_shape():
    result, config, _ = _run()
    rec = compute_admissions_recommendation(result)
    assert rec["recommended_intake"] >= 1
    assert rec["recommended_intake"] <= math.ceil(config["cohort_size"] * 1.25)
    assert rec["binding_criterion"] in {
        "graduation_rate", "time_to_degree", "seats_denied_per_stud", "throughput_stability"
    }
    assert len(rec["criteria"]) == 4


def test_starved_capacity_recommends_shrink():
    config, curriculum = _setup()
    # Choke every course to 5 seats -> heavy congestion -> shrink intake.
    scenario = {"name": "starved", "capacity_overrides": {c: 0.05 for c in curriculum}}
    result = Simulator(curriculum, config, scenario).run()
    result.metrics = compute_metrics(result)
    rec = compute_admissions_recommendation(result)
    assert rec["recommended_intake"] < config["cohort_size"]


# ── Timeline JSON structure ──────────────────────────────────────── #

def test_timeline_frames_and_invariants():
    result, config, curriculum = _run()
    timeline = result.history.timeline

    # Independent re-derivation of Simulator's start_term/end_term (not a mirror of its
    # implementation): earliest entry_term through the latest cohort's mandatory-semester
    # horizon. A raw `max_terms` calendar-term count only matches this when every season is
    # mandatory; mandatory_horizon_end_term is what makes this correct once optional
    # (non-mandatory) seasons exist in the cycle too. See CLAUDE.md's "Term/Season Model".
    interval = config["admit_interval_terms"]
    entry_terms = [c * interval for c in range(config["num_cohorts"])]
    entry_terms += [-k * interval for k in range(1, config["num_incumbent_cohorts"] + 1)]
    start_term = min(entry_terms)
    end_term = max(mandatory_horizon_end_term(t, config["max_terms"], config) for t in entry_terms)
    expected_terms = end_term - start_term
    assert len(timeline) == expected_terms

    stage_nodes = set(["Admitted", "Year1", "Year2", "Year3", "Year4",
                       "Graduated", "Dropped", "Censored"])
    for f in timeline:
        for code, st in f["courses"].items():
            if st["offered"]:
                assert st["granted"] == min(st["registered"], st["capacity"])
                assert st["denied"] == st["registered"] - st["granted"]
                assert st["full"] == (st["granted"] >= st["capacity"])
        for cid, block in f["stages"]["cohorts"].items():
            assert set(block["nodes"]).issubset(stage_nodes)


def test_curriculum_graph_matches_curriculum():
    _, curriculum = _setup()
    g = build_curriculum_graph(curriculum)
    codes = {n["code"] for n in g["nodes"]}
    assert codes == set(curriculum)
    for e in g["edges"]:
        assert e["from"] in codes and e["to"] in codes


def test_course_utilization_rows():
    result, _, _ = _run()
    rows = build_course_utilization(result)
    assert rows
    for r in rows:
        # utilization is rounded to 4 dp in the export
        assert abs(r["utilization"] - r["granted"] / max(1, r["capacity"])) < 1e-3


# ── Monte Carlo ──────────────────────────────────────────────────── #

def test_monte_carlo_ci_brackets_mean_and_deterministic():
    config, curriculum = _setup()
    config = dict(config)
    config["monte_carlo"] = {"enabled": True, "n_runs": 5, "base_seed": 42}
    scenario = config["scenarios"][0]
    mc1 = run_monte_carlo(curriculum, config, scenario)
    mc2 = run_monte_carlo(curriculum, config, scenario)
    for metric, v in mc1.items():
        assert v["ci_low"] <= v["mean"] <= v["ci_high"]
        assert v == mc2[metric], "Monte Carlo must be deterministic for a fixed base_seed"


# ── Determinism of the canonical run ─────────────────────────────── #

def test_canonical_run_deterministic():
    r1, _, _ = _run()
    r2, _, _ = _run()
    assert r1.history.cohort_snapshots == r2.history.cohort_snapshots
    assert r1.history.timeline == r2.history.timeline
