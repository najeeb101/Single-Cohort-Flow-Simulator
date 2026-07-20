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
from src.models.student import standing_levels


class PlanValidationError(Exception):
    """Raised on a guardrail violation. Callers (src/api.py) map this to HTTP 422."""


def validate_cohort_size(config: dict) -> None:
    """cohort_size must be a positive integer. Closes a real gap: neither
    `ScenarioRequest.cohort_size` nor `PUT /config` enforced this before, so `cohort_size: 0`
    could reach `SyntheticDataSource` and produce degenerate (empty) cohorts."""
    size = config.get("cohort_size")
    if size is None:
        return
    if not isinstance(size, int) or isinstance(size, bool) or size < 1:
        raise PlanValidationError("cohort_size must be a positive integer")


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


def validate_initial_state(value: object, config: dict) -> None:
    """Shape-check the initial-state warm start: {occupancy: {code: int>=0}, standing:
    {<year-band>: int>=0}}. Both keys optional; raises PlanValidationError on a bad shape. The
    valid standing keys are the plan's own year bands above Year1 (`standing_levels(config)`),
    not a hardcoded Year2/3/4 set, so a program that isn't 4 years long validates correctly."""
    if not isinstance(value, dict):
        raise PlanValidationError("initial_state must be an object")
    occupancy = value.get("occupancy", {})
    if not isinstance(occupancy, dict) or not all(
        isinstance(v, int) and not isinstance(v, bool) and v >= 0 for v in occupancy.values()
    ):
        raise PlanValidationError("initial_state.occupancy must map course codes to non-negative integers")
    valid_standing = set(standing_levels(config))
    standing = value.get("standing", {})
    if not isinstance(standing, dict) or not set(standing) <= valid_standing or not all(
        isinstance(v, int) and not isinstance(v, bool) and v >= 0 for v in standing.values()
    ):
        raise PlanValidationError(
            f"initial_state.standing keys must be a subset of {sorted(valid_standing)} with non-negative integer values"
        )


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
