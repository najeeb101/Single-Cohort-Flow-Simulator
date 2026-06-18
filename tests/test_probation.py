"""Tests for academic probation trigger and load-cap enforcement."""
from __future__ import annotations

import pytest

from src.models.course import Course, load_curriculum
from src.models.student import Student

SEED = 42

CONFIG = {
    "normal_load_ch": 18,
    "probation_load_ch": 12,
    "probation_gpa_threshold": 2.0,
    "probation_min_ch": 25,
}


def _make_student() -> Student:
    return Student(0, SEED)


def _fake_course(code: str, credits: int, pass_rate: float = 0.80) -> Course:
    return Course(
        code=code, title=code, credits=credits,
        prerequisites=(), pass_rate=pass_rate,
        offering=("Fall", "Spring"), category="cs_core",
        capacity=100,
    )


# ─── Probation trigger ───────────────────────────────────────────────────── #

def test_probation_not_triggered_below_threshold_ch():
    """Probation must not fire until completed_ch >= 25."""
    s = _make_student()
    # Record 24 CH worth of D grades (1.0 pts each) -> GPA = 1.0 but < 25 CH
    for i in range(6):
        c = _fake_course(f"FAKE{i}", 4)
        s.record_grade(c, "D")  # 6 × 4 = 24 CH
    assert s.completed_ch == 24
    assert s.gpa < 2.0
    assert not s.on_probation


def test_probation_triggered_at_threshold():
    """At 25+ CH with GPA < 2.0, probation is active."""
    s = _make_student()
    # 7 × 4 CH = 28 CH, all D grades (1.0 GPA)
    for i in range(7):
        c = _fake_course(f"FAKE{i}", 4)
        s.record_grade(c, "D")
    assert s.completed_ch >= 25
    assert s.gpa < 2.0
    assert s.on_probation
    assert s.ever_probation


def test_probation_reduces_load_cap():
    s = _make_student()
    for i in range(7):
        c = _fake_course(f"FAKE{i}", 4)
        s.record_grade(c, "D")
    assert s.on_probation
    assert s.get_load_cap(CONFIG) == CONFIG["probation_load_ch"]


def test_normal_load_when_not_on_probation():
    s = _make_student()
    assert not s.on_probation
    assert s.get_load_cap(CONFIG) == CONFIG["normal_load_ch"]


def test_probation_clears_when_gpa_recovers():
    """After enough A grades, GPA recovers and probation clears."""
    s = _make_student()
    # Put student on probation
    for i in range(7):
        c = _fake_course(f"FAKE{i}", 4)
        s.record_grade(c, "D")
    assert s.on_probation

    # Now give several A grades to lift GPA above 2.0
    for i in range(20):
        c = _fake_course(f"GOOD{i}", 4)
        s.record_grade(c, "A")

    assert s.gpa >= 2.0
    assert not s.on_probation


def test_ever_probation_persists_after_recovery():
    """ever_probation stays True even after GPA recovers."""
    s = _make_student()
    for i in range(7):
        c = _fake_course(f"FAKE{i}", 4)
        s.record_grade(c, "D")
    assert s.ever_probation

    for i in range(20):
        c = _fake_course(f"GOOD{i}", 4)
        s.record_grade(c, "A")

    assert not s.on_probation
    assert s.ever_probation  # must remain True


# ─── GPA calculation ─────────────────────────────────────────────────────── #

def test_gpa_includes_failed_courses_in_denominator():
    """Standard GPA: F = 0 pts contributes to denominator, diluting GPA."""
    s = _make_student()
    s.record_grade(_fake_course("PASS", 3), "A")   # 4.0 × 3 = 12 pts, 3 CH attempted
    s.record_grade(_fake_course("FAIL", 3), "F")   # 0.0 × 3 = 0 pts,  3 CH attempted
    # GPA = 12 / 6 = 2.0
    assert s.gpa == pytest.approx(2.0, rel=1e-6)
    assert s.completed_ch == 3  # only passed credits
