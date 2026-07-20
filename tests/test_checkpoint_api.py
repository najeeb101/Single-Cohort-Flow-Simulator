"""Tests for the /checkpoint endpoints — Semester Checkpoint Mode's API surface (see
CLAUDE.md). The engine mechanics themselves (step_one_mandatory_term, snapshot/from_snapshot)
are covered in tests/test_checkpoint_engine.py; this file covers the HTTP layer: session
lifecycle, the future-facing-knobs-only edit whitelist, and that guardrails apply here too.
"""
from __future__ import annotations

from fastapi.testclient import TestClient

from src.api import app

client = TestClient(app)


def _discard_any_session():
    client.delete("/checkpoint")


def test_no_active_session_returns_404():
    _discard_any_session()
    resp = client.get("/checkpoint")
    assert resp.status_code == 404


def test_create_checkpoint_starts_at_horizon_start():
    _discard_any_session()
    resp = client.post("/checkpoint")
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "active"
    assert body["is_finished"] is False
    assert body["frames"] == []  # no terms run yet
    assert body["counts_so_far"] == {"active": 0, "delayed": 0, "graduated": 0, "dropped": 0, "censored": 0}

    meta = client.get("/meta").json()
    assert meta["checkpoint_active"] is True
    assert meta["checkpoint_next_term"] == body["next_term"]

    _discard_any_session()


def test_create_checkpoint_discards_previous_session():
    _discard_any_session()
    client.post("/checkpoint")
    second = client.post("/checkpoint")
    assert second.status_code == 200
    # Only one active session ever exists — GET returns the second one, not a conflict.
    got = client.get("/checkpoint")
    assert got.status_code == 200
    assert got.json()["id"] == second.json()["id"]
    _discard_any_session()


def test_advance_runs_exactly_one_mandatory_term():
    _discard_any_session()
    client.post("/checkpoint")
    before = client.get("/checkpoint").json()
    resp = client.post("/checkpoint/advance")
    assert resp.status_code == 200
    after = resp.json()
    assert after["next_term"] > before["next_term"]
    assert len(after["frames"]) >= 1
    _discard_any_session()


def test_advance_to_completion_marks_session_completed():
    _discard_any_session()
    client.post("/checkpoint")
    state = client.get("/checkpoint").json()
    guard = 0
    while not state["is_finished"] and guard < 50:
        state = client.post("/checkpoint/advance").json()
        guard += 1
    assert state["is_finished"] is True
    assert state["status"] == "completed"
    # Some students should have reached a terminal status by the end of the horizon.
    terminal = state["counts_so_far"]["graduated"] + state["counts_so_far"]["dropped"] + state["counts_so_far"]["censored"]
    assert terminal > 0

    # Advancing a completed session is rejected, not silently accepted.
    resp = client.post("/checkpoint/advance")
    assert resp.status_code == 422
    _discard_any_session()


def test_edit_capacity_and_pass_rate():
    _discard_any_session()
    created = client.post("/checkpoint").json()
    code = next(iter(c["code"] for c in created["working_curriculum"]))
    original_capacity = next(c["capacity"] for c in created["working_curriculum"] if c["code"] == code)

    resp = client.post("/checkpoint/edit", json={
        "capacity": {code: original_capacity + 5},
        "pass_rate": {code: 0.42},
    })
    assert resp.status_code == 200
    updated = next(c for c in resp.json()["working_curriculum"] if c["code"] == code)
    assert updated["capacity"] == original_capacity + 5
    assert updated["pass_rate"] == 0.42

    # The edit must not have touched frames/history (no term advanced).
    assert resp.json()["frames"] == []
    _discard_any_session()


def test_edit_rejects_unknown_course():
    _discard_any_session()
    client.post("/checkpoint")
    resp = client.post("/checkpoint/edit", json={"capacity": {"NOPE999": 50}})
    assert resp.status_code == 422
    _discard_any_session()


def test_edit_rejects_out_of_range_pass_rate():
    _discard_any_session()
    created = client.post("/checkpoint").json()
    code = created["working_curriculum"][0]["code"]
    resp = client.post("/checkpoint/edit", json={"pass_rate": {code: 1.5}})
    assert resp.status_code == 422
    _discard_any_session()


def test_edit_rejects_non_positive_cohort_size():
    _discard_any_session()
    client.post("/checkpoint")
    resp = client.post("/checkpoint/edit", json={"cohort_size": 0})
    assert resp.status_code == 422
    _discard_any_session()


def test_edit_rejects_occupancy_exceeding_capacity():
    _discard_any_session()
    created = client.post("/checkpoint").json()
    code = created["working_curriculum"][0]["code"]
    capacity = created["working_curriculum"][0]["capacity"]
    resp = client.post("/checkpoint/edit", json={
        "initial_state": {"occupancy": {code: capacity + 1}, "standing": {}},
    })
    assert resp.status_code == 422
    _discard_any_session()


def test_edit_rejects_non_positive_admission_size():
    # admission_terms (which season names are even valid) isn't exposed on this endpoint at
    # all — only admission_sizes' own positivity is checked here.
    _discard_any_session()
    client.post("/checkpoint")
    resp = client.post("/checkpoint/edit", json={"admission_sizes": {"Spring": -5}})
    assert resp.status_code == 422
    _discard_any_session()


def test_edit_cannot_smuggle_structural_fields():
    # The request model simply has no field for these — sending them is ignored by pydantic,
    # not silently accepted as a curriculum change (extra fields are dropped, not validated).
    _discard_any_session()
    created = client.post("/checkpoint").json()
    code = created["working_curriculum"][0]["code"]
    original_prereqs = next(c["prerequisites"] for c in created["working_curriculum"] if c["code"] == code)

    resp = client.post("/checkpoint/edit", json={"prerequisites": {code: ["SOMETHING"]}})
    assert resp.status_code == 200
    updated = next(c for c in resp.json()["working_curriculum"] if c["code"] == code)
    assert updated["prerequisites"] == original_prereqs
    _discard_any_session()


def test_discard_leaves_baseline_dashboard_working():
    client.post("/checkpoint")
    resp = client.delete("/checkpoint")
    assert resp.status_code == 200
    assert client.get("/checkpoint").status_code == 404
    assert client.get("/meta").json()["checkpoint_active"] is False

    baseline = client.post("/simulate", json={})
    assert baseline.status_code == 200
