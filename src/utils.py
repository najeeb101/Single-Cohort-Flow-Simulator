from __future__ import annotations

import json
from pathlib import Path


def load_json(path: str | Path) -> dict | list:
    with open(path, encoding="utf-8") as f:
        return json.load(f)


# Gap between replication seeds. Each student's RNG is Random(seed + student_id), so seeds that
# differ by 1 just shift every student by one id and replay ~99% of the same population; a stride
# much larger than any run's student count keeps replications genuinely independent.
SEED_STRIDE = 10_000_019


def spaced_seeds(base_seed: int, n: int) -> list[int]:
    """`n` independent replication seeds starting at `base_seed` (see SEED_STRIDE)."""
    return [int(base_seed) + k * SEED_STRIDE for k in range(n)]


def grade_tier(pass_rate: float, config: dict) -> str:
    tiers = config["grade_tiers"]
    if pass_rate <= tiers["hard_max"]:
        return "hard"
    if pass_rate <= tiers["medium_max"]:
        return "medium"
    return "easy"
