from __future__ import annotations

import math
from collections import defaultdict
from dataclasses import dataclass, field

from src.models.course import Course
from src.models.semester import term_season, term_label
from src.models.student import Student, registration_tier, curriculum_stage
from src.utils import grade_tier

STAGE_NODES = ["Admitted", "Year1", "Year2", "Year3", "Year4", "Graduated", "Dropped", "Censored"]


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
    graduation_times: list[int] = field(default_factory=list)  # personal semesters, study cohorts

    # Per-cohort-per-course block counters (cohort_id -> {course_code -> count})
    fail_by_cohort: dict[int, dict[str, int]] = field(
        default_factory=lambda: defaultdict(lambda: defaultdict(int)))
    capacity_block_by_cohort: dict[int, dict[str, int]] = field(
        default_factory=lambda: defaultdict(lambda: defaultdict(int)))
    offering_block_by_cohort: dict[int, dict[str, int]] = field(
        default_factory=lambda: defaultdict(lambda: defaultdict(int)))
    prereq_block_by_cohort: dict[int, dict[str, int]] = field(
        default_factory=lambda: defaultdict(lambda: defaultdict(int)))

    # Per-cohort, per-term ledger rows + frontend timeline frames
    cohort_snapshots: list[dict] = field(default_factory=list)
    timeline: list[dict] = field(default_factory=list)

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

    def record_cohort_snapshot(self, row: dict) -> None:
        self.cohort_snapshots.append(row)

    def record_timeline_frame(self, frame: dict) -> None:
        self.timeline.append(frame)


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
        self.cohort_size: int = config["cohort_size"]
        self.max_terms: int = config["max_terms"]
        self.num_cohorts: int = config.get("num_cohorts", 1)
        self.num_incumbent_cohorts: int = config.get("num_incumbent_cohorts", 0)
        self.admit_interval: int = config.get("admit_interval_terms", 2)

        # Study cohorts enter at 0, interval, 2*interval, ...; incumbents enter before term 0.
        self.start_term: int = -self.num_incumbent_cohorts * self.admit_interval
        self.end_term: int = (self.num_cohorts - 1) * self.admit_interval + self.max_terms

        self.students: list[Student] = []
        self.history = History()
        # cohort_id -> entry_term, in admission order
        self.admission_schedule: dict[int, int] = self._build_admission_schedule()
        self.cohort_entry: dict[int, int] = {}  # filled as cohorts are admitted

    def _build_admission_schedule(self) -> dict[int, int]:
        """Map cohort_id -> entry_term. Incumbents get negative ids/entry terms."""
        schedule: dict[int, int] = {}
        for k in range(1, self.num_incumbent_cohorts + 1):
            schedule[-k] = -k * self.admit_interval
        for c in range(self.num_cohorts):
            schedule[c] = c * self.admit_interval
        return schedule

    def run(self) -> SimulationResult:
        # Map entry_term -> [cohort_ids] for quick admission lookup.
        by_entry: dict[int, list[int]] = defaultdict(list)
        for cohort_id, entry_term in self.admission_schedule.items():
            by_entry[entry_term].append(cohort_id)

        for term_idx in range(self.start_term, self.end_term):
            for cohort_id in sorted(by_entry.get(term_idx, [])):
                self._admit_cohort(cohort_id, term_idx)
            season = term_season(term_idx)
            self._run_term(term_idx, season)

        # Safety net: anyone still active at the horizon is censored.
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

    def _admit_cohort(self, cohort_id: int, entry_term: int) -> None:
        self.cohort_entry[cohort_id] = entry_term
        base = (cohort_id + self.num_incumbent_cohorts) * self.cohort_size
        for i in range(self.cohort_size):
            sid = base + i
            self.students.append(Student(sid, self.seed, cohort_id=cohort_id, entry_term=entry_term))

    def _make_students(self) -> None:
        """Admit study cohort 0 at term 0 (used by tests / single-cohort runs)."""
        self._admit_cohort(0, 0)

    # ------------------------------------------------------------------ #
    # Per-term loop                                                       #
    # ------------------------------------------------------------------ #

    def _run_term(self, term_idx: int, season: str) -> None:
        available = [c for c in self.curriculum.values() if season in self._effective_offering(c)]
        available_codes = {c.code for c in available}
        active = [s for s in self.students if s.is_active()]

        # Per-term per-course stats for EVERY course (offered or not, so a Spring-only
        # course can still report how many students are waiting on it during a Fall term).
        course_stats: dict[str, dict] = {}
        for code, c in self.curriculum.items():
            offered = code in available_codes
            course_stats[code] = {
                "capacity": self._effective_capacity(c) if offered else 0,
                "sections": self._section_count(c) if offered else 0,
                "registered": 0, "granted": 0, "denied": 0,
                "passed": 0, "failed": 0,
                "prereq_waiting": 0, "offering_blocked": 0,
                "offered": offered, "full": False,
            }

        # Per-cohort seat counters this term.
        seats_requested: dict[int, int] = defaultdict(int)
        seats_denied: dict[int, int] = defaultdict(int)

        # ── Phase 1: Each student builds a desired-enrollment list ── #
        desired: dict[str, list[Student]] = defaultdict(list)
        for student in active:
            for course in student.get_desired_courses(available, self.curriculum, self.config):
                desired[course.code].append(student)
                seats_requested[student.cohort_id] += 1

        # ── Phase 2: Seat allocation ─────────────────────────────── #
        granted: dict[int, list[Course]] = defaultdict(list)

        for code, requesters in desired.items():
            course = self.curriculum[code]
            cap = self._effective_capacity(course)
            stats = course_stats[code]
            stats["registered"] = len(requesters)

            if len(requesters) <= cap:
                winners, losers = requesters, []
            else:
                sorted_req = sorted(
                    requesters,
                    key=lambda s: (registration_tier(s.completed_ch), s.tiebreak_token),
                )
                winners, losers = sorted_req[:cap], sorted_req[cap:]

            for s in winners:
                granted[s.student_id].append(course)
            stats["granted"] = len(winners)
            stats["denied"] = len(losers)
            stats["full"] = len(winners) >= cap

            for s in losers:
                self.history.capacity_block_counts[code] += 1
                self.history.capacity_block_by_cohort[s.cohort_id][code] += 1
                seats_denied[s.cohort_id] += 1

        # ── Phase 3: Take courses ─────────────────────────────────── #
        for student in active:
            for course in granted[student.student_id]:
                grade = self._resolve_grade(student, course)
                student.record_grade(course, grade)
                if grade == "F":
                    self.history.fail_counts[course.code] += 1
                    self.history.fail_by_cohort[student.cohort_id][course.code] += 1
                    course_stats[course.code]["failed"] += 1
                else:
                    course_stats[course.code]["passed"] += 1

        # ── Academic dropout checks ───────────────────────────────── #
        # Two independent causes, both calibrated to QU's ~72% / 12-sem
        # graduation rate:
        #   (1) PRIMARY — chronic low GPA: a per-term hazard that grows the
        #       further a student sits below the floor, and is front-loaded
        #       (early-year students are likelier to leave). Ties dropout to
        #       the GPA/probation system instead of one stubborn course.
        #   (2) SECONDARY — stuck on a single gateway course: failing the same
        #       course `dropout_fails_threshold` times can still push a student
        #       out even if their overall GPA is survivable.
        gpa_floor   = self.config.get("dropout_gpa_floor", 2.0)
        base_hazard = self.config.get("dropout_base_hazard", 0.0)
        early_mult  = self.config.get("dropout_early_multiplier", 1.0)
        early_cut   = self.config.get("dropout_early_sem_cutoff", 4)
        min_ch      = self.config["probation_min_ch"]
        threshold   = self.config["dropout_fails_threshold"]
        drop_prob   = self.config["dropout_prob_on_repeated_fail"]
        for student in active:
            if not student.is_active():
                continue
            # (1) Chronic low-GPA hazard — only judged once a student has
            # accumulated enough credits for their GPA to be meaningful.
            if student.completed_ch >= min_ch and student.gpa < gpa_floor:
                severity = gpa_floor - student.gpa          # 0 .. gpa_floor
                hazard = base_hazard * (1.0 + severity)
                personal_sem = term_idx - student.entry_term + 1
                if personal_sem <= early_cut:
                    hazard *= early_mult
                if student.rng.random() < hazard:
                    student.status = "DROPPED"
                    continue
            # (2) Stuck on a single gateway course.
            for code, attempts in student.failed_attempts.items():
                if attempts >= threshold:
                    if student.rng.random() < drop_prob:
                        student.status = "DROPPED"
                        break

        # ── Graduation, delayed & censoring (personal-time horizons) ── #
        for student in self.students:
            if student.status in ("DROPPED", "GRADUATED", "CENSORED"):
                continue
            personal_semester = term_idx - student.entry_term + 1
            if self._has_graduated(student):
                student.status = "GRADUATED"
                student.grad_semester = personal_semester
                if student.entry_term >= 0:  # study cohorts only
                    self.history.graduation_times.append(personal_semester)
            elif personal_semester >= self.max_terms:
                student.status = "CENSORED"  # ran out of their 12 semesters
            elif personal_semester > 8:
                student.status = "DELAYED"

        # ── Record blocking signals + per-term per-course waiting ── #
        self._record_blocks(season, [s for s in self.students if s.is_active()], course_stats)

        # ── Cohort snapshot + timeline frame ──────────────────────── #
        self._record_term_outputs(term_idx, season, course_stats, seats_requested, seats_denied)

        # ── Aggregate snapshot (legacy) ───────────────────────────── #
        self.history.record_snapshot(term_idx + 1, self.students)

    # ------------------------------------------------------------------ #
    # Output assembly                                                     #
    # ------------------------------------------------------------------ #

    def _record_term_outputs(
        self,
        term_idx: int,
        season: str,
        course_stats: dict[str, dict],
        seats_requested: dict[int, int],
        seats_denied: dict[int, int],
    ) -> None:
        entered = sorted(self.cohort_entry)
        members: dict[int, list[Student]] = defaultdict(list)
        for s in self.students:
            members[s.cohort_id].append(s)

        # Stage nodes + flows per cohort (and totals).
        per_cohort_nodes: dict[int, dict[str, int]] = {}
        per_cohort_flows: dict[int, list[dict]] = {}
        for cid in entered:
            nodes = {n: 0 for n in STAGE_NODES}
            flows: dict[tuple[str, str], int] = defaultdict(int)
            for s in members[cid]:
                stage = curriculum_stage(s)
                src = s.prev_stage if s.prev_stage is not None else "Admitted"
                nodes[stage] += 1
                if src != stage:
                    flows[(src, stage)] += 1
                s.prev_stage = stage
            per_cohort_nodes[cid] = nodes
            per_cohort_flows[cid] = [
                {"from": a, "to": b, "count": n} for (a, b), n in sorted(flows.items())
            ]

        # Cohort ledger rows.
        for cid in entered:
            ms = members[cid]
            entry = self.cohort_entry[cid]
            self.history.record_cohort_snapshot({
                "global_term": term_idx,
                "season": season,
                "cohort_id": cid,
                "is_incumbent": cid < 0,
                "cohort_age": term_idx - entry + 1,
                "active":    sum(1 for s in ms if s.status == "ACTIVE"),
                "delayed":   sum(1 for s in ms if s.status == "DELAYED"),
                "graduated": sum(1 for s in ms if s.status == "GRADUATED"),
                "dropped":   sum(1 for s in ms if s.status == "DROPPED"),
                "censored":  sum(1 for s in ms if s.status == "CENSORED"),
                "seats_requested": seats_requested.get(cid, 0),
                "seats_denied": seats_denied.get(cid, 0),
            })

        # Timeline frame (frontend contract).
        total_nodes = {n: 0 for n in STAGE_NODES}
        for cid in entered:
            for n, v in per_cohort_nodes[cid].items():
                total_nodes[n] += v

        frame = {
            "term": term_idx,
            "season": season,
            "label": term_label(term_idx),
            "courses": course_stats,
            "stages": {
                "cohorts": {
                    str(cid): {
                        "is_incumbent": cid < 0,
                        "nodes": per_cohort_nodes[cid],
                        "flows": per_cohort_flows[cid],
                        "seats_requested": seats_requested.get(cid, 0),
                        "seats_denied": seats_denied.get(cid, 0),
                    }
                    for cid in entered
                },
                "totals": {
                    "nodes": total_nodes,
                    "seats_requested": sum(seats_requested.values()),
                    "seats_denied": sum(seats_denied.values()),
                },
            },
        }
        self.history.record_timeline_frame(frame)

    # ------------------------------------------------------------------ #
    # Helpers                                                             #
    # ------------------------------------------------------------------ #

    def _has_graduated(self, student: Student) -> bool:
        return all(student.has_passed(code) for code in self.curriculum)

    def _seats_per_section(self) -> int:
        return int(self.config.get("seats_per_section", 35))

    def _section_count(self, course: Course) -> int:
        """How many sections of this course the university runs per term.

        Taken from the calibrated `course_sections` map; falls back to whatever the
        single-cohort `capacity` implies if a course is missing from the map.
        """
        smap: dict[str, int] = self.config.get("course_sections", {})
        if course.code in smap:
            return max(1, int(smap[course.code]))
        return max(1, math.ceil(course.capacity / self._seats_per_section()))

    def _effective_capacity(self, course: Course) -> int:
        # Per-term seats = sections × seats-per-section. Scenario hooks still scale it
        # for what-if experiments (capacity_overrides interpreted as a section multiplier).
        seats = self._section_count(course) * self._seats_per_section()
        multiplier = float(self.scenario.get("capacity_multiplier", 1.0))
        overrides: dict[str, float] = self.scenario.get("capacity_overrides", {})
        if course.code in overrides:
            multiplier = float(overrides[course.code])
        return max(1, math.floor(seats * multiplier))

    def _effective_offering(self, course: Course) -> tuple[str, ...]:
        overrides: dict[str, list[str]] = self.scenario.get("offering_overrides", {})
        if course.code in overrides:
            return tuple(overrides[course.code])
        return course.offering

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

    def _record_blocks(
        self,
        season: str,
        active_students: list[Student],
        course_stats: dict[str, dict],
    ) -> None:
        for student in active_students:
            for code, course in self.curriculum.items():
                if student.has_passed(code):
                    continue
                if course.is_senior_project:
                    prereqs_met = student.can_register_senior_project(self.curriculum)
                else:
                    prereqs_met = student.prerequisites_met(course, self.curriculum)

                if prereqs_met:
                    if season not in self._effective_offering(course):
                        self.history.offering_block_counts[code] += 1
                        self.history.offering_block_by_cohort[student.cohort_id][code] += 1
                        if code in course_stats:
                            course_stats[code]["offering_blocked"] += 1
                else:
                    self.history.prereq_block_counts[code] += 1
                    self.history.prereq_block_by_cohort[student.cohort_id][code] += 1
                    if code in course_stats:
                        course_stats[code]["prereq_waiting"] += 1
