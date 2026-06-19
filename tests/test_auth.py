"""Tests for src/auth.py and the auth gate on /meta and /simulate."""
from __future__ import annotations

from fastapi.testclient import TestClient

from src.api import app

client = TestClient(app)


def _register(email: str = "auth_test_user@example.com", password: str = "s3cret-pw") -> str:
    resp = client.post("/auth/register", json={"email": email, "password": password})
    assert resp.status_code == 200
    return resp.json()["access_token"]


def test_register_then_login():
    email, password = "round_trip@example.com", "round-trip-pw"
    token = _register(email, password)
    assert token

    resp = client.post("/auth/login", json={"email": email, "password": password})
    assert resp.status_code == 200
    assert resp.json()["access_token"]


def test_register_duplicate_email_rejected():
    email = "dup@example.com"
    _register(email, "first-password")
    resp = client.post("/auth/register", json={"email": email, "password": "second-password"})
    assert resp.status_code == 409


def test_login_wrong_password_rejected():
    email = "wrongpw@example.com"
    _register(email, "correct-password")
    resp = client.post("/auth/login", json={"email": email, "password": "incorrect-password"})
    assert resp.status_code == 401


def test_login_unknown_email_rejected():
    resp = client.post("/auth/login", json={"email": "nobody@example.com", "password": "whatever"})
    assert resp.status_code == 401


def test_simulate_requires_auth():
    resp = client.post("/simulate", json={})
    assert resp.status_code == 401


def test_meta_requires_auth():
    resp = client.get("/meta")
    assert resp.status_code == 401


def test_simulate_with_token_succeeds():
    token = _register("gated_simulate@example.com", "gated-pw")
    resp = client.post("/simulate", json={}, headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200


def test_health_does_not_require_auth():
    resp = client.get("/health")
    assert resp.status_code == 200
