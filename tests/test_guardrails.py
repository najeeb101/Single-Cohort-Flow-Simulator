"""Tests for the cross-cutting guardrails that protect the engine/API from a config or AI
proposal that would silently corrupt a run:

  - Curriculum topology (src/curriculum_validation.py): missing prerequisites, cycles,
    unreachable prerequisite depth.
  - Plan-edit bounds (src/plan_validation.py): intake size, credit-load ceilings, max
    course-attempt bounds, all wired into validate_plan_edits (the single entry point every
    write path calls).
  - Student progression (src/models/student.py): the retake-attempt cap, tracked on the model
    and enforced both defensively (get_desired_courses) and authoritatively (Simulator).
  - Simulator (src/simulator.py): fail-fast construction on an out-of-bounds config, and the
    hard end-of-term drop once a student exhausts a course's attempt cap.
  - AI proposal integrity (src/advisor.py): conflicting proposals collapse to one, and a
    pass-rate increase is capped.
  - Auto-fill (src/optimizer.py): run_budget bounds the solver's cost (deeper coverage lives in
    tests/test_optimizer.py; this file adds one end-to-end sanity check for cohesion).
"""
from __future__ import annotations

import pytest

from src.models.course import Course
from src.models.student import Student
from src.simulator import Simulator
from src.utils import load_json

SEED = 1


# ─────────────────────────────────────────────────────────────────────────── #
# Curriculum topology (src/curriculum_validation.py)                         #
# ─────────────────────────────────────────────────────────────────────────── #

def _course(code, prereqs=(), credits=3, study_plan_term=1):
    return Course(
        code=code, title=code, credits=credits, prerequisites=tuple(prereqs),
        pass_rate=0.8, offering=("Fall", "Spring"), category="cs_core", capacity=50,
        study_plan_term=study_plan_term,
    )


class TestCurriculumTopology:
    def test_missing_prerequisite_rejected(self):
        from src.curriculum_validation import PlanImportError, validate_missing_prerequisites

        curriculum = {"A": _course("A", prereqs=("GHOST",))}
        with pytest.raises(PlanImportError, match="GHOST"):
            validate_missing_prerequisites(curriculum)

    def test_present_prerequisite_accepted(self):
        from src.curriculum_validation import validate_missing_prerequisites

        curriculum = {"A": _course("A"), "B": _course("B", prereqs=("A",))}
        validate_missing_prerequisites(curriculum)  # no raise

    def test_unreachable_depth_rejected_when_chain_exceeds_max_terms(self):
        """Regression: the raise used to sit inside a `try/except Exception: pass`, so this
        guardrail silently never fired. A 5-course straight-line chain needs 5 terms; a plan
        capped at max_terms=2 can never actually complete it."""
        from src.curriculum_validation import PlanImportError, validate_unreachable_prereq_depth

        chain = {}
        prev = None
        for i in range(5):
            code = f"C{i}"
            chain[code] = _course(code, prereqs=(prev,) if prev else ())
            prev = code

        with pytest.raises(PlanImportError, match="exceeds max_terms"):
            validate_unreachable_prereq_depth(chain, {"max_terms": 2})

    def test_unreachable_depth_accepted_within_max_terms(self):
        from src.curriculum_validation import validate_unreachable_prereq_depth

        chain = {"A": _course("A"), "B": _course("B", prereqs=("A",))}
        validate_unreachable_prereq_depth(chain, {"max_terms": 12})  # no raise

    def test_validate_curriculum_topology_runs_all_three_checks(self):
        from src.curriculum_validation import PlanImportError, validate_curriculum_topology

        # Missing-prereq is checked first, so it's what surfaces here even though this
        # curriculum would also fail the depth check.
        curriculum = {"A": _course("A", prereqs=("GHOST",))}
        with pytest.raises(PlanImportError):
            validate_curriculum_topology(curriculum, {"max_terms": 12})


# ─────────────────────────────────────────────────────────────────────────── #
# Plan-edit bounds (src/plan_validation.py)                                  #
# ─────────────────────────────────────────────────────────────────────────── #

class TestPlanValidationBounds:
    def test_cohort_size_out_of_bounds_rejected(self):
        from src.plan_validation import PlanValidationError, validate_cohort_size

        with pytest.raises(PlanValidationError):
            validate_cohort_size({"cohort_size": 5})  # below the 10 floor
        with pytest.raises(PlanValidationError):
            validate_cohort_size({"cohort_size": 5000})  # above the 1000 ceiling

    def test_cohort_size_within_bounds_accepted(self):
        from src.plan_validation import validate_cohort_size

        validate_cohort_size({"cohort_size": 100})  # no raise
        validate_cohort_size({})  # absent -> skipped, no raise

    def test_credit_load_bounds_rejects_out_of_range(self):
        from src.plan_validation import PlanValidationError, validate_credit_load_bounds

        with pytest.raises(PlanValidationError):
            validate_credit_load_bounds({"normal_load_ch": 30})  # above the 24 ceiling
        with pytest.raises(PlanValidationError):
            validate_credit_load_bounds({"normal_load_ch": 0})  # below the 1 floor

    def test_credit_load_bounds_rejects_probation_exceeding_normal(self):
        """A probation load cap higher than the normal load cap would give a student in poor
        standing MORE credits than one in good standing — backwards from the policy's intent."""
        from src.plan_validation import PlanValidationError, validate_credit_load_bounds

        with pytest.raises(PlanValidationError, match="probation_load_ch"):
            validate_credit_load_bounds({"normal_load_ch": 12, "probation_load_ch": 15})

    def test_credit_load_bounds_accepts_realistic_values(self):
        from src.plan_validation import validate_credit_load_bounds

        validate_credit_load_bounds({"normal_load_ch": 18, "probation_load_ch": 12})  # no raise
        validate_credit_load_bounds({})  # absent -> skipped, no raise

    def test_max_course_attempts_bounds(self):
        from src.plan_validation import PlanValidationError, validate_max_course_attempts

        with pytest.raises(PlanValidationError):
            validate_max_course_attempts({"max_course_attempts": 0})
        with pytest.raises(PlanValidationError):
            validate_max_course_attempts({"max_course_attempts": 50})
        validate_max_course_attempts({"max_course_attempts": 3})  # no raise
        validate_max_course_attempts({})  # absent -> skipped, no raise

    def test_validate_plan_edits_wires_in_curriculum_topology(self):
        """validate_plan_edits (the single entry point every write path calls) must reject a
        curriculum whose prerequisite graph is broken, not just bad config scalars."""
        from src.plan_validation import PlanValidationError, validate_plan_edits

        curriculum = {"A": _course("A", prereqs=("GHOST",))}
        config = {"cohort_size": 100, "max_terms": 12}
        with pytest.raises(PlanValidationError):
            validate_plan_edits(curriculum, config)

    def test_validate_plan_edits_accepts_a_healthy_plan(self):
        from src.plan_validation import validate_plan_edits

        curriculum = {"A": _course("A"), "B": _course("B", prereqs=("A",))}
        config = {
            "cohort_size": 100, "max_terms": 12,
            "normal_load_ch": 18, "probation_load_ch": 12,
            "max_course_attempts": 3,
        }
        validate_plan_edits(curriculum, config)  # no raise


# ─────────────────────────────────────────────────────────────────────────── #
# Student progression: attempt tracking (src/models/student.py)              #
# ─────────────────────────────────────────────────────────────────────────── #

class TestStudentAttemptTracking:
    def test_attempts_used_reflects_failed_attempts(self):
        student = Student(student_id=0, seed=SEED)
        assert student.attempts_used("C1") == 0
        student.failed_attempts["C1"] = 2
        assert student.attempts_used("C1") == 2

    def test_has_exhausted_attempts_at_configured_cap(self):
        student = Student(student_id=0, seed=SEED)
        config = {"max_course_attempts": 3}
        student.failed_attempts["C1"] = 2
        assert not student.has_exhausted_attempts("C1", config)
        student.failed_attempts["C1"] = 3
        assert student.has_exhausted_attempts("C1", config)

    def test_has_exhausted_attempts_defaults_to_three_when_unconfigured(self):
        student = Student(student_id=0, seed=SEED)
        student.failed_attempts["C1"] = 3
        assert student.has_exhausted_attempts("C1", {})

    def test_get_desired_courses_excludes_a_course_with_exhausted_attempts(self):
        """Defense in depth: a student who has already burned every attempt on a course must
        never be offered it again, even before the simulator's own end-of-term drop fires."""
        curriculum = {"C1": _course("C1")}
        config = {
            "normal_load_ch": 18, "probation_load_ch": 12,
            "enrollment_priority_tiers": [{"categories": ["cs_core"]}],
            "max_course_attempts": 3,
        }
        student = Student(student_id=0, seed=SEED)
        student.failed_attempts["C1"] = 3
        desired = student.get_desired_courses([curriculum["C1"]], curriculum, config)
        assert desired == []

    def test_get_desired_courses_still_offers_a_course_with_attempts_remaining(self):
        curriculum = {"C1": _course("C1")}
        config = {
            "normal_load_ch": 18, "probation_load_ch": 12,
            "enrollment_priority_tiers": [{"categories": ["cs_core"]}],
            "max_course_attempts": 3,
        }
        student = Student(student_id=0, seed=SEED)
        student.failed_attempts["C1"] = 1
        desired = student.get_desired_courses([curriculum["C1"]], curriculum, config)
        assert [c.code for c in desired] == ["C1"]


# ─────────────────────────────────────────────────────────────────────────── #
# Simulator: credit load ceilings + max attempt enforcement (src/simulator.py) #
# ─────────────────────────────────────────────────────────────────────────── #

def _minimal_config(**overrides) -> dict:
    config = {
        "seed": SEED,
        "cohort_size": 1,
        "max_terms": 12,
        "normal_load_ch": 12,
        "probation_load_ch": 9,
        "probation_gpa_threshold": 2.0,
        "probation_min_ch": 999,       # never trigger probation in these tests
        "dropout_gpa_floor": 0.0,      # never trigger the chronic-low-GPA hazard
        "dropout_base_hazard": 0.0,
        "dropout_early_multiplier": 1.0,
        "dropout_early_sem_cutoff": 4,
        "dropout_fails_threshold": 99,  # disable the secondary same-course hazard so only the
        "dropout_prob_on_repeated_fail": 0.0,  # hard attempt-cap guardrail below can fire
        "ability_sd": 0.0,
        "ability_clip": 0.0,
        "registration_tier_thresholds": [90, 75, 60, 45, 30],
        "enrollment_priority_tiers": [{"categories": ["cs_core"]}],
        "grade_tiers": {
            "hard_max": 1.0, "medium_max": 1.0,
            "hard": {"A": 1.0}, "medium": {"A": 1.0}, "easy": {"A": 1.0},
        },
        "max_course_attempts": 3,
    }
    config.update(overrides)
    return config


def _tiny_curriculum() -> dict:
    return {"C1": _course("C1")}


class TestSimulatorCreditLoadCeiling:
    def test_construction_rejects_load_ch_above_ceiling(self):
        config = _minimal_config(normal_load_ch=30)
        with pytest.raises(ValueError):
            Simulator(_tiny_curriculum(), config, {"name": "test"})

    def test_construction_rejects_probation_load_exceeding_normal_load(self):
        config = _minimal_config(normal_load_ch=12, probation_load_ch=18)
        with pytest.raises(ValueError):
            Simulator(_tiny_curriculum(), config, {"name": "test"})

    def test_construction_rejects_max_course_attempts_out_of_bounds(self):
        config = _minimal_config(max_course_attempts=0)
        with pytest.raises(ValueError):
            Simulator(_tiny_curriculum(), config, {"name": "test"})

    def test_construction_accepts_realistic_bounds(self):
        config = _minimal_config()
        Simulator(_tiny_curriculum(), config, {"name": "test"})  # no raise


class TestSimulatorMaxAttemptEnforcement:
    def test_student_dropped_once_attempts_exhausted(self):
        config = _minimal_config()
        sim = Simulator(_tiny_curriculum(), config, {"name": "test"})
        sim._make_students()
        student = sim.students[0]
        student.failed_attempts["C1"] = config["max_course_attempts"]

        sim._run_term(0, "Fall")

        assert student.status == "DROPPED"

    def test_student_not_dropped_with_attempts_remaining(self):
        config = _minimal_config()
        sim = Simulator(_tiny_curriculum(), config, {"name": "test"})
        sim._make_students()
        student = sim.students[0]
        student.failed_attempts["C1"] = config["max_course_attempts"] - 1

        sim._run_term(0, "Fall")

        assert student.status != "DROPPED"


# ─────────────────────────────────────────────────────────────────────────── #
# AI proposal integrity (src/advisor.py)                                     #
# ─────────────────────────────────────────────────────────────────────────── #

class TestAdvisorProposalIntegrity:
    def test_conflicting_proposals_for_the_same_course_collapse_to_first(self):
        from src import advisor

        curriculum = {"C": Course(code="C", title="C", credits=3, prerequisites=(),
                                   pass_rate=0.8, offering=("Fall",), category="cs_core",
                                   capacity=50, study_plan_term=1)}
        config = {"cohort_size": 100}
        raw = [
            {"type": "capacity", "code": "C", "value": 60, "reason": "first"},
            {"type": "capacity", "code": "C", "value": 200, "reason": "conflicting second"},
        ]
        out = advisor.validate_proposals(raw, curriculum, config)
        assert len(out) == 1
        assert out[0]["value"] == 60

    def test_pass_rate_increase_is_capped(self):
        from src import advisor

        curriculum = {"C": Course(code="C", title="C", credits=3, prerequisites=(),
                                   pass_rate=0.5, offering=("Fall",), category="cs_core",
                                   capacity=50, study_plan_term=1)}
        config = {"cohort_size": 100}
        raw = [{"type": "pass_rate", "code": "C", "value": 0.95, "reason": "big jump"}]
        out = advisor.validate_proposals(raw, curriculum, config)
        assert len(out) == 1
        assert out[0]["value"] == pytest.approx(0.65)  # 0.5 + _MAX_PASS_RATE_DELTA (0.15)

    def test_pass_rate_increase_within_cap_is_untouched(self):
        from src import advisor

        curriculum = {"C": Course(code="C", title="C", credits=3, prerequisites=(),
                                   pass_rate=0.5, offering=("Fall",), category="cs_core",
                                   capacity=50, study_plan_term=1)}
        config = {"cohort_size": 100}
        raw = [{"type": "pass_rate", "code": "C", "value": 0.6, "reason": "modest bump"}]
        out = advisor.validate_proposals(raw, curriculum, config)
        assert out[0]["value"] == 0.6


# ─────────────────────────────────────────────────────────────────────────── #
# Auto-fill: budget-capped solver (src/optimizer.py)                         #
# Deeper coverage (clamping an absurd run_budget, monotonicity) lives in     #
# tests/test_optimizer.py — this is a single end-to-end sanity check that a  #
# tight budget really does bound the solver's cost.                         #
# ─────────────────────────────────────────────────────────────────────────── #

class TestAutofillBudgetCap:
    def test_tight_run_budget_bounds_solver_cost(self):
        from src.models.course import load_curriculum
        from src.optimizer import solve_for_targets

        config = load_json("data/simulation_config.json")
        curriculum = load_curriculum("data/curriculum.json")
        res = solve_for_targets(curriculum, config, run_budget=1)
        assert res["runs"] <= 1
