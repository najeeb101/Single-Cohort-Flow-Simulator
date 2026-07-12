"""Profiling harness (optimization plan item 1): run a representative scenario under
`cProfile` and print the hottest functions, so we verify hotspots *before* changing engine
code. Stdlib-only — no pyinstrument/pyprof2calltree required — so `py scripts/profile_run.py`
works out of the box on Windows.

Examples:
    # Profile one baseline run (800 students), top 25 by cumulative time
    py scripts/profile_run.py

    # Profile the Monte Carlo path (the workload item 2 parallelizes)
    py scripts/profile_run.py --montecarlo 10 --sort tottime

    # Save the raw pstats blob somewhere and inspect it later in snakeviz/pyprof2calltree
    py scripts/profile_run.py --out outputs/profiling/baseline.out

The raw `.out` is a `pstats` binary: `pyprof2calltree -k -i <file>` (if installed) opens a
callgrind view, and `snakeviz <file>` gives a flamegraph — neither is a project dependency.
"""
from __future__ import annotations

import argparse
import cProfile
import copy
import pstats
import sys
from pathlib import Path

# Allow `py scripts/profile_run.py` from anywhere: make the repo root importable.
_REPO_ROOT = Path(__file__).resolve().parent.parent
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from src.models.course import load_curriculum  # noqa: E402
from src.montecarlo import run_monte_carlo  # noqa: E402
from src.service import run_simulation  # noqa: E402
from src.utils import load_json  # noqa: E402

_DATA = _REPO_ROOT / "data"


def _resolve_scenario(config: dict, name: str | None) -> dict:
    scenarios = config["scenarios"]
    if name is None:
        return scenarios[0]
    for s in scenarios:
        if s["name"] == name:
            return s
    available = ", ".join(s["name"] for s in scenarios)
    raise SystemExit(f"No scenario named {name!r}. Available: {available}")


def _build_workload(curriculum, config, scenario, mc_runs: int):
    """Return a zero-arg callable that runs the workload we want to profile."""
    if mc_runs > 0:
        mc_config = copy.deepcopy(config)
        mc_config.setdefault("monte_carlo", {})["n_runs"] = mc_runs

        def workload() -> None:
            run_monte_carlo(curriculum, mc_config, scenario)

        return workload

    def workload() -> None:
        run_simulation(curriculum, config, scenario)

    return workload


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--scenario", default=None, help="scenario name (default: first in config)")
    parser.add_argument("--montecarlo", type=int, default=0, metavar="N",
                        help="profile run_monte_carlo with N seeds instead of a single run (default: 0 = single run)")
    parser.add_argument("--sort", default="cumulative", choices=["cumulative", "tottime", "ncalls", "percall"],
                        help="primary pstats sort key (default: cumulative)")
    parser.add_argument("--top", type=int, default=25, help="rows to print (default: 25)")
    parser.add_argument("--out", default=None, help="path for the raw pstats blob (default: outputs/profiling/...)")
    parser.add_argument("--pyinstrument", action="store_true",
                        help="also produce a pyinstrument HTML flamegraph if pyinstrument is installed")
    args = parser.parse_args()

    config = load_json(_DATA / "simulation_config.json")
    curriculum = load_curriculum(_DATA / "curriculum.json")
    scenario = _resolve_scenario(config, args.scenario)

    n_students = config.get("num_cohorts", 1) * config["cohort_size"]
    label = f"{scenario['name']}"
    if args.montecarlo > 0:
        label += f" (Monte Carlo x{args.montecarlo})"
    print(f"Profiling: {label}")
    print(f"  {config.get('num_cohorts', 1)} cohorts x {config['cohort_size']} = {n_students} study students")

    workload = _build_workload(curriculum, config, scenario, args.montecarlo)

    out_path = Path(args.out) if args.out else (
        _REPO_ROOT / "outputs" / "profiling" /
        (f"profile_{scenario['name']}" + (f"_mc{args.montecarlo}" if args.montecarlo else "") + ".out")
    )
    out_path.parent.mkdir(parents=True, exist_ok=True)

    profiler = cProfile.Profile()
    profiler.enable()
    workload()
    profiler.disable()
    profiler.dump_stats(str(out_path))

    stats = pstats.Stats(profiler)
    print(f"\nTop {args.top} functions by {args.sort} (whole program):")
    stats.sort_stats(args.sort).print_stats(args.top)

    # A src/-only view keeps the engine's own hot spots from being buried under stdlib frames.
    print(f"\nTop {args.top} functions in src/ by {args.sort} (the code we can actually change):")
    stats.sort_stats(args.sort).print_stats("src[\\\\/]", args.top)

    print(f"Raw pstats saved to {out_path}")
    print("  Inspect further:  pyprof2calltree -k -i "
          f"{out_path}   (or)  snakeviz {out_path}   (neither is a project dependency)")

    if args.pyinstrument:
        _run_pyinstrument(workload, scenario["name"], args.montecarlo)


def _run_pyinstrument(workload, scenario_name: str, mc_runs: int) -> None:
    try:
        from pyinstrument import Profiler  # type: ignore
    except ImportError:
        print("\n[--pyinstrument] pyinstrument is not installed; skipping the HTML flamegraph.")
        print("  Install it with:  py -m pip install pyinstrument")
        return
    prof = Profiler()
    prof.start()
    workload()
    prof.stop()
    html_path = (_REPO_ROOT / "outputs" / "profiling" /
                 (f"profile_{scenario_name}" + (f"_mc{mc_runs}" if mc_runs else "") + ".html"))
    html_path.write_text(prof.output_html(), encoding="utf-8")
    print(f"\npyinstrument flamegraph saved to {html_path}")


if __name__ == "__main__":
    main()
