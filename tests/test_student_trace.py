"""Tests for the per-student trace feature: the opt-in record_traces capture in the
Simulator (block_events + student_term_states) and the analytics extraction functions
(find_students_matching / compute_student_trace) that surface one synthetic student's
term-by-term journey.
"""
from __future__ import annotations

from src.analytics import compute_student_trace, find_students_matching
from src.models.course import load_curriculum
from src.simulator import Simulator
from src.utils import load_json


def _setup():
    config = dict(load_json("data/simulation_config.json"))
    # Keep the population small so the trace-recording run stays fast in CI.
    config["cohort_size"] = 15
    config["num_cohorts"] = 2
    curriculum = load_curriculum("data/curriculum.json")
    return config, curriculum


def _run(record_traces: bool):
    config, curriculum = _setup()
    result = Simulator(
        curriculum, config, config["scenarios"][0], record_traces=record_traces
    ).run()
    return result, curriculum


# ------------------------------------------------------------------ #
# Opt-in capture: off by default, populated only when requested       #
# ------------------------------------------------------------------ #

def test_traces_off_by_default_records_nothing():
    result, _ = _run(record_traces=False)
    assert result.history.block_events == []
    assert result.history.student_term_states == []


def test_traces_on_populates_both_logs():
    result, _ = _run(record_traces=True)
    assert result.history.block_events, "expected block events with record_traces=True"
    assert result.history.student_term_states, "expected per-term state snapshots"


def test_block_event_signals_are_valid():
    result, _ = _run(record_traces=True)
    assert {e.signal for e in result.history.block_events} <= {"capacity", "offering", "prereq"}


def test_opt_in_does_not_change_outcomes():
    """record_traces must be side-effect-free on the simulation itself (CRN preserved)."""
    off, _ = _run(record_traces=False)
    on, _ = _run(record_traces=True)
    off_outcomes = {o.student_id: o.exit_reason for o in off.history.outcomes}
    on_outcomes = {o.student_id: o.exit_reason for o in on.history.outcomes}
    assert off_outcomes == on_outcomes


# ------------------------------------------------------------------ #
# compute_student_trace                                               #
# ------------------------------------------------------------------ #

def test_unknown_student_returns_none():
    result, curriculum = _run(record_traces=True)
    assert compute_student_trace(result, curriculum, student_id=10_000_000) is None


def test_trace_shape_and_ordering():
    result, curriculum = _run(record_traces=True)
    sid = result.students[0].student_id
    trace = compute_student_trace(result, curriculum, sid)

    assert trace is not None
    assert set(trace) >= {
        "student_id", "cohort_id", "entry_term", "final_status", "final_reason",
        "grad_semester", "gpa", "completed_ch", "total_program_ch", "terms",
    }
    terms = [t["term"] for t in trace["terms"]]
    assert terms == sorted(terms)  # chronological
    assert trace["terms"], "an active student should have at least one term"


def test_trace_final_status_matches_student():
    result, curriculum = _run(record_traces=True)
    by_id = {s.student_id: s for s in result.students}
    for s in result.students[:5]:
        trace = compute_student_trace(result, curriculum, s.student_id)
        assert trace["final_status"] == by_id[s.student_id].status


def test_graduated_student_last_term_reflects_graduation():
    result, curriculum = _run(record_traces=True)
    grad = next((s for s in result.students if s.status == "GRADUATED"), None)
    if grad is None:
        return  # nobody graduated in this small run; nothing to assert
    trace = compute_student_trace(result, curriculum, grad.student_id)
    assert trace["grad_semester"] is not None
    assert trace["terms"][-1]["status"] == "GRADUATED"


def test_trace_courses_match_transcript():
    result, curriculum = _run(record_traces=True)
    sid = result.students[0].student_id
    trace = compute_student_trace(result, curriculum, sid)

    traced = {(t["term"], c["code"]) for t in trace["terms"] for c in t["courses"]}
    transcript = {(r.term, r.course_code) for r in result.history.transcript if r.student_id == sid}
    assert traced == transcript


def test_blocked_lists_degrade_when_traces_off():
    """Without record_traces, blocked lists are empty but the trace still assembles."""
    result, curriculum = _run(record_traces=False)
    sid = result.students[0].student_id
    trace = compute_student_trace(result, curriculum, sid)
    assert all(t["blocked"] == [] for t in trace["terms"])


# ------------------------------------------------------------------ #
# find_students_matching                                             #
# ------------------------------------------------------------------ #

def test_search_scoped_to_study_cohorts_and_capped():
    result, _ = _run(record_traces=False)
    out = find_students_matching(result, limit=3)
    assert len(out["candidates"]) <= 3
    assert out["total_matched"] >= len(out["candidates"])
    # study cohorts have non-negative ids
    assert all(c["cohort_id"] >= 0 for c in out["candidates"])


def test_search_filters_by_status():
    result, _ = _run(record_traces=False)
    out = find_students_matching(result, final_status="graduated", limit=50)
    assert all(c["final_status"] == "GRADUATED" for c in out["candidates"])


def test_search_filters_by_cohort_and_probation():
    result, _ = _run(record_traces=False)
    out = find_students_matching(result, cohort_id=0, ever_probation=True, limit=50)
    assert all(c["cohort_id"] == 0 and c["ever_probation"] is True for c in out["candidates"])
