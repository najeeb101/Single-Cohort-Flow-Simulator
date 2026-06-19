"""Tests for the FastAPI wrapper (src/api.py) — the HTTP boundary over run_simulation
(ACIP plan §2.3/§3.2). Parity with run_simulation() mirrors the pattern in
tests/test_service.py::test_matches_manual_construction.
"""
from __future__ import annotations

from fastapi.testclient import TestClient

from src.api import BASE_CONFIG, BASE_SCENARIO, CURRICULUM, app
from src.service import run_simulation

client = TestClient(app)
_token = client.post(
    "/auth/register", json={"email": "test_api@example.com", "password": "test-password"}
).json()["access_token"]
client.headers.update({"Authorization": f"Bearer {_token}"})


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
        "admit_interval_terms", "max_terms", "seed", "dropout_gpa_floor",
        "dropout_base_hazard", "dropout_early_multiplier", "dropout_early_sem_cutoff",
        "dropout_fails_threshold", "dropout_prob_on_repeated_fail",
        "registration_tier_thresholds", "enrollment_priority_tiers",
    }
    assert len(body["graph"]["nodes"]) == len(CURRICULUM)
    assert set(body["course_pass_rates"]) == set(CURRICULUM)


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


def test_simulate_course_sections_override_changes_result():
    baseline = client.post("/simulate", json={}).json()
    code, baseline_count = baseline["metrics"]["top_capacity_blocks"][0]
    current_sections = BASE_CONFIG["course_sections"].get(code, 1)

    boosted = client.post(
        "/simulate", json={"course_sections_overrides": {code: current_sections + 5}}
    ).json()
    boosted_count = dict(boosted["metrics"]["top_capacity_blocks"]).get(code, 0)

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
