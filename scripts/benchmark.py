"""Benchmark harness (optimization plan item 1 / testing section): run a standard scenario
a few times and record wall time + peak memory, so every optimization PR can attach a
before/after baseline. Stdlib-only (`time.perf_counter` + `tracemalloc`) so it runs anywhere
`py` does; no external profiler needed.

Examples:
    # Measure the baseline, write outputs/profiling/benchmark_baseline.json
    py scripts/benchmark.py

    # Measure the Monte Carlo path over 5 repeats without overwriting the saved baseline
    py scripts/benchmark.py --montecarlo 10 --repeats 5 --no-save

    # Compare the current tree against a saved baseline (for a PR)
    py scripts/benchmark.py --compare outputs/profiling/benchmark_baseline.json

`peak_mem_mb` is peak *traced Python* allocation (tracemalloc), not RSS — a stable,
cross-platform proxy for the GC/allocation pressure the optimization plan targets, not an
OS memory figure. It is measured in a **separate** run from the timed ones: tracemalloc
instruments every allocation and inflates wall time ~3-4x, so timing it and tracing it in the
same run would report a wall figure that is pure measurement artifact.
"""
from __future__ import annotations

import argparse
import copy
import json
import platform
import statistics
import subprocess
import sys
import time
import tracemalloc
from datetime import datetime, timezone
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parent.parent
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from src.models.course import load_curriculum  # noqa: E402
from src.montecarlo import run_monte_carlo  # noqa: E402
from src.service import run_simulation  # noqa: E402
from src.utils import load_json  # noqa: E402

_DATA = _REPO_ROOT / "data"
_DEFAULT_OUT = _REPO_ROOT / "outputs" / "profiling" / "benchmark_baseline.json"


def _resolve_scenario(config: dict, name: str | None) -> dict:
    scenarios = config["scenarios"]
    if name is None:
        return scenarios[0]
    for s in scenarios:
        if s["name"] == name:
            return s
    available = ", ".join(s["name"] for s in scenarios)
    raise SystemExit(f"No scenario named {name!r}. Available: {available}")


def _git_commit() -> str:
    try:
        out = subprocess.run(
            ["git", "rev-parse", "--short", "HEAD"],
            cwd=_REPO_ROOT, capture_output=True, text=True, check=True,
        )
        return out.stdout.strip()
    except (subprocess.CalledProcessError, FileNotFoundError):
        return "unknown"


def _build_workload(curriculum, config, scenario, mc_runs: int):
    if mc_runs > 0:
        mc_config = copy.deepcopy(config)
        mc_config.setdefault("monte_carlo", {})["n_runs"] = mc_runs

        def workload() -> None:
            run_monte_carlo(curriculum, mc_config, scenario)

        return workload

    def workload() -> None:
        run_simulation(curriculum, config, scenario)

    return workload


def _time_once(workload) -> float:
    """Run the workload once (no memory tracing) and return wall seconds."""
    t0 = time.perf_counter()
    workload()
    return time.perf_counter() - t0


def _peak_memory_once(workload) -> float:
    """Run the workload once under tracemalloc and return peak traced MB (timing discarded —
    tracemalloc's per-allocation overhead makes any wall time from this run meaningless)."""
    tracemalloc.start()
    workload()
    peak_bytes = tracemalloc.get_traced_memory()[1]
    tracemalloc.stop()
    return peak_bytes / (1024 * 1024)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--scenario", default=None, help="scenario name (default: first in config)")
    parser.add_argument("--repeats", type=int, default=3, help="timed runs to aggregate (default: 3)")
    parser.add_argument("--montecarlo", type=int, default=0, metavar="N",
                        help="benchmark run_monte_carlo with N seeds instead of a single run (default: 0)")
    parser.add_argument("--out", default=str(_DEFAULT_OUT), help=f"where to write the baseline JSON (default: {_DEFAULT_OUT})")
    parser.add_argument("--no-save", action="store_true", help="print results but don't write the JSON baseline")
    parser.add_argument("--compare", default=None, metavar="PATH",
                        help="load a previous baseline JSON and print deltas against this run")
    args = parser.parse_args()

    config = load_json(_DATA / "simulation_config.json")
    curriculum = load_curriculum(_DATA / "curriculum.json")
    scenario = _resolve_scenario(config, args.scenario)

    n_students = config.get("num_cohorts", 1) * config["cohort_size"]
    workload = _build_workload(curriculum, config, scenario, args.montecarlo)

    label = scenario["name"] + (f" (Monte Carlo x{args.montecarlo})" if args.montecarlo else "")
    print(f"Benchmark: {label}")
    print(f"  {config.get('num_cohorts', 1)} cohorts x {config['cohort_size']} = {n_students} study students")
    print(f"  {args.repeats} repeat(s) on {platform.python_implementation()} {platform.python_version()} / {platform.system()}")

    walls: list[float] = []
    for i in range(args.repeats):
        wall = _time_once(workload)
        walls.append(wall)
        print(f"  run {i + 1}/{args.repeats}: {wall:7.3f}s")

    # Memory is sampled in one extra, untimed run so tracemalloc's overhead never touches the
    # wall figures above. Peak is deterministic across runs, so one sample is enough.
    peak_mb = _peak_memory_once(workload)
    print(f"  memory run: peak {peak_mb:.1f} MB  (traced separately; not timed)")

    result = {
        "commit": _git_commit(),
        "timestamp": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "python": platform.python_version(),
        "platform": platform.platform(),
        "scenario": scenario["name"],
        "montecarlo_runs": args.montecarlo,
        "n_students": n_students,
        "repeats": args.repeats,
        "wall_seconds": {
            "min": min(walls),
            "mean": statistics.fmean(walls),
            "median": statistics.median(walls),
            "max": max(walls),
        },
        "peak_mem_mb": peak_mb,
    }

    w = result["wall_seconds"]
    print(f"\n  wall (s):  min {w['min']:.3f}   mean {w['mean']:.3f}   median {w['median']:.3f}   max {w['max']:.3f}")
    print(f"  peak (MB): {peak_mb:.1f}")
    print(f"  commit {result['commit']}")

    if args.compare:
        _print_comparison(Path(args.compare), result)

    if not args.no_save:
        out_path = Path(args.out)
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
        print(f"\nBaseline written to {out_path}")


def _print_comparison(baseline_path: Path, current: dict) -> None:
    if not baseline_path.exists():
        print(f"\n[--compare] no baseline at {baseline_path}; skipping comparison.")
        return
    base = json.loads(baseline_path.read_text(encoding="utf-8"))
    print(f"\nComparison vs {base.get('commit', '?')} ({baseline_path.name}):")

    def _scalar(entry, prefer_median: bool):
        # wall_seconds is a {min,mean,median,max} dict; peak_mem_mb is a scalar. Older
        # baselines stored peak as a dict too — tolerate both.
        if isinstance(entry, dict):
            return entry.get("median") if prefer_median else entry.get("max")
        return entry

    for key, unit, prefer_median in (("wall_seconds", "s", True), ("peak_mem_mb", "MB", False)):
        b = _scalar(base.get(key), prefer_median)
        c = _scalar(current.get(key), prefer_median)
        if b is None or c is None:
            continue
        delta = c - b
        pct = (delta / b * 100.0) if b else 0.0
        arrow = "faster/less" if delta < 0 else "slower/more"
        print(f"  {key:14s}  {b:.3f} -> {c:.3f} {unit}   ({delta:+.3f} {unit}, {pct:+.1f}%  {arrow})")


if __name__ == "__main__":
    main()
