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


@pytest.fixture(autouse=True)
def _no_ambient_llm_env(monkeypatch):
    """Each test sets exactly the provider env it needs — a developer's .env (e.g. a local
    Ollama LLM_BASE_URL) must not leak in and flip the enabled/disabled assertions."""
    for key in ("LLM_API_KEY", "LLM_BASE_URL", "LLM_MODEL", "LLM_TIMEOUT", "LLM_OLLAMA_NATIVE",
                "LLM_FALLBACK_BASE_URL", "LLM_FALLBACK_MODEL", "LLM_FALLBACK_API_KEY"):
        monkeypatch.delenv(key, raising=False)


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


_REPLY_WITH_PROPOSALS = (
    "CMPS323 has the most seat denials, so add seats there and ease intake.\n"
    '```json\n{"proposals": ['
    '{"type": "capacity", "code": "CMPS323", "value": 150, "reason": "worst seat shortfall"},'
    '{"type": "cohort_size", "value": 90, "reason": "relieve shared-pool pressure"}'
    "]}\n```"
)


def _fake_ok_with_proposals(*_args, **_kwargs):
    return _FakeResp(200, {"choices": [{"message": {"content": _REPLY_WITH_PROPOSALS}}]})


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
    config = {"cohort_size": 100, "num_cohorts": 8, "admission_terms": ["Fall"], "max_terms": 12,
              "optional_terms_enabled": True, "intake_policy": {"max_grad_rate_loss_pts": 2.0}}
    plan = advisor.summarize_plan(curriculum, config)
    assert plan["cohort_size"] == 100 and plan["max_terms"] == 12
    assert plan["admission_terms"] == ["Fall"]
    assert plan["intake_policy"]["max_grad_rate_loss_pts"] == 2.0
    # Courses come back in study-plan order, each carrying its definition.
    codes = [c["code"] for c in plan["courses"]]
    assert codes == ["CMPS151", "CMPS303"]
    ds = next(c for c in plan["courses"] if c["code"] == "CMPS303")
    assert ds["prerequisites"] == ["CMPS151"] and ds["capacity"] == 90 and ds["offering"] == ["Fall"]


def test_prompt_includes_curriculum_and_per_course_run_behavior():
    context = {
        **SAMPLE_CONTEXT,
        "plan": {
            "cohort_size": 100, "num_cohorts": 8, "admission_terms": ["Fall"], "admission_sizes": {},
            "max_terms": 12, "optional_terms_enabled": True, "intake_policy": {"max_grad_rate_loss_pts": 2.0},
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
    assert "max_grad_rate_loss_pts=2.0" in p     # intake policy surfaced
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


def test_local_server_needs_no_key(monkeypatch):
    monkeypatch.setenv("LLM_BASE_URL", "http://localhost:11434/v1")
    monkeypatch.setenv("LLM_MODEL", "qwen3:4b-instruct-2507-q4_K_M")
    assert advisor.chat_enabled() is True
    assert advisor.model_label() == "qwen3:4b-instruct-2507-q4_K_M · on this PC"
    assert advisor._config()["timeout"] == 120.0  # local inference gets a longer timeout


def test_ollama_uses_native_api_with_bigger_context(monkeypatch):
    monkeypatch.setenv("LLM_BASE_URL", "http://localhost:11434/v1")
    seen = {}

    def fake_post(url, json=None, **_kwargs):
        seen["url"], seen["json"] = url, json
        return _FakeResp(200, {"message": {"content": "Native reply."}})

    monkeypatch.setattr(advisor.httpx, "post", fake_post)
    assert advisor.run_chat([{"role": "user", "content": "q"}], SAMPLE_CONTEXT) == "Native reply."
    assert seen["url"] == "http://localhost:11434/api/chat"
    assert seen["json"]["options"]["num_ctx"] == advisor.OLLAMA_NUM_CTX >= 8192
    assert seen["json"]["stream"] is False


def test_other_local_servers_use_openai_endpoint(monkeypatch):
    monkeypatch.setenv("LLM_BASE_URL", "http://localhost:1234/v1")  # e.g. LM Studio
    seen = {}

    def fake_post(url, **_kwargs):
        seen["url"] = url
        return _FakeResp(200, {"choices": [{"message": {"content": "ok"}}]})

    monkeypatch.setattr(advisor.httpx, "post", fake_post)
    advisor.run_chat([{"role": "user", "content": "q"}], SAMPLE_CONTEXT)
    assert seen["url"] == "http://localhost:1234/v1/chat/completions"


def test_hosted_url_without_key_stays_disabled(monkeypatch):
    monkeypatch.setenv("LLM_BASE_URL", "https://api.groq.com/openai/v1")
    assert advisor.chat_enabled() is False


def test_fallback_answers_when_local_is_down(monkeypatch):
    import httpx

    monkeypatch.setenv("LLM_BASE_URL", "http://localhost:11434/v1")
    monkeypatch.setenv("LLM_MODEL", "qwen3:4b-instruct-2507-q4_K_M")
    monkeypatch.setenv("LLM_FALLBACK_BASE_URL", "https://api.example.com/v1")
    monkeypatch.setenv("LLM_FALLBACK_API_KEY", "paid-key")
    monkeypatch.setenv("LLM_FALLBACK_MODEL", "big-model")

    def fake_post(url, **_kwargs):
        if url.startswith("http://localhost"):
            raise httpx.ConnectError("connection refused")
        return _FakeResp(200, {"choices": [{"message": {"content": "From the fallback."}}]})

    monkeypatch.setattr(advisor.httpx, "post", fake_post)
    out = advisor.run_chat_detailed([{"role": "user", "content": "why?"}], SAMPLE_CONTEXT)
    assert out == {"reply": "From the fallback.", "model": "big-model · api.example.com"}


def test_think_blocks_are_stripped(monkeypatch):
    monkeypatch.setenv("LLM_BASE_URL", "http://127.0.0.1:11434/v1")
    monkeypatch.setattr(advisor.httpx, "post", lambda *a, **k: _FakeResp(
        200, {"message": {"content": "<think>internal reasoning</think>\nThe answer."}}))
    assert advisor.run_chat([{"role": "user", "content": "q"}], SAMPLE_CONTEXT) == "The answer."


def test_prompt_grounds_latest_intake_analysis():
    analysis = advisor.summarize_analysis({
        "label": "Fall 2027 intake",
        "policy": {"max_grad_rate_loss_pts": 2.0, "max_on_time_loss_pts": 10.0},
        "reference": {"grad_rate": 0.66, "on_time_rate": 0.5},
        "recommendation": {"recommended_intake": 40, "sustainable_intake": 70, "upper_limit": 90,
                           "why": "At 45 students seat shortages could cost up to 11 pts.",
                           "robustness": {"range": [30, 50]}, "warnings": ["Illustrative."]},
        "views": {"next": {"points": [{"intake": 40, "grad_rate": 0.67, "on_time_rate": 0.42,
                                       "grad_rate_loss_fit": -1.0, "on_time_loss_fit": 8.5,
                                       "graduates_per_year": 27.0,
                                       "top_courses": [{"code": "CSEL2", "denials_per_student": 0.4}]}]}},
        "data_quality": {"illustrative": True},
    })
    p = advisor.build_system_prompt({"intake_analysis": analysis})
    assert "Recommended next intake: 40" in p and "sustainable every year: 70" in p
    assert "Robustness range" in p and "30-50" in p
    assert "40: 67.0% / 42.0%" in p and "CSEL2" in p
    assert "never recompute or overrule" in p


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


# --- actionable proposals (step 2: propose-and-apply) -----------------------------------

def test_extract_proposals_pulls_and_strips_fenced_block():
    clean, raw = advisor.extract_proposals(_REPLY_WITH_PROPOSALS)
    assert "```" not in clean and clean.startswith("CMPS323 has the most")  # prose kept, JSON gone
    assert [p["type"] for p in raw] == ["capacity", "cohort_size"]


def test_extract_proposals_plain_reply_is_untouched():
    text = "Just some advice, no changes."
    assert advisor.extract_proposals(text) == (text, [])


def test_extract_proposals_bare_object_fallback():
    text = 'Do this.\n{"proposals": [{"type": "cohort_size", "value": 80, "reason": "x"}]}'
    clean, raw = advisor.extract_proposals(text)
    assert clean == "Do this." and raw[0]["value"] == 80


def test_extract_proposals_tolerates_trailing_comma():
    # llama models frequently emit a trailing comma before the closing bracket. Without lenient
    # parsing the whole block was unparseable, so the raw JSON leaked into the reply AND the
    # proposal was lost — the exact failure seen in live testing.
    text = (
        "Add seats to CMPS303.\n"
        '```json\n{"proposals": ['
        '{"type": "capacity", "code": "CMPS303", "value": 120, "reason": "full every term"},'
        "]}\n```"
    )
    clean, raw = advisor.extract_proposals(text)
    assert "```" not in clean and clean == "Add seats to CMPS303."
    assert len(raw) == 1 and raw[0]["type"] == "capacity" and raw[0]["value"] == 120


def test_validate_proposals_normalizes_and_drops_bad():
    from src.models.course import Course

    curriculum = {
        "CMPS303": Course(
            code="CMPS303", title="Data Structures", credits=3, prerequisites=("CMPS151",),
            pass_rate=0.75, offering=("Fall",), category="cs_core", capacity=90, study_plan_term=3,
        ),
    }
    config = {"cohort_size": 100, "terms_per_year": ["Fall", "Winter", "Spring", "Summer"]}
    raw = [
        {"type": "capacity", "code": "CMPS303", "value": 130, "reason": "too full"},
        {"type": "offering", "code": "CMPS303", "value": ["Fall", "Spring"], "reason": "add spring"},
        {"type": "pass_rate", "code": "CMPS303", "value": 0.85, "reason": "tutoring"},
        {"type": "cohort_size", "value": 90, "reason": "less pressure"},
        {"type": "capacity", "code": "NOPE999", "value": 50, "reason": "bad code"},      # dropped: unknown code
        {"type": "pass_rate", "code": "CMPS303", "value": 5, "reason": "out of range"},   # dropped: >1
        {"type": "teleport", "value": 1, "reason": "unknown type"},                        # dropped: bad type
    ]
    out = advisor.validate_proposals(raw, curriculum, config)
    # Capped at 3, most-impactful-first order preserved, only valid ones survive.
    assert len(out) == 3
    assert out[0] == {
        "type": "capacity", "code": "CMPS303", "value": 130, "current": 90,
        "reason": "too full", "label": "Set CMPS303 capacity to 130 seats (from 90)",
    }
    assert out[1]["type"] == "offering" and out[1]["value"] == ["Fall", "Spring"]
    assert out[2]["type"] == "pass_rate" and out[2]["value"] == 0.85


def test_validate_proposals_drops_offering_seasons_not_in_plan():
    from src.models.course import Course

    curriculum = {"C": Course(code="C", title="", credits=3, prerequisites=(), pass_rate=0.8,
                              offering=("Fall",), category="cs_core", capacity=10, study_plan_term=1)}
    config = {"cohort_size": 10, "terms_per_year": ["Fall", "Spring"]}
    # "Summer" isn't a season in this plan -> filtered out; nothing valid left -> proposal dropped.
    out = advisor.validate_proposals([{"type": "offering", "code": "C", "value": ["Summer"]}], curriculum, config)
    assert out == []


def test_endpoint_returns_validated_proposals(monkeypatch):
    monkeypatch.setenv("LLM_API_KEY", "test-key")
    monkeypatch.setattr(advisor.httpx, "post", _fake_ok_with_proposals)
    resp = client.post(
        "/advisor/chat",
        json={"messages": [{"role": "user", "content": "what should I change?"}], "context": {}},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["configured"] is True
    assert "```" not in body["reply"]  # raw JSON stripped from the shown prose
    props = body["proposals"]
    assert [p["type"] for p in props] == ["capacity", "cohort_size"]
    assert props[0]["code"] == "CMPS323" and props[0]["value"] == 150  # validated against the real seeded plan


def test_validate_proposals_drops_no_op_changes():
    # A small local model sometimes "proposes" exactly what the plan already has.
    from src.models.course import Course

    curriculum = {"CSEL2": Course(code="CSEL2", title="Elective 2", credits=3, prerequisites=(),
                                  pass_rate=0.85, offering=("Fall", "Spring"), category="cs_elective",
                                  capacity=35, study_plan_term=6)}
    config = {"terms_per_year": ["Fall", "Spring", "Summer"], "cohort_size": 100}
    raw = [
        {"type": "offering", "code": "CSEL2", "value": ["Spring", "Fall"], "reason": "same as now"},
        {"type": "capacity", "code": "CSEL2", "value": 35, "reason": "same as now"},
        {"type": "capacity", "code": "CSEL2", "value": 70, "reason": "a real change"},
    ]
    out = advisor.validate_proposals(raw, curriculum, config)
    # Dedup keeps the first capacity proposal (35, a no-op) and drops it; the offering no-op too.
    assert out == []
    out = advisor.validate_proposals(raw[2:], curriculum, config)
    assert [(p["type"], p["value"]) for p in out] == [("capacity", 70)]
