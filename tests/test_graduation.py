"""Tests for graduation detection."""
from __future__ import annotations

import pytest

from src.models.course import load_curriculum
from src.models.student import Student, PASSING_GRADES
from src.simulator import Simulator
from src.utils import load_json

SEED = 42


def test_student_graduates_after_passing_all_courses():
    """A student who passes every course in the curriculum must reach GRADUATED."""
    config     = load_json("data/simulation_config.json")
    curriculum = load_curriculum("data/curriculum.json")

    sim = Simulator(curriculum, config, config["scenarios"][0])
    sim._make_students()

    student = sim.students[0]
    for code, course in curriculum.items():
        student.completed_courses[code] = "B"
        student._gpa_numerator   += 3.0 * course.credits
        student._gpa_denominator += course.credits
        student.completed_ch     += course.credits
    student.gpa = student._gpa_numerator / student._gpa_denominator

    assert sim._has_graduated(student)


def test_student_not_graduated_with_one_missing():
    """Missing even one course must prevent graduation."""
    config     = load_json("data/simulation_config.json")
    curriculum = load_curriculum("data/curriculum.json")

    sim = Simulator(curriculum, config, config["scenarios"][0])
    sim._make_students()
    student = sim.students[0]

    codes = list(curriculum.keys())
    for code in codes[:-1]:
        course = curriculum[code]
        student.completed_courses[code] = "B"
        student.completed_ch += course.credits

    assert not sim._has_graduated(student)


def test_graduation_time_recorded_in_history():
    """Running the full simulation must record at least one graduation time."""
    config     = load_json("data/simulation_config.json")
    curriculum = load_curriculum("data/curriculum.json")

    sim    = Simulator(curriculum, config, config["scenarios"][0])
    result = sim.run()

    assert len(result.history.graduation_times) > 0
    assert all(1 <= t <= config["max_terms"] for t in result.history.graduation_times)


def test_graduated_students_have_all_courses_passed():
    """Every student marked GRADUATED must have passed all courses."""
    config     = load_json("data/simulation_config.json")
    curriculum = load_curriculum("data/curriculum.json")

    sim    = Simulator(curriculum, config, config["scenarios"][0])
    result = sim.run()

    for student in result.students:
        if student.status == "GRADUATED":
            for code in curriculum:
                assert student.has_passed(code), (
                    f"Student {student.student_id} is GRADUATED but hasn't passed {code}"
                )


def test_completed_ch_equals_120_at_graduation():
    """Graduated students must accumulate exactly 120 credit hours."""
    config     = load_json("data/simulation_config.json")
    curriculum = load_curriculum("data/curriculum.json")

    total_ch = sum(c.credits for c in curriculum.values())
    assert total_ch == 120, f"Curriculum sums to {total_ch} CH, expected 120"

    sim    = Simulator(curriculum, config, config["scenarios"][0])
    result = sim.run()

    for student in result.students:
        if student.status == "GRADUATED":
            assert student.completed_ch == 120, (
                f"Student {student.student_id} graduated with {student.completed_ch} CH"
            )


def test_no_student_is_still_active_after_simulation():
    """After run() completes, every student must be in a terminal status."""
    config     = load_json("data/simulation_config.json")
    curriculum = load_curriculum("data/curriculum.json")

    sim    = Simulator(curriculum, config, config["scenarios"][0])
    result = sim.run()

    terminal = {"GRADUATED", "DROPPED", "CENSORED"}
    for student in result.students:
        assert student.status in terminal, (
            f"Student {student.student_id} still has status {student.status!r}"
        )
