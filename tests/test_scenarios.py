"""Tests for src/scenarios.py — persistent scenarios + run history, and their per-user
isolation (docs/input_system_history.md §2.3)."""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from src.api import app

client = TestClient(app)

# Auth is intentionally disabled for local demo use (see src/auth.py): every request resolves
# to a single shared demo@local user, so the per-user isolation these tests assert no longer
# holds (and the shared user accumulates run/plan state across tests). Un-skip when real
# token-based get_current_user is restored.
DEMO_AUTH_DISABLED = "auth disabled for demo mode (src/auth.py); all requests share one demo user"


def _auth_headers(email: str) -> dict:
    token = client.post("/auth/register", json={"email": email, "password": "pw-12345"}).json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def test_create_list_get_scenario():
    headers = _auth_headers("scen_owner@example.com")
    created = client.post(
        "/scenarios", json={"name": "My scenario", "overrides": {"cohort_size": 80}}, headers=headers
    ).json()
    assert created["name"] == "My scenario"
    assert created["overrides"] == {"cohort_size": 80}

    listed = client.get("/scenarios", headers=headers).json()
    assert [s["id"] for s in listed] == [created["id"]]

    fetched = client.get(f"/scenarios/{created['id']}", headers=headers).json()
    assert fetched == created


def test_update_and_delete_scenario():
    headers = _auth_headers("scen_editor@example.com")
    created = client.post("/scenarios", json={"name": "Draft", "overrides": {}}, headers=headers).json()

    updated = client.put(
        f"/scenarios/{created['id']}", json={"name": "Final", "overrides": {"seed": 7}}, headers=headers
    ).json()
    assert updated["name"] == "Final"
    assert updated["overrides"] == {"seed": 7}

    delete_resp = client.delete(f"/scenarios/{created['id']}", headers=headers)
    assert delete_resp.status_code == 200
    assert client.get(f"/scenarios/{created['id']}", headers=headers).status_code == 404


@pytest.mark.skip(reason=DEMO_AUTH_DISABLED)
def test_scenario_not_visible_to_other_user():
    owner_headers = _auth_headers("scen_private_owner@example.com")
    other_headers = _auth_headers("scen_private_other@example.com")
    created = client.post("/scenarios", json={"name": "Mine", "overrides": {}}, headers=owner_headers).json()

    resp = client.get(f"/scenarios/{created['id']}", headers=other_headers)
    assert resp.status_code == 404
    assert client.get("/scenarios", headers=other_headers).json() == []


@pytest.mark.skip(reason=DEMO_AUTH_DISABLED)
def test_simulate_writes_run_row_visible_in_history():
    headers = _auth_headers("run_history@example.com")
    assert client.get("/runs", headers=headers).json() == []

    resp = client.post("/simulate", json={}, headers=headers)
    assert resp.status_code == 200

    runs = client.get("/runs", headers=headers).json()
    assert len(runs) == 1
    assert "flow_timeline" not in runs[0]
    assert set(runs[0]["summary_json"]) == {"metrics", "admissions_recommendation"}

    detail = client.get(f"/runs/{runs[0]['id']}", headers=headers).json()
    assert detail == runs[0]


@pytest.mark.skip(reason=DEMO_AUTH_DISABLED)
def test_run_not_visible_to_other_user():
    owner_headers = _auth_headers("run_owner@example.com")
    other_headers = _auth_headers("run_other@example.com")
    client.post("/simulate", json={}, headers=owner_headers)
    run_id = client.get("/runs", headers=owner_headers).json()[0]["id"]

    assert client.get(f"/runs/{run_id}", headers=other_headers).status_code == 404
