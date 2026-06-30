"""Tests for src/scenarios.py — persistent scenarios + run history."""
from __future__ import annotations

from fastapi.testclient import TestClient

from src.api import app

client = TestClient(app)


def test_create_list_get_scenario():
    created = client.post("/scenarios", json={"name": "My scenario", "overrides": {"cohort_size": 80}}).json()
    assert created["name"] == "My scenario"
    assert created["overrides"] == {"cohort_size": 80}

    listed = client.get("/scenarios").json()
    assert any(s["id"] == created["id"] for s in listed)

    fetched = client.get(f"/scenarios/{created['id']}").json()
    assert fetched["id"] == created["id"]


def test_update_and_delete_scenario():
    created = client.post("/scenarios", json={"name": "Draft", "overrides": {}}).json()

    updated = client.put(f"/scenarios/{created['id']}", json={"name": "Final", "overrides": {"seed": 7}}).json()
    assert updated["name"] == "Final"
    assert updated["overrides"] == {"seed": 7}

    delete_resp = client.delete(f"/scenarios/{created['id']}")
    assert delete_resp.status_code == 200
    assert client.get(f"/scenarios/{created['id']}").status_code == 404
