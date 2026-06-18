"""Tests for the canonical historical-record schema (ACIP plan §2.4 replay/fit groundwork):
History.transcript / History.outcomes recorded by the simulator, and
analytics.compute_historical_transcripts() which extracts them into the canonical
StudentRecord / EnrollmentRecord / OutcomeRecord shape.
"""
from __future__ import annotations

from src.analytics import compute_historical_transcripts, compute_metrics
from src.models.course import load_curriculum
from src.simulator import Simulator
from src.utils import load_json


def _setup():
    config = load_json("data/simulation_config.json")
    curriculum = load_curriculum("data/curriculum.json")
    return config, curriculum


def _run():
    config, curriculum = _setup()
    result = Simulator(curriculum, config, config["scenarios"][0]).run()
    result.metrics = compute_metrics(result)
    return result


def test_every_student_has_exactly_one_outcome():
    result = _run()
    outcome_ids = [r.student_id for r in result.history.outcomes]
    assert len(outcome_ids) == len(result.students)
    assert len(set(outcome_ids)) == len(outcome_ids)  # no duplicates


def test_outcome_matches_final_status():
    result = _run()
    by_id = {s.student_id: s for s in result.students}
    reason_for_status = {"GRADUATED": "graduated", "DROPPED": "dropped", "CENSORED": "censored"}

    for record in result.history.outcomes:
        student = by_id[record.student_id]
        assert record.exit_reason == reason_for_status[student.status]
        if student.status == "GRADUATED":
            assert record.graduation_term is not None
        else:
            assert record.graduation_term is None


def test_enrollment_attempt_no_increments_on_retake():
    result = _run()
    by_student_course: dict[tuple[int, str], list[int]] = {}
    for r in result.history.transcript:
        by_student_course.setdefault((r.student_id, r.course_code), []).append(r.attempt_no)

    for attempts in by_student_course.values():
        assert attempts == sorted(attempts)
        assert attempts == list(range(1, len(attempts) + 1))


def test_enrollment_credits_match_curriculum():
    result = _run()
    _, curriculum = _setup()
    for r in result.history.transcript:
        assert r.credits == curriculum[r.course_code].credits


def test_compute_historical_transcripts_defaults_to_incumbents_only():
    result = _run()
    incumbent_ids = {s.student_id for s in result.students if s.entry_term < 0}

    transcripts = compute_historical_transcripts(result)

    assert transcripts["students"]
    assert all(row["student_id"] in incumbent_ids for row in transcripts["students"])
    assert all(row["student_id"] in incumbent_ids for row in transcripts["enrollments"])
    assert all(row["student_id"] in incumbent_ids for row in transcripts["outcomes"])
    assert len(transcripts["outcomes"]) == len(incumbent_ids)


def test_compute_historical_transcripts_can_include_everyone():
    result = _run()

    transcripts = compute_historical_transcripts(result, incumbents_only=False)

    assert len(transcripts["students"]) == len(result.students)
    assert len(transcripts["outcomes"]) == len(result.students)


def test_student_record_shape():
    result = _run()
    transcripts = compute_historical_transcripts(result)
    row = transcripts["students"][0]
    assert set(row) == {"student_id", "program_id", "admission_term", "status"}
