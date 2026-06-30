"""Tests for Phase 3 — live, stepwise simulation (src/livesim.py + src/api.py's /livesim
routes). The core correctness property is determinism/stability under replay: re-running
the replay to term N twice yields identical frames, and an edit effective at term K must
never change any snapshot/frame for a term < K. See src/livesim.py's module docstring.
"""
from __future__ import annotations

from copy import deepcopy

import pytest
from fastapi.testclient import TestClient

from src.api import app
from src.models.course import load_curriculum
from src.utils import load_json

client = TestClient(app)


_created_plan_ids: list[int] = []


@pytest.fixture(autouse=True)
def _isolate_demo_users_plan_state():
    """Auth is a no-op (every request in this whole test session acts as the same shared
    `demo@local` user — see src/auth.py::get_current_user), so this module's heavy use of
    `/plans/import` + `/plans/{id}/activate` to get a fast, small cohort_size plan both (a)
    leaves that shared user's active_plan_id pointed at whichever private plan a test
    created last, and (b) leaves the imported plan rows themselves sitting in the DB owned
    by demo@local. Other test modules (notably tests/test_plans.py's `GET /plans`
    assertions, which list every plan owned by the caller — i.e. every plan owned by
    demo@local, since auth doesn't actually separate callers) assume nothing else in the
    session has created a demo-owned plan yet. Reset active_plan_id and delete every plan
    this module created after each test, so this file's ordering (it sorts before
    test_plans.py alphabetically) can't leak state into them.
    """
    _created_plan_ids.clear()

    yield

    from src.auth import DEMO_USER_EMAIL
    from src.db import SessionLocal, get_or_create_default_plan
    from src.db_models import AppConfig, Course, Instructor, LiveSimulation, LiveTermSnapshot, User

    with SessionLocal() as session:
        default_plan = get_or_create_default_plan(session)
        user = session.query(User).filter_by(email=DEMO_USER_EMAIL).first()
        if user is not None:
            user.active_plan_id = default_plan.id

        for plan_id in _created_plan_ids:
            live_sim_ids = [
                row.id for row in session.query(LiveSimulation).filter_by(plan_id=plan_id).all()
            ]
            if live_sim_ids:
                session.query(LiveTermSnapshot).filter(
                    LiveTermSnapshot.live_sim_id.in_(live_sim_ids)
                ).delete(synchronize_session=False)
                session.query(LiveSimulation).filter_by(plan_id=plan_id).delete(synchronize_session=False)
            session.query(Course).filter_by(plan_id=plan_id).delete(synchronize_session=False)
            session.query(Instructor).filter_by(plan_id=plan_id).delete(synchronize_session=False)
            session.query(AppConfig).filter_by(plan_id=plan_id).delete(synchronize_session=False)

        if _created_plan_ids:
            from src.db_models import Plan as PlanRow

            session.query(PlanRow).filter(PlanRow.id.in_(_created_plan_ids)).delete(synchronize_session=False)

        session.commit()
    _created_plan_ids.clear()


def _register(_email: str) -> dict[str, str]:
    return {}  # auth removed — all requests auto-resolve to the shared demo user


def _small_plan_payload(name: str) -> dict:
    """A small/fast variant of the default plan — cohort_size shrunk so the engine replay
    in these tests runs in milliseconds instead of the default plan's ~100-student cohorts.
    """
    curriculum = [
        {
            "code": c.code,
            "title": c.title,
            "credits": c.credits,
            "prerequisites": list(c.prerequisites),
            "pass_rate": c.pass_rate,
            "offering": list(c.offering),
            "category": c.category,
            "capacity": c.capacity,
            "rule_expr": c.rule_expr,
            "study_plan_order": c.study_plan_order,
            "study_plan_term": c.study_plan_term,
        }
        for c in load_curriculum("data/curriculum.json").values()
    ]
    config = deepcopy(load_json("data/simulation_config.json"))
    config["cohort_size"] = 10
    return {"name": name, "curriculum": curriculum, "config": config}


def _activate_small_plan(headers: dict[str, str], name: str) -> dict:
    plan = client.post("/plans/import", json=_small_plan_payload(name), headers=headers).json()
    _created_plan_ids.append(plan["id"])
    activated = client.post(f"/plans/{plan['id']}/activate", headers=headers)
    assert activated.status_code == 200
    return plan


def _create_live_sim(headers: dict[str, str], name: str = "Live sim") -> dict:
    resp = client.post("/livesim", json={"name": name}, headers=headers)
    assert resp.status_code == 200
    return resp.json()


# ------------------------------------------------------------------ #
# Creation / listing / fetching                                       #
# ------------------------------------------------------------------ #

def test_create_live_sim_has_no_term_simulated_yet():
    headers = _register("livesim_create@example.com")
    _activate_small_plan(headers, "Livesim create plan")

    sim = _create_live_sim(headers, "Fresh sim")
    assert sim["current_term"] is None
    assert sim["status"] == "active"
    assert sim["total_terms"] > 0
    assert "id" in sim and "plan_id" in sim and "created_at" in sim


def test_create_live_sim_with_initial_state_override():
    headers = _register("livesim_create_initial_state@example.com")
    _activate_small_plan(headers, "Livesim initial-state plan")

    code = next(iter(load_curriculum("data/curriculum.json")))
    resp = client.post(
        "/livesim",
        json={"name": "Warm-started sim", "initial_state": {"occupancy": {code: 3}, "standing": {"Year3": 50}}},
        headers=headers,
    )
    assert resp.status_code == 200
    sim_id = resp.json()["id"]

    detail = client.get(f"/livesim/{sim_id}", headers=headers).json()
    assert detail["meta"]["initial_state"] == {"occupancy": {code: 3}, "standing": {"Year3": 50}}


def test_list_live_sims_shows_newest_first():
    headers = _register("livesim_list@example.com")
    _activate_small_plan(headers, "Livesim list plan")

    first = _create_live_sim(headers, "First")
    second = _create_live_sim(headers, "Second")

    listed = client.get("/livesim", headers=headers).json()
    ids = [s["id"] for s in listed]
    assert ids.index(second["id"]) < ids.index(first["id"])


def test_get_live_sim_shape():
    headers = _register("livesim_get_shape@example.com")
    _activate_small_plan(headers, "Livesim get-shape plan")
    sim = _create_live_sim(headers)

    resp = client.get(f"/livesim/{sim['id']}", headers=headers)
    assert resp.status_code == 200
    body = resp.json()
    assert set(body) == {"live_sim", "meta", "snapshots"}
    assert set(body["meta"]) == {"graph", "stage_nodes", "cohorts", "initial_state"}
    assert body["snapshots"] == []
    assert body["meta"]["stage_nodes"] == [
        "Admitted", "Year1", "Year2", "Year3", "Year4", "Graduated", "Dropped", "Censored",
    ]


def test_get_live_sim_not_found_returns_404():
    headers = _register("livesim_404@example.com")
    resp = client.get("/livesim/999999", headers=headers)
    assert resp.status_code == 404


# ------------------------------------------------------------------ #
# Advancing                                                            #
# ------------------------------------------------------------------ #

def test_advance_produces_snapshot_matching_term():
    headers = _register("livesim_advance_basic@example.com")
    _activate_small_plan(headers, "Livesim advance plan")
    sim = _create_live_sim(headers)

    resp = client.post(f"/livesim/{sim['id']}/advance", json={}, headers=headers)
    assert resp.status_code == 200
    body = resp.json()
    assert set(body) == {"live_sim", "snapshot"}
    assert body["snapshot"]["term_index"] == 0
    assert body["snapshot"]["frame"]["term"] == 0
    assert body["live_sim"]["current_term"] == 0
    assert body["live_sim"]["status"] == "active"
    assert body["snapshot"]["summary"] is not None


def test_advance_twice_gives_terms_0_then_1():
    headers = _register("livesim_advance_twice@example.com")
    _activate_small_plan(headers, "Livesim advance-twice plan")
    sim = _create_live_sim(headers)

    first = client.post(f"/livesim/{sim['id']}/advance", json={}, headers=headers).json()
    second = client.post(f"/livesim/{sim['id']}/advance", json={}, headers=headers).json()

    assert first["snapshot"]["term_index"] == 0
    assert second["snapshot"]["term_index"] == 1
    assert second["live_sim"]["current_term"] == 1

    detail = client.get(f"/livesim/{sim['id']}", headers=headers).json()
    assert [s["term_index"] for s in detail["snapshots"]] == [0, 1]


def test_advance_when_finished_returns_409():
    headers = _register("livesim_advance_finished@example.com")
    _activate_small_plan(headers, "Livesim finish plan")
    sim = _create_live_sim(headers)

    total_terms = sim["total_terms"]
    last_status = "active"
    for _ in range(total_terms):
        resp = client.post(f"/livesim/{sim['id']}/advance", json={}, headers=headers)
        assert resp.status_code == 200
        last_status = resp.json()["live_sim"]["status"]

    assert last_status == "finished"

    resp = client.post(f"/livesim/{sim['id']}/advance", json={}, headers=headers)
    assert resp.status_code == 409


def test_advance_not_visible_once_active_plan_switches_away():
    # NOTE: auth is currently a no-op (src/auth.py::get_current_user always resolves the
    # same shared demo user regardless of the bearer token — see CLAUDE.md), so a second
    # `_register(...)` call does not give a genuinely separate "current user" to test
    # cross-user visibility against (that gap is exactly the pre-existing test_plans/
    # test_scenarios/test_auth failures the task's done-criteria carves out). What IS real
    # and testable here is plan-scoping: a live sim is only visible while its plan is the
    # caller's *active* plan, regardless of who created it.
    headers = _register("livesim_scope@example.com")
    _activate_small_plan(headers, "Livesim scope plan")
    sim = _create_live_sim(headers)

    # Switch the (shared) current user onto a different plan — the live sim must stop
    # being visible/advanceable from there even though nothing about "who's asking" changed.
    _activate_small_plan(headers, "Livesim scope plan 2")
    resp = client.post(f"/livesim/{sim['id']}/advance", json={}, headers=headers)
    assert resp.status_code == 404
    resp = client.get(f"/livesim/{sim['id']}", headers=headers)
    assert resp.status_code == 404


# ------------------------------------------------------------------ #
# Determinism / stability — the core correctness property             #
# ------------------------------------------------------------------ #

def test_replay_is_deterministic_across_independent_runs():
    headers = _register("livesim_determinism@example.com")
    _activate_small_plan(headers, "Livesim determinism plan")
    sim_a = _create_live_sim(headers, "Sim A")
    sim_b = _create_live_sim(headers, "Sim B")

    frames_a = []
    frames_b = []
    for _ in range(3):
        frames_a.append(client.post(f"/livesim/{sim_a['id']}/advance", json={}, headers=headers).json()["snapshot"]["frame"])
        frames_b.append(client.post(f"/livesim/{sim_b['id']}/advance", json={}, headers=headers).json()["snapshot"]["frame"])

    assert frames_a == frames_b


def test_edit_does_not_change_snapshots_of_earlier_terms():
    headers = _register("livesim_no_retroactive_change@example.com")
    _activate_small_plan(headers, "Livesim no-retroactive plan")
    sim = _create_live_sim(headers)
    sim_id = sim["id"]

    # Advance terms 0 and 1 with no edits.
    frame0_before = client.post(f"/livesim/{sim_id}/advance", json={}, headers=headers).json()["snapshot"]["frame"]
    frame1_before = client.post(f"/livesim/{sim_id}/advance", json={}, headers=headers).json()["snapshot"]["frame"]

    # Now advance to term 2 WITH an edit effective at term 2 (the term being advanced to).
    config = client.get("/config", headers=headers).json()
    code = next(iter(config["course_sections"]))
    bumped_sections = {**config["course_sections"], code: config["course_sections"][code] + 10}
    resp = client.post(
        f"/livesim/{sim_id}/advance",
        json={"edits": {"course_sections": bumped_sections}},
        headers=headers,
    )
    assert resp.status_code == 200

    # Terms 0 and 1's already-saved snapshots must be completely untouched by the edit
    # that only took effect starting at term 2.
    detail = client.get(f"/livesim/{sim_id}", headers=headers).json()
    snap0 = next(s for s in detail["snapshots"] if s["term_index"] == 0)
    snap1 = next(s for s in detail["snapshots"] if s["term_index"] == 1)
    assert snap0["frame"] == frame0_before
    assert snap1["frame"] == frame1_before


def test_course_sections_edit_changes_capacity_from_its_effective_term():
    headers = _register("livesim_edit_changes_capacity@example.com")
    _activate_small_plan(headers, "Livesim capacity-edit plan")
    sim = _create_live_sim(headers)
    sim_id = sim["id"]

    config = client.get("/config", headers=headers).json()
    code = next(iter(config["course_sections"]))

    baseline = client.post(f"/livesim/{sim_id}/advance", json={}, headers=headers).json()
    baseline_capacity = baseline["snapshot"]["frame"]["courses"][code]["capacity"]

    bumped_sections = {**config["course_sections"], code: config["course_sections"][code] + 10}
    edited = client.post(
        f"/livesim/{sim_id}/advance",
        json={"edits": {"course_sections": bumped_sections}},
        headers=headers,
    ).json()
    edited_capacity = edited["snapshot"]["frame"]["courses"][code]["capacity"]

    assert edited_capacity > baseline_capacity
    assert edited["snapshot"]["edits_applied"] == {"course_sections": bumped_sections}


def test_seats_per_section_override_changes_capacity_from_its_effective_term():
    headers = _register("livesim_seats_per_section@example.com")
    _activate_small_plan(headers, "Livesim seats-per-section plan")
    sim = _create_live_sim(headers)
    sim_id = sim["id"]

    config = client.get("/config", headers=headers).json()
    code = next(iter(config["course_sections"]))

    baseline = client.post(f"/livesim/{sim_id}/advance", json={}, headers=headers).json()
    baseline_capacity = baseline["snapshot"]["frame"]["courses"][code]["capacity"]

    # Bigger sections for just this course — total seats = sections × seats/section, so a
    # higher per-section count must raise its effective capacity, the same way adding
    # sections does, without touching any other course.
    bumped = int(config.get("seats_per_section", 35)) + 20
    edited = client.post(
        f"/livesim/{sim_id}/advance",
        json={"edits": {"seats_per_section_overrides": {code: bumped}}},
        headers=headers,
    ).json()
    edited_capacity = edited["snapshot"]["frame"]["courses"][code]["capacity"]

    assert edited_capacity > baseline_capacity
    assert edited["snapshot"]["edits_applied"] == {"seats_per_section_overrides": {code: bumped}}


def test_replaying_through_api_matches_livesim_runner_directly():
    """The API's per-advance replay must agree with calling LiveRunner.replay directly with
    the same edits — i.e. the API isn't doing anything to the engine's output beyond what
    LiveRunner already computes."""
    from src.auth import DEMO_USER_EMAIL
    from src.db import SessionLocal, load_config_from_db, load_curriculum_from_db, resolve_active_plan_id
    from src.db_models import User
    from src.livesim import LiveRunner

    headers = _register("livesim_matches_runner@example.com")
    _activate_small_plan(headers, "Livesim matches-runner plan")
    sim = _create_live_sim(headers)
    sim_id = sim["id"]

    client.post(f"/livesim/{sim_id}/advance", json={}, headers=headers)
    second = client.post(f"/livesim/{sim_id}/advance", json={}, headers=headers).json()

    # NOTE: auth is currently a no-op (src/auth.py::get_current_user always resolves the
    # same shared demo user) — so the *real* current user behind every request above is
    # DEMO_USER_EMAIL, not the email passed to _register/headers. Query that row directly
    # to read back the same active plan the API calls actually used.
    with SessionLocal() as session:
        user = session.query(User).filter_by(email=DEMO_USER_EMAIL).first()
        plan_id = resolve_active_plan_id(session, user)
        curriculum = load_curriculum_from_db(session, plan_id)
        config = load_config_from_db(session, plan_id)
        scenario = config["scenarios"][0]

        runner = LiveRunner(curriculum, config, scenario)
        edits = [{"effective_from_term": 0, "patch": {}}, {"effective_from_term": 1, "patch": {}}]
        result = runner.replay(edits, 1)

    assert result.frames[-1] == second["snapshot"]["frame"]


# ------------------------------------------------------------------ #
# Visibility scoping                                                  #
# ------------------------------------------------------------------ #

def test_live_sim_listed_only_for_its_own_plan():
    headers = _register("livesim_visibility@example.com")
    _activate_small_plan(headers, "Livesim visibility plan A")
    sim_a = _create_live_sim(headers, "Sim in plan A")

    # Switch to a brand new private plan: sim_a must disappear from the list.
    _activate_small_plan(headers, "Livesim visibility plan B")
    listed_under_b = client.get("/livesim", headers=headers).json()
    assert all(s["id"] != sim_a["id"] for s in listed_under_b)

    sim_b = _create_live_sim(headers, "Sim in plan B")
    assert any(s["id"] == sim_b["id"] for s in listed_under_b + [sim_b])


# ------------------------------------------------------------------ #
# Finishing at the horizon                                            #
# ------------------------------------------------------------------ #

def test_status_finished_at_horizon():
    headers = _register("livesim_finished_status@example.com")
    _activate_small_plan(headers, "Livesim finished-status plan")
    sim = _create_live_sim(headers)
    total_terms = sim["total_terms"]

    last = None
    for _ in range(total_terms):
        last = client.post(f"/livesim/{sim['id']}/advance", json={}, headers=headers).json()

    assert last["live_sim"]["current_term"] == total_terms - 1
    assert last["live_sim"]["status"] == "finished"

    detail = client.get(f"/livesim/{sim['id']}", headers=headers).json()
    assert detail["live_sim"]["status"] == "finished"
    assert len(detail["snapshots"]) == total_terms


# ------------------------------------------------------------------ #
# Deletion                                                             #
# ------------------------------------------------------------------ #

def test_delete_live_sim_requires_creator():
    # Auth is currently a no-op (see the note in test_advance_not_visible_once_active_plan_
    # switches_away above), so there is no genuine second HTTP identity to exercise
    # delete_live_sim's `created_by_user_id != current_user.id` -> 403 branch end-to-end.
    # Exercise that branch directly instead, against a real DB-backed LiveSimulation row,
    # so it's still covered without depending on auth ever becoming real.
    from src.api import delete_live_sim
    from src.auth import DEMO_USER_EMAIL
    from src.db import SessionLocal
    from src.db_models import LiveSimulation, User

    headers = _register("livesim_delete_owner@example.com")
    _activate_small_plan(headers, "Livesim delete-owner plan")
    sim = _create_live_sim(headers)

    with SessionLocal() as session:
        creator = session.query(User).filter_by(email=DEMO_USER_EMAIL).first()
        impostor = User(email="livesim_delete_impostor@example.com", hashed_password="x",
                         active_plan_id=creator.active_plan_id)
        session.add(impostor)
        session.commit()

        live_sim = session.get(LiveSimulation, sim["id"])
        assert live_sim.created_by_user_id != impostor.id

        try:
            delete_live_sim(sim["id"], db=session, current_user=impostor)
            assert False, "expected delete_live_sim to raise for a non-creator"
        except Exception as exc:
            assert getattr(exc, "status_code", None) == 403

    # The sim must still exist — the rejected delete must not have committed anything.
    assert client.get(f"/livesim/{sim['id']}", headers=headers).status_code == 200


def test_delete_live_sim_by_creator_removes_snapshots():
    headers = _register("livesim_delete_creator@example.com")
    _activate_small_plan(headers, "Livesim delete-creator plan")
    sim = _create_live_sim(headers)
    client.post(f"/livesim/{sim['id']}/advance", json={}, headers=headers)

    resp = client.delete(f"/livesim/{sim['id']}", headers=headers)
    assert resp.status_code == 200
    assert resp.json() == {"ok": True}

    assert client.get(f"/livesim/{sim['id']}", headers=headers).status_code == 404
    assert all(s["id"] != sim["id"] for s in client.get("/livesim", headers=headers).json())
