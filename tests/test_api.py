"""Tests for the FastAPI wrapper (src/api.py) — the HTTP boundary over run_simulation
(ACIP plan §2.3/§3.2). Parity with run_simulation() mirrors the pattern in
tests/test_service.py::test_matches_manual_construction.
"""
from __future__ import annotations

from fastapi.testclient import TestClient

from src.api import BASE_CONFIG, BASE_SCENARIO, CURRICULUM, app
from src.service import run_simulation

client = TestClient(app)


def test_health():
    resp = client.get("/health")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}


def test_meta_shape():
    resp = client.get("/meta")
    assert resp.status_code == 200
    body = resp.json()
    assert set(body) == {
        "graph", "course_sections", "seats_per_section", "baseline_scenario", "cohort_size",
    }
    assert len(body["graph"]["nodes"]) == len(CURRICULUM)


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
    actual_metrics = dict(body["metrics"])
    assert actual_metrics.pop("top_fail_courses") == expected_top_fail
    assert actual_metrics.pop("top_capacity_blocks") == expected_top_capacity
    assert actual_metrics.pop("top_offering_blocks") == expected_top_offering
    assert actual_metrics.pop("top_prereq_blocks") == expected_top_prereq
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
