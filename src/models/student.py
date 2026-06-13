from __future__ import annotations

import random
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from src.models.course import Course

GRADE_POINTS: dict[str, float] = {
    "A": 4.0, "B+": 3.3, "B": 3.0,
    "C+": 2.3, "C": 2.0, "D": 1.0, "F": 0.0,
}
PASSING_GRADES = frozenset({"A", "B+", "B", "C+", "C", "D"})

_REQUIRED_CATEGORIES = frozenset({"cs_core", "college_req"})
_NON_CS_CATEGORIES = frozenset({"math", "science", "english", "gen_ed"})


def registration_tier(completed_ch: int) -> int:
    if completed_ch >= 90:
        return 0
    if completed_ch >= 75:
        return 1
    if completed_ch >= 60:
        return 2
    if completed_ch >= 45:
        return 3
    if completed_ch >= 30:
        return 4
    return 5


class Student:
    def __init__(self, student_id: int, seed: int) -> None:
        self.student_id = student_id
        self._seed = seed
        # Stable tiebreak for seat allocation — never consumes the course RNG stream
        self.tiebreak_token: int = hash((seed, student_id)) & 0xFFFF_FFFF
        self._reset_rng_and_state()

    # ------------------------------------------------------------------ #
    # Initialisation / scenario reset                                     #
    # ------------------------------------------------------------------ #

    def _reset_rng_and_state(self) -> None:
        self.rng = random.Random(self._seed + self.student_id)
        raw = self.rng.gauss(0.0, 0.15)
        self.ability_score: float = max(-0.30, min(0.30, raw))

        self.completed_courses: dict[str, str] = {}
        self.failed_attempts: dict[str, int] = {}
        self.gpa: float = 0.0
        self.completed_ch: int = 0
        self._gpa_numerator: float = 0.0
        self._gpa_denominator: int = 0
        self.status: str = "ACTIVE"
        self.on_probation: bool = False
        self.ever_probation: bool = False

    def reset(self, seed: int) -> None:
        """Re-instantiate RNG and wipe state for a new scenario (CRN)."""
        self._seed = seed
        self._reset_rng_and_state()

    # ------------------------------------------------------------------ #
    # Accessors                                                           #
    # ------------------------------------------------------------------ #

    def is_active(self) -> bool:
        return self.status in ("ACTIVE", "DELAYED")

    def has_passed(self, code: str) -> bool:
        return code in self.completed_courses and self.completed_courses[code] in PASSING_GRADES

    # ------------------------------------------------------------------ #
    # Pass-rate & eligibility                                             #
    # ------------------------------------------------------------------ #

    def effective_pass_rate(self, course: Course, pass_rate_overrides: dict[str, float]) -> float:
        base = pass_rate_overrides.get(course.code, course.pass_rate)
        return max(0.05, min(0.98, base + self.ability_score))

    def prerequisites_met(self, course: Course, curriculum: dict[str, Course]) -> bool:
        return all(self.has_passed(p) for p in course.prerequisites)

    def can_register_senior_project(self, curriculum: dict[str, Course]) -> bool:
        for course in curriculum.values():
            if not course.is_senior_project:
                continue
            rule = course.senior_project_rule
            if rule is None:
                return False
            all_req = all(self.has_passed(c) for c in rule.required)
            one_of  = any(self.has_passed(c) for c in rule.one_of)
            ch_ok   = self.completed_ch >= rule.min_credits
            return all_req and one_of and ch_ok
        return False

    def get_load_cap(self, config: dict) -> int:
        return config["probation_load_ch"] if self.on_probation else config["normal_load_ch"]

    # ------------------------------------------------------------------ #
    # Desired-course selection (Phase 1 of per-term loop)                #
    # ------------------------------------------------------------------ #

    def get_desired_courses(
        self,
        available_courses: list[Course],
        curriculum: dict[str, Course],
        config: dict,
    ) -> list[Course]:
        load_cap = self.get_load_cap(config)

        def can_enroll(c: Course) -> bool:
            if self.has_passed(c.code):
                return False
            if c.is_senior_project:
                return self.can_register_senior_project(curriculum)
            return self.prerequisites_met(c, curriculum)

        eligible = sorted(
            [c for c in available_courses if can_enroll(c)],
            key=lambda c: c.study_plan_order,
        )

        retakes: list[Course] = []
        new_required: list[Course] = []
        electives: list[Course] = []
        non_cs: list[Course] = []
        retake_codes: set[str] = set()

        for c in eligible:
            if self.failed_attempts.get(c.code, 0) > 0:
                retakes.append(c)
                retake_codes.add(c.code)

        for c in eligible:
            if c.code in retake_codes:
                continue
            if c.category in _REQUIRED_CATEGORIES:
                new_required.append(c)
            elif c.category == "cs_elective" and self.completed_ch >= 60:
                electives.append(c)
            elif c.category in _NON_CS_CATEGORIES:
                non_cs.append(c)

        selected: list[Course] = []
        total_ch = 0
        for course in retakes + new_required + electives + non_cs:
            if total_ch + course.credits <= load_cap:
                selected.append(course)
                total_ch += course.credits
        return selected

    # ------------------------------------------------------------------ #
    # Grade recording                                                     #
    # ------------------------------------------------------------------ #

    def record_grade(self, course: Course, grade: str) -> None:
        # Grade replacement: passing a retake removes all prior F attempts from the denominator.
        # F = 0.0 pts so numerator was already unaffected by those fails.
        if grade in PASSING_GRADES:
            prior_fails = self.failed_attempts.get(course.code, 0)
            if prior_fails > 0:
                self._gpa_denominator -= course.credits * prior_fails

        self._gpa_numerator  += GRADE_POINTS[grade] * course.credits
        self._gpa_denominator += course.credits

        if grade in PASSING_GRADES:
            self.completed_courses[course.code] = grade
            self.completed_ch += course.credits
        else:
            self.failed_attempts[course.code] = self.failed_attempts.get(course.code, 0) + 1

        if self._gpa_denominator > 0:
            self.gpa = self._gpa_numerator / self._gpa_denominator

        if self.completed_ch >= 25 and self.gpa < 2.0:
            self.on_probation = True
            self.ever_probation = True
        elif self.gpa >= 2.0:
            self.on_probation = False
