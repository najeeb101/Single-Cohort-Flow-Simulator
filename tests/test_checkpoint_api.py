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


def test_checkpoint_summary_carries_flow_timeline_shaped_data():
    # Bottlenecks/HeadlineKpis/AdmissionsRecommendation/CohortsTable read the checkpoint
    # session the same way they read a completed /simulate's flow_timeline — this locks in
    # that the field exists and is well-formed even before any term has run.
    _discard_any_session()
    created = client.post("/checkpoint").json()
    ft = created["flow_timeline"]
    assert set(ft) == {"meta", "frames", "summary"}
    assert set(ft["summary"]) == {
        "headline",
        "per_cohort",
        "admissions_recommendation",
        "top_bottlenecks",
        "severe_terms",
    }

    assert ft["frames"] == []
    assert ft["summary"]["per_cohort"] == []
    # No study cohorts have been admitted yet, so there's nothing to recommend from.
    assert ft["summary"]["admissions_recommendation"] == {}

    client.post("/checkpoint/advance")
    after = client.get("/checkpoint").json()
    ft_after = after["flow_timeline"]
    assert len(ft_after["frames"]) >= 1
    assert 0.0 <= ft_after["summary"]["headline"]["graduation_rate"] <= 1.0
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


def test_autofill_scoped_to_working_config_not_live_plan():
    # Bumping a course's staged capacity in the session should change what the session-scoped
    # solver sees (fewer/no seat shortfalls to fix for that course) without touching the live
    # plan at all — proving it reads working_curriculum/working_config, not the DB plan.
    _discard_any_session()
    created = client.post("/checkpoint").json()
    code = created["working_curriculum"][0]["code"]
    live_capacity_before = next(c["capacity"] for c in client.get("/curriculum").json() if c["code"] == code)

    resp = client.post("/checkpoint/autofill", json={"run_budget": 2})
    assert resp.status_code == 200
    body = resp.json()
    assert set(body) >= {"feasible", "recommended", "final_metrics", "criteria", "trace", "runs"}

    # The live plan's own capacity is untouched by a read-only solve.
    live_capacity_after = next(c["capacity"] for c in client.get("/curriculum").json() if c["code"] == code)
    assert live_capacity_after == live_capacity_before
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
        "initial_state": {"occupancy": {code: capacity + 1}},
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


def test_create_checkpoint_records_initial_history_step():
    _discard_any_session()
    created = client.post("/checkpoint").json()
    assert created["history"] == [{"seq": 0, "next_term": created["next_term"]}]
    _discard_any_session()


def test_rewind_restores_earlier_step_and_truncates_future():
    _discard_any_session()
    client.post("/checkpoint")
    client.post("/checkpoint/advance")
    after_first = client.get("/checkpoint").json()
    client.post("/checkpoint/advance")
    client.post("/checkpoint/advance")
    latest = client.get("/checkpoint").json()
    assert len(latest["history"]) == 4  # seq 0 (start) + 3 advances
    assert latest["next_term"] > after_first["next_term"]

    resp = client.post("/checkpoint/rewind", json={"seq": 1})
    assert resp.status_code == 200
    rewound = resp.json()
    assert rewound["next_term"] == after_first["next_term"]
    assert rewound["frames"] == after_first["frames"]
    assert rewound["history"] == [{"seq": 0, "next_term": rewound["history"][0]["next_term"]}, {"seq": 1, "next_term": rewound["next_term"]}]
    _discard_any_session()


def test_advance_after_rewind_continues_from_rewound_point():
    # After going back to seq=1 and advancing again, the walkthrough should record a fresh
    # forward path from there (linear undo, no branching/redo) rather than restoring whatever
    # used to be at seq=2.
    _discard_any_session()
    client.post("/checkpoint")
    client.post("/checkpoint/advance")
    step1 = client.get("/checkpoint").json()
    client.post("/checkpoint/advance")
    client.post("/checkpoint/advance")

    client.post("/checkpoint/rewind", json={"seq": 1})
    resp = client.post("/checkpoint/advance")
    assert resp.status_code == 200
    body = resp.json()
    assert [s["seq"] for s in body["history"]] == [0, 1, 2]
    assert body["next_term"] > step1["next_term"]
    _discard_any_session()


def test_rewind_reactivates_completed_session():
    _discard_any_session()
    client.post("/checkpoint")
    state = client.get("/checkpoint").json()
    guard = 0
    while not state["is_finished"] and guard < 50:
        state = client.post("/checkpoint/advance").json()
        guard += 1
    assert state["status"] == "completed"
    assert len(state["history"]) >= 2

    resp = client.post("/checkpoint/rewind", json={"seq": 1})
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "active"
    assert body["is_finished"] is False

    # And the reactivated session can advance again.
    assert client.post("/checkpoint/advance").status_code == 200
    _discard_any_session()


def test_rewind_keeps_staged_edits():
    # Rewinding rolls back simulated terms only — staged capacity/pass_rate/etc. edits are
    # deliberately left alone, so trying a different number "from an earlier point" works.
    _discard_any_session()
    created = client.post("/checkpoint").json()
    code = created["working_curriculum"][0]["code"]
    original_capacity = created["working_curriculum"][0]["capacity"]
    client.post("/checkpoint/advance")
    client.post("/checkpoint/edit", json={"capacity": {code: original_capacity + 7}})

    resp = client.post("/checkpoint/rewind", json={"seq": 0})
    assert resp.status_code == 200
    updated = next(c for c in resp.json()["working_curriculum"] if c["code"] == code)
    assert updated["capacity"] == original_capacity + 7
    _discard_any_session()


def test_rewind_rejects_unknown_step():
    _discard_any_session()
    client.post("/checkpoint")
    resp = client.post("/checkpoint/rewind", json={"seq": 99})
    assert resp.status_code == 422
    _discard_any_session()


def test_advance_backfills_history_for_a_pre_existing_session():
    # Simulates a session created before the per-step history table existed (or one that
    # otherwise lost its seq=0 row): it has zero CheckpointSnapshot rows even though it's
    # already partway through the walkthrough. The next advance must back-fill the CURRENT
    # (pre-advance) state as seq=0 rather than mislabeling "one step past where it already was"
    # as the start.
    from src.db import SessionLocal
    from src.db_models import CheckpointSnapshot

    _discard_any_session()
    client.post("/checkpoint")
    client.post("/checkpoint/advance")
    before = client.get("/checkpoint").json()
    session_id = before["id"]
    next_term_before = before["next_term"]

    with SessionLocal() as session:
        session.query(CheckpointSnapshot).filter_by(session_id=session_id).delete()
        session.commit()
    assert client.get("/checkpoint").json()["history"] == []

    after = client.post("/checkpoint/advance").json()
    assert after["history"] == [
        {"seq": 0, "next_term": next_term_before},
        {"seq": 1, "next_term": after["next_term"]},
    ]

    # And rewinding to the backfilled seq=0 restores that pre-advance state correctly.
    rewound = client.post("/checkpoint/rewind", json={"seq": 0}).json()
    assert rewound["next_term"] == next_term_before
    _discard_any_session()


def test_discard_purges_snapshot_history():
    from src.db import SessionLocal
    from src.db_models import CheckpointSnapshot

    _discard_any_session()
    created = client.post("/checkpoint").json()
    session_id = created["id"]
    client.post("/checkpoint/advance")

    with SessionLocal() as session:
        assert session.query(CheckpointSnapshot).filter_by(session_id=session_id).count() > 0

    client.delete("/checkpoint")

    with SessionLocal() as session:
        assert session.query(CheckpointSnapshot).filter_by(session_id=session_id).count() == 0
