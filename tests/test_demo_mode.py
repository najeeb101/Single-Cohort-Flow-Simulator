"""Public read-only demo mode (DEMO_MODE=1, src/api/demo.py): per-visitor sessions, a read-only
saved plan, the precomputed showcase handed to new visitors, and the lite analysis settings."""
from __future__ import annotations

import json

import pytest
from fastapi.testclient import TestClient

from src.api import app, demo
from src.storage.db import SessionLocal, get_or_create_default_plan, load_config_from_db, load_curriculum_from_db


@pytest.fixture()
def demo_on(monkeypatch):
    monkeypatch.setenv("DEMO_MODE", "1")


def test_off_by_default_nothing_is_refused_and_meta_says_so():
    c = TestClient(app)
    assert c.get("/meta").json()["demo_mode"] is False
    assert demo.COOKIE not in c.cookies


def test_demo_hands_out_a_visitor_cookie_and_reports_demo_mode(demo_on):
    c = TestClient(app)
    assert c.get("/meta").json()["demo_mode"] is True
    assert len(c.cookies[demo.COOKIE]) == 32


def test_saved_plan_is_read_only(demo_on):
    c = TestClient(app)
    for method, url, body in (
        ("put", "/config", {"cohort_size": 50}),
        ("put", "/curriculum/CMPS151", {"capacity": 99}),
        ("post", "/plans/import", {"name": "x", "curriculum": [], "config": {}}),
        ("delete", "/curriculum/CMPS151", None),
    ):
        resp = c.request(method, url, json=body)
        assert resp.status_code == 403, (method, url, resp.text)
        assert "read-only demo" in resp.json()["detail"]
    # ...and it really didn't change.
    assert c.get("/config").json()["cohort_size"] != 50


def test_each_visitor_has_a_private_walkthrough(demo_on):
    a, b = TestClient(app), TestClient(app)
    assert a.post("/checkpoint").status_code == 200
    assert a.get("/checkpoint").status_code == 200
    assert b.get("/checkpoint").status_code == 404       # b never started one
    assert b.get("/meta").json()["checkpoint_active"] is False
    assert a.delete("/checkpoint").status_code in (200, 204)


def test_a_bogus_cookie_is_replaced(demo_on):
    c = TestClient(app)
    c.get("/meta", headers={"Cookie": f"{demo.COOKIE}=../../etc/passwd"})
    assert demo._SID_RE.match(c.cookies[demo.COOKIE])


def test_new_visitors_start_with_the_showcase_analyses(demo_on, monkeypatch, tmp_path):
    showcase = tmp_path / "showcase.json"
    showcase.write_text(json.dumps({"analyses": [{
        "kind": "intake_sweep", "label": "Fall test", "params": {}, "inputs_snapshot": {},
        "result": {"recommendation": {"recommended_intake": 40}, "data_quality": {"illustrative": True}},
    }]}))
    monkeypatch.setattr(demo, "SHOWCASE_PATH", showcase)
    a, b = TestClient(app), TestClient(app)
    for c in (a, b):
        listed = c.get("/intake-analyses").json()
        assert [r["label"] for r in listed] == ["Fall test"]
        assert listed[0]["status"] == "done"
        assert listed[0]["summary"]["recommended_intake"] == 40
    assert a.get("/intake-analyses").json()[0]["id"] != b.get("/intake-analyses").json()[0]["id"]


def test_demo_analysis_requests_are_clamped_to_the_lite_settings():
    asked = demo.lite_params({"grid_max": 1000, "seeds": 100, "refine_seeds": 200, "reference_runs": 50})
    for key, value in demo.LITE_ANALYSIS_PARAMS.items():
        assert asked[key] == value


def test_a_demo_analysis_is_started_with_the_lite_settings(demo_on, monkeypatch):
    started = {}
    monkeypatch.setattr("src.planner.jobs.start", lambda *args: started.update(job_params=args[4]))
    c = TestClient(app)
    resp = c.post("/intake-analyses", json={"params": {"seeds": 100, "refine_seeds": 200, "grid_max": 1000}})
    assert resp.status_code == 202, resp.text
    for key, value in demo.LITE_ANALYSIS_PARAMS.items():
        assert started["job_params"]["params"][key] == value


def test_heavy_endpoints_are_rate_limited(demo_on):
    demo._hits.clear()
    c = TestClient(app)
    codes = [c.post("/advisor/chat", json={"messages": []}).status_code for _ in range(14)]
    assert 429 in codes and codes[0] != 429
    demo._hits.clear()


def test_committed_showcase_matches_the_shipped_default_plan():
    """Fails when the seed data changed but data/demo_showcase.json wasn't rebuilt
    (`py scripts/build_demo_showcase.py`), which would make the demo's headline result stale."""
    if not demo.SHOWCASE_PATH.exists():
        pytest.skip("demo showcase not built yet")
    rows = demo.load_showcase()
    assert {r["kind"] for r in rows} == {"intake_sweep", "seat_plan"}
    with SessionLocal() as db:
        plan = get_or_create_default_plan(db)
        curriculum = load_curriculum_from_db(db, plan.id)
        config = load_config_from_db(db, plan.id)
    snap = rows[0]["inputs_snapshot"]
    assert {c["code"]: (c["capacity"], c["pass_rate"]) for c in snap["curriculum"]} == {
        code: (c.capacity, c.pass_rate) for code, c in curriculum.items()}
    assert snap["config"] == json.loads(json.dumps(config))
