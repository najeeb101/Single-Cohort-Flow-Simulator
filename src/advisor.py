"""Phase B of the hybrid advisor: an optional LLM chat box grounded in one run's numbers.

Provider-agnostic by design — it POSTs to any OpenAI-compatible ``/chat/completions`` endpoint,
selected entirely by environment variables, so Groq (the default, which has a real free tier),
Google Gemini, OpenRouter, or an Anthropic-compatible proxy are a config swap, not a code change::

    LLM_API_KEY    required to enable the feature at all
    LLM_BASE_URL   default https://api.groq.com/openai/v1
    LLM_MODEL      default llama-3.3-70b-versatile

When ``LLM_API_KEY`` is unset the whole feature is dormant: :func:`chat_enabled` is ``False``,
``/meta`` reports it, and the frontend hides the chat box — Phase A (the rules-based
``AdvisorPanel``) is completely untouched and needs no key.
"""
from __future__ import annotations

import os

import httpx

DEFAULT_BASE_URL = "https://api.groq.com/openai/v1"
DEFAULT_MODEL = "llama-3.3-70b-versatile"


def chat_enabled() -> bool:
    """True iff an LLM API key is configured. Everything else stays dormant without it."""
    return bool(os.environ.get("LLM_API_KEY"))


def _config() -> dict:
    return {
        "base_url": os.environ.get("LLM_BASE_URL", DEFAULT_BASE_URL).rstrip("/"),
        "api_key": os.environ.get("LLM_API_KEY", ""),
        "model": os.environ.get("LLM_MODEL", DEFAULT_MODEL),
    }


class AdvisorChatError(RuntimeError):
    """Any failure talking to the LLM provider (unreachable, non-200, or a malformed reply)."""


def _fmt_pct(x: object) -> str:
    try:
        return f"{float(x) * 100:.1f}%"  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return "n/a"


def build_system_prompt(context: dict) -> str:
    """Ground the model in exactly this run's numbers, so it can't invent figures or courses.

    ``context`` is the compact facts blob the frontend builds from the ``/simulate`` summary
    (``headline`` / ``criteria`` / ``bottlenecks`` / ``scenario``) — every field is optional and
    defended, so a partial or empty context still yields a valid prompt.
    """
    ctx = context or {}
    h = ctx.get("headline") or {}
    criteria = ctx.get("criteria") or []
    bn = ctx.get("bottlenecks") or {}
    scenario = ctx.get("scenario") or "baseline"

    lines = [
        "You are the built-in assistant of a university course-flow SIMULATOR. A discrete-term, "
        "agent-based model simulates students moving through a curriculum over up to 12 semesters, "
        "all competing for shared course seats; a student can pass, fail, repeat, be delayed, drop "
        "out, or run out of time (CENSORED). An administrator is exploring the results of ONE run.",
        "",
        "RULES:",
        "- Answer ONLY from the run facts below. Never invent numbers, courses, or outcomes.",
        "- If a question can't be answered from these facts, say so plainly and point them at the "
        "right tool: Settings (edit the plan), Bottlenecks + Auto-fill (fix seat shortfalls), the "
        "What-if panel (test a change safely), or Live (step term by term).",
        "- Be concise and concrete — usually 2-5 sentences — and cite the real numbers.",
        "- Mechanics you must respect: a capacity block = wanted a seat but the course was full "
        "(fixed by more seats); an offering block = eligible but the course wasn't taught that term "
        "(fixed by offering it more often); a prereq block = prerequisites not yet met (fixed "
        "upstream); a failure = sat the course and didn't pass. ADDING SEATS DOES NOT FIX FAILURES "
        "— those are a pass-rate/support problem.",
        "",
        f"RUN FACTS (scenario: {scenario}):",
        f"- Graduation rate {_fmt_pct(h.get('graduation_rate'))}, on-time {_fmt_pct(h.get('on_time_rate'))}, "
        f"academic dropout {_fmt_pct(h.get('academic_dropout_rate'))}, censored (ran out of time) "
        f"{_fmt_pct(h.get('censored_rate'))}.",
        f"- Average time to degree {h.get('avg_graduation_time', 'n/a')} semesters; "
        f"mean GPA at graduation {h.get('mean_gpa_at_graduation', 'n/a')}.",
    ]

    if criteria:
        lines.append(
            "- Admission health targets (observed / target / slack; slack < 1 means the target is MISSED):"
        )
        for c in criteria:
            lines.append(f"    {c.get('name')}: {c.get('observed')} / {c.get('target')} (slack {c.get('slack')})")

    def _top(key: str, label: str) -> None:
        rows = bn.get(key) or []
        if rows:
            lines.append(f"- Top {label}: " + ", ".join(f"{code} ({n})" for code, n in rows[:5]))

    _top("capacity", "seat/capacity blocks")
    _top("fail", "failure courses")
    _top("offering", "offering blocks")
    _top("prereq", "prerequisite blocks")

    return "\n".join(lines)


def run_chat(messages: list[dict], context: dict, *, timeout: float = 30.0) -> str:
    """Send the grounded system prompt + the conversation to the configured provider, return the reply."""
    if not chat_enabled():
        raise AdvisorChatError("LLM chat is not configured (set LLM_API_KEY).")
    cfg = _config()
    payload = {
        "model": cfg["model"],
        "messages": [{"role": "system", "content": build_system_prompt(context)}, *messages],
        "temperature": 0.2,
        "max_tokens": 700,
    }
    try:
        resp = httpx.post(
            f"{cfg['base_url']}/chat/completions",
            headers={"Authorization": f"Bearer {cfg['api_key']}", "Content-Type": "application/json"},
            json=payload,
            timeout=timeout,
        )
    except httpx.HTTPError as e:  # network / timeout / DNS
        raise AdvisorChatError(f"Could not reach the LLM provider: {e}") from e
    if resp.status_code != 200:
        raise AdvisorChatError(f"LLM provider returned {resp.status_code}: {resp.text[:300]}")
    try:
        return resp.json()["choices"][0]["message"]["content"].strip()
    except (KeyError, IndexError, TypeError) as e:
        raise AdvisorChatError("Unexpected response shape from the LLM provider.") from e
