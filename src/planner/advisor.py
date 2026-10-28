"""Phase B of the hybrid advisor: an optional LLM chat box grounded in the plan, the latest
intake analysis, and one run's numbers.

**The model never produces the intake number** — src/planner/intake.py does. The chat explains the
recommendation and proposes changes to *test*; nothing is written without the admin's click.

Provider-agnostic: it POSTs to any OpenAI-compatible ``/chat/completions`` endpoint selected by
environment variables. The recommended setup is a **local model through Ollama** (free, offline,
nothing leaves the department PC)::

    LLM_BASE_URL   e.g. http://localhost:11434/v1 (Ollama); default https://api.groq.com/openai/v1
    LLM_MODEL      e.g. qwen3:4b-instruct-2507-q4_K_M; default llama-3.3-70b-versatile
    LLM_API_KEY    required for a hosted provider; optional for a localhost server
    LLM_TIMEOUT    seconds; default 120 for a local server (CPU/GPU inference is slower), else 30

A local **Ollama** server (port 11434) is called through its native ``/api/chat`` with
``num_ctx`` = :data:`OLLAMA_NUM_CTX`: Ollama ignores context settings on its OpenAI-compatible
endpoint and defaults to 4096 tokens, which the grounding prompt (the whole curriculum plus the
latest analysis, ~3k tokens) plus a reply would overflow — silently, by truncation.

An optional paid/hosted fallback is tried when the primary can't be reached::

    LLM_FALLBACK_BASE_URL, LLM_FALLBACK_MODEL, LLM_FALLBACK_API_KEY

With neither a key nor a local base URL the feature is dormant: :func:`chat_enabled` is
``False``, ``/meta`` reports it, and the frontend shows a "how to enable" note — the rules-based
``AdvisorPanel`` needs no model at all.
"""
from __future__ import annotations

import json
import os
import re

import httpx

from src.domain.semester import admission_seasons

DEFAULT_BASE_URL = "https://api.groq.com/openai/v1"
DEFAULT_MODEL = "llama-3.3-70b-versatile"


_LOCAL_HOSTS = ("localhost", "127.0.0.1", "0.0.0.0", "[::1]")


OLLAMA_NUM_CTX = 8192
_OLLAMA_PORT = "11434"


def _host_port(base_url: str) -> tuple[str, str]:
    netloc = base_url.split("://", 1)[-1].split("/", 1)[0].lower()
    host, _, port = netloc.rpartition(":") if ":" in netloc.lstrip("[") else (netloc, "", "")
    return (host or netloc), port


def _is_local(base_url: str) -> bool:
    return _host_port(base_url)[0] in _LOCAL_HOSTS


def _is_ollama(base_url: str) -> bool:
    """A local server on Ollama's port, or LLM_OLLAMA_NATIVE=1 to force the native API."""
    if os.environ.get("LLM_OLLAMA_NATIVE") == "1":
        return True
    host, port = _host_port(base_url)
    return host in _LOCAL_HOSTS and port == _OLLAMA_PORT


def _provider(prefix: str = "LLM_") -> dict | None:
    """One provider's settings from env (``LLM_`` primary, ``LLM_FALLBACK_`` fallback), or None
    when that provider isn't configured. A localhost server (Ollama, LM Studio) needs no key."""
    explicit_url = os.environ.get(f"{prefix}BASE_URL")
    if prefix != "LLM_" and not explicit_url:
        return None
    base_url = (explicit_url or DEFAULT_BASE_URL).rstrip("/")
    api_key = os.environ.get(f"{prefix}API_KEY", "")
    local = _is_local(base_url)
    if not api_key and not local:
        return None
    return {
        "base_url": base_url,
        "api_key": api_key or "local",
        "model": os.environ.get(f"{prefix}MODEL", DEFAULT_MODEL),
        "local": local,
        "ollama": _is_ollama(base_url),
        "timeout": float(os.environ.get("LLM_TIMEOUT", 120.0 if local else 30.0)),
    }


def _providers() -> list[dict]:
    return [p for p in (_provider("LLM_"), _provider("LLM_FALLBACK_")) if p]


def chat_enabled() -> bool:
    """True when a hosted provider has a key or a local server URL is configured."""
    return bool(_providers())


def _config() -> dict:
    """The primary provider's settings (kept for callers/tests that read one config)."""
    providers = _providers()
    return providers[0] if providers else {
        "base_url": DEFAULT_BASE_URL, "api_key": "", "model": DEFAULT_MODEL, "local": False,
        "ollama": False, "timeout": 30.0}


def _label(provider: dict) -> str:
    where = "on this PC" if provider["local"] else provider["base_url"].split("://", 1)[-1].split("/", 1)[0]
    return f"{provider['model']} · {where}"


def model_label() -> str | None:
    """Human-readable "which model answers" line for the UI, e.g. "qwen3:4b · on this PC"."""
    providers = _providers()
    return _label(providers[0]) if providers else None


_THINK_RE = re.compile(r"<think>.*?</think>", re.DOTALL | re.IGNORECASE)


class AdvisorChatError(RuntimeError):
    """Any failure talking to the LLM provider (unreachable, non-200, or a malformed reply)."""


def _fmt_pct(x: object) -> str:
    try:
        return f"{float(x) * 100:.1f}%"  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return "n/a"


def summarize_plan(curriculum: dict, config: dict) -> dict:
    """Compact, LLM-groundable snapshot of the ACTIVE plan: intake knobs, intake policy limits, and
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
        "admission_terms": admission_seasons(config),
        "admission_sizes": config.get("admission_sizes") or {},
        "max_terms": config.get("max_terms"),
        "optional_terms_enabled": config.get("optional_terms_enabled", False),
        "intake_policy": config.get("intake_policy") or {},
        "past_intakes": [e.get("size") for e in (config.get("current_students") or {}).get("past_intakes") or []],
        "seat_step": config.get("seat_step", 5),
        "courses": courses,
    }


def summarize_analysis(result: dict | None, *, label: str | None = None, when: str | None = None) -> dict:
    """Compact, LLM-groundable view of one completed intake analysis (src/planner/intake.py)."""
    if not result:
        return {}
    rec = result.get("recommendation") or {}
    nxt = (result.get("views") or {}).get("next") or {}
    rows = []
    for p in nxt.get("points") or []:
        top = p["top_courses"][0]["code"] if p.get("top_courses") else None
        rows.append({
            "intake": p["intake"],
            "grad_rate": round(p["grad_rate"], 3),
            "on_time_rate": round(p["on_time_rate"], 3),
            "grad_loss_pts": round(p.get("grad_rate_loss_fit", 0.0), 1),
            "on_time_loss_pts": round(p.get("on_time_loss_fit", 0.0), 1),
            "graduates_per_year": round(p["graduates_per_year"], 1),
            "top_short_course": top,
        })
    rob = rec.get("robustness") or {}
    ref = result.get("reference") or {}
    return {
        "label": label or result.get("label"),
        "when": when,
        "recommended_intake": rec.get("recommended_intake"),
        "sustainable_intake": rec.get("sustainable_intake"),
        "upper_limit": rec.get("upper_limit"),
        "feasible": rec.get("feasible"),
        "binding_limit": rec.get("binding_limit"),
        "binding_course": rec.get("binding_course"),
        "why": rec.get("why"),
        "robustness_range": rob.get("range"),
        "warnings": rec.get("warnings") or [],
        "policy": result.get("policy") or {},
        "reference_grad_rate": ref.get("grad_rate"),
        "reference_on_time_rate": ref.get("on_time_rate"),
        "per_intake": rows,
        "illustrative": (result.get("data_quality") or {}).get("illustrative"),
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
    ``plan`` (the active plan's full curriculum + settings, via :func:`summarize_plan`) and
    ``intake_analysis`` (the latest completed intake analysis, via :func:`summarize_analysis`);
    the frontend supplies the ``/simulate`` summary (``headline`` / ``bottlenecks`` /
    ``scenario``) plus per-course run aggregates (``course_stats``). Every field is optional and
    defended, so a partial or empty context still yields a valid prompt.
    """
    ctx = context or {}
    h = ctx.get("headline") or {}
    bn = ctx.get("bottlenecks") or {}
    scenario = ctx.get("scenario") or "baseline"
    plan = ctx.get("plan") or {}
    course_stats = ctx.get("course_stats") or {}

    analysis = ctx.get("intake_analysis") or {}
    lines = [
        "You are the built-in assistant of the CS INTAKE PLANNER used by a university department "
        "(Qatar University Computer Science). Its one question: HOW MANY STUDENTS SHOULD WE ADMIT IN "
        "THE NEXT INTAKE, AND WHAT COURSE SEATS DOES THAT NUMBER NEED? A discrete-term, agent-based "
        "model simulates students moving through the real curriculum over up to 12 semesters, all "
        "competing for shared course seats; a student can pass, fail, repeat, be delayed, drop out, "
        "or run out of time (CENSORED). The intake recommendation below was computed by the "
        "simulation's intake sweep - explain it, never recompute or overrule it yourself.",
        "",
        "RULES:",
        "- Answer ONLY from the facts below: this run's numbers PLUS the full curriculum and current "
        "settings of the active plan (listed under CURRENT PLAN & SETTINGS). Never invent numbers, "
        "courses, prerequisites, or outcomes — if a course or figure isn't below, say you don't have it.",
        "- You DO have every course's seats, pass rate, offering seasons, prerequisites, and study-plan "
        "term, so answer specific per-course questions (\"what unlocks X?\", \"how many seats does Y "
        "have?\", \"when is Z taught?\") directly from that list.",
        "- You are read-only: you can't change anything yourself. To act, point them at the right tool: "
        "the Intake Planner page (run the analysis; its seat planner answers 'what would it take to "
        "admit N?' in seats per course, which the department can add by widening sections or opening "
        "new ones), the Data page (edit seats, pass rates, past intakes, other-program "
        "seats, policy limits), Bottlenecks (which courses limit intake), the Test button on a proposal "
        "you emit below (a safe what-if run that predicts the effect before they Apply it), or the "
        "Walkthrough page (step term by term, editing capacity/pass rate/occupancy/intake between steps).",
        "- Data honesty: seats and sections change every semester, and many inputs may still be "
        "estimates rather than QU data. When the analysis is marked illustrative, say so.",
        "- Be concise and concrete — usually 2-5 sentences — and cite the real numbers.",
        "- Mechanics you must respect: a capacity block = wanted a seat but the course was full "
        "(fixed by more seats); an offering block = eligible but the course wasn't taught that term "
        "(fixed by offering it more often); a prereq block = prerequisites not yet met (fixed "
        "upstream); a failure = sat the course and didn't pass. ADDING SEATS DOES NOT FIX FAILURES "
        "— those are a pass-rate/support problem.",
        "- The prerequisite-block COUNT is a passive whole-curriculum sweep (every not-yet-eligible "
        "student is re-counted every term), so it runs large and noisy — never call it \"the biggest "
        "bottleneck\". Rank real, actionable pressure by seat/capacity blocks, offering blocks, and "
        "failures instead; a high prereq count means fix the UPSTREAM gateway (its seats or pass rate), "
        "not the downstream course that's waiting.",
        "",
        "PROPOSING CHANGES:",
        "- You can't edit anything yourself, but you CAN propose concrete changes the admin can Test "
        "(a what-if run that predicts the effect) and then Apply. Emit a proposal whenever you "
        "recommend a specific numeric change, OR whenever the user asks you to test / try / model a "
        "specific change (a \"what if I…\" question). In those cases end your reply with a fenced json "
        "block (nothing after it) of exactly this shape:",
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

    if analysis:
        lines.append("")
        when = f", {analysis.get('when')}" if analysis.get("when") else ""
        lines.append(f"LATEST INTAKE ANALYSIS ({analysis.get('label') or 'next intake'}{when}):")
        rec_n = analysis.get("recommended_intake")
        lines.append(
            f"- Recommended next intake: {rec_n if rec_n is not None else 'NONE meets the policy limits'}; "
            f"sustainable every year: {analysis.get('sustainable_intake') or 'n/a'}; upper limit (extra "
            f"students stop adding graduates beyond): {analysis.get('upper_limit') or 'not reached'}."
        )
        if analysis.get("why"):
            lines.append(f"- Why: {analysis['why']}")
        if analysis.get("robustness_range"):
            lo, hi = analysis["robustness_range"]
            lines.append(f"- Robustness range (10% fewer seats in the tightest courses / pass rates 5 pts lower): {lo}-{hi}.")
        pol = analysis.get("policy") or {}
        lines.append(
            f"- Policy limits: seat shortages may cost at most {pol.get('max_grad_rate_loss_pts')} pts of "
            f"graduation rate and {pol.get('max_on_time_loss_pts')} pts of on-time graduation, measured "
            f"against the same students with unlimited seats (graduation "
            f"{_fmt_pct(analysis.get('reference_grad_rate'))}, on-time {_fmt_pct(analysis.get('reference_on_time_rate'))})."
        )
        rows = analysis.get("per_intake") or []
        if rows:
            lines.append("- Per intake (next intakes, smoothed): N: grad / on-time / grad loss / on-time loss / "
                         "graduates per year / most short course")
            for r in rows:
                lines.append(
                    f"    {r['intake']}: {_fmt_pct(r['grad_rate'])} / {_fmt_pct(r['on_time_rate'])} / "
                    f"{r['grad_loss_pts']} pts / {r['on_time_loss_pts']} pts / {r['graduates_per_year']} / "
                    f"{r.get('top_short_course') or '-'}"
                )
        for w in analysis.get("warnings") or []:
            lines.append(f"- Caveat: {w}")

    def _top(key: str, label: str) -> None:
        rows = bn.get(key) or []
        if rows:
            lines.append(f"- Top {label}: " + ", ".join(f"{code} ({n})" for code, n in rows[:5]))

    _top("capacity", "seat/capacity blocks")
    _top("fail", "failure courses")
    _top("offering", "offering blocks")
    _top("prereq", "prerequisite blocks")

    severe = ctx.get("severe_terms") or {}
    warnings = severe.get("warnings") or []
    if warnings:
        lines.append("- NOTABLE TERM-LEVEL BOTTLENECKS (already occurred in this run, worst first):")
        for w in warnings[:6]:
            lines.append(f"    * {w.get('message')}")

    if plan:

        lines.append("")
        lines.append("CURRENT PLAN & SETTINGS:")
        admit_terms = plan.get("admission_terms") or ["Fall"]
        admit_sizes = plan.get("admission_sizes") or {}
        intake_desc = ", ".join(
            f"{s} ({admit_sizes.get(s, plan.get('cohort_size'))})" for s in admit_terms
        )
        lines.append(
            f"- Intake: {plan.get('num_cohorts')} cohorts, admitting in {intake_desc} (season size); "
            f"{plan.get('cohort_size')} students/cohort by default; up to {plan.get('max_terms')} "
            "semesters to graduate. Optional (Summer/Winter) terms: "
            f"{'on' if plan.get('optional_terms_enabled') else 'off'}."
        )
        policy = plan.get("intake_policy") or {}
        if policy:
            lines.append("- Intake policy limits: " + ", ".join(f"{k}={v}" for k, v in policy.items()))
        if plan.get("past_intakes"):
            lines.append(f"- Past intakes (most recent first): {plan['past_intakes']}.")
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


def _call(provider: dict, messages: list[dict], context: dict, timeout: float | None) -> str:
    convo = [{"role": "system", "content": build_system_prompt(context)}, *messages]
    if provider.get("ollama"):
        # Native Ollama API: the only way to raise its 4096-token default context per request.
        root = provider["base_url"][:-3] if provider["base_url"].endswith("/v1") else provider["base_url"]
        url = f"{root}/api/chat"
        payload = {"model": provider["model"], "messages": convo, "stream": False,
                   "options": {"num_ctx": OLLAMA_NUM_CTX, "temperature": 0.2, "num_predict": 700}}
    else:
        url = f"{provider['base_url']}/chat/completions"
        payload = {"model": provider["model"], "messages": convo, "temperature": 0.2, "max_tokens": 700}
    try:
        resp = httpx.post(
            url,
            headers={"Authorization": f"Bearer {provider['api_key']}", "Content-Type": "application/json"},
            json=payload,
            timeout=timeout if timeout is not None else provider["timeout"],
        )
    except httpx.HTTPError as e:  # network / timeout / DNS
        raise AdvisorChatError(f"Could not reach the LLM provider: {e}") from e
    if resp.status_code != 200:
        raise AdvisorChatError(f"LLM provider returned {resp.status_code}: {resp.text[:300]}")
    try:
        body = resp.json()
        content = body["message"]["content"] if provider.get("ollama") else body["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError) as e:
        raise AdvisorChatError("Unexpected response shape from the LLM provider.") from e
    # Reasoning models (Qwen3 thinking variants) may prepend a <think>...</think> block.
    return _THINK_RE.sub("", content or "").strip()


def run_chat_detailed(messages: list[dict], context: dict, *, timeout: float | None = None) -> dict:
    """Ask the primary provider, falling back to the LLM_FALLBACK_* one if the primary fails.
    Returns {"reply", "model"} where model is the human-readable label of who answered."""
    providers = _providers()
    if not providers:
        raise AdvisorChatError("LLM chat is not configured (set LLM_BASE_URL to a local server, or LLM_API_KEY).")
    errors = []
    for provider in providers:
        try:
            return {"reply": _call(provider, messages, context, timeout), "model": _label(provider)}
        except AdvisorChatError as e:
            errors.append(f"{_label(provider)}: {e}")
    raise AdvisorChatError("; ".join(errors))


def run_chat(messages: list[dict], context: dict, *, timeout: float | None = None) -> str:
    """Send the grounded system prompt + the conversation, return the reply text."""
    return run_chat_detailed(messages, context, timeout=timeout)["reply"]


# --- Actionable proposals (step 2: propose a change the admin applies with one click) -----------
#
# The model is asked to append a fenced ```json {"proposals":[...]} ``` block ONLY when it
# recommends a concrete, numeric change. extract_proposals() pulls that block out (so the user
# never sees raw JSON) and validate_proposals() checks each entry against the real active plan,
# normalizing it into a card the frontend applies via the existing PUT /curriculum / PUT /config
# endpoints. Every stage is defensive: a malformed block or a bad entry is dropped, never fatal.
# The LLM never writes anything — it only suggests; the human clicks Apply.

_FENCE_RE = re.compile(r"```(?:json)?\s*(.*?)\s*```", re.DOTALL)
_TRAILING_COMMA_RE = re.compile(r",(\s*[}\]])")
_PROPOSAL_TYPES = ("capacity", "offering", "pass_rate", "cohort_size")
# Max pass-rate increase per proposal — prevents unrealistic 40% → 100% jumps.
_MAX_PASS_RATE_DELTA = 0.15


def _loads_lenient(s: str) -> object:
    """``json.loads`` that also tolerates a trailing comma before a closing ``}``/``]`` — the single
    most common way LLMs (llama especially) emit *almost*-valid JSON. Without this, a trailing comma
    made the whole proposal block unparseable, so the raw JSON leaked into the shown reply AND the
    proposal was dropped. Returns ``None`` if it still can't parse."""
    for candidate in (s, _TRAILING_COMMA_RE.sub(r"\1", s)):
        try:
            return json.loads(candidate)
        except (ValueError, TypeError):
            continue
    return None


def extract_proposals(text: str) -> tuple[str, list]:
    """Split an assistant reply into (prose, raw proposals). Returns ``(text, [])`` unchanged if
    there is no parseable ``{"proposals": [...]}`` block, so a plain answer is never mangled."""
    if not text:
        return text, []
    for m in _FENCE_RE.finditer(text):
        data = _loads_lenient(m.group(1).strip())
        if isinstance(data, dict) and isinstance(data.get("proposals"), list):
            clean = (text[: m.start()] + text[m.end():]).strip()
            return clean, data["proposals"]
    # Fallback: a bare (un-fenced) {"proposals": ...} object, assumed to run to the end of the text.
    idx = text.find('{"proposals"')
    if idx != -1:
        data = _loads_lenient(text[idx:])
        if isinstance(data, dict) and isinstance(data.get("proposals"), list):
            return text[:idx].strip(), data["proposals"]
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


def _deduplicate_proposals(raw: list) -> list:
    """Keep only the first proposal per (type, code) pair to prevent conflicting changes."""
    seen: set[tuple] = set()
    result = []
    for p in raw:
        if not isinstance(p, dict):
            continue
        key = (p.get("type"), p.get("code", "__no_code__"))
        if key in seen:
            continue
        seen.add(key)
        result.append(p)
    return result


def validate_proposals(raw: list, curriculum: dict, config: dict) -> list[dict]:
    """Whitelist + normalize the model's raw proposals against the real active plan.

    Each surviving proposal becomes a card the frontend can apply directly:
    ``{type, code?, value, current, reason, label}``. Anything with an unknown type, a course code
    that doesn't exist, or an out-of-range value is dropped (never raised) — the endpoint that
    actually applies the change is the final gate. Capped at 3.

    Guardrails applied:
    - Deduplicate conflicting proposals (first-wins per type+code).
    - Cap pass_rate increases to +0.15 over the course's current pass rate.
    """
    seasons = set(config.get("terms_per_year") or []) or {"Fall", "Spring"}
    deduped = _deduplicate_proposals(raw or [])
    out: list[dict] = []
    for p in deduped[:6]:
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
            if v == cur:
                continue  # a no-op "change" isn't worth a card
            out.append({"type": t, "code": code, "value": v, "current": cur, "reason": reason,
                        "label": f"Set {code} capacity to {v} seats" + (f" (from {cur})" if cur is not None else "")})
        elif t == "pass_rate":
            v = _as_float(p.get("value"))
            if v is None or not (0.0 <= v <= 1.0):
                continue
            cur = getattr(course, "pass_rate", None)
            # Cap pass-rate increase to _MAX_PASS_RATE_DELTA over the current rate.
            if isinstance(cur, (int, float)) and v > cur + _MAX_PASS_RATE_DELTA:
                v = round(cur + _MAX_PASS_RATE_DELTA, 2)
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
            if set(val) == set(cur):
                continue  # already offered exactly then — nothing to apply
            out.append({"type": t, "code": code, "value": val, "current": cur, "reason": reason,
                        "label": f"Offer {code} in {', '.join(val)}" + (f" (was {', '.join(cur)})" if cur else "")})

        if len(out) >= 3:
            break
    return out[:3]

