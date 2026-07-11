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

import json
import os
import re

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


def summarize_plan(curriculum: dict, config: dict) -> dict:
    """Compact, LLM-groundable snapshot of the ACTIVE plan: intake knobs, admission targets, and
    every course's definition (seats, pass rate, offering seasons, prerequisites, study-plan term).

    Injected by the ``/advisor/chat`` endpoint from the requesting user's active plan, so the model
    can answer detailed per-course questions ("what's the prerequisite for X?", "how many seats
    does Y have?", "when is Z offered?") from the real curriculum instead of guessing. ``curriculum``
    is the engine-shape ``{code: Course}`` mapping; ``config`` the plan's config dict.
    """
    courses = []
    for code, c in curriculum.items():
        courses.append(
            {
                "code": code,
                "title": getattr(c, "title", ""),
                "credits": getattr(c, "credits", None),
                "category": getattr(c, "category", ""),
                "capacity": getattr(c, "capacity", None),
                "pass_rate": getattr(c, "pass_rate", None),
                "offering": list(getattr(c, "offering", ()) or ()),
                "prerequisites": list(getattr(c, "prerequisites", ()) or ()),
                "has_rule": getattr(c, "rule_expr", None) is not None,
                "study_plan_term": getattr(c, "study_plan_term", 0),
            }
        )
    # Present in study-plan order so the model reads the curriculum the way the roadmap flows.
    courses.sort(key=lambda x: (x["study_plan_term"] or 99, x["code"]))
    return {
        "cohort_size": config.get("cohort_size"),
        "num_cohorts": config.get("num_cohorts"),
        "admit_interval_terms": config.get("admit_interval_terms"),
        "max_terms": config.get("max_terms"),
        "optional_terms_enabled": config.get("optional_terms_enabled", False),
        "targets": config.get("admission_targets") or {},
        "courses": courses,
    }


def _course_run_stat(stat: dict | None) -> str:
    """One-clause summary of how a course actually behaved this run (peaks + pass/fail totals)."""
    if not stat:
        return ""
    bits = []
    if stat.get("denied_peak"):
        bits.append(f"peak seat-denied {stat['denied_peak']}")
    if stat.get("full_terms"):
        bits.append(f"full {stat['full_terms']} terms")
    if stat.get("offering_blocked_peak"):
        bits.append(f"peak offering-blocked {stat['offering_blocked_peak']}")
    if stat.get("prereq_waiting_peak"):
        bits.append(f"peak prereq-waiting {stat['prereq_waiting_peak']}")
    passed, failed = stat.get("passed", 0), stat.get("failed", 0)
    if passed or failed:
        bits.append(f"passed {passed}/failed {failed}")
    return ", ".join(bits) if bits else "no pressure"


def _course_line(c: dict, stat: dict | None) -> str:
    """Render one curriculum course as a single dense line: definition + (optional) run behavior."""
    if c.get("has_rule"):
        extra = c.get("prerequisites") or []
        prereqs = "compound-rule" + (f" (+{','.join(extra)})" if extra else "")
    else:
        prereqs = ",".join(c.get("prerequisites") or []) or "none"
    offered = ",".join(c.get("offering") or []) or "?"
    line = (
        f"{c.get('code')} {c.get('title', '')} [{c.get('credits')} cr, {c.get('category')}]; "
        f"seats={c.get('capacity')}; pass≈{_fmt_pct(c.get('pass_rate'))}; offered={offered}; "
        f"prereqs={prereqs}; term={c.get('study_plan_term') or '-'}"
    )
    run = _course_run_stat(stat)
    if run:
        line += f" | run: {run}"
    return line


def build_system_prompt(context: dict) -> str:
    """Ground the model in exactly this run's numbers, so it can't invent figures or courses.

    ``context`` is the facts blob assembled for one run. The ``/advisor/chat`` endpoint injects
    ``plan`` (the active plan's full curriculum + settings, via :func:`summarize_plan`); the
    frontend supplies the ``/simulate`` summary (``headline`` / ``criteria`` / ``bottlenecks`` /
    ``scenario``) plus per-course run aggregates (``course_stats``). Every field is optional and
    defended, so a partial or empty context still yields a valid prompt.
    """
    ctx = context or {}
    h = ctx.get("headline") or {}
    criteria = ctx.get("criteria") or []
    bn = ctx.get("bottlenecks") or {}
    scenario = ctx.get("scenario") or "baseline"
    plan = ctx.get("plan") or {}
    course_stats = ctx.get("course_stats") or {}

    lines = [
        "You are the built-in assistant of a university course-flow SIMULATOR. A discrete-term, "
        "agent-based model simulates students moving through a curriculum over up to 12 semesters, "
        "all competing for shared course seats; a student can pass, fail, repeat, be delayed, drop "
        "out, or run out of time (CENSORED). An administrator is exploring the results of ONE run.",
        "",
        "RULES:",
        "- Answer ONLY from the facts below: this run's numbers PLUS the full curriculum and current "
        "settings of the active plan (listed under CURRENT PLAN & SETTINGS). Never invent numbers, "
        "courses, prerequisites, or outcomes — if a course or figure isn't below, say you don't have it.",
        "- You DO have every course's seats, pass rate, offering seasons, prerequisites, and study-plan "
        "term, so answer specific per-course questions (\"what unlocks X?\", \"how many seats does Y "
        "have?\", \"when is Z taught?\") directly from that list.",
        "- You are read-only: you can't change anything yourself. To act, point them at the right tool: "
        "Settings (edit the plan), Bottlenecks + Auto-fill (fix seat shortfalls), the What-if panel "
        "(test a change safely), or Live (step term by term).",
        "- Be concise and concrete — usually 2-5 sentences — and cite the real numbers.",
        "- Mechanics you must respect: a capacity block = wanted a seat but the course was full "
        "(fixed by more seats); an offering block = eligible but the course wasn't taught that term "
        "(fixed by offering it more often); a prereq block = prerequisites not yet met (fixed "
        "upstream); a failure = sat the course and didn't pass. ADDING SEATS DOES NOT FIX FAILURES "
        "— those are a pass-rate/support problem.",
        "",
        "PROPOSING CHANGES:",
        "- You can't edit anything yourself, but you CAN propose concrete changes the admin applies "
        "with one click. ONLY when you recommend a specific, numeric change, end your reply with a "
        "fenced json block (nothing after it) of exactly this shape:",
        '```json',
        '{"proposals": [',
        '  {"type": "capacity", "code": "<existing course code>", "value": <int seats>, "reason": "<short why>"},',
        '  {"type": "offering", "code": "<existing course code>", "value": ["Fall","Spring"], "reason": "<short why>"},',
        '  {"type": "pass_rate", "code": "<existing course code>", "value": <0..1>, "reason": "<short why>"},',
        '  {"type": "cohort_size", "value": <int>, "reason": "<short why>"}',
        "]}",
        '```',
        "- capacity fixes seat/capacity blocks; offering fixes offering blocks; pass_rate models a "
        "tutoring/support intervention for a high-failure course; LOWERING cohort_size relieves "
        "shared-pool pressure everywhere. Only use course codes that appear below. At most 3 "
        "proposals, most impactful first. If you are NOT proposing a concrete change, omit the block "
        "entirely. Always give your prose reasoning ABOVE the block.",
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

    if plan:
        lines.append("")
        lines.append("CURRENT PLAN & SETTINGS:")
        lines.append(
            f"- Intake: {plan.get('cohort_size')} students/cohort, {plan.get('num_cohorts')} cohorts, "
            f"admit every {plan.get('admit_interval_terms')} terms; up to {plan.get('max_terms')} "
            "semesters to graduate. Optional (Summer/Winter) terms: "
            f"{'on' if plan.get('optional_terms_enabled') else 'off'}."
        )
        targets = plan.get("targets") or {}
        if targets:
            lines.append("- Admission targets: " + ", ".join(f"{k}={v}" for k, v in targets.items()))
        courses = plan.get("courses") or []
        if courses:
            lines.append(
                f"- Curriculum ({len(courses)} courses, in study-plan order). Each line: "
                "CODE title [credits, category]; seats; pass rate; offered seasons; prereqs; "
                "study-plan term | run: how it behaved this run."
            )
            for c in courses:
                lines.append("    " + _course_line(c, course_stats.get(c.get("code"))))

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


# --- Actionable proposals (step 2: propose a change the admin applies with one click) -----------
#
# The model is asked to append a fenced ```json {"proposals":[...]} ``` block ONLY when it
# recommends a concrete, numeric change. extract_proposals() pulls that block out (so the user
# never sees raw JSON) and validate_proposals() checks each entry against the real active plan,
# normalizing it into a card the frontend applies via the existing PUT /curriculum / PUT /config
# endpoints. Every stage is defensive: a malformed block or a bad entry is dropped, never fatal.
# The LLM never writes anything — it only suggests; the human clicks Apply.

_FENCE_RE = re.compile(r"```(?:json)?\s*(.*?)\s*```", re.DOTALL)
_PROPOSAL_TYPES = ("capacity", "offering", "pass_rate", "cohort_size")


def extract_proposals(text: str) -> tuple[str, list]:
    """Split an assistant reply into (prose, raw proposals). Returns ``(text, [])`` unchanged if
    there is no parseable ``{"proposals": [...]}`` block, so a plain answer is never mangled."""
    if not text:
        return text, []
    for m in _FENCE_RE.finditer(text):
        try:
            data = json.loads(m.group(1).strip())
        except (ValueError, TypeError):
            continue
        if isinstance(data, dict) and isinstance(data.get("proposals"), list):
            clean = (text[: m.start()] + text[m.end():]).strip()
            return clean, data["proposals"]
    # Fallback: a bare (un-fenced) {"proposals": ...} object, assumed to run to the end of the text.
    idx = text.find('{"proposals"')
    if idx != -1:
        try:
            data = json.loads(text[idx:])
            if isinstance(data, dict) and isinstance(data.get("proposals"), list):
                return text[:idx].strip(), data["proposals"]
        except (ValueError, TypeError):
            pass
    return text, []


def _as_int(v: object) -> int | None:
    try:
        return int(v)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return None


def _as_float(v: object) -> float | None:
    try:
        return float(v)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return None


def validate_proposals(raw: list, curriculum: dict, config: dict) -> list[dict]:
    """Whitelist + normalize the model's raw proposals against the real active plan.

    Each surviving proposal becomes a card the frontend can apply directly:
    ``{type, code?, value, current, reason, label}``. Anything with an unknown type, a course code
    that doesn't exist, or an out-of-range value is dropped (never raised) — the endpoint that
    actually applies the change is the final gate. Capped at 3.
    """
    seasons = set(config.get("terms_per_year") or []) or {"Fall", "Spring"}
    out: list[dict] = []
    for p in (raw or [])[:6]:
        if not isinstance(p, dict) or p.get("type") not in _PROPOSAL_TYPES:
            continue
        t = p["type"]
        reason = str(p.get("reason") or "").strip()[:220]

        if t == "cohort_size":
            v = _as_int(p.get("value"))
            if v is None or v < 1:
                continue
            cur = config.get("cohort_size")
            out.append({"type": t, "value": v, "current": cur, "reason": reason,
                        "label": f"Set cohort size to {v}" + (f" (from {cur})" if cur is not None else "")})
            continue

        code = p.get("code")
        course = curriculum.get(code) if isinstance(code, str) else None
        if course is None:
            continue

        if t == "capacity":
            v = _as_int(p.get("value"))
            if v is None or v < 1:
                continue
            cur = getattr(course, "capacity", None)
            out.append({"type": t, "code": code, "value": v, "current": cur, "reason": reason,
                        "label": f"Set {code} capacity to {v} seats" + (f" (from {cur})" if cur is not None else "")})
        elif t == "pass_rate":
            v = _as_float(p.get("value"))
            if v is None or not (0.0 <= v <= 1.0):
                continue
            cur = getattr(course, "pass_rate", None)
            cur_txt = f" (from {cur:.0%})" if isinstance(cur, (int, float)) else ""
            out.append({"type": t, "code": code, "value": v, "current": cur, "reason": reason,
                        "label": f"Set {code} pass rate to {v:.0%}" + cur_txt})
        elif t == "offering":
            val = p.get("value")
            if not isinstance(val, list):
                continue
            val = [s for s in val if s in seasons]
            if not val:
                continue
            cur = list(getattr(course, "offering", ()) or ())
            out.append({"type": t, "code": code, "value": val, "current": cur, "reason": reason,
                        "label": f"Offer {code} in {', '.join(val)}" + (f" (was {', '.join(cur)})" if cur else "")})

        if len(out) >= 3:
            break
    return out[:3]
