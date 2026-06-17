"""Entry point: load → run scenario(s) → analyze → render → CSV + frontend JSON."""
from __future__ import annotations

import shutil
from pathlib import Path

from src.analytics import (
    build_cohort_flow_csv,
    build_cohort_summary_csv,
    build_course_utilization_csv,
    build_flow_timeline_js,
    build_flow_timeline_json,
    build_monte_carlo_csv,
    build_summary_csv,
    compute_admissions_recommendation,
    compute_metrics,
    flow_timeline_payload,
)
from src.models.course import load_curriculum
from src.montecarlo import run_monte_carlo
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
    print(f"University: {config.get('num_cohorts', 1)} study cohorts "
          f"+ {config.get('num_incumbent_cohorts', 0)} incumbent cohorts "
          f"of {config['cohort_size']} students, shared seat pool")

    results = {}
    for scenario in config["scenarios"]:
        name = scenario["name"]
        print(f"\nRunning {name}...")
        result = Simulator(curriculum, config, scenario).run()
        result.metrics = compute_metrics(result)
        results[name] = result

        m = result.metrics
        print(f"  Graduation rate       : {m['graduation_rate']:.1%}  (study cohorts)")
        print(f"  Academic dropout rate : {m['academic_dropout_rate']:.1%}")
        print(f"  Censored rate         : {m['censored_rate']:.1%}  (hit horizon)")
        print(f"  Avg grad time         : {m['avg_graduation_time']:.1f} semesters")
        print(f"  On-time rate          : {m['on_time_rate']:.1%}  (<=8 sem)")
        print(f"  Probation rate        : {m['probation_rate']:.1%}")
        print(f"  Top failure           : {m['top_fail_courses'][:1]}")
        print(f"  Top cap-block         : {m['top_capacity_blocks'][:1]}")

    baseline_name = "A_baseline" if "A_baseline" in results else next(iter(results))
    baseline = results[baseline_name]

    # Monte Carlo confidence intervals on the baseline.
    monte_carlo = None
    if config.get("monte_carlo", {}).get("enabled"):
        n = config["monte_carlo"].get("n_runs", 30)
        print(f"\nRunning Monte Carlo ({n} seeds) for {baseline_name}...")
        monte_carlo = run_monte_carlo(curriculum, config, results[baseline_name].scenario)
        g = monte_carlo["graduation_rate"]
        print(f"  Graduation rate: {g['mean']:.1%}  "
              f"(95% CI {g['ci_low']:.1%}–{g['ci_high']:.1%})")

    # Reports.
    reports_dir = Path("outputs/reports")
    reports_dir.mkdir(parents=True, exist_ok=True)
    print("\nWriting reports...")
    build_summary_csv(results, reports_dir / "simulation_summary.csv")
    build_cohort_flow_csv(baseline, reports_dir / "cohort_flow.csv")
    build_cohort_summary_csv(baseline, reports_dir / "cohort_summary.csv")
    build_course_utilization_csv(baseline, reports_dir / "course_utilization.csv")
    if monte_carlo:
        build_monte_carlo_csv(monte_carlo, reports_dir / "monte_carlo.csv")

    # Frontend data: write the JSON, plus an inlined data.js so the page runs from file://
    # (just double-click frontend/index.html — no local server needed).
    payload = flow_timeline_payload(baseline, curriculum, monte_carlo=monte_carlo)
    build_flow_timeline_json(baseline, curriculum, reports_dir / "flow_timeline.json", monte_carlo)
    frontend_dir = Path("frontend")
    build_flow_timeline_json(baseline, curriculum, frontend_dir / "flow_timeline.json", monte_carlo)
    build_flow_timeline_js(payload, frontend_dir / "data.js")
    print("  Saved simulation_summary.csv, cohort_flow.csv, cohort_summary.csv,")
    print("        course_utilization.csv, monte_carlo.csv, flow_timeline.json + frontend/data.js")

    # Admissions recommendation headline.
    rec = compute_admissions_recommendation(baseline)
    if rec:
        print("\nAdmissions recommendation (single-run heuristic):")
        print(f"  Current intake     : {rec['current_intake']}")
        print(f"  Recommended intake : {rec['recommended_intake']} / year")
        print(f"  Binding criterion  : {rec['binding_criterion']} "
              f"(slack {rec['binding_slack']:.2f})")

    # Figures — generate, then copy into the frontend so the page can display them.
    print("\nGenerating figures...")
    figures_dir = Path("outputs/figures")
    save_all_figures(results, curriculum, config, figures_dir)

    frontend_figs = frontend_dir / "figures"
    frontend_figs.mkdir(parents=True, exist_ok=True)
    for png in figures_dir.glob("*.png"):
        shutil.copy2(png, frontend_figs / png.name)
    print(f"  Copied figures into {frontend_figs}/")

    print("\nDone. Open frontend/index.html directly in a browser (no server needed).")


if __name__ == "__main__":
    main()
