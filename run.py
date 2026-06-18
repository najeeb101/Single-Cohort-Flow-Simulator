"""Entry point: load → run scenario(s) → analyze → render → CSV + outputs/.

The frontend (frontend/) is server-only: it fetches its data and figures straight from
outputs/ over HTTP (see frontend/app.js), so nothing here writes into frontend/ at all.
Serve from the repo root (py -m http.server) and open http://localhost:<port>/frontend/.
"""
from __future__ import annotations

from pathlib import Path

from src.analytics import (
    build_cohort_flow_csv,
    build_cohort_summary_csv,
    build_course_utilization_csv,
    build_flow_timeline_json,
    build_monte_carlo_csv,
    build_summary_csv,
)
from src.models.course import load_curriculum
from src.montecarlo import run_monte_carlo
from src.service import run_simulation
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
    runs: dict[str, dict] = {}
    for scenario in config["scenarios"]:
        name = scenario["name"]
        print(f"\nRunning {name}...")
        run = run_simulation(curriculum, config, scenario)
        runs[name] = run
        results[name] = run["result"]

        m = run["metrics"]
        print(f"  Graduation rate       : {m['graduation_rate']:.1%}  (study cohorts)")
        print(f"  Academic dropout rate : {m['academic_dropout_rate']:.1%}")
        print(f"  Censored rate         : {m['censored_rate']:.1%}  (hit horizon)")
        print(f"  Avg grad time         : {m['avg_graduation_time']:.1f} semesters")
        print(f"  On-time rate          : {m['on_time_rate']:.1%}  (<=8 sem)")
        print(f"  Probation rate        : {m['probation_rate']:.1%}")
        print(f"  Top failure           : {m['top_fail_courses'][:1]}")
        print(f"  Top cap-block         : {m['top_capacity_blocks'][:1]}")

    # The frontend animates exactly one scenario. Prefer the calibrated scenario (measured
    # pass rates) over the assumed baseline when both exist — the whole point of fitting
    # pass rates from history is to show real numbers, not guesses, on the live dashboard.
    for preferred in ("B_calibrated", "A_baseline"):
        if preferred in results:
            baseline_name = preferred
            break
    else:
        baseline_name = next(iter(results))
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

    # Frontend data: the frontend fetches this file directly from outputs/reports/ over HTTP.
    build_flow_timeline_json(baseline, curriculum, reports_dir / "flow_timeline.json", monte_carlo)
    print("  Saved simulation_summary.csv, cohort_flow.csv, cohort_summary.csv,")
    print("        course_utilization.csv, monte_carlo.csv, flow_timeline.json")

    # Admissions recommendation headline.
    rec = runs[baseline_name]["admissions_recommendation"]
    if rec:
        print("\nAdmissions recommendation (single-run heuristic):")
        print(f"  Current intake     : {rec['current_intake']}")
        print(f"  Recommended intake : {rec['recommended_intake']} / year")
        print(f"  Binding criterion  : {rec['binding_criterion']} "
              f"(slack {rec['binding_slack']:.2f})")

    # Figures — the frontend loads these straight from outputs/figures/ over HTTP.
    print("\nGenerating figures...")
    figures_dir = Path("outputs/figures")
    save_all_figures(results, curriculum, config, figures_dir)

    print("\nDone. Serve from the repo root (py -m http.server) and open "
          "http://localhost:<port>/frontend/.")


if __name__ == "__main__":
    main()
