"""Entry point: load → seed → run each scenario → analyze → render → CSV."""
from __future__ import annotations

from pathlib import Path

from src.analytics import build_summary_csv, compute_metrics
from src.models.course import load_curriculum
from src.simulator import Simulator
from src.visualize import save_all_figures
from src.utils import load_json


def main() -> None:
    curriculum_path = Path("data/curriculum.json")
    config_path     = Path("data/simulation_config.json")

    config     = load_json(config_path)
    curriculum = load_curriculum(curriculum_path)

    total_ch = sum(c.credits for c in curriculum.values())
    print(f"Loaded {len(curriculum)} courses, {total_ch} total CH")

    results = {}
    for scenario in config["scenarios"]:
        name = scenario["name"]
        print(f"\nRunning {name}...")
        sim    = Simulator(curriculum, config, scenario)
        result = sim.run()
        result.metrics = compute_metrics(result)
        results[name] = result

        m = result.metrics
        print(f"  Graduation rate       : {m['graduation_rate']:.1%}")
        print(f"  Academic dropout rate : {m['academic_dropout_rate']:.1%}  (3-fails rule)")
        print(f"  Censored rate         : {m['censored_rate']:.1%}  (hit 12-sem horizon)")
        print(f"  Avg grad time         : {m['avg_graduation_time']:.1f} semesters")
        print(f"  On-time rate          : {m['on_time_rate']:.1%}  (<=8 sem)")
        print(f"  Probation rate        : {m['probation_rate']:.1%}  (ever on probation)")
        print(f"  Top failure           : {m['top_fail_courses'][:1]}")
        print(f"  Top cap-block         : {m['top_capacity_blocks'][:1]}")
        print(f"  Top off-block (accrued): {m['top_offering_blocks'][:1]}")

    print("\nGenerating figures...")
    figures_dir = Path("outputs/figures")
    save_all_figures(results, curriculum, config, figures_dir)

    print("\nWriting CSV report...")
    reports_dir = Path("outputs/reports")
    reports_dir.mkdir(parents=True, exist_ok=True)
    build_summary_csv(results, reports_dir / "simulation_summary.csv")
    print(f"  Saved outputs/reports/simulation_summary.csv")

    print("\nDone. All outputs written to outputs/")


if __name__ == "__main__":
    main()
