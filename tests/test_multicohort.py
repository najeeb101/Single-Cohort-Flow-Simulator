"""Tests for the multi-cohort steady-state university model + data exports."""
from __future__ import annotations

import math
from collections import defaultdict

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
from src.models.semester import effective_admit_interval_terms, mandatory_horizon_end_term
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
    n_inc = config.get("num_incumbent_cohorts", 0)  # default plan no longer warm-starts incumbents
    expected = config["cohort_size"] * (n_cohorts + n_inc)
    assert len(result.students) == expected

    cohort_ids = {s.cohort_id for s in result.students}
    assert cohort_ids == set(range(n_cohorts)) | {-k for k in range(1, n_inc + 1)}


def test_entry_terms_match_schedule():
    result, config, _ = _run()
    interval = effective_admit_interval_terms(config)
    entry = {s.cohort_id: s.entry_term for s in result.students}
    # study cohorts at 0, interval, 2*interval, ...
    for c in range(config["num_cohorts"]):
        assert entry[c] == c * interval
    # incumbents before term 0 (none in the default plan, but the schedule still holds if set)
    for k in range(1, config.get("num_incumbent_cohorts", 0) + 1):
        assert entry[-k] == -k * interval


# ── Warm start: initial-state occupancy + standing (replaces incumbents) ── #

def test_initial_state_occupancy_reduces_capacity_and_standing_populates_totals():
    result, config, curriculum = _run()
    occupancy = config["initial_state"]["occupancy"]
    standing = config["initial_state"]["standing"]
    sps = config["seats_per_section"]

    # A course with occupancy has its free seats reduced by exactly that many on a
    # mandatory term: free = sections * seats_per_section - occupied.
    sim = Simulator(curriculum, config, config["scenarios"][0])
    code = "CMPS151"
    expected = config["course_sections"][code] * sps - occupancy[code]
    assert sim._effective_capacity(curriculum[code]) == expected

    # Standing head-counts are folded into the aggregate stage nodes (and exposed as
    # `background`) so the flow chart isn't empty at term 0.
    frame0 = next(f for f in result.history.timeline if f["term"] == 0)
    assert frame0["background"] == {k: v for k, v in standing.items() if v}
    for node, count in standing.items():
        assert frame0["stages"]["totals"]["nodes"][node] >= count


def test_effective_capacity_is_sections_times_section_size():
    config, curriculum = _setup()
    sim = Simulator(curriculum, config, config["scenarios"][0])
    sps = config["seats_per_section"]
    occupancy = config.get("initial_state", {}).get("occupancy", {})
    for code in ["CMPS303", "CMPS405", "HIS121"]:
        course = curriculum[code]
        # Effective capacity is sections × seats, minus any steady-state initial occupancy.
        expected = config["course_sections"][code] * sps - occupancy.get(code, 0)
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


def test_record_blocks_includes_students_who_drop_the_same_term(monkeypatch):
    """_record_blocks must see the pre-outcome `active` snapshot for the term, not a fresh
    is_active() refilter — a student who drops via the GPA hazard this term still experienced
    this term's offering/prereq constraints before exiting and should be counted.

    Forces every student in a single freshman cohort to drop on their very first (entry) term
    by making the GPA-hazard dropout deterministic, then spies on `_record_outcome` (which
    receives term_idx) and `_record_blocks` (called once per term, in the same order) to confirm
    the dropped students' ids appear in that term's blocks call.
    """
    config, curriculum = _setup()
    config = dict(config)
    config["num_cohorts"] = 1
    config["num_incumbent_cohorts"] = 0
    config["cohort_size"] = 20
    config["probation_min_ch"] = 0       # hazard check applies from term 0, before any credits
    config["dropout_gpa_floor"] = 10.0   # always "below floor" regardless of real GPA
    config["dropout_base_hazard"] = 1.0  # hazard >= 1.0 -> guaranteed drop
    config["dropout_early_multiplier"] = 1.0

    dropped_by_term: dict[int, set[int]] = defaultdict(set)
    blocked_ids_by_call: list[set[int]] = []

    orig_record_outcome = Simulator._record_outcome
    orig_record_blocks = Simulator._record_blocks

    def spy_record_outcome(self, student, status, term_idx):
        if status == "DROPPED":
            dropped_by_term[term_idx].add(student.student_id)
        return orig_record_outcome(self, student, status, term_idx)

    def spy_record_blocks(self, season, active_students, course_stats, courses_to_check):
        blocked_ids_by_call.append({s.student_id for s in active_students})
        return orig_record_blocks(self, season, active_students, course_stats, courses_to_check)

    monkeypatch.setattr(Simulator, "_record_outcome", spy_record_outcome)
    monkeypatch.setattr(Simulator, "_record_blocks", spy_record_blocks)

    sim = Simulator(curriculum, config, config["scenarios"][0])
    start_term = sim.start_term
    sim.run()

    assert dropped_by_term[start_term] == {i for i in range(config["cohort_size"])}, (
        "test setup should force every freshman to drop on their entry term"
    )
    # _record_blocks is called once per term, in run()'s term order starting at start_term.
    blocks_at_entry_term = blocked_ids_by_call[0]
    assert dropped_by_term[start_term] <= blocks_at_entry_term, (
        "students who dropped this term must still appear in this term's _record_blocks call"
    )


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
    interval = effective_admit_interval_terms(config)
    entry_terms = [c * interval for c in range(config["num_cohorts"])]
    entry_terms += [-k * interval for k in range(1, config.get("num_incumbent_cohorts", 0) + 1)]
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
