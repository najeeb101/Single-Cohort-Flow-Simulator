"""Zero-dependency ``.env`` loader — avoids pulling in python-dotenv for one small need.

Called once at API startup (``src/api.py``) before anything reads ``os.environ``, so keys like
``LLM_API_KEY`` / ``LLM_BASE_URL`` / ``LLM_MODEL`` (and ``DATABASE_URL``, ``CORS_ORIGINS``) can
live in a repo-root ``.env`` instead of being exported on every launch.

Real environment variables always win: :func:`load_dotenv` uses ``setdefault``, so a value already
present in ``os.environ`` is never overwritten. Lines may be blank, ``# comments``, or
``KEY=VALUE`` with an optional ``export`` prefix and optional matching surrounding quotes.
"""
from __future__ import annotations

import os
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parent.parent


def load_dotenv(path: str | os.PathLike[str] | None = None) -> None:
    env_path = Path(path) if path is not None else _REPO_ROOT / ".env"
    if not env_path.is_file():
        return
    for raw in env_path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[len("export ") :]
        key, sep, value = line.partition("=")
        if not sep:
            continue
        key = key.strip()
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in ("'", '"'):
            value = value[1:-1]  # strip matching surrounding quotes
        if key:
            os.environ.setdefault(key, value)  # real env wins
