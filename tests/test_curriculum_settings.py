"""Tests for GET/PUT /curriculum and /config — Settings (docs/input_system_history.md §2.4),
including the prerequisite-cycle rejection on a real edge from the dataset (CMPS493's
rule_expr already requires CMPS310, so giving CMPS310 a prerequisite on CMPS493 is a
genuine cycle, not a synthetic one)."""
from __future__ import annotations

from fastapi.testclient import TestClient

from src.api import app

client = TestClient(app)


def test_list_curriculum_shape():
    resp = client.get("/curriculum")
    assert resp.status_code == 200
    body = resp.json()
    codes = {c["code"] for c in body}
    assert "CMPS493" in codes
    cmps493 = next(c for c in body if c["code"] == "CMPS493")
    assert cmps493["rule_expr"] == {"all": ["CMPS310", {"any": ["CMPS350", "CMPS405"]}, {"min_ch": 84}]}


def test_update_curriculum_pass_rate():
    original = next(c for c in client.get("/curriculum").json() if c["code"] == "CMPS151")["pass_rate"]
    try:
        resp = client.put("/curriculum/CMPS151", json={"pass_rate": 0.5})
        assert resp.status_code == 200
        assert resp.json()["pass_rate"] == 0.5

        meta = client.get("/meta").json()
        assert meta["course_pass_rates"]["CMPS151"] == 0.5
    finally:
        # restore — CURRICULUM is process-wide global state shared by every test module
        client.put("/curriculum/CMPS151", json={"pass_rate": original})


def test_update_curriculum_unknown_course_404():
    resp = client.put("/curriculum/NOPE999", json={"pass_rate": 0.5})
    assert resp.status_code == 404


def test_update_curriculum_rejects_real_cycle():
    resp = client.put("/curriculum/CMPS310", json={"prerequisites": ["CMPS493"]})
    assert resp.status_code == 422
    detail = resp.json()["detail"]
    cycle_courses = {edge[0] for edge in detail["cycle"]} | {edge[1] for edge in detail["cycle"]}
    assert "CMPS310" in cycle_courses
    assert "CMPS493" in cycle_courses


def test_get_config_shape():
    resp = client.get("/config")
    assert resp.status_code == 200
    assert "cohort_size" in resp.json()


def test_update_config_changes_baseline():
    original = client.get("/config").json()["cohort_size"]
    resp = client.put("/config", json={"cohort_size": original + 7})
    assert resp.status_code == 200
    assert resp.json()["cohort_size"] == original + 7

    meta = client.get("/meta").json()
    assert meta["cohort_size"] == original + 7

    # restore so other tests in this module/run aren't affected by mutated shared baseline
    client.put("/config", json={"cohort_size": original})


def test_update_config_rejects_malformed_registration_tiers():
    resp = client.put("/config", json={"registration_tier_thresholds": [1, 2, 3]})
    assert resp.status_code == 422
