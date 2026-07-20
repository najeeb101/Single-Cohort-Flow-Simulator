"""Tests for GET/PUT /curriculum and /config — Settings (docs/input_system_history.md §2.4),
including the prerequisite write-once lock (prerequisites/rule_expr are settable only at
course creation — see CLAUDE.md's prereq lockdown note) and, as a pure-function check
unaffected by that lock, the cycle detector itself on a real edge from the dataset (CMPS493's
rule_expr already requires CMPS310, so giving CMPS310 a prerequisite on CMPS493 is a genuine
cycle, not a synthetic one)."""
from __future__ import annotations

from fastapi.testclient import TestClient

from src.api import app
from src.curriculum_validation import CycleError, check_no_cycle
from src.db import SessionLocal, get_or_create_default_plan, load_curriculum_from_db

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


def test_update_curriculum_rejects_prerequisite_change():
    """Prerequisites are write-once (locked after course creation — see CLAUDE.md). PUT
    /curriculum/{code} now rejects ANY change to prerequisites, cyclic or not; the cycle
    detector itself is still exercised directly below since the API can no longer trigger it
    via an edit."""
    resp = client.put("/curriculum/CMPS310", json={"prerequisites": ["CMPS493"]})
    assert resp.status_code == 422
    assert "locked" in resp.json()["detail"]


def test_update_curriculum_allows_non_prerequisite_fields():
    original = next(c for c in client.get("/curriculum").json() if c["code"] == "CMPS151")["title"]
    try:
        resp = client.put("/curriculum/CMPS151", json={"title": "Programming Concepts (renamed)"})
        assert resp.status_code == 200
        assert resp.json()["title"] == "Programming Concepts (renamed)"
    finally:
        client.put("/curriculum/CMPS151", json={"title": original})


def test_update_curriculum_rejects_rule_expr_change():
    resp = client.put("/curriculum/CMPS493", json={"rule_expr": {"all": ["CMPS310"]}})
    assert resp.status_code == 422
    assert "locked" in resp.json()["detail"]


def test_update_curriculum_allows_resubmitting_unchanged_prerequisites():
    # The Settings edit form previously always sent prerequisites/rule_expr back unchanged;
    # even though CurriculumTable.save no longer does this, the API itself should still treat
    # a no-op resubmission as a non-edit rather than rejecting it as a "change".
    current = next(c for c in client.get("/curriculum").json() if c["code"] == "CMPS151")
    resp = client.put("/curriculum/CMPS151", json={
        "prerequisites": current["prerequisites"],
        "rule_expr": current["rule_expr"],
        "title": current["title"],
    })
    assert resp.status_code == 200


def test_check_no_cycle_detects_real_cycle():
    """Pure-function coverage of the cycle detector itself (src/curriculum_validation.py),
    using the same genuine edge the API-level test above used to exercise before the
    prerequisite lock made that path unreachable: CMPS493's rule_expr already requires
    CMPS310, so giving CMPS310 a prerequisite on CMPS493 closes a real cycle."""
    import dataclasses

    with SessionLocal() as session:
        plan = get_or_create_default_plan(session)
        curriculum = load_curriculum_from_db(session, plan.id)

    hypothetical = dict(curriculum)
    hypothetical["CMPS310"] = dataclasses.replace(curriculum["CMPS310"], prerequisites=("CMPS493",))

    try:
        check_no_cycle(hypothetical)
        assert False, "expected a CycleError"
    except CycleError as exc:
        cycle_courses = {edge[0] for edge in exc.cycle} | {edge[1] for edge in exc.cycle}
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
