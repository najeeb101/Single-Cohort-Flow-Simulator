from __future__ import annotations

import math
from collections import defaultdict
from dataclasses import dataclass, field

from src.models.course import Course
from src.models.semester import term_season
from src.models.student import Student, registration_tier
from src.utils import grade_tier


# ------------------------------------------------------------------ #
# History: accumulated statistics across all terms                   #
# ------------------------------------------------------------------ #

@dataclass
class History:
    snapshots: list[dict] = field(default_factory=list)
    fail_counts: dict[str, int] = field(default_factory=lambda: defaultdict(int))
    offering_block_counts: dict[str, int] = field(default_factory=lambda: defaultdict(int))
    capacity_block_counts: dict[str, int] = field(default_factory=lambda: defaultdict(int))
    prereq_block_counts: dict[str, int] = field(default_factory=lambda: defaultdict(int))
    graduation_times: list[int] = field(default_factory=list)  # 1-based term number

    def record_snapshot(self, term_num: int, students: list[Student]) -> None:
        bands: dict[str, int] = {"0-29": 0, "30-59": 0, "60-89": 0, "90-119": 0}
        for s in students:
            if s.status in ("ACTIVE", "DELAYED"):
                ch = s.completed_ch
                if ch < 30:
                    bands["0-29"] += 1
                elif ch < 60:
                    bands["30-59"] += 1
                elif ch < 90:
                    bands["60-89"] += 1
                else:
                    bands["90-119"] += 1
        self.snapshots.append({
            "term": term_num,
            "active":    sum(1 for s in students if s.status == "ACTIVE"),
            "delayed":   sum(1 for s in students if s.status == "DELAYED"),
            "graduated": sum(1 for s in students if s.status == "GRADUATED"),
            "dropped":   sum(1 for s in students if s.status == "DROPPED"),
            "censored":  sum(1 for s in students if s.status == "CENSORED"),
            "ch_bands":  bands,
        })


# ------------------------------------------------------------------ #
# SimulationResult                                                    #
# ------------------------------------------------------------------ #

@dataclass
class SimulationResult:
    history: History
    students: list[Student]
    scenario: dict
    config: dict
    metrics: dict = field(default_factory=dict)


# ------------------------------------------------------------------ #
# Simulator                                                           #
# ------------------------------------------------------------------ #

class Simulator:
    def __init__(
        self,
        curriculum: dict[str, Course],
        config: dict,
        scenario: dict,
    ) -> None:
        self.curriculum = curriculum
        self.config = config
        self.scenario = scenario
        self.seed: int = config["seed"]
        self.students: list[Student] = []
        self.history = History()

    def run(self) -> SimulationResult:
        self._make_students()
        max_terms: int = self.config["max_terms"]

        for term_idx in range(max_terms):
            season = term_season(term_idx)
            self._run_term(term_idx, season)

        # Students still enrolled at the horizon are censored — they ran out of
        # time, not academic will. Distinct from DROPPED (academic 3-fails trigger).
        for student in self.students:
            if student.is_active():
                student.status = "CENSORED"

        return SimulationResult(
            history=self.history,
            students=self.students,
            scenario=self.scenario,
            config=self.config,
        )

    # ------------------------------------------------------------------ #
    # Student creation                                                    #
    # ------------------------------------------------------------------ #

    def _make_students(self) -> None:
        self.students = [
            Student(i, self.seed)
            for i in range(self.config["cohort_size"])
        ]

    # ------------------------------------------------------------------ #
    # Per-term loop                                                       #
    # ------------------------------------------------------------------ #

    def _run_term(self, term_idx: int, season: str) -> None:
        available = [c for c in self.curriculum.values() if season in c.offering]
        active = [s for s in self.students if s.is_active()]

        # ── Phase 1: Each student builds a desired-enrollment list ── #
        desired: dict[str, list[Student]] = defaultdict(list)
        for student in active:
            for course in student.get_desired_courses(available, self.curriculum, self.config):
                desired[course.code].append(student)

        # ── Phase 2: Seat allocation ─────────────────────────────── #
        granted: dict[int, list[Course]] = defaultdict(list)

        for code, requesters in desired.items():
            course = self.curriculum[code]
            cap = self._effective_capacity(course)

            if len(requesters) <= cap:
                for s in requesters:
                    granted[s.student_id].append(course)
            else:
                sorted_req = sorted(
                    requesters,
                    key=lambda s: (registration_tier(s.completed_ch), s.tiebreak_token),
                )
                for s in sorted_req[:cap]:
                    granted[s.student_id].append(course)
                for s in sorted_req[cap:]:
                    self.history.capacity_block_counts[code] += 1

        # ── Phase 3: Take courses ─────────────────────────────────── #
        for student in active:
            for course in granted[student.student_id]:
                grade = self._resolve_grade(student, course)
                student.record_grade(course, grade)
                if grade == "F":
                    self.history.fail_counts[course.code] += 1

        # ── Academic dropout checks (3-fails rule) ────────────────── #
        threshold = self.config["dropout_fails_threshold"]
        drop_prob = self.config["dropout_prob_on_repeated_fail"]
        for student in active:
            if not student.is_active():
                continue
            for code, attempts in student.failed_attempts.items():
                if attempts >= threshold:
                    if student.rng.random() < drop_prob:
                        student.status = "DROPPED"  # academic dropout
                        break

        # ── Graduation & delayed checks ───────────────────────────── #
        for student in self.students:
            if student.status in ("DROPPED", "GRADUATED", "CENSORED"):
                continue
            if self._has_graduated(student):
                student.status = "GRADUATED"
                self.history.graduation_times.append(term_idx + 1)
            elif term_idx + 1 > 8:
                student.status = "DELAYED"

        # ── Record blocking signals for this term ─────────────────── #
        self._record_blocks(season, [s for s in self.students if s.is_active()])

        # ── Snapshot ─────────────────────────────────────────────── #
        self.history.record_snapshot(term_idx + 1, self.students)

    # ------------------------------------------------------------------ #
    # Helpers                                                             #
    # ------------------------------------------------------------------ #

    def _has_graduated(self, student: Student) -> bool:
        return all(student.has_passed(code) for code in self.curriculum)

    def _effective_capacity(self, course: Course) -> int:
        multiplier = float(self.scenario.get("capacity_multiplier", 1.0))
        overrides: dict[str, float] = self.scenario.get("capacity_overrides", {})
        if course.code in overrides:
            multiplier = float(overrides[course.code])
        return max(1, math.floor(course.capacity * multiplier))

    def _resolve_grade(self, student: Student, course: Course) -> str:
        overrides: dict[str, float] = self.scenario.get("pass_rate_overrides", {})
        effective = student.effective_pass_rate(course, overrides)

        if student.rng.random() < effective:
            tier = grade_tier(course.pass_rate, self.config)
            tier_dist = self.config["grade_tiers"][tier]
            grades = list(tier_dist.keys())
            weights = list(tier_dist.values())
            return student.rng.choices(grades, weights=weights)[0]
        return "F"

    def _record_blocks(self, season: str, active_students: list[Student]) -> None:
        for student in active_students:
            for code, course in self.curriculum.items():
                if student.has_passed(code):
                    continue
                if course.is_senior_project:
                    prereqs_met = student.can_register_senior_project(self.curriculum)
                else:
                    prereqs_met = student.prerequisites_met(course, self.curriculum)

                if prereqs_met:
                    if season not in course.offering:
                        self.history.offering_block_counts[code] += 1
                else:
                    self.history.prereq_block_counts[code] += 1
