from __future__ import annotations

import json
from pathlib import Path


def load_json(path: str | Path) -> dict | list:
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def grade_tier(pass_rate: float, config: dict) -> str:
    tiers = config["grade_tiers"]
    if pass_rate <= tiers["hard_max"]:
        return "hard"
    if pass_rate <= tiers["medium_max"]:
        return "medium"
    return "easy"
