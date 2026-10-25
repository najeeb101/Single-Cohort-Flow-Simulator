"""HTTP layer of the Intake Planner (POST/GET /intake-analyses + cancel) and the job plumbing
(src/jobs.py, src/db.py recovery/migration). Jobs run inline and serial under test
(tests/conftest.py), with tiny sweep params so each analysis is a handful of simulations.
"""
from __future__ import annotations

from fastapi.testclient import TestClient

from src import jobs
from src.api import app
from src.db import SessionLocal, migrate_plan_configs, normalize_config, recover_interrupted_analyses
from src.db_models import Analysis, AppConfig

client = TestClient(app)

TINY = {"grid_min": 40, "grid_max": 60, "grid_step": 20, "seeds": 3, "refine_seeds": 3,
        "reference_runs": 1, "min_history_years": 0, "steady_seeds": 3, "robustness": False}


def test_intake_sweep_runs_and_is_stored():
    resp = client.post("/intake-analyses", json={"label": "Test intake", "params": TINY})
    assert resp.status_code == 202, resp.text
    analysis_id = resp.json()["id"]

    body = client.get(f"/intake-analyses/{analysis_id}").json()
    assert body["status"] == "done", body["error"]
    assert body["label"] == "Test intake" and body["kind"] == "intake_sweep"
    result = body["result"]
    assert {"recommendation", "views", "reference", "data_quality", "history"} <= set(result)
    assert [p["intake"] for p in result["views"]["next"]["points"]] == [40, 60]
    assert result["reference"]["denials"] == 0
    # The exact inputs are kept for audit.
    assert {"curriculum", "config"} == set(body["inputs_snapshot"])
    # Default policy (Balanced) is recorded with the run.
    assert body["params"]["policy"]["max_on_time_loss_pts"] == 10.0

    listed = client.get("/intake-analyses").json()
    assert listed[0]["id"] == analysis_id
    assert "result" not in listed[0] and "recommended_intake" in listed[0]["summary"]


def test_seat_plan_requires_target():
    resp = client.post("/intake-analyses", json={"kind": "seat_plan"})
    assert resp.status_code == 422


def test_invalid_params_rejected():
    resp = client.post("/intake-analyses", json={"params": {"seeds": 1}})
    assert resp.status_code == 422
    resp = client.post("/intake-analyses", json={"policy": {"max_grad_rate_loss_pts": -1}})
    assert resp.status_code == 422


def test_busy_returns_409():
    jobs._running_id = 999_999
    try:
        resp = client.post("/intake-analyses", json={"params": TINY})
        assert resp.status_code == 409
    finally:
        jobs._running_id = None


def test_cancel_finished_analysis_conflicts():
    analysis_id = client.post("/intake-analyses", json={"params": TINY}).json()["id"]
    assert client.post(f"/intake-analyses/{analysis_id}/cancel").status_code == 409


def test_unknown_analysis_404():
    assert client.get("/intake-analyses/987654").status_code == 404


def test_recover_marks_interrupted_runs_failed():
    with SessionLocal() as session:
        row = Analysis(user_id=1, plan_id=1, kind="intake_sweep", status="running")
        session.add(row)
        session.commit()
        assert recover_interrupted_analyses(session) >= 1
        session.refresh(row)
        assert row.status == "failed" and "restarted" in row.error


def test_config_migration_is_idempotent():
    old = {"seed": 1, "admission_targets": {"target_grad_rate": 0.7}, "section_size": 35}
    once = normalize_config(old)
    assert "admission_targets" not in once and once["intake_policy"]["max_grad_rate_loss_pts"] == 2.0
    # The retired 0.70 target is not turned into an absolute floor.
    assert once["intake_policy"]["min_grad_rate"] is None
    # Seat suggestions are in seats now: the fixed section size is dropped for a rounding step.
    assert "section_size" not in once and once["seat_step"] == 5
    assert normalize_config(once) == once
    assert old == {"seed": 1, "admission_targets": {"target_grad_rate": 0.7}, "section_size": 35}  # input untouched

    with SessionLocal() as session:
        migrate_plan_configs(session)
        assert migrate_plan_configs(session) == 0
        assert all("admission_targets" not in r.data for r in session.query(AppConfig).all())


def test_put_config_rejects_retired_admission_targets():
    resp = client.put("/config", json={"admission_targets": {"target_grad_rate": 0.7}})
    assert resp.status_code == 422


def test_put_config_validates_planner_keys():
    assert client.put("/config", json={"seat_step": 0}).status_code == 422
    assert client.put("/config", json={"seat_step": 101}).status_code == 422
    # Retired: sections vary in size, so there is no single section size to set.
    assert client.put("/config", json={"section_size": 35}).status_code == 422
    assert client.put("/config", json={"current_students": {"past_intakes": [{"size": -5}]}}).status_code == 422
    assert client.put("/config", json={"historical_outcomes": {"grad_rate_6yr": 1.5}}).status_code == 422


def test_meta_exposes_planner_inputs():
    body = client.get("/meta").json()
    assert body["intake_policy"]["max_grad_rate_loss_pts"] == 2.0
    assert body["seat_step"] == 5 and "section_size" not in body
    assert "past_intakes" in body["current_students"]
    assert body["intake_job_running"] is False
