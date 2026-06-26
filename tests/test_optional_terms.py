"""Tests for the generalized term/season model: mandatory Fall/Spring + optional
Winter/Summer intersessions (CLAUDE.md's "Term/Season Model"). The legacy 2-season
behavior (every other test file's fixtures) is covered by the rest of the suite staying
green unmodified -- these tests specifically exercise the new, opt-in 4-season cycle.
"""
from __future__ import annotations

import math

from src.models.course import course_from_dict
from src.models.semester import (
    effective_admit_interval_terms,
    get_mandatory_seasons,
    get_terms,
    mandatory_horizon_end_term,
    term_season,
)
from src.models.student import Student
from src.simulator import Simulator

FOUR_SEASON_CONFIG_BASE = {
    "seed": 1,
    "terms_per_year": ["Fall", "Winter", "Spring", "Summer"],
    "mandatory_terms": ["Fall", "Spring"],
    "seats_per_section": 35,
    "normal_load_ch": 9,        # exactly one 9-credit course per term, for deterministic sequencing
    "probation_load_ch": 9,
    "probation_gpa_threshold": 2.0,
    "probation_min_ch": 25,
    "dropout_gpa_floor": 2.0,
    "dropout_base_hazard": 0.0,  # deterministic: no stochastic dropout
    "dropout_early_multiplier": 1.0,
    "dropout_early_sem_cutoff": 4,
    "dropout_fails_threshold": 99,
    "dropout_prob_on_repeated_fail": 0.0,
    "ability_sd": 0.0,
    "ability_clip": 0.0,
    "registration_tier_thresholds": [90, 75, 60, 45, 30],
    "enrollment_priority_tiers": [{"categories": ["cs_core"]}],
    "grade_tiers": {
        "hard_max": 0.5, "medium_max": 0.9,
        "hard": {"A": 1.0}, "medium": {"A": 1.0}, "easy": {"A": 1.0},
    },
}


def _course(code, credits, prereqs, offering, order):
    return course_from_dict({
        "code": code, "title": code, "credits": credits, "prerequisites": prereqs,
        "pass_rate": 0.95, "offering": offering, "category": "cs_core", "capacity": 35,
        "study_plan_order": order,
    })


# ── mandatory_horizon_end_term ─────────────────────────────────────────── #

def test_mandatory_horizon_legacy_two_season_default():
    # No config -> legacy Fall/Spring-only cycle, every season mandatory: identical to the
    # old `entry_term + max_terms` formula.
    assert mandatory_horizon_end_term(0, 12) == 12
    assert mandatory_horizon_end_term(4, 8) == 12


def test_mandatory_horizon_four_season_cycle():
    config = {"terms_per_year": ["Fall", "Winter", "Spring", "Summer"],
              "mandatory_terms": ["Fall", "Spring"]}
    # term0=Fall(mandatory),1=Winter,2=Spring(mandatory),3=Summer,4=Fall(mandatory),
    # 5=Winter,6=Spring(mandatory),7=Summer,...
    assert mandatory_horizon_end_term(0, 1, config) == 1   # just Fall
    assert mandatory_horizon_end_term(0, 2, config) == 3   # Fall, Winter, Spring
    assert mandatory_horizon_end_term(0, 4, config) == 7   # 4th mandatory term is Spring of year 2 (t=6)


def test_get_terms_and_mandatory_seasons_default_to_legacy():
    assert get_terms(None) == ("Fall", "Spring")
    assert get_mandatory_seasons(None) == frozenset({"Fall", "Spring"})
    assert get_mandatory_seasons({}) == frozenset({"Fall", "Spring"})


# ── personal_semester: only advances on mandatory terms ────────────────── #

def test_personal_semester_skips_optional_terms_but_lets_student_progress():
    """C1 (no prereq, Fall/Spring/Winter), C2 (prereq C1, Fall/Spring), C3 (no prereq,
    Fall/Spring/Winter). With a 9-CH load cap (one course/term), a student who uses the
    optional Winter term to clear C3 graduates in calendar term 2 (Spring) but only 2
    *mandatory* semesters — proving Winter didn't cost them a semester."""
    curriculum = {
        "C1": _course("C1", 9, [], ["Fall", "Spring", "Winter"], 1),
        "C2": _course("C2", 9, ["C1"], ["Fall", "Spring"], 2),
        "C3": _course("C3", 9, [], ["Fall", "Spring", "Winter"], 3),
    }
    config = {**FOUR_SEASON_CONFIG_BASE, "cohort_size": 15, "max_terms": 6,
              "num_cohorts": 1, "num_incumbent_cohorts": 0, "admit_interval_terms": 4,
              "course_sections": {"C1": 1, "C2": 1, "C3": 1}}
    result = Simulator(curriculum, config, {"name": "t"}).run()

    seasons_seen = {f["season"] for f in result.history.timeline}
    assert "Winter" in seasons_seen, "expected the simulation window to include a Winter term"

    graduated = [s for s in result.students if s.status == "GRADUATED"]
    assert graduated, "expected at least one student to graduate"
    assert any(s.grad_semester == 2 for s in graduated), (
        "expected at least one student to graduate in 2 mandatory semesters "
        f"(got {[s.grad_semester for s in graduated]})"
    )


# ── No cohort is ever admitted in an optional term ─────────────────────── #

def test_cohorts_never_admitted_in_optional_terms():
    curriculum = {"C1": _course("C1", 3, [], ["Fall", "Spring"], 1)}
    config = {**FOUR_SEASON_CONFIG_BASE, "cohort_size": 5, "max_terms": 2,
              "num_cohorts": 3, "num_incumbent_cohorts": 2, "admit_interval_terms": 4,
              "course_sections": {"C1": 1}}
    result = Simulator(curriculum, config, {"name": "t"}).run()

    mandatory = get_mandatory_seasons(config)
    entry_terms = {s.entry_term for s in result.students}
    for t in entry_terms:
        assert term_season(t, config) in mandatory, f"cohort admitted in optional term {t}"


# ── Optional-term capacity is smaller/separate ─────────────────────────── #

def test_optional_term_capacity_uses_explicit_override():
    course = _course("C1", 3, [], ["Fall", "Spring", "Summer"], 1)
    config = {**FOUR_SEASON_CONFIG_BASE, "cohort_size": 1, "max_terms": 1,
              "num_cohorts": 1, "num_incumbent_cohorts": 0, "admit_interval_terms": 4,
              "course_sections": {"C1": 5},
              "optional_term_course_sections": {"C1": 1}}
    sim = Simulator({"C1": course}, config, {"name": "t"})

    regular = sim._effective_capacity(course, "Fall")
    optional = sim._effective_capacity(course, "Summer")
    assert regular == 5 * config["seats_per_section"]
    assert optional == 1 * config["seats_per_section"]
    assert optional < regular


def test_optional_term_capacity_falls_back_to_scale():
    course = _course("C1", 3, [], ["Fall", "Spring", "Summer"], 1)
    config = {**FOUR_SEASON_CONFIG_BASE, "cohort_size": 1, "max_terms": 1,
              "num_cohorts": 1, "num_incumbent_cohorts": 0, "admit_interval_terms": 4,
              "course_sections": {"C1": 4}, "optional_term_capacity_scale": 0.5}
    sim = Simulator({"C1": course}, config, {"name": "t"})

    expected_sections = max(1, math.floor(4 * 0.5))
    assert sim._section_count(course, "Summer") == expected_sections
    assert sim._section_count(course) == 4          # no season arg -> unaffected, legacy path
    assert sim._section_count(course, "Fall") == 4   # mandatory season -> unaffected


# ── prereq_block during an optional term: only for courses offered then ── #

def test_prereq_block_scoped_to_courses_offered_in_optional_term():
    """B is offered in Winter and gated by A; C is gated by A but Fall/Spring-only. A
    student who hasn't passed A yet, during a Winter term, should accumulate a prereq_block
    for B (an actionable, offered-now opportunity) but NOT for C (not offered this term
    regardless of prerequisites -- recording it would just inflate from term count)."""
    curriculum = {
        "A": _course("A", 3, [], ["Fall", "Spring"], 1),
        "B": _course("B", 3, ["A"], ["Fall", "Spring", "Winter"], 2),
        "C": _course("C", 3, ["A"], ["Fall", "Spring"], 3),
    }
    config = {**FOUR_SEASON_CONFIG_BASE, "cohort_size": 1, "max_terms": 4,
              "num_cohorts": 1, "num_incumbent_cohorts": 0, "admit_interval_terms": 4,
              "course_sections": {"A": 1, "B": 1, "C": 1}}
    sim = Simulator(curriculum, config, {"name": "t"})
    student = Student(0, seed=1, cohort_id=0, entry_term=0)
    sim.students = [student]
    sim.cohort_entry[0] = 0

    sim._run_term(1, "Winter")  # term 1 in the 4-cycle is Winter

    assert sim.history.prereq_block_counts.get("B", 0) == 1
    assert sim.history.prereq_block_counts.get("C", 0) == 0
    assert sim.history.offering_block_counts.get("C", 0) == 0  # not swept this term at all


# ── optional_terms_enabled: admin on/off switch (Settings -> PUT /config) ──────────── #

def _four_season_config(**overrides):
    return {
        "terms_per_year": ["Fall", "Winter", "Spring", "Summer"],
        "mandatory_terms": ["Fall", "Spring"],
        "admit_interval_terms": 4,
        **overrides,
    }


def test_optional_terms_enabled_false_collapses_terms_per_year_to_mandatory_only():
    config = _four_season_config(optional_terms_enabled=False)
    assert get_terms(config) == ("Fall", "Spring")
    assert get_mandatory_seasons(config) == frozenset({"Fall", "Spring"})
    # No Winter/Summer anywhere in the cycle once disabled.
    assert term_season(1, config) == "Spring"   # term 1 would be Winter under the 4-season cycle
    assert term_season(3, config) == "Spring"   # term 3 would be Summer under the 4-season cycle


def test_optional_terms_enabled_true_matches_omitting_the_flag():
    explicit_on = _four_season_config(optional_terms_enabled=True)
    omitted = _four_season_config()
    assert get_terms(explicit_on) == get_terms(omitted) == ("Fall", "Winter", "Spring", "Summer")
    assert get_mandatory_seasons(explicit_on) == get_mandatory_seasons(omitted) == frozenset({"Fall", "Spring"})


def test_effective_admit_interval_rescales_to_one_year_when_disabled():
    # admit_interval_terms (4) matches the full 4-season cycle length -> it was set on the
    # "one full year" convention, so disabling optional terms rescales it to 2 (one year
    # under the now-2-season cycle) rather than silently admitting only every other year.
    config = _four_season_config(optional_terms_enabled=False)
    assert effective_admit_interval_terms(config) == 2
    # Enabled (or omitted) -> unchanged, matches the stored 4-season cadence.
    assert effective_admit_interval_terms(_four_season_config(optional_terms_enabled=True)) == 4
    assert effective_admit_interval_terms(_four_season_config()) == 4


def test_effective_admit_interval_leaves_custom_cadence_untouched():
    # 6 doesn't match len(terms_per_year)==4, so it wasn't the "one full year" convention --
    # leave an admin's deliberate non-yearly cadence alone even with optional terms off.
    config = _four_season_config(admit_interval_terms=6, optional_terms_enabled=False)
    assert effective_admit_interval_terms(config) == 6


def test_optional_terms_toggle_off_produces_legacy_two_season_simulation():
    """End-to-end: a course offered Fall/Spring/Winter is never reachable in Winter once the
    toggle is off, and the simulation never produces a Winter/Summer timeline frame at all."""
    curriculum = {"C1": _course("C1", 9, [], ["Fall", "Spring", "Winter"], 1)}
    config = {
        **FOUR_SEASON_CONFIG_BASE, "optional_terms_enabled": False,
        "cohort_size": 5, "max_terms": 2,
        "num_cohorts": 1, "num_incumbent_cohorts": 0,
        "course_sections": {"C1": 1},
    }
    result = Simulator(curriculum, config, {"name": "t"}).run()
    seasons_seen = {f["season"] for f in result.history.timeline}
    assert seasons_seen <= {"Fall", "Spring"}
    assert "Winter" not in seasons_seen and "Summer" not in seasons_seen
