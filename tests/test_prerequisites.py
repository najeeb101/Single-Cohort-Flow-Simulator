"""Tests for prerequisite gating, including the CMPS493 compound rule."""
from __future__ import annotations

import pytest

from src.models.course import Course, load_curriculum
from src.models.student import Student

SEED = 42


def _make_student(passed: dict[str, str] | None = None, completed_ch: int = 0) -> Student:
    s = Student(0, SEED)
    if passed:
        for code, grade in passed.items():
            s.completed_courses[code] = grade
            s.completed_ch += 4  # approximate
    s.completed_ch = completed_ch
    return s


def _minimal_curriculum() -> dict[str, Course]:
    return load_curriculum("data/curriculum.json")


# ─── Generic prerequisite gating ─────────────────────────────────────────── #

def test_no_prereqs_always_eligible():
    curric = _minimal_curriculum()
    s = _make_student()
    assert s.prerequisites_met(curric["CMPS151"], curric)
    assert s.prerequisites_met(curric["MATH_1"], curric)


def test_prereq_blocks_when_not_passed():
    curric = _minimal_curriculum()
    s = _make_student()
    assert not s.prerequisites_met(curric["CMPS251"], curric)  # needs CMPS151
    assert not s.prerequisites_met(curric["CMPS303"], curric)  # needs CMPS251


def test_prereq_satisfied_after_passing():
    curric = _minimal_curriculum()
    s = _make_student(passed={"CMPS151": "B"})
    assert s.prerequisites_met(curric["CMPS251"], curric)


def test_multi_prereq_requires_all():
    curric = _minimal_curriculum()
    # CMPS323 needs CMPS303 AND CMPS205
    s_partial = _make_student(passed={"CMPS303": "C"})
    assert not s_partial.prerequisites_met(curric["CMPS323"], curric)

    s_both = _make_student(passed={"CMPS303": "C", "CMPS205": "B"})
    assert s_both.prerequisites_met(curric["CMPS323"], curric)


def test_d_grade_satisfies_prereq():
    curric = _minimal_curriculum()
    s = _make_student(passed={"CMPS151": "D"})
    assert s.prerequisites_met(curric["CMPS251"], curric)


# ─── CMPS493 compound rule ────────────────────────────────────────────────── #

def test_senior_project_blocked_with_nothing():
    curric = _minimal_curriculum()
    s = _make_student()
    assert not s.is_eligible_for(curric["CMPS493"], curric)


def test_senior_project_blocked_without_cmps310():
    curric = _minimal_curriculum()
    s = _make_student(
        passed={"CMPS350": "B", "CMPS405": "B"},
        completed_ch=90,
    )
    assert not s.is_eligible_for(curric["CMPS493"], curric)


def test_senior_project_blocked_without_one_of():
    curric = _minimal_curriculum()
    s = _make_student(
        passed={"CMPS310": "B"},
        completed_ch=90,
    )
    assert not s.is_eligible_for(curric["CMPS493"], curric)


def test_senior_project_blocked_below_min_credits():
    curric = _minimal_curriculum()
    s = _make_student(
        passed={"CMPS310": "B", "CMPS350": "A"},
        completed_ch=83,
    )
    assert not s.is_eligible_for(curric["CMPS493"], curric)


def test_senior_project_eligible_cmps350_path():
    curric = _minimal_curriculum()
    s = _make_student(
        passed={"CMPS310": "B", "CMPS350": "A"},
        completed_ch=84,
    )
    assert s.is_eligible_for(curric["CMPS493"], curric)


def test_senior_project_eligible_cmps405_path():
    curric = _minimal_curriculum()
    s = _make_student(
        passed={"CMPS310": "B", "CMPS405": "C"},
        completed_ch=84,
    )
    assert s.is_eligible_for(curric["CMPS493"], curric)


def test_senior_project_eligible_both_one_of():
    curric = _minimal_curriculum()
    s = _make_student(
        passed={"CMPS310": "A", "CMPS350": "B", "CMPS405": "B"},
        completed_ch=90,
    )
    assert s.is_eligible_for(curric["CMPS493"], curric)
