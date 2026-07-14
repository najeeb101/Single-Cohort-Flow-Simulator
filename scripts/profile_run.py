"""Benchmark the canonical simulation run and write a compact JSON baseline.

Usage:
    python scripts/profile_run.py
    python scripts/profile_run.py --runs 10 --profile
"""
from __future__ import annotations

import argparse
import cProfile
import json
import pstats
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from src.analytics import compute_metrics
from src.models.course import load_curriculum
from src.simulator import Simulator
from src.utils import load_json


# Anchor data/output paths to the repo ROOT (not the current working directory) so the script
# runs the same from anywhere — `py scripts/profile_run.py` from a subdir previously died with
# FileNotFoundError because these were resolved against the CWD.
DEFAULT_OUTPUT = ROOT / "outputs/profiling/benchmark_baseline.json"


def run_once() -> tuple[float, dict]:
    config = load_json(str(ROOT / "data/simulation_config.json"))
    curriculum = load_curriculum(str(ROOT / "data/curriculum.json"))
    scenario = config["scenarios"][0]

    start = time.perf_counter()
    result = Simulator(curriculum, config, scenario).run()
    elapsed = time.perf_counter() - start
    result.metrics = compute_metrics(result)
    return elapsed, {
        "students": len(result.students),
        "terms": len(result.history.timeline),
        "graduation_rate": result.metrics["graduation_rate"],
        "avg_graduation_time": result.metrics["avg_graduation_time"],
        "top_capacity_blocks": result.metrics["top_capacity_blocks"],
    }


def benchmark(runs: int) -> dict:
    timings: list[float] = []
    summary: dict | None = None
    for _ in range(runs):
        elapsed, summary = run_once()
        timings.append(elapsed)

    assert summary is not None
    sorted_timings = sorted(timings)
    return {
        "runs": runs,
        "timings_seconds": {
            "min": round(min(timings), 6),
            "median": round(sorted_timings[len(sorted_timings) // 2], 6),
            "max": round(max(timings), 6),
            "mean": round(sum(timings) / len(timings), 6),
        },
        "canonical_run": summary,
    }


def write_profile(path: Path) -> None:
    profile = cProfile.Profile()
    profile.enable()
    run_once()
    profile.disable()
    stats_path = path.with_suffix(".pstats")
    stats_path.parent.mkdir(parents=True, exist_ok=True)
    profile.dump_stats(stats_path)

    text_path = path.with_suffix(".profile.txt")
    with text_path.open("w", encoding="utf-8") as f:
        stats = pstats.Stats(profile, stream=f).strip_dirs().sort_stats("cumtime")
        stats.print_stats(30)


def main() -> None:
    parser = argparse.ArgumentParser(description="Benchmark the canonical simulator run.")
    parser.add_argument("--runs", type=int, default=5, help="Number of runs to time.")
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT, help="JSON output path.")
    parser.add_argument("--profile", action="store_true", help="Also write .pstats and text profile files.")
    args = parser.parse_args()

    if args.runs < 1:
        raise SystemExit("--runs must be at least 1")

    payload = benchmark(args.runs)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2)
        f.write("\n")

    if args.profile:
        write_profile(args.output)

    print(f"Wrote {args.output} ({args.runs} runs)")


if __name__ == "__main__":
    main()
