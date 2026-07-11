"""Tests for the zero-dependency .env loader (src/env.py)."""
from __future__ import annotations

import os

from src.env import load_dotenv


def test_loads_keys_handles_comments_quotes_and_export(tmp_path, monkeypatch):
    for k in ("EV_PLAIN", "EV_QUOTED", "EV_EXPORTED", "EV_COMMENT"):
        monkeypatch.delenv(k, raising=False)
    env = tmp_path / ".env"
    env.write_text(
        "\n".join(
            [
                "# a comment",
                "",
                "EV_PLAIN=hello",
                'EV_QUOTED="a b c"',
                "export EV_EXPORTED=xyz",
                "# EV_COMMENT=should_not_load",
                "NOT_A_PAIR",  # no '=', skipped
            ]
        ),
        encoding="utf-8",
    )
    load_dotenv(env)
    assert os.environ["EV_PLAIN"] == "hello"
    assert os.environ["EV_QUOTED"] == "a b c"  # surrounding quotes stripped
    assert os.environ["EV_EXPORTED"] == "xyz"  # export prefix handled
    assert "EV_COMMENT" not in os.environ  # commented line ignored


def test_real_env_wins_over_dotenv(tmp_path, monkeypatch):
    monkeypatch.setenv("EV_EXISTING", "from-env")
    env = tmp_path / ".env"
    env.write_text("EV_EXISTING=from-file", encoding="utf-8")
    load_dotenv(env)
    assert os.environ["EV_EXISTING"] == "from-env"  # setdefault: real env is not clobbered


def test_missing_file_is_a_noop(tmp_path):
    load_dotenv(tmp_path / "does-not-exist.env")  # must not raise
