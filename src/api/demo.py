"""Public read-only demo mode (`DEMO_MODE=1`), for hosting the planner on a free tier so visitors
can try it without installing anything.

What changes when it is on (nothing changes when it is off, which is the department-PC default):

- **One private session per visitor.** A `demo_sid` cookie picks a per-visitor user, so each
  visitor has their own Walkthrough (checkpoint) session and their own analyses. Nobody can see
  or disturb anyone else's.
- **The shared plan is read-only.** Every write that would change the stored plan or its
  curriculum (`PUT /config`, `/curriculum*`, `/plans*`, `/scenarios*`) answers 403. What-if
  testing still works through `/simulate` overrides and the Walkthrough's own working copy,
  neither of which touches the stored plan.
- **A precomputed result opens first.** A new visitor starts with the finished intake analysis and
  seat plan from `data/demo_showcase.json` (built by `scripts/build_demo_showcase.py`), so the
  headline result is there instantly instead of after a long run on a 2-core host.
- **"Run analysis" is the lite version.** `lite_params` coarsens the grid and cuts the seeds so a
  fresh run finishes in a couple of minutes on a free host instead of tens of minutes.
- **Heavy endpoints are rate limited** per client so one visitor cannot hog the 2 vCPUs.

This module lives in the api layer and only imports lower layers.
"""
from __future__ import annotations

import contextvars
import json
import os
import re
import secrets
import threading
import time
from collections import defaultdict, deque
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

COOKIE = "demo_sid"
COOKIE_MAX_AGE = 7 * 24 * 3600
SHOWCASE_PATH = Path(__file__).resolve().parents[2] / "data" / "demo_showcase.json"

READ_ONLY_MESSAGE = (
    "This is a public read-only demo, so the saved plan can't be changed here. "
    "Use the Walkthrough's term settings or the Advisor's Test button to try what-ifs, "
    "or run the planner on your own PC to edit data."
)

# Analysis settings used in the demo: a coarse grid and few seeds. A full analysis needs about
# 570 simulations, which is ~2.5 minutes on a 20-core PC but far too long on a free 2-vCPU host.
LITE_ANALYSIS_PARAMS: dict = {
    "grid_min": 20, "grid_max": 120, "grid_step": 20,
    "seeds": 12, "refine_step": 10, "refine_seeds": 16,
    "reference_runs": 4, "steady_seeds": 6, "robustness_seeds": 3,
    "robustness": False,
}

# (method, path regex) pairs that may write while the demo is on. Everything else that isn't a
# plain read is refused. Checkpoint writes only touch the visitor's own working copy.
_ALLOWED_WRITES = (
    ("POST", re.compile(r"^/simulate$")),
    ("POST", re.compile(r"^/advisor/chat$")),
    ("POST", re.compile(r"^/intake-analyses$")),
    ("POST", re.compile(r"^/intake-analyses/\d+/cancel$")),
    ("POST", re.compile(r"^/checkpoint(/(edit|advance|rewind))?$")),
    ("DELETE", re.compile(r"^/checkpoint$")),
)

# (max requests, window seconds) per client, by endpoint.
_RATE_LIMITS = (
    (re.compile(r"^/simulate$"), 30, 60),
    (re.compile(r"^/advisor/chat$"), 12, 60),
    (re.compile(r"^/intake-analyses$"), 6, 600),
    (re.compile(r"^/checkpoint/(advance|rewind)$"), 60, 60),
)

_SID_RE = re.compile(r"^[0-9a-f]{32}$")
_sid: contextvars.ContextVar[str | None] = contextvars.ContextVar("demo_sid", default=None)
_hits: dict[tuple[str, str], deque] = defaultdict(deque)
_hits_lock = threading.Lock()


def enabled() -> bool:
    return os.environ.get("DEMO_MODE") == "1"


def current_sid() -> str | None:
    """The visitor id of the request being handled (None when demo mode is off)."""
    return _sid.get()


def lite_params(requested: dict | None) -> dict:
    """The analysis settings a demo run actually uses: the visitor's request, capped to the lite
    values, so a crafted request can't ask for the full-size sweep."""
    out = dict(requested or {})
    out.update(LITE_ANALYSIS_PARAMS)
    return out


def _is_write_allowed(method: str, path: str) -> bool:
    return any(method == m and rx.match(path) for m, rx in _ALLOWED_WRITES)


def _client_key(request: Request) -> str:
    fwd = request.headers.get("x-forwarded-for")
    if fwd:
        return fwd.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def _rate_limited(request: Request) -> bool:
    if request.method != "POST":
        return False
    for rx, limit, window in _RATE_LIMITS:
        if rx.match(request.url.path):
            key = (_client_key(request), rx.pattern)
            now = time.monotonic()
            with _hits_lock:
                q = _hits[key]
                while q and now - q[0] > window:
                    q.popleft()
                if len(q) >= limit:
                    return True
                q.append(now)
            return False
    return False


def install(app: FastAPI) -> None:
    """Register the demo middleware. A no-op unless DEMO_MODE=1, checked per request so tests can
    flip it."""

    @app.middleware("http")
    async def demo_guard(request: Request, call_next):
        if not enabled():
            return await call_next(request)
        sid = request.cookies.get(COOKIE)
        fresh = sid is None or not _SID_RE.match(sid)
        if fresh:
            sid = secrets.token_hex(16)
        token = _sid.set(sid)
        try:
            path, method = request.url.path, request.method
            if method not in ("GET", "HEAD", "OPTIONS") and not _is_write_allowed(method, path):
                response = JSONResponse({"detail": READ_ONLY_MESSAGE}, status_code=403)
            elif _rate_limited(request):
                response = JSONResponse(
                    {"detail": "Too many requests from this connection. Please wait a moment and try again."},
                    status_code=429)
            else:
                response = await call_next(request)
        finally:
            _sid.reset(token)
        if fresh:
            secure = request.headers.get("x-forwarded-proto", request.url.scheme) == "https"
            # SameSite=None lets the cookie work when the demo is shown inside an iframe (a
            # Hugging Face Space page); browsers only accept that together with Secure.
            response.set_cookie(COOKIE, sid, max_age=COOKIE_MAX_AGE, httponly=True, path="/",
                                samesite="none" if secure else "lax", secure=secure)
        return response


def demo_email(sid: str) -> str:
    return f"demo-{sid}@local"


def load_showcase() -> list[dict]:
    """Precomputed analyses (newest-first irrelevant): [{kind, label, params, inputs_snapshot,
    result}]. Empty list when the file hasn't been built."""
    try:
        data = json.loads(SHOWCASE_PATH.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return []
    return [row for row in data.get("analyses", []) if isinstance(row, dict) and row.get("result")]
