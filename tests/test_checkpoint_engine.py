"""Tests for the resumable-engine mechanics behind Semester Checkpoint Mode (see CLAUDE.md):
`Simulator.step_one_mandatory_term`, `snapshot()`/`from_snapshot()`, and the `History` pickle
fix (named factory functions instead of lambdas) that makes snapshotting possible at all.

These exist alongside — not instead of — the existing full test suite: every other test file
already re-verifies that `run()` (now implemented as a step loop internally) still produces its
usual numbers, since many of them assert specific fixed values. This file is the dedicated
coverage for the *new* surface: pausing, serializing, and resuming.
"""
from __future__ import annotations

import json
import pickle

import pytest

from src.models.course import load_curriculum
from src.models.semester import get_mandatory_seasons, term_season
from src.simulator import Simulator, SnapshotVersionError
from src.utils import load_json


def _fixture():
    config = load_json("data/simulation_config.json")
    curriculum = load_curriculum("data/curriculum.json")
    scenario = config["scenarios"][0]
    return curriculum, config, scenario


def _fingerprint(result) -> str:
    """A single comparable string covering everything a checkpoint session must reproduce
    byte-for-byte: the full per-term timeline (the frontend contract) plus every block-count
    signal and the graduation-times list."""
    history = result.history
    payload = {
        "timeline": history.timeline,
        "fail_counts": dict(history.fail_counts),
        "capacity_block_counts": dict(history.capacity_block_counts),
        "offering_block_counts": dict(history.offering_block_counts),
        "prereq_block_counts": dict(history.prereq_block_counts),
        "graduation_times": sorted(history.graduation_times),
    }
    return json.dumps(payload, sort_keys=True, default=str)


def test_partial_steps_then_run_matches_straight_run():
    """Calling step_one_mandatory_term() a few times, then run() to finish the rest, must equal
    calling run() with no manual stepping at all — the new step loop and the old single-shot
    for-loop must visit identical terms in identical order."""
    curriculum, config, scenario = _fixture()
    straight = Simulator(curriculum, config, scenario).run()

    sim = Simulator(curriculum, config, scenario)
    for _ in range(3):
        if sim.is_finished:
            break
        sim.step_one_mandatory_term()
    stepped_then_run = sim.run()

    assert _fingerprint(straight) == _fingerprint(stepped_then_run)


def test_snapshot_restore_round_trip_matches_straight_run():
    """The actual point of Phase 3: pausing partway through, serializing, and resuming in a
    brand-new Simulator instance (as a checkpoint session does across separate HTTP requests)
    must produce the exact same final result as never pausing at all."""
    curriculum, config, scenario = _fixture()
    straight = Simulator(curriculum, config, scenario).run()

    sim = Simulator(curriculum, config, scenario)
    for _ in range(3):
        if sim.is_finished:
            break
        sim.step_one_mandatory_term()
    blob = sim.snapshot()

    resumed_sim = Simulator.from_snapshot(curriculum, config, scenario, blob)
    resumed_result = resumed_sim.run()  # finishes remaining steps + the CENSORED safety net

    assert _fingerprint(straight) == _fingerprint(resumed_result)


def test_step_one_mandatory_term_advances_exactly_one_mandatory_term():
    curriculum, config, scenario = _fixture()
    sim = Simulator(curriculum, config, scenario)
    term_before = sim._next_term
    sim.step_one_mandatory_term()
    assert sim._next_term > term_before
    assert len(sim.history.timeline) >= 1
    # Whatever run of terms this step swept (possibly an optional term or two), the LAST one
    # processed must be mandatory — that's what ends a step.
    last_term_run = sim._next_term - 1
    assert term_season(last_term_run, sim.config) in get_mandatory_seasons(sim.config)


def test_is_finished_reflects_horizon():
    curriculum, config, scenario = _fixture()
    sim = Simulator(curriculum, config, scenario)
    assert not sim.is_finished
    while not sim.is_finished:
        sim.step_one_mandatory_term()
    assert sim.is_finished
    # Calling again past the end is a safe no-op, not an error.
    sim.step_one_mandatory_term()
    assert sim.is_finished


def test_snapshot_rejects_version_mismatch():
    curriculum, config, scenario = _fixture()
    sim = Simulator(curriculum, config, scenario)
    sim.step_one_mandatory_term()
    blob = sim.snapshot()

    version, students, history, cohort_entry, next_term = pickle.loads(blob)
    tampered = pickle.dumps((version + 1, students, history, cohort_entry, next_term))

    with pytest.raises(SnapshotVersionError):
        Simulator.from_snapshot(curriculum, config, scenario, tampered)
