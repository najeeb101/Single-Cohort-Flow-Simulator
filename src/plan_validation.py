"""Single entry point for cross-object guardrails against edits that would silently corrupt a
run — as opposed to the cheap, single-field checks pydantic's `Field(ge=..., le=...)` already
does on `CourseUpdate`/`CourseCreate`/`ScenarioRequest` (src/api.py), which can't see across a
`Course` and the plan's `config`.

Every write path that can change capacity, occupancy, or intake calls `validate_plan_edits`
against the POST-patch `(curriculum, config)`: `PUT /curriculum/{code}`, `POST /curriculum`,
and `PUT /config` (src/api.py). `validate_initial_state`/`validate_admissions` are the
narrower, patch-shaped checks `PUT /config` already ran before this module existed (moved
here, not rewritten, so their behavior is unchanged) — they validate one key's shape against
the plan rather than reasoning across the whole curriculum.
"""
from __future__ import annotations

from src.models.course import Course
from src.models.semester import get_mandatory_seasons


class PlanValidationError(Exception):
    """Raised on a guardrail violation. Callers (src/api.py) map this to HTTP 422."""


# Intake bounds — realistic institutional limits.
_COHORT_SIZE_MIN = 10
_COHORT_SIZE_MAX = 1000

# Credit-load ceilings — realistic per-term load bounds (a 6-course, 4-credit overload tops
# out around 24 CH; below 1 CH a student could never make progress at all).
_LOAD_CH_MIN = 1
_LOAD_CH_MAX = 24

# Retake-attempt bounds — must allow at least one attempt, and stay within a realistic
# institutional repeat-course policy (no program lets a student retake indefinitely).
_MAX_COURSE_ATTEMPTS_MIN = 1
_MAX_COURSE_ATTEMPTS_MAX = 10


def validate_cohort_size(config: dict) -> None:
    """cohort_size must be a positive integer within institutional bounds."""
    size = config.get("cohort_size")
    if size is None:
        return
    if not isinstance(size, int) or isinstance(size, bool) or size < 1:
        raise PlanValidationError("cohort_size must be a positive integer")
    if size < _COHORT_SIZE_MIN or size > _COHORT_SIZE_MAX:
        raise PlanValidationError(
            f"cohort_size must be between {_COHORT_SIZE_MIN} and {_COHORT_SIZE_MAX} (got {size})"
        )


def validate_credit_load_bounds(config: dict) -> None:
    """normal_load_ch/probation_load_ch must each be positive integers within a realistic
    per-term ceiling, and probation_load_ch must not exceed normal_load_ch — otherwise a
    misconfigured plan could hand a probation student a *higher* course load than a student in
    good standing, or let either load cap climb to a value no real term of course offerings
    could satisfy. Only checked when present, so a minimal engine-level config that doesn't set
    them is untouched (Simulator.__init__ re-runs this same check as a fail-fast guard for
    direct/non-API callers — see src/simulator.py)."""
    normal = config.get("normal_load_ch")
    probation = config.get("probation_load_ch")
    for name, value in (("normal_load_ch", normal), ("probation_load_ch", probation)):
        if value is None:
            continue
        if not isinstance(value, int) or isinstance(value, bool) or value < 1:
            raise PlanValidationError(f"{name} must be a positive integer")
        if value < _LOAD_CH_MIN or value > _LOAD_CH_MAX:
            raise PlanValidationError(
                f"{name} must be between {_LOAD_CH_MIN} and {_LOAD_CH_MAX} (got {value})"
            )
    if isinstance(normal, int) and isinstance(probation, int) and probation > normal:
        raise PlanValidationError(
            f"probation_load_ch ({probation}) must not exceed normal_load_ch ({normal})"
        )


def validate_max_course_attempts(config: dict) -> None:
    """max_course_attempts (the hard per-course retake cap Simulator/Student enforce) must be a
    positive integer within a realistic institutional bound. Only checked when present — the
    engine defaults to 3 when the key is absent (see Student.has_exhausted_attempts)."""
    value = config.get("max_course_attempts")
    if value is None:
        return
    if not isinstance(value, int) or isinstance(value, bool) or value < 1:
        raise PlanValidationError("max_course_attempts must be a positive integer")
    if value < _MAX_COURSE_ATTEMPTS_MIN or value > _MAX_COURSE_ATTEMPTS_MAX:
        raise PlanValidationError(
            f"max_course_attempts must be between {_MAX_COURSE_ATTEMPTS_MIN} and "
            f"{_MAX_COURSE_ATTEMPTS_MAX} (got {value})"
        )


def validate_capacity_vs_occupancy(curriculum: dict[str, Course], config: dict) -> None:
    """initial_state.occupancy[code] must not exceed that course's capacity. Today
    `Simulator._effective_capacity` silently floors `capacity - occupancy` at 0 — so an
    over-occupied required gateway can be quietly zeroed into mass CENSORED instead of erroring
    up front. Only checks courses present in `curriculum`; an occupancy entry for a code that
    doesn't exist in this plan is the create/import path's problem, not this one's."""
    occupancy: dict = config.get("initial_state", {}).get("occupancy", {})
    violations = sorted(
        code for code, seats in occupancy.items()
        if code in curriculum and isinstance(seats, int) and seats > curriculum[code].capacity
    )
    if violations:
        raise PlanValidationError(
            f"initial_state.occupancy exceeds capacity for: {', '.join(violations)}"
        )


def validate_prerequisites_locked(current: Course, patch_fields: dict) -> None:
    """Prerequisites/rule_expr are write-once: settable only at course creation (Plan Builder's
    course step, or `POST /curriculum` for a course added later — both still cycle-checked by
    `check_no_cycle`), never editable afterward via `PUT /curriculum/{code}`. They define
    eligibility, which drives the whole deterministic trajectory, so changing them on an
    existing course would silently invalidate what any run built on the old graph means.
    Diff-based, not presence-based: the Settings edit form always includes both fields in a
    save, so only an actual *change* to either is rejected — capacity/title/offering-only saves
    are unaffected. `patch_fields` is the caller's already-normalized patch dict (prerequisites
    as a tuple, if present)."""
    if "prerequisites" in patch_fields and tuple(patch_fields["prerequisites"]) != tuple(current.prerequisites):
        raise PlanValidationError(
            "prerequisites are locked after course creation; recreate the course (or use Plan Builder) to change them"
        )
    if "rule_expr" in patch_fields and patch_fields["rule_expr"] != current.rule_expr:
        raise PlanValidationError(
            "rule_expr is locked after course creation; recreate the course (or use Plan Builder) to change it"
        )


def validate_plan_edits(curriculum: dict[str, Course], config: dict) -> None:
    """Run every cross-object guardrail against a hypothetical post-edit (curriculum, config).
    Called by every write path that can move capacity/occupancy/intake: `PUT /curriculum/{code}`,
    `POST /curriculum`, and `PUT /config`."""
    validate_cohort_size(config)
    validate_capacity_vs_occupancy(curriculum, config)
    validate_credit_load_bounds(config)
    validate_max_course_attempts(config)
    # Curriculum topology guardrails (missing prereqs, cycles, unreachable depth).
    from src.curriculum_validation import validate_curriculum_topology
    try:
        validate_curriculum_topology(curriculum, config)
    except Exception as e:
        raise PlanValidationError(str(e)) from e


def validate_initial_state(value: object, config: dict) -> None:
    """Shape-check the initial-state warm start: {occupancy: {code: int>=0}}. The starting
    student body is driven entirely by per-course occupancy now — there is no separate
    year-standing head-count (see CLAUDE.md's "Initial-State Model")."""
    if not isinstance(value, dict):
        raise PlanValidationError("initial_state must be an object")
    occupancy = value.get("occupancy", {})
    if not isinstance(occupancy, dict) or not all(
        isinstance(v, int) and not isinstance(v, bool) and v >= 0 for v in occupancy.values()
    ):
        raise PlanValidationError("initial_state.occupancy must map course codes to non-negative integers")


def validate_admissions(patch: dict, config: dict) -> None:
    """Guard the seasonal-admission knobs against the plan's *mandatory* seasons. Admission is
    only ever allowed in a mandatory season (Fall/Spring by default) — an optional intersession
    (Summer/Winter) is a deliberately-scarce bonus pool and must never take in a cohort, so a
    request naming one is rejected rather than silently filtered. Sizes must be positive."""
    if "admission_terms" in patch:
        terms = patch["admission_terms"]
        mandatory = set(get_mandatory_seasons(config))
        if not (isinstance(terms, list) and terms and all(isinstance(s, str) for s in terms)):
            raise PlanValidationError("admission_terms must be a non-empty list of season names")
        bad = [s for s in terms if s not in mandatory]
        if bad:
            raise PlanValidationError(
                f"admission_terms must be mandatory seasons {sorted(mandatory)}; "
                f"optional seasons cannot admit a cohort. Got {bad}"
            )
    if "admission_sizes" in patch:
        sizes = patch["admission_sizes"]
        if not isinstance(sizes, dict) or not all(
            isinstance(v, int) and not isinstance(v, bool) and v >= 1 for v in sizes.values()
        ):
            raise PlanValidationError("admission_sizes must map season names to positive integers")
