from __future__ import annotations

import math
from collections import defaultdict
from dataclasses import dataclass, field

from src.models.course import Course
from src.models.semester import get_mandatory_seasons, mandatory_horizon_end_term, term_season, term_label
from src.models.student import Student, registration_tier, curriculum_stage, stage_node_names
from src.datasource import (
    BlockEvent,
    CohortSpec,
    DataSource,
    EnrollmentRecord,
    OutcomeRecord,
    StudentTermState,
    SyntheticDataSource,
)
from src.utils import grade_tier

# Bumped whenever Simulator.snapshot()'s pickled payload shape changes, so a stale snapshot
# (e.g. from a checkpoint session started before a deploy) fails loudly via from_snapshot
# instead of unpickling into a shape the running code doesn't expect. See CLAUDE.md's
# Semester Checkpoint Mode.
_SNAPSHOT_VERSION = 1


class SnapshotVersionError(Exception):
    """Raised by Simulator.from_snapshot on a version mismatch — the caller (a checkpoint
    session) should treat this as an invalidated session, not attempt to recover it."""


# ------------------------------------------------------------------ #
# History: accumulated statistics across all terms                   #
# ------------------------------------------------------------------ #

def _int_defaultdict() -> "defaultdict[str, int]":
    return defaultdict(int)


def _cohort_int_defaultdict() -> "defaultdict[int, defaultdict[str, int]]":
    # A *named* nested factory (not a lambda) so History stays pickle-able — pickle can't
    # serialize a lambda, and a resumable Simulator (see step_one_mandatory_term / snapshot)
    # needs to pickle its History between checkpoint requests.
    return defaultdict(_int_defaultdict)


@dataclass
class History:
    snapshots: list[dict] = field(default_factory=list)
    fail_counts: dict[str, int] = field(default_factory=_int_defaultdict)
    offering_block_counts: dict[str, int] = field(default_factory=_int_defaultdict)
    capacity_block_counts: dict[str, int] = field(default_factory=_int_defaultdict)
    prereq_block_counts: dict[str, int] = field(default_factory=_int_defaultdict)
    # MANDATORY (regular) term-only variants of the three *structural* block signals — the basis for
    # the capacity/offering/prereq bottleneck rankings (headline + bottlenecks + per-cohort). Optional
    # (Summer/Winter) terms are excluded: those seats are a deliberately small bonus pool
    # (optional_term_capacity_scale), so a denial/wait there doesn't block graduation and isn't fixed
    # by regular capacity/offering — counting it would point the ranking at Summer service courses
    # that are scarce by design instead of the regular-term gateways that delay students. The
    # unfiltered counters above still feed the timeline frames + utilization heatmap. (fail_counts is
    # deliberately NOT filtered: a fail is a real fail whenever it happens.)
    capacity_block_counts_mandatory: dict[str, int] = field(default_factory=_int_defaultdict)
    offering_block_counts_mandatory: dict[str, int] = field(default_factory=_int_defaultdict)
    prereq_block_counts_mandatory: dict[str, int] = field(default_factory=_int_defaultdict)
    graduation_times: list[int] = field(default_factory=list)  # personal semesters, study cohorts

    # Per-cohort-per-course block counters (cohort_id -> {course_code -> count})
    fail_by_cohort: dict[int, dict[str, int]] = field(default_factory=_cohort_int_defaultdict)
    capacity_block_by_cohort: dict[int, dict[str, int]] = field(default_factory=_cohort_int_defaultdict)
    offering_block_by_cohort: dict[int, dict[str, int]] = field(default_factory=_cohort_int_defaultdict)
    prereq_block_by_cohort: dict[int, dict[str, int]] = field(default_factory=_cohort_int_defaultdict)
    # Mandatory-terms-only variants (see capacity_block_counts_mandatory) — power the per-cohort
    # top_capacity_block / top_offering_block / top_prereq_block rankings.
    capacity_block_mandatory_by_cohort: dict[int, dict[str, int]] = field(
        default_factory=_cohort_int_defaultdict)
    offering_block_mandatory_by_cohort: dict[int, dict[str, int]] = field(
        default_factory=_cohort_int_defaultdict)
    prereq_block_mandatory_by_cohort: dict[int, dict[str, int]] = field(
        default_factory=_cohort_int_defaultdict)

    # Per-cohort, per-term ledger rows + frontend timeline frames
    cohort_snapshots: list[dict] = field(default_factory=list)
    timeline: list[dict] = field(default_factory=list)

    # Canonical-schema historical record (ACIP plan §2.4) — every course attempt and every
    # terminal outcome, for every student, regardless of cohort. analytics.compute_historical_
    # transcripts() filters this down (incumbents only, by default) into the pseudo-historical
    # export calibration/validation will consume.
    transcript: list[EnrollmentRecord] = field(default_factory=list)
    outcomes: list[OutcomeRecord] = field(default_factory=list)

    # Per-student trace detail — populated only when Simulator is run with
    # record_traces=True (the trace feature; never on the hot /simulate path). block_events
    # is the per-student counterpart to the aggregate capacity/offering/prereq counters above;
    # student_term_states is the per-term GPA/probation/status trajectory. Both stay out of
    # the flow_timeline JSON contract, exactly like transcript/outcomes.
    block_events: list[BlockEvent] = field(default_factory=list)
    student_term_states: list[StudentTermState] = field(default_factory=list)

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
        record_traces: bool = False,
    ) -> None:
        self.curriculum = curriculum
        # Opt-in per-student trace capture (block events + per-term state snapshots). Default
        # off, so every existing caller/test and the hot /simulate baseline run byte-identical
        # and pay nothing; only the student-trace endpoints flip this on.
        self.record_traces = record_traces
        # Total program credit hours, for the cumulative-delay dropout hazard's "expected
        # completed_ch by now" calculation (see _run_term) — computed once since curriculum
        # doesn't change per term (only config/scenario overlays do).
        self._total_program_ch: int = sum(c.credits for c in curriculum.values())
        # Flow-chart stage nodes for THIS plan, derived from year_standing_thresholds (not a
        # hardcoded Year1..Year4), so a program that isn't 4 years long gets matching nodes.
        # year_standing_thresholds isn't an overlay-able knob, so this is computed once here.
        self.stage_nodes: list[str] = stage_node_names(config)
        self.config = config
        self.scenario = scenario
        self.seed: int = config["seed"]
        self.max_terms: int = config["max_terms"]

        # Fail fast on an out-of-bounds credit-load ceiling / retake cap. This is the same
        # check `PUT /config` runs via plan_validation.validate_plan_edits, re-run here so a
        # caller that builds a Simulator directly (scripts, tests, a hand-edited config file
        # bypassing the API) can't silently run a whole simulation on a config that would hand
        # students a physically-impossible course load or an unbounded retake allowance.
        from src.plan_validation import (
            PlanValidationError,
            validate_credit_load_bounds,
            validate_max_course_attempts,
        )
        try:
            validate_credit_load_bounds(config)
            validate_max_course_attempts(config)
        except PlanValidationError as exc:
            raise ValueError(str(exc)) from exc

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

        # Map entry_term -> [cohort_ids] for quick admission lookup, and the resume cursor a
        # checkpoint session persists between requests (see step_one_mandatory_term/snapshot).
        # Built once here since admission_schedule never changes over the object's lifetime —
        # from_snapshot() rebuilds this fresh from the (possibly edited) config on every resume.
        self._by_entry: dict[int, list[int]] = defaultdict(list)
        for cohort_id, entry_term in self.admission_schedule.items():
            self._by_entry[entry_term].append(cohort_id)
        self._next_term: int = self.start_term

    @property
    def is_finished(self) -> bool:
        """True once every term through the horizon has been run. A resumable checkpoint
        session (CLAUDE.md's Semester Checkpoint Mode) advances by calling step_one_term()
        (or, for a full/batch run, step_one_mandatory_term()) until this is True."""
        return self._next_term >= self.end_term

    def _advance_one_calendar_term(self) -> str:
        """Admit any cohort due, run exactly one calendar term (whatever season it is), and
        move the resume cursor past it. Returns the season just processed. Shared by
        step_one_mandatory_term (which loops this until a mandatory season) and step_one_term
        (which calls it exactly once) — the actual per-term work is identical either way; only
        how many terms get bundled into one caller-visible "step" differs."""
        term_idx = self._next_term
        for cohort_id in sorted(self._by_entry.get(term_idx, [])):
            self._admit_cohort(cohort_id, term_idx)
        season = term_season(term_idx, self.config)
        self._run_term(term_idx, season)
        self._next_term += 1
        return season

    def step_one_mandatory_term(self) -> None:
        """Advance the simulation by exactly one MANDATORY (Fall/Spring) term, running any
        intervening optional (Summer/Winter) term along the way in the same call — so a caller
        that only wants mandatory-term boundaries (full/batch runs via `run()` below) always
        lands on one. No-op once is_finished. `run()` is just this called in a loop, so a
        caller who never pauses gets identical behavior to the old single-shot for-loop.
        """
        while not self.is_finished:
            season = self._advance_one_calendar_term()
            if season in get_mandatory_seasons(self.config):
                break

    def step_one_term(self) -> None:
        """Advance the simulation by exactly one calendar term, mandatory OR optional — used by
        Semester Checkpoint Mode so a session can pause (and edit future-facing knobs) at every
        term boundary, including Summer/Winter, not just Fall/Spring. Never sweeps more than one
        term per call, unlike step_one_mandatory_term. No-op once is_finished. Doesn't change
        Student.personal_semester semantics (still mandatory-terms-only, handled inside
        _run_term) — this only changes how finely a *caller* can pause, not what happens inside
        any given term."""
        if not self.is_finished:
            self._advance_one_calendar_term()

    def run(self) -> SimulationResult:
        while not self.is_finished:
            self.step_one_mandatory_term()

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

    def snapshot(self) -> bytes:
        """Serialize this engine's dynamic mid-run state (students, history, cohort_entry, the
        resume cursor) so it can be persisted between checkpoint requests and restored later via
        `from_snapshot`. curriculum/config/scenario are deliberately NOT included — the caller
        supplies those fresh on restore, which is how a staged checkpoint edit takes effect on
        the next step (see CLAUDE.md's Semester Checkpoint Mode). Pickle-based; this is why
        History's per-cohort counters use named module-level factory functions instead of
        lambdas (lambdas can't be pickled) — see _int_defaultdict/_cohort_int_defaultdict above.
        """
        import pickle
        payload = (_SNAPSHOT_VERSION, self.students, self.history, self.cohort_entry, self._next_term)
        return pickle.dumps(payload)

    @classmethod
    def from_snapshot(
        cls,
        curriculum: dict[str, Course],
        config: dict,
        scenario: dict,
        blob: bytes,
        data_source: DataSource | None = None,
        record_traces: bool = False,
    ) -> "Simulator":
        """Rebuild a Simulator around previously-snapshotted dynamic state, with fresh
        curriculum/config/scenario — so any capacity/pass_rate/occupancy/intake edit staged
        since the snapshot takes effect starting with the next step_one_mandatory_term() call.
        __init__ still runs in full (rebuilding _specs_by_id/admission_schedule/etc. from the
        possibly-edited config); the restored students/history/cursor below then replace what
        __init__ initialized empty, so already-admitted students and their history are carried
        forward untouched while only NOT-yet-admitted cohorts pick up an intake edit (their
        entry terms/specs come from the freshly-rebuilt schedule) — see CLAUDE.md's Semester
        Checkpoint Mode for why this matters and its intake-edit caveat.
        """
        import pickle
        version, students, history, cohort_entry, next_term = pickle.loads(blob)
        if version != _SNAPSHOT_VERSION:
            raise SnapshotVersionError(
                f"checkpoint snapshot version {version} is incompatible with the running "
                f"engine's version {_SNAPSHOT_VERSION}"
            )
        sim = cls(curriculum, config, scenario, data_source=data_source, record_traces=record_traces)
        sim.students = students
        sim.history = history
        sim.cohort_entry = cohort_entry
        sim._next_term = next_term
        return sim

    # ------------------------------------------------------------------ #
    # Student creation                                                    #
    # ------------------------------------------------------------------ #

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

            is_mandatory = self._is_mandatory_season(season)
            for s in losers:
                self.history.capacity_block_counts[code] += 1
                self.history.capacity_block_by_cohort[s.cohort_id][code] += 1
                # Regular-term denials also feed the mandatory-only counters used for ranking
                # (Summer/Winter bonus-seat denials are intentionally left out — see History).
                if is_mandatory:
                    self.history.capacity_block_counts_mandatory[code] += 1
                    self.history.capacity_block_mandatory_by_cohort[s.cohort_id][code] += 1
                seats_denied[s.cohort_id] += 1
                if self.record_traces:
                    self.history.block_events.append(
                        BlockEvent(s.student_id, term_idx, code, "capacity"))

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
                student.record_grade(course, grade, self.config)
                if grade == "F":
                    self.history.fail_counts[course.code] += 1
                    self.history.fail_by_cohort[student.cohort_id][course.code] += 1
                    course_stats[course.code]["failed"] += 1
                else:
                    course_stats[course.code]["passed"] += 1

        # ── Max course attempt cap (hard guardrail) ────────────────── #
        # Deterministic: if a student has exhausted max_course_attempts on any single course,
        # they are immediately dropped. This complements the probabilistic
        # dropout_fails_threshold mechanism below. Student.has_exhausted_attempts is the single
        # source of truth for the threshold (also used defensively in get_desired_courses so a
        # student is never offered a course they've already exhausted).
        for student in active:
            if not student.is_active():
                continue
            if any(student.has_exhausted_attempts(code, self.config) for code in student.failed_attempts):
                self._record_outcome(student, "DROPPED", term_idx)

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
        #   (3) TERTIARY, opt-in (default off) — cumulative delay: a student who
        #       is simply falling behind a normal completion pace, independent of
        #       GPA, faces rising withdrawal risk the further behind they get.
        #       Distinct from passively hitting the horizon (CENSORED, below) —
        #       real students in this position often leave well before their
        #       time budget is actually exhausted. See CLAUDE.md's dropout notes.
        gpa_floor   = self.config.get("dropout_gpa_floor", 2.0)
        base_hazard = self.config.get("dropout_base_hazard", 0.0)
        early_mult  = self.config.get("dropout_early_multiplier", 1.0)
        early_cut   = self.config.get("dropout_early_sem_cutoff", 4)
        min_ch      = self.config["probation_min_ch"]
        threshold   = self.config["dropout_fails_threshold"]
        drop_prob   = self.config["dropout_prob_on_repeated_fail"]
        delay_scale = self.config.get("dropout_delay_hazard_scale", 0.0)
        on_time_terms = self.config.get("on_time_terms", 8)
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
            if not student.is_active():
                continue
            # (3) Cumulative delay (opt-in, see note above). Off by default
            # (delay_scale == 0.0), so existing behavior is untouched unless an
            # admin deliberately sets dropout_delay_hazard_scale.
            if delay_scale > 0 and student.personal_semester > 0:
                expected_ch = (student.personal_semester / on_time_terms) * self._total_program_ch
                deficit_fraction = max(0.0, expected_ch - student.completed_ch) / self._total_program_ch
                if deficit_fraction > 0 and student.rng.random() < delay_scale * deficit_fraction:
                    self._record_outcome(student, "DROPPED", term_idx)
                    continue

        # ── Graduation, delayed & censoring (personal-time horizons) ── #
        for student in self.students:
            if student.status in ("DROPPED", "GRADUATED", "CENSORED"):
                continue
            personal_semester = student.personal_semester
            if self._has_graduated(student):
                self._record_outcome(student, "GRADUATED", term_idx)
            elif personal_semester >= self.max_terms:
                self._record_outcome(student, "CENSORED", term_idx)  # ran out of their 12 semesters
            elif personal_semester > self.config.get("on_time_terms", 8):
                student.status = "DELAYED"  # past the nominal on-time plan, still progressing

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
        self._record_blocks(term_idx, season, active, course_stats, courses_to_check)

        # Per-student trace snapshot (opt-in). Uses the pre-outcome `active` snapshot so a
        # student's terminal-transition term is captured with its post-transition status.
        if self.record_traces:
            for s in active:
                self.history.student_term_states.append(StudentTermState(
                    student_id=s.student_id,
                    term=term_idx,
                    personal_semester=s.personal_semester,
                    gpa=round(s.gpa, 4),
                    completed_ch=s.completed_ch,
                    on_probation=s.on_probation,
                    status=s.status,
                ))

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
            nodes = {n: 0 for n in self.stage_nodes}
            flows: dict[tuple[str, str], int] = defaultdict(int)
            for s in members[cid]:
                stage = curriculum_stage(s, self.config)
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
        total_nodes = {n: 0 for n in self.stage_nodes}
        for cid in entered:
            for n, v in per_cohort_nodes[cid].items():
                total_nodes[n] += v

        frame = {
            "term": term_idx,
            "season": season,
            "label": term_label(term_idx, self.config),
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

    def _is_mandatory_season(self, season: str | None) -> bool:
        return season is None or season in get_mandatory_seasons(self.config)

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
        # Per-term seats = the course's own `capacity` — the one number that drives both the
        # curriculum roadmap display and the simulation, so editing it in Settings actually
        # changes the run. On an optional (non-mandatory) season, a separate, much smaller
        # capacity model applies (`optional_term_capacity_scale`) — see CLAUDE.md's
        # "Term/Season Model". Scenario hooks still scale it for what-if experiments
        # (`capacity_overrides` interpreted as a per-course multiplier).
        seats = course.capacity
        if not self._is_mandatory_season(season):
            scale = float(self.config.get("optional_term_capacity_scale", 0.3))
            seats = max(1, math.floor(seats * scale))
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
        term_idx: int,
        season: str,
        active_students: list[Student],
        course_stats: dict[str, dict],
        courses_to_check: dict[str, Course],
    ) -> None:
        is_mandatory = self._is_mandatory_season(season)
        for student in active_students:
            for code, course in courses_to_check.items():
                if student.has_passed(code):
                    continue
                prereqs_met = student.is_eligible_for(course, self.curriculum)

                if prereqs_met:
                    if season not in self._effective_offering(course):
                        self.history.offering_block_counts[code] += 1
                        self.history.offering_block_by_cohort[student.cohort_id][code] += 1
                        # Regular-term waits also feed the mandatory-only ranking counters (optional-
                        # term passive-sweep waits are calendar-term noise — see History).
                        if is_mandatory:
                            self.history.offering_block_counts_mandatory[code] += 1
                            self.history.offering_block_mandatory_by_cohort[student.cohort_id][code] += 1
                        if code in course_stats:
                            course_stats[code]["offering_blocked"] += 1
                        if self.record_traces:
                            self.history.block_events.append(
                                BlockEvent(student.student_id, term_idx, code, "offering"))
                else:
                    self.history.prereq_block_counts[code] += 1
                    self.history.prereq_block_by_cohort[student.cohort_id][code] += 1
                    if is_mandatory:
                        self.history.prereq_block_counts_mandatory[code] += 1
                        self.history.prereq_block_mandatory_by_cohort[student.cohort_id][code] += 1
                    if code in course_stats:
                        course_stats[code]["prereq_waiting"] += 1
                    if self.record_traces:
                        self.history.block_events.append(
                            BlockEvent(student.student_id, term_idx, code, "prereq"))
