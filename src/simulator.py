from __future__ import annotations

import math
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Callable

from src.models.course import Course
from src.models.semester import get_mandatory_seasons, mandatory_horizon_end_term, term_season, term_label
from src.models.student import Student, registration_tier, curriculum_stage
from src.datasource import DataSource, SyntheticDataSource, CohortSpec, EnrollmentRecord, OutcomeRecord
from src.utils import grade_tier

# A per-term overlay hook: given the calendar term index, returns (config_patch,
# scenario_patch) dicts to shallow-merge on top of the Simulator's base config/scenario for
# that term only (see src/livesim.py::LiveRunner, which is the only real caller). Returning
# `({}, {})` for every term is equivalent to passing `overlay_provider=None`.
OverlayProvider = Callable[[int], tuple[dict, dict]]

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

    # Canonical-schema historical record (ACIP plan §2.4) — every course attempt and every
    # terminal outcome, for every student, regardless of cohort. analytics.compute_historical_
    # transcripts() filters this down (incumbents only, by default) into the pseudo-historical
    # export calibration/validation will consume.
    transcript: list[EnrollmentRecord] = field(default_factory=list)
    outcomes: list[OutcomeRecord] = field(default_factory=list)

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

    def record_enrollment(self, record: EnrollmentRecord) -> None:
        self.transcript.append(record)

    def record_outcome(self, record: OutcomeRecord) -> None:
        self.outcomes.append(record)


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
        data_source: DataSource | None = None,
        overlay_provider: OverlayProvider | None = None,
    ) -> None:
        self.curriculum = curriculum
        # `config`/`scenario` are mutated in place, per term, when `overlay_provider` is set
        # (see `_apply_overlay`) — `_base_config`/`_base_scenario` keep the untouched
        # originals so every term's overlay is computed from the same starting point rather
        # than compounding onto a previous term's patched view. When `overlay_provider` is
        # None (the default — every existing caller), `self.config`/`self.scenario` are never
        # reassigned and behavior is byte-identical to before this hook existed.
        self._base_config = config
        self._base_scenario = scenario
        self.config = config
        self.scenario = scenario
        self.overlay_provider = overlay_provider
        self.seed: int = config["seed"]
        self.max_terms: int = config["max_terms"]

        # Population enters through the DataSource seam (synthetic by default; a future
        # RealDataSource plugs in here unchanged). The engine never builds students itself.
        self.data_source: DataSource = data_source or SyntheticDataSource(config)
        specs = self.data_source.cohort_specs()
        if not specs:
            raise ValueError("DataSource returned no cohort specs; at least one cohort is required")
        self._specs_by_id: dict[int, CohortSpec] = {s.cohort_id: s for s in specs}
        # cohort_id -> entry_term, in admission order.
        self.admission_schedule: dict[int, int] = {s.cohort_id: s.entry_term for s in specs}

        # Global clock: earliest admission through the last cohort's full personal horizon.
        # end_term uses mandatory_horizon_end_term (not entry_term + max_terms) so optional
        # (non-mandatory) seasons in the cycle don't truncate the window before a student's
        # real max_terms semester budget is exhausted — see CLAUDE.md's "Term/Season Model".
        self.start_term: int = min(s.entry_term for s in specs)
        self.end_term: int = max(
            mandatory_horizon_end_term(s.entry_term, self.max_terms, self.config) for s in specs
        )

        self.students: list[Student] = []
        self.history = History()
        self.cohort_entry: dict[int, int] = {}  # filled as cohorts are admitted

    def run(self) -> SimulationResult:
        # Map entry_term -> [cohort_ids] for quick admission lookup.
        by_entry: dict[int, list[int]] = defaultdict(list)
        for cohort_id, entry_term in self.admission_schedule.items():
            by_entry[entry_term].append(cohort_id)

        for term_idx in range(self.start_term, self.end_term):
            self._apply_overlay(term_idx)
            for cohort_id in sorted(by_entry.get(term_idx, [])):
                self._admit_cohort(cohort_id, term_idx)
            season = term_season(term_idx, self.config)
            self._run_term(term_idx, season)

        # Safety net: anyone still active at the horizon is censored. (In practice every
        # student is already terminal by end_term - see the personal-semester check in
        # _run_term - so this should never fire; it stays as a defensive backstop.)
        for student in self.students:
            if student.is_active():
                self._record_outcome(student, "CENSORED", self.end_term - 1)

        return SimulationResult(
            history=self.history,
            students=self.students,
            scenario=self.scenario,
            config=self.config,
        )

    # ------------------------------------------------------------------ #
    # Student creation                                                    #
    # ------------------------------------------------------------------ #

    def _apply_overlay(self, term_idx: int) -> None:
        """Recompute `self.config`/`self.scenario` for `term_idx` from the untouched
        `_base_config`/`_base_scenario` plus whatever `overlay_provider` returns for this
        term — a fresh shallow merge every term, never compounding onto a previous term's
        already-patched dict. No-op (config/scenario stay exactly the base objects, by
        identity) when `overlay_provider` is None, so every pre-existing caller is
        unaffected. `course_sections`/`pass_rate_overrides`/`offering_overrides`/
        `capacity_overrides` are themselves dicts, so the patch's version (if present)
        *replaces* the base map for that key rather than deep-merging key-by-key —
        LiveRunner is responsible for handing in the right cumulative map each call.
        """
        if self.overlay_provider is None:
            return
        config_patch, scenario_patch = self.overlay_provider(term_idx)
        self.config = {**self._base_config, **(config_patch or {})}
        self.scenario = {**self._base_scenario, **(scenario_patch or {})}

    def _admit_cohort(self, cohort_id: int, entry_term: int) -> None:
        self.cohort_entry[cohort_id] = entry_term
        self.students.extend(self.data_source.create_students(self._specs_by_id[cohort_id]))

    def _make_students(self) -> None:
        """Admit study cohort 0 at term 0 (used by tests / single-cohort runs)."""
        self._admit_cohort(0, 0)

    # ------------------------------------------------------------------ #
    # Per-term loop                                                       #
    # ------------------------------------------------------------------ #

    def _run_term(self, term_idx: int, season: str) -> None:
        # Mandatory-terms-elapsed clock: ticks once per Fall/Spring (mandatory) term, not at
        # all during an optional Summer/Winter term — see CLAUDE.md's "Term/Season Model".
        if season in get_mandatory_seasons(self.config):
            for student in self.students:
                if student.status in ("ACTIVE", "DELAYED"):
                    student.personal_semester += 1

        available = [c for c in self.curriculum.values() if season in self._effective_offering(c)]
        available_codes = {c.code for c in available}
        active = [s for s in self.students if s.is_active()]

        # Per-term per-course stats for EVERY course (offered or not, so a Spring-only
        # course can still report how many students are waiting on it during a Fall term).
        course_stats: dict[str, dict] = {}
        for code, c in self.curriculum.items():
            offered = code in available_codes
            cap = self._effective_capacity(c, season) if offered else 0
            course_stats[code] = {
                "capacity": cap,
                "sections": self._section_count(c, season) if offered else 0,
                "registered": 0, "granted": 0, "denied": 0,
                "passed": 0, "failed": 0,
                "prereq_waiting": 0, "offering_blocked": 0,
                # A course whose seats are entirely consumed by initial-state occupancy starts
                # full even with no requesters this term — keeps full == (granted >= capacity)
                # holding when capacity is 0. The allocation loop overwrites this for courses
                # that do get requesters.
                "offered": offered, "full": offered and cap == 0,
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
            cap = self._effective_capacity(course, season)
            stats = course_stats[code]
            stats["registered"] = len(requesters)

            if len(requesters) <= cap:
                winners, losers = requesters, []
            else:
                sorted_req = sorted(
                    requesters,
                    key=lambda s: (registration_tier(s.completed_ch, self.config), s.tiebreak_token),
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
                attempt_no = student.failed_attempts.get(course.code, 0) + 1
                grade = self._resolve_grade(student, course)
                self.history.record_enrollment(EnrollmentRecord(
                    student_id=student.student_id,
                    term=term_idx,
                    course_code=course.code,
                    grade=grade,
                    credits=course.credits,
                    attempt_no=attempt_no,
                ))
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
                if student.personal_semester <= early_cut:
                    hazard *= early_mult
                if student.rng.random() < hazard:
                    self._record_outcome(student, "DROPPED", term_idx)
                    continue
            # (2) Stuck on a single gateway course.
            for code, attempts in student.failed_attempts.items():
                if attempts >= threshold:
                    if student.rng.random() < drop_prob:
                        self._record_outcome(student, "DROPPED", term_idx)
                        break

        # ── Graduation, delayed & censoring (personal-time horizons) ── #
        for student in self.students:
            if student.status in ("DROPPED", "GRADUATED", "CENSORED"):
                continue
            personal_semester = student.personal_semester
            if self._has_graduated(student):
                self._record_outcome(student, "GRADUATED", term_idx)
            elif personal_semester >= self.max_terms:
                self._record_outcome(student, "CENSORED", term_idx)  # ran out of their 12 semesters
            elif personal_semester > 8:
                student.status = "DELAYED"

        # ── Record blocking signals + per-term per-course waiting ── #
        # On a mandatory term, sweep the whole curriculum (legacy behavior). On an optional
        # term, sweep only courses actually offered then — adding Summer/Winter terms where
        # almost nothing is offered would otherwise inflate offering_block/prereq_block purely
        # from term count, not real scheduling problems. See CLAUDE.md's "Term/Season Model".
        if season in get_mandatory_seasons(self.config):
            courses_to_check = self.curriculum
        else:
            courses_to_check = {c.code: c for c in available}
        # Use the pre-outcome `active` snapshot, not a fresh is_active() filter: a student
        # who drops/graduates/is censored THIS term still experienced this term's scheduling
        # constraints and should be counted. (Graduates are unaffected either way — they've
        # already passed every course, so _record_blocks skips them via has_passed().)
        self._record_blocks(season, active, course_stats, courses_to_check)

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

        # Background standing: the admin-entered count of pre-existing students at each
        # year-standing (initial_state.standing), added as a constant to the aggregate
        # ("totals") stage nodes so the university flow chart starts non-empty rather than
        # filling in only as the simulated cohorts age. Steady-state (same every term), and
        # only on totals — per-cohort node counts stay exactly the simulated population.
        standing: dict[str, int] = self.config.get("initial_state", {}).get("standing", {})
        background = {n: int(standing.get(n, 0)) for n in STAGE_NODES if standing.get(n)}
        for n, v in background.items():
            total_nodes[n] += v

        frame = {
            "term": term_idx,
            "season": season,
            "label": term_label(term_idx, self.config),
            "background": background,
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

    def _record_outcome(self, student: Student, status: str, term_idx: int) -> None:
        """Fused terminal-status assignment + outcome recording, so a student can never
        end up with `status` set but no matching OutcomeRecord (or vice versa)."""
        student.status = status
        if status == "GRADUATED":
            student.grad_semester = student.personal_semester
            if student.entry_term >= 0:  # study cohorts only
                self.history.graduation_times.append(student.grad_semester)
        reason = {"GRADUATED": "graduated", "DROPPED": "dropped", "CENSORED": "censored"}[status]
        self.history.record_outcome(OutcomeRecord(
            student_id=student.student_id,
            graduation_term=term_idx if status == "GRADUATED" else None,
            exit_reason=reason,
        ))

    def _seats_per_section(self) -> int:
        return int(self.config.get("seats_per_section", 35))

    def _is_mandatory_season(self, season: str | None) -> bool:
        return season is None or season in get_mandatory_seasons(self.config)

    def _section_count(self, course: Course, season: str | None = None) -> int:
        """How many sections of this course the university runs per term.

        Taken from the calibrated `course_sections` map; falls back to whatever the
        single-cohort `capacity` implies if a course is missing from the map. `season`
        defaults to `None` (treated as mandatory) so existing callers that don't pass it
        keep today's exact behavior. On an optional (non-mandatory) season, sections come
        from the separate, smaller `optional_term_course_sections` map, falling back to a
        scaled-down regular section count (`optional_term_capacity_scale`) — see CLAUDE.md's
        "Term/Season Model".
        """
        smap: dict[str, int] = self.config.get("course_sections", {})
        regular = (
            max(1, int(smap[course.code])) if course.code in smap
            else max(1, math.ceil(course.capacity / self._seats_per_section()))
        )
        if self._is_mandatory_season(season):
            return regular

        optional_smap: dict[str, int] = self.config.get("optional_term_course_sections", {})
        if course.code in optional_smap:
            return max(1, int(optional_smap[course.code]))
        scale = float(self.config.get("optional_term_capacity_scale", 0.3))
        return max(1, math.floor(regular * scale))

    def _initial_occupancy(self, code: str) -> int:
        """Seats in `code` already taken by the pre-existing student body at the start of the
        run (the admin-entered `initial_state.occupancy`). This is a steady-state background
        load — it reduces the seats available to the simulated cohorts on every mandatory term
        (not just term 0), modelling a university that's always partly full of students we
        don't individually simulate. It replaces the old incumbent-cohort warm start; see
        CLAUDE.md's "Initial-State Model".
        """
        occupancy: dict[str, int] = self.config.get("initial_state", {}).get("occupancy", {})
        return int(occupancy.get(code, 0))

    def _effective_capacity(self, course: Course, season: str | None = None) -> int:
        # Per-term seats = sections × seats-per-section. Scenario hooks still scale it
        # for what-if experiments (capacity_overrides interpreted as a section multiplier).
        seats = self._section_count(course, season) * self._seats_per_section()
        multiplier = float(self.scenario.get("capacity_multiplier", 1.0))
        overrides: dict[str, float] = self.scenario.get("capacity_overrides", {})
        if course.code in overrides:
            multiplier = float(overrides[course.code])
        seats = max(1, math.floor(seats * multiplier))
        # Background occupancy reduces what's free for the simulated cohorts. Applied on
        # mandatory seasons only: optional (Summer/Winter) terms run a separate, much smaller
        # capacity model whose tiny offerings the steady-state load shouldn't zero out.
        if self._is_mandatory_season(season):
            occupied = self._initial_occupancy(course.code)
            if occupied:
                seats = max(0, seats - occupied)
        return seats

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
        courses_to_check: dict[str, Course],
    ) -> None:
        for student in active_students:
            for code, course in courses_to_check.items():
                if student.has_passed(code):
                    continue
                prereqs_met = student.is_eligible_for(course, self.curriculum)

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
