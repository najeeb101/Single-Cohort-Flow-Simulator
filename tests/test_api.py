"""Tests for the FastAPI wrapper (src/api.py) — the HTTP boundary over run_simulation
(ACIP plan §2.3/§3.2). Parity with run_simulation() mirrors the pattern in
tests/test_service.py::test_matches_manual_construction.
"""
from __future__ import annotations

from fastapi.testclient import TestClient

from src.api import app
from src.db import (
    SessionLocal,
    get_or_create_default_plan,
    load_config_from_db,
    load_curriculum_from_db,
)
from src.models.semester import get_mandatory_seasons
from src.service import run_simulation

client = TestClient(app)

with SessionLocal() as _session:
    _plan = get_or_create_default_plan(_session)
    CURRICULUM = load_curriculum_from_db(_session, _plan.id)
    BASE_CONFIG = load_config_from_db(_session, _plan.id)
    BASE_SCENARIO = BASE_CONFIG["scenarios"][0]


def test_health():
    resp = client.get("/health")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}


def test_meta_shape():
    resp = client.get("/meta")
    assert resp.status_code == 200
    body = resp.json()
    assert set(body) == {
        "graph", "course_sections", "course_pass_rates", "seats_per_section",
        "baseline_scenario", "cohort_size", "num_cohorts", "num_incumbent_cohorts",
        "initial_state",
        "admit_interval_terms", "optional_terms_enabled", "max_terms", "seed", "dropout_gpa_floor",
        "dropout_base_hazard", "dropout_early_multiplier", "dropout_early_sem_cutoff",
        "dropout_fails_threshold", "dropout_prob_on_repeated_fail",
        "registration_tier_thresholds", "enrollment_priority_tiers",
        "admission_targets",
    }
    assert len(body["graph"]["nodes"]) == len(CURRICULUM)
    assert set(body["course_pass_rates"]) == set(CURRICULUM)
    assert set(body["initial_state"]) == {"occupancy", "standing"}


def test_simulate_initial_state_override_changes_capacity_and_background():
    code = next(iter(CURRICULUM))
    sections = BASE_CONFIG["course_sections"].get(code, 1)
    sps = BASE_CONFIG.get("seats_per_section", 35)
    overridden = {"occupancy": {code: 7}, "standing": {"Year3": 123}}

    resp = client.post("/simulate", json={"initial_state": overridden})
    assert resp.status_code == 200
    frames = resp.json()["flow_timeline"]["frames"]
    frame0 = next(f for f in frames if f["term"] == 0)

    # Occupancy reduced the course's free seats by exactly 7 on this mandatory term.
    assert frame0["courses"][code]["capacity"] == sections * sps - 7
    # Standing flowed into the aggregate stage nodes / background.
    assert frame0["background"] == {"Year3": 123}
    assert frame0["stages"]["totals"]["nodes"]["Year3"] >= 123


def test_update_config_rejects_malformed_initial_state():
    resp = client.put("/config", json={"initial_state": {"standing": {"Year9": 5}}})
    assert resp.status_code == 422


def test_simulate_default_matches_run_simulation():
    resp = client.post("/simulate", json={})
    assert resp.status_code == 200
    body = resp.json()
    assert set(body) == {"metrics", "cohort_metrics", "admissions_recommendation", "flow_timeline"}

    expected = run_simulation(CURRICULUM, BASE_CONFIG, BASE_SCENARIO)
    expected_top_fail = [list(pair) for pair in expected["metrics"].pop("top_fail_courses")]
    expected_top_capacity = [list(pair) for pair in expected["metrics"].pop("top_capacity_blocks")]
    expected_top_offering = [list(pair) for pair in expected["metrics"].pop("top_offering_blocks")]
    expected_top_prereq = [list(pair) for pair in expected["metrics"].pop("top_prereq_blocks")]
    expected_grad_dist = [list(pair) for pair in expected["metrics"].pop("graduation_time_distribution")]
    actual_metrics = dict(body["metrics"])
    assert actual_metrics.pop("top_fail_courses") == expected_top_fail
    assert actual_metrics.pop("top_capacity_blocks") == expected_top_capacity
    assert actual_metrics.pop("top_offering_blocks") == expected_top_offering
    assert actual_metrics.pop("top_prereq_blocks") == expected_top_prereq
    assert actual_metrics.pop("graduation_time_distribution") == expected_grad_dist
    assert actual_metrics == expected["metrics"]
    assert body["flow_timeline"]["meta"]["graph"] == expected["flow_timeline"]["meta"]["graph"]


def test_simulate_capacity_override_changes_result():
    # Pick whichever course tops the baseline's capacity-block ranking — hardcoding
    # CMPS303 would silently no-op if hand-tuned section counts move the bottleneck.
    baseline = client.post("/simulate", json={}).json()
    code, baseline_count = baseline["metrics"]["top_capacity_blocks"][0]

    boosted = client.post("/simulate", json={"capacity_overrides": {code: 3.0}}).json()
    boosted_count = dict(boosted["metrics"]["top_capacity_blocks"]).get(code, 0)

    assert boosted_count < baseline_count


def _mandatory_term_capacity_blocks(flow_timeline: dict) -> dict[str, int]:
    """`course_sections_overrides` only patches the regular (mandatory-term) section map —
    courses offered in an optional term (Winter/Summer) use a separate, smaller capacity
    model (see CLAUDE.md's Term/Season Model) the override doesn't touch. Recompute
    denied-seat totals scoped to mandatory-term frames so the override's actual contract
    is what gets tested, independent of which course happens to be globally top-blocked."""
    mandatory = get_mandatory_seasons(BASE_CONFIG)
    totals: dict[str, int] = {}
    for frame in flow_timeline["frames"]:
        if frame["season"] not in mandatory:
            continue
        for code, stats in frame["courses"].items():
            totals[code] = totals.get(code, 0) + stats["denied"]
    return totals


def test_simulate_course_sections_override_changes_result():
    baseline = client.post("/simulate", json={}).json()
    mandatory_blocks = _mandatory_term_capacity_blocks(baseline["flow_timeline"])
    code, baseline_count = max(mandatory_blocks.items(), key=lambda kv: kv[1])
    assert baseline_count > 0, "expected at least one mandatory-term capacity block to override against"
    current_sections = BASE_CONFIG["course_sections"].get(code, 1)

    boosted = client.post(
        "/simulate", json={"course_sections_overrides": {code: current_sections + 5}}
    ).json()
    boosted_count = _mandatory_term_capacity_blocks(boosted["flow_timeline"]).get(code, 0)

    assert boosted_count < baseline_count


def test_simulate_seats_per_section_override_changes_result():
    baseline = client.post("/simulate", json={}).json()
    mandatory_blocks = _mandatory_term_capacity_blocks(baseline["flow_timeline"])
    code, baseline_count = max(mandatory_blocks.items(), key=lambda kv: kv[1])
    assert baseline_count > 0, "expected at least one mandatory-term capacity block to override against"

    sps = BASE_CONFIG.get("seats_per_section", 35)
    boosted = client.post(
        "/simulate", json={"seats_per_section_overrides": {code: sps * 3}}
    ).json()
    boosted_count = _mandatory_term_capacity_blocks(boosted["flow_timeline"]).get(code, 0)

    assert boosted_count < baseline_count


def test_simulate_admissions_overrides_change_population():
    baseline = client.post("/simulate", json={}).json()
    shrunk = client.post("/simulate", json={"num_cohorts": 1, "num_incumbent_cohorts": 0}).json()

    assert shrunk["flow_timeline"]["meta"]["num_cohorts"] == 1
    assert shrunk["flow_timeline"]["meta"]["num_incumbent_cohorts"] == 0
    assert len(shrunk["flow_timeline"]["meta"]["cohorts"]) < len(baseline["flow_timeline"]["meta"]["cohorts"])


def test_simulate_dropout_overrides_change_result():
    baseline = client.post("/simulate", json={}).json()
    raised = client.post("/simulate", json={"dropout_base_hazard": 0.9}).json()

    assert raised["metrics"]["academic_dropout_rate"] > baseline["metrics"]["academic_dropout_rate"]


def test_simulate_registration_tier_thresholds_override_accepted():
    resp = client.post("/simulate", json={"registration_tier_thresholds": [100, 80, 60, 40, 20]})
    assert resp.status_code == 200
    assert resp.json()["flow_timeline"]["meta"]["graph"]["nodes"]


def test_simulate_enrollment_priority_tiers_override_accepted():
    resp = client.post(
        "/simulate",
        json={"enrollment_priority_tiers": [{"categories": ["cs_core", "college_req"]}]},
    )
    assert resp.status_code == 200
    assert resp.json()["flow_timeline"]["meta"]["graph"]["nodes"]
