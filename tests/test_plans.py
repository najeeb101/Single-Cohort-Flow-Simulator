"""Tests for user-owned curriculum/config plans."""
from __future__ import annotations

from copy import deepcopy

from fastapi.testclient import TestClient

from src.api import app
from src.db import DEFAULT_PLAN_NAME
from src.models.course import load_curriculum
from src.utils import load_json


client = TestClient(app)


def _register(email: str) -> dict[str, str]:
    resp = client.post("/auth/register", json={"email": email, "password": "plan-test-password"})
    assert resp.status_code == 200
    token = resp.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def _import_payload(name: str = "Imported CS Plan") -> dict:
    curriculum = [
        {
            "code": course.code,
            "title": course.title,
            "credits": course.credits,
            "prerequisites": list(course.prerequisites),
            "pass_rate": course.pass_rate,
            "offering": list(course.offering),
            "category": course.category,
            "capacity": course.capacity,
            "rule_expr": course.rule_expr,
            "study_plan_order": course.study_plan_order,
        }
        for course in load_curriculum("data/curriculum.json").values()
    ]
    curriculum[0] = {**curriculum[0], "title": "Imported Plan Marker"}
    config = deepcopy(load_json("data/simulation_config.json"))
    return {"name": name, "curriculum": curriculum, "config": config}


def test_list_plans_starts_with_active_default_plan():
    headers = _register("plans_default@example.com")
    resp = client.get("/plans", headers=headers)

    assert resp.status_code == 200
    assert resp.json() == [
        {"id": resp.json()[0]["id"], "name": DEFAULT_PLAN_NAME, "is_default": True, "is_active": True}
    ]


def test_import_activate_export_and_delete_private_plan():
    headers = _register("plans_lifecycle@example.com")
    imported = client.post("/plans/import", json=_import_payload(), headers=headers)
    assert imported.status_code == 200
    plan = imported.json()
    assert plan["name"] == "Imported CS Plan"
    assert plan["is_default"] is False
    assert plan["is_active"] is False

    activate = client.post(f"/plans/{plan['id']}/activate", headers=headers)
    assert activate.status_code == 200
    assert activate.json()["is_active"] is True

    exported = client.get(f"/plans/{plan['id']}/export", headers=headers)
    assert exported.status_code == 200
    assert exported.json()["curriculum"][0]["title"] == "Imported Plan Marker"

    delete = client.delete(f"/plans/{plan['id']}", headers=headers)
    assert delete.status_code == 200
    assert delete.json() == {"ok": True}

    remaining = client.get("/plans", headers=headers).json()
    assert len(remaining) == 1
    assert remaining[0]["is_default"] is True
    assert remaining[0]["is_active"] is True


def test_private_plan_is_not_visible_to_other_users():
    owner_headers = _register("plans_owner@example.com")
    other_headers = _register("plans_other@example.com")
    plan = client.post("/plans/import", json=_import_payload("Private Plan"), headers=owner_headers).json()

    assert client.post(f"/plans/{plan['id']}/activate", headers=other_headers).status_code == 404
    assert client.get(f"/plans/{plan['id']}/export", headers=other_headers).status_code == 404
    assert all(p["id"] != plan["id"] for p in client.get("/plans", headers=other_headers).json())


def test_import_rejects_prerequisite_cycle():
    headers = _register("plans_cycle@example.com")
    payload = {
        "name": "Cyclic Plan",
        "curriculum": [
            {
                "code": "A",
                "title": "A",
                "credits": 3,
                "prerequisites": ["B"],
                "pass_rate": 0.9,
                "offering": ["Fall"],
                "category": "cs_core",
                "capacity": 30,
            },
            {
                "code": "B",
                "title": "B",
                "credits": 3,
                "prerequisites": ["A"],
                "pass_rate": 0.9,
                "offering": ["Spring"],
                "category": "cs_core",
                "capacity": 30,
            },
        ],
        "config": {"cohort_size": 10, "scenarios": [{"name": "baseline"}]},
    }

    resp = client.post("/plans/import", json=payload, headers=headers)

    assert resp.status_code == 422
    assert "cycle" in resp.json()["detail"]
