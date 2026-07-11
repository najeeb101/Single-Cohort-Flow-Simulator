"""Tests for the Phase B advisor chat (src/advisor.py + the /advisor/chat endpoint).

No real network: the enabled path is exercised by monkeypatching httpx.post, so the grounding,
the dormant-without-a-key behavior, and the endpoint contract are all covered offline.
"""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from src import advisor
from src.api import app

client = TestClient(app)

SAMPLE_CONTEXT = {
    "scenario": "baseline",
    "headline": {
        "graduation_rate": 0.655,
        "on_time_rate": 0.40,
        "avg_graduation_time": 8.8,
        "academic_dropout_rate": 0.15,
        "censored_rate": 0.22,
        "mean_gpa_at_graduation": 2.97,
    },
    "criteria": [{"name": "graduation_rate", "observed": "65.5%", "target": "70.0%", "slack": 0.93}],
    "bottlenecks": {"capacity": [["CMPS323", 1064]], "fail": [["MATH101", 280]]},
}


class _FakeResp:
    def __init__(self, status_code=200, payload=None, text=""):
        self.status_code = status_code
        self._payload = payload or {}
        self.text = text

    def json(self):
        return self._payload


def _fake_ok(*_args, **_kwargs):
    return _FakeResp(200, {"choices": [{"message": {"content": "  Grounded reply.  "}}]})


# --- prompt grounding -------------------------------------------------------------------

def test_prompt_includes_the_run_numbers_and_rules():
    p = advisor.build_system_prompt(SAMPLE_CONTEXT)
    assert "65.5%" in p  # graduation rate formatted
    assert "CMPS323 (1064)" in p  # top capacity bottleneck
    assert "MATH101 (280)" in p  # top failure course
    assert "ADDING SEATS DOES NOT FIX FAILURES" in p  # the key mechanic guardrail


def test_prompt_survives_empty_context():
    # A partial/empty context must still produce a valid prompt, never crash.
    assert "RUN FACTS" in advisor.build_system_prompt({})


# --- plan grounding (see-more / step 1) -------------------------------------------------

def test_summarize_plan_flattens_curriculum_and_settings():
    from src.models.course import Course

    curriculum = {
        "CMPS151": Course(
            code="CMPS151", title="Programming Concepts", credits=3, prerequisites=(),
            pass_rate=0.85, offering=("Fall", "Spring"), category="cs_core", capacity=120,
            study_plan_term=1,
        ),
        "CMPS303": Course(
            code="CMPS303", title="Data Structures", credits=3, prerequisites=("CMPS151",),
            pass_rate=0.75, offering=("Fall",), category="cs_core", capacity=90, study_plan_term=3,
        ),
    }
    config = {"cohort_size": 100, "num_cohorts": 8, "admit_interval_terms": 3, "max_terms": 12,
              "optional_terms_enabled": True, "admission_targets": {"target_grad_rate": 0.7}}
    plan = advisor.summarize_plan(curriculum, config)
    assert plan["cohort_size"] == 100 and plan["max_terms"] == 12
    assert plan["targets"]["target_grad_rate"] == 0.7
    # Courses come back in study-plan order, each carrying its definition.
    codes = [c["code"] for c in plan["courses"]]
    assert codes == ["CMPS151", "CMPS303"]
    ds = next(c for c in plan["courses"] if c["code"] == "CMPS303")
    assert ds["prerequisites"] == ["CMPS151"] and ds["capacity"] == 90 and ds["offering"] == ["Fall"]


def test_prompt_includes_curriculum_and_per_course_run_behavior():
    context = {
        **SAMPLE_CONTEXT,
        "plan": {
            "cohort_size": 100, "num_cohorts": 8, "admit_interval_terms": 3, "max_terms": 12,
            "optional_terms_enabled": True, "targets": {"target_grad_rate": 0.7},
            "courses": [
                {"code": "CMPS303", "title": "Data Structures", "credits": 3, "category": "cs_core",
                 "capacity": 90, "pass_rate": 0.75, "offering": ["Fall"], "prerequisites": ["CMPS151"],
                 "has_rule": False, "study_plan_term": 3},
            ],
        },
        "course_stats": {"CMPS303": {"denied_peak": 42, "full_terms": 5, "passed": 300, "failed": 80}},
    }
    p = advisor.build_system_prompt(context)
    assert "CURRENT PLAN & SETTINGS" in p
    assert "100 students/cohort" in p           # intake settings surfaced
    assert "target_grad_rate=0.7" in p          # admission target surfaced
    assert "seats=90" in p and "prereqs=CMPS151" in p  # the course definition
    assert "peak seat-denied 42" in p and "passed 300/failed 80" in p  # merged run behavior


# --- enable/disable gating --------------------------------------------------------------

def test_chat_disabled_without_key(monkeypatch):
    monkeypatch.delenv("LLM_API_KEY", raising=False)
    assert advisor.chat_enabled() is False
    with pytest.raises(advisor.AdvisorChatError):
        advisor.run_chat([{"role": "user", "content": "hi"}], SAMPLE_CONTEXT)


def test_chat_enabled_with_key(monkeypatch):
    monkeypatch.setenv("LLM_API_KEY", "test-key")
    assert advisor.chat_enabled() is True


def test_run_chat_success_path(monkeypatch):
    monkeypatch.setenv("LLM_API_KEY", "test-key")
    monkeypatch.setattr(advisor.httpx, "post", _fake_ok)
    reply = advisor.run_chat([{"role": "user", "content": "why?"}], SAMPLE_CONTEXT)
    assert reply == "Grounded reply."  # stripped


def test_run_chat_wraps_provider_error(monkeypatch):
    monkeypatch.setenv("LLM_API_KEY", "test-key")
    monkeypatch.setattr(advisor.httpx, "post", lambda *a, **k: _FakeResp(401, {}, "bad key"))
    with pytest.raises(advisor.AdvisorChatError):
        advisor.run_chat([{"role": "user", "content": "hi"}], SAMPLE_CONTEXT)


# --- endpoint contract ------------------------------------------------------------------

def test_endpoint_dormant_without_key(monkeypatch):
    monkeypatch.delenv("LLM_API_KEY", raising=False)
    resp = client.post("/advisor/chat", json={"messages": [{"role": "user", "content": "hi"}], "context": {}})
    assert resp.status_code == 200
    assert resp.json() == {"configured": False, "reply": None}


def test_endpoint_success_with_mocked_llm(monkeypatch):
    monkeypatch.setenv("LLM_API_KEY", "test-key")
    monkeypatch.setattr(advisor.httpx, "post", _fake_ok)
    resp = client.post(
        "/advisor/chat",
        json={"messages": [{"role": "user", "content": "why low grad rate?"}], "context": SAMPLE_CONTEXT},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["configured"] is True and body["reply"] == "Grounded reply."


def test_endpoint_requires_trailing_user_message(monkeypatch):
    monkeypatch.setenv("LLM_API_KEY", "test-key")
    resp = client.post(
        "/advisor/chat",
        json={"messages": [{"role": "assistant", "content": "hello"}], "context": {}},
    )
    assert resp.status_code == 400


def test_meta_reports_chat_flag(monkeypatch):
    monkeypatch.delenv("LLM_API_KEY", raising=False)
    assert client.get("/meta").json()["llm_chat_enabled"] is False
    monkeypatch.setenv("LLM_API_KEY", "test-key")
    assert client.get("/meta").json()["llm_chat_enabled"] is True
