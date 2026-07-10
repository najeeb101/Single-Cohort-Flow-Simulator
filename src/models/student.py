from __future__ import annotations

import random
from typing import TYPE_CHECKING

from src.rules import evaluate_rule

if TYPE_CHECKING:
    from src.models.course import Course

GRADE_POINTS: dict[str, float] = {
    "A": 4.0, "B+": 3.3, "B": 3.0,
    "C+": 2.3, "C": 2.0, "D": 1.0, "F": 0.0,
}
PASSING_GRADES = frozenset({"A", "B+", "B", "C+", "C", "D"})


# Fallback for callers that don't pass a config (e.g. tests exercising the function in
# isolation) — QU's actual bands, mirrored from registration_tier_thresholds below.
DEFAULT_REGISTRATION_TIER_THRESHOLDS: tuple[int, ...] = (90, 75, 60, 45, 30)

# Ascending completed-CH cutoffs for Year1->Year2->Year3->Year4 standing, mirrored from
# year_standing_thresholds below — QU's actual 4-year/120-CH bands (30 CH/year). Tenant-scoped
# data, not hardcoded to one program's length: a plan with a different total credit-hour count
# sets its own `year_standing_thresholds` in simulation_config.json.
DEFAULT_YEAR_STANDING_THRESHOLDS: tuple[int, ...] = (30, 60, 90)


def registration_tier(completed_ch: int, config: dict | None = None) -> int:
    """Seat-priority tier from completed credit hours — lower tier registers first.

    Thresholds are tenant-scoped data (`registration_tier_thresholds` in
    simulation_config.json), not hardcoded to one program's bands; see ACIP plan §2.1.
    """
    thresholds = (config or {}).get("registration_tier_thresholds", DEFAULT_REGISTRATION_TIER_THRESHOLDS)
    for tier, threshold in enumerate(thresholds):
        if completed_ch >= threshold:
            return tier
    return len(thresholds)


def curriculum_stage(student: "Student", config: dict | None = None) -> str:
    """Flow-chart node for a student: terminal status wins, else CH band.

    Band cutoffs are `year_standing_thresholds` (3 ascending CH values -> Year1..Year4),
    defaulting to QU's 30/60/90 bands so every existing caller/config is unaffected.
    """
    if student.status == "GRADUATED":
        return "Graduated"
    if student.status == "DROPPED":
        return "Dropped"
    if student.status == "CENSORED":
        return "Censored"
    thresholds = (config or {}).get("year_standing_thresholds", DEFAULT_YEAR_STANDING_THRESHOLDS)
    ch = student.completed_ch
    for i, threshold in enumerate(thresholds):
        if ch < threshold:
            return f"Year{i + 1}"
    return f"Year{len(thresholds) + 1}"


# The three terminal flow-chart nodes, in the order the dashboard renders them. Kept separate
# from the year bands because they're reachable from any Year stage, not a single-file sequence.
TERMINAL_STAGES: tuple[str, ...] = ("Graduated", "Dropped", "Censored")


def stage_node_names(config: dict | None = None) -> list[str]:
    """The ordered flow-chart stage nodes for a plan: ``Admitted`` -> one ``Year`` band per
    ``year_standing_thresholds`` entry (+1) -> the three terminal statuses. A K-threshold plan
    (default K=3 -> 4 years) yields ``Year1..Year(K+1)``, so a program that isn't 4 years long
    gets stage nodes that actually match what ``curriculum_stage`` returns for its students —
    the list is derived from the same thresholds, never hardcoded to Year1..Year4.
    """
    thresholds = (config or {}).get("year_standing_thresholds", DEFAULT_YEAR_STANDING_THRESHOLDS)
    years = [f"Year{i}" for i in range(1, len(thresholds) + 2)]
    return ["Admitted", *years, *TERMINAL_STAGES]


def standing_levels(config: dict | None = None) -> list[str]:
    """Valid ``initial_state.standing`` keys for a plan: every year band above Year1
    (``Year2..Year(K+1)``). Year1 is the incoming simulated cohort, so the pre-existing
    warm-start student body is counted from Year2 up. Derived from the same
    ``year_standing_thresholds`` as ``stage_node_names``, so a non-4-year plan works.
    """
    thresholds = (config or {}).get("year_standing_thresholds", DEFAULT_YEAR_STANDING_THRESHOLDS)
    return [f"Year{i}" for i in range(2, len(thresholds) + 2)]


class Student:
    def __init__(
        self,
        student_id: int,
        seed: int,
        cohort_id: int = 0,
        entry_term: int = 0,
        ability_sd: float = 0.15,
        ability_clip: float = 0.30,
    ) -> None:
        self.student_id = student_id
        self._seed = seed
        self.cohort_id = cohort_id
        self.entry_term = entry_term
        self.ability_sd = ability_sd
        self.ability_clip = ability_clip
        # Previous flow-chart stage, used to derive term-over-term flows for the timeline.
        self.prev_stage: str | None = None
        # Stable tiebreak for seat allocation — never consumes the course RNG stream
        self.tiebreak_token: int = hash((seed, student_id)) & 0xFFFF_FFFF
        self._reset_rng_and_state()

    # ------------------------------------------------------------------ #
    # Initialisation / scenario reset                                     #
    # ------------------------------------------------------------------ #

    def _reset_rng_and_state(self) -> None:
        self.rng = random.Random(self._seed + self.student_id)
        raw = self.rng.gauss(0.0, self.ability_sd)
        self.ability_score: float = max(-self.ability_clip, min(self.ability_clip, raw))

        self.completed_courses: dict[str, str] = {}
        self.failed_attempts: dict[str, int] = {}
        self.gpa: float = 0.0
        self.completed_ch: int = 0
        self._gpa_numerator: float = 0.0
        self._gpa_denominator: int = 0
        self.status: str = "ACTIVE"
        self.on_probation: bool = False
        self.ever_probation: bool = False
        self.prev_stage = None
        self.grad_semester: int | None = None  # personal semester at graduation
        # Mandatory-terms-elapsed counter — incremented once per Fall/Spring (mandatory)
        # term by Simulator._run_term; optional terms (Summer/Winter) don't advance it. See
        # CLAUDE.md's "Term/Season Model" section.
        self.personal_semester: int = 0

    def reset(self, seed: int) -> None:
        """Re-instantiate RNG and wipe state for a new scenario (CRN)."""
        self._seed = seed
        self._reset_rng_and_state()

    # ------------------------------------------------------------------ #
    # Accessors                                                           #
    # ------------------------------------------------------------------ #

    def is_active(self) -> bool:
        return self.status in ("ACTIVE", "DELAYED")

    @property
    def is_incumbent(self) -> bool:
        return self.cohort_id < 0

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

    def is_eligible_for(self, course: Course, curriculum: dict[str, Course]) -> bool:
        """Eligibility for any course: a compound `rule_expr` if it has one, else plain prerequisites."""
        if course.rule_expr is not None:
            return evaluate_rule(course.rule_expr, self)
        return self.prerequisites_met(course, curriculum)

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
        priority_tiers = config["enrollment_priority_tiers"]

        def can_enroll(c: Course) -> bool:
            if self.has_passed(c.code):
                return False
            return self.is_eligible_for(c, curriculum)

        eligible = sorted(
            [c for c in available_courses if can_enroll(c)],
            key=lambda c: c.study_plan_order,
        )

        retakes: list[Course] = []
        retake_codes: set[str] = set()
        for c in eligible:
            if self.failed_attempts.get(c.code, 0) > 0:
                retakes.append(c)
                retake_codes.add(c.code)

        # Bucket the rest into the first tier (in config order) whose categories match
        # and whose min_ch gate (default 0) is already met; see _enrollment_priority_note
        # in simulation_config.json.
        tiers: list[list[Course]] = [[] for _ in priority_tiers]
        for c in eligible:
            if c.code in retake_codes:
                continue
            for bucket, tier in zip(tiers, priority_tiers):
                if c.category in tier["categories"] and self.completed_ch >= tier.get("min_ch", 0):
                    bucket.append(c)
                    break

        selected: list[Course] = []
        total_ch = 0
        for course in retakes + [c for bucket in tiers for c in bucket]:
            if total_ch + course.credits <= load_cap:
                selected.append(course)
                total_ch += course.credits
        return selected

    # ------------------------------------------------------------------ #
    # Grade recording                                                     #
    # ------------------------------------------------------------------ #

    def record_grade(self, course: Course, grade: str, config: dict) -> None:
        # Grade replacement: passing a retake removes all prior F attempts from the denominator.
        # F = 0.0 pts so numerator was already unaffected by those fails.
        if grade in PASSING_GRADES:
            prior_fails = self.failed_attempts.pop(course.code, 0)
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

        probation_min_ch = config["probation_min_ch"]
        probation_gpa_threshold = config.get("probation_gpa_threshold", 2.0)
        if self.completed_ch >= probation_min_ch and self.gpa < probation_gpa_threshold:
            self.on_probation = True
            self.ever_probation = True
        elif self.gpa >= probation_gpa_threshold:
            self.on_probation = False
