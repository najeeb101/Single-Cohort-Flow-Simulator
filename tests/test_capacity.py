"""Tests for seat-allocation: priority ordering and exact capacity enforcement."""
from __future__ import annotations

import math
from collections import defaultdict

import pytest

from src.models.course import load_curriculum
from src.models.student import Student, registration_tier
from src.simulator import Simulator


SEED = 42
CONFIG_STUB = {
    "seed": SEED,
    "cohort_size": 10,
    "max_terms": 12,
    "normal_load_ch": 18,
    "probation_load_ch": 12,
    "probation_gpa_threshold": 2.0,
    "probation_min_ch": 25,
    "dropout_fails_threshold": 3,
    "dropout_prob_on_repeated_fail": 0.25,
    "ability_sd": 0.15,
    "ability_clip": 0.30,
    "grade_tiers": {
        "hard_max": 0.72, "medium_max": 0.82,
        "hard":   {"A":0.05,"B+":0.10,"B":0.25,"C+":0.20,"C":0.30,"D":0.10},
        "medium": {"A":0.10,"B+":0.15,"B":0.30,"C+":0.20,"C":0.20,"D":0.05},
        "easy":   {"A":0.25,"B+":0.25,"B":0.25,"C+":0.12,"C":0.10,"D":0.03},
    },
}
SCENARIO_STUB = {"name": "test", "capacity_multiplier": 1.0}


def _sim(scenario=None):
    curric = load_curriculum("data/curriculum.json")
    return Simulator(curric, CONFIG_STUB, scenario or SCENARIO_STUB)


# ─── registration_tier() ─────────────────────────────────────────────────── #

def test_registration_tier_boundaries():
    assert registration_tier(0)  == 5
    assert registration_tier(29) == 5
    assert registration_tier(30) == 4
    assert registration_tier(44) == 4
    assert registration_tier(45) == 3
    assert registration_tier(59) == 3
    assert registration_tier(60) == 2
    assert registration_tier(74) == 2
    assert registration_tier(75) == 1
    assert registration_tier(89) == 1
    assert registration_tier(90) == 0
    assert registration_tier(120) == 0


def test_registration_tier_reads_config_thresholds():
    config = {"registration_tier_thresholds": [60, 30]}
    assert registration_tier(0, config) == 2
    assert registration_tier(30, config) == 1
    assert registration_tier(60, config) == 0
    # No config (or a config missing the key) falls back to the QU default bands.
    assert registration_tier(60, {}) == 2
    assert registration_tier(60, None) == 2


# ─── Capacity enforcement ─────────────────────────────────────────────────── #

def test_all_granted_when_under_capacity():
    """All requesters get a seat when count ≤ capacity."""
    sim = _sim()
    curric = sim.curriculum
    course = curric["CMPS151"]  # capacity 55

    requesters = [Student(i, SEED) for i in range(10)]
    for s in requesters:
        s.completed_ch = 0  # tier 5

    cap = sim._effective_capacity(course)
    assert len(requesters) <= cap  # sanity

    # Run Phase 2 for just this course
    desired = defaultdict(list)
    for s in requesters:
        desired[course.code].append(s)

    granted = defaultdict(list)
    sim.history.capacity_block_counts.clear()
    for code, reqs in desired.items():
        c = curric[code]
        eff_cap = sim._effective_capacity(c)
        if len(reqs) <= eff_cap:
            for s in reqs:
                granted[s.student_id].append(c)
        else:
            sorted_req = sorted(reqs, key=lambda s: (registration_tier(s.completed_ch), s.tiebreak_token))
            for s in sorted_req[:eff_cap]:
                granted[s.student_id].append(c)
            for s in sorted_req[eff_cap:]:
                sim.history.capacity_block_counts[code] += 1

    assert sum(len(v) for v in granted.values()) == 10
    assert sim.history.capacity_block_counts.get(course.code, 0) == 0


def test_exactly_capacity_granted_when_over():
    """When requesters > capacity, exactly `capacity` seats are granted."""
    sim = _sim()
    curric = sim.curriculum
    course = curric["CMPS493"]  # capacity 25
    cap = course.capacity  # 25

    # Create 30 students, all tier 5 (completed_ch = 0)
    requesters = [Student(i, SEED) for i in range(30)]
    for s in requesters:
        s.completed_ch = 0

    granted = defaultdict(list)
    for code, reqs in {course.code: requesters}.items():
        c = curric[code]
        eff_cap = sim._effective_capacity(c)
        sorted_req = sorted(reqs, key=lambda s: (registration_tier(s.completed_ch), s.tiebreak_token))
        for s in sorted_req[:eff_cap]:
            granted[s.student_id].append(c)
        for s in sorted_req[eff_cap:]:
            sim.history.capacity_block_counts[code] += 1

    granted_count = sum(len(v) for v in granted.values())
    assert granted_count == cap
    assert sim.history.capacity_block_counts[course.code] == 30 - cap


def test_higher_tier_wins_seat_over_lower():
    """Students with lower registration_tier (more credits) get priority."""
    sim = _sim()
    curric = sim.curriculum
    # Use CMPS493 with capacity 25, create students where 5 have high completed_ch
    course = curric["CMPS493"]
    cap = course.capacity  # 25

    # 30 students: 5 with 90 CH (tier 0), 25 with 0 CH (tier 5)
    students = [Student(i, SEED) for i in range(30)]
    high_ch_ids = set(range(5))
    for s in students:
        s.completed_ch = 90 if s.student_id in high_ch_ids else 0

    sorted_req = sorted(
        students,
        key=lambda s: (registration_tier(s.completed_ch), s.tiebreak_token),
    )
    granted_ids = {s.student_id for s in sorted_req[:cap]}

    # All 5 high-CH students must be in the granted set
    assert high_ch_ids.issubset(granted_ids)


def test_capacity_multiplier_scales_seats():
    """Scenario capacity_overrides scales seats correctly."""
    sim_base = _sim({"name": "base", "capacity_multiplier": 1.0})
    sim_2x   = _sim({"name": "2x",   "capacity_multiplier": 2.0})

    course = sim_base.curriculum["CMPS303"]
    base_cap = sim_base._effective_capacity(course)
    two_x_cap = sim_2x._effective_capacity(course)
    assert two_x_cap == math.floor(base_cap * 2.0)


def test_capacity_override_per_course():
    # Capacity is now sections × seats_per_section; an override scales that base.
    base = _sim({"name": "base", "capacity_multiplier": 1.0})
    course = base.curriculum["CMPS303"]
    base_cap = base._effective_capacity(course)

    sim = _sim({
        "name": "override_test",
        "capacity_multiplier": 1.0,
        "capacity_overrides": {"CMPS303": 1.5},
    })
    assert sim._effective_capacity(course) == math.floor(base_cap * 1.5)
