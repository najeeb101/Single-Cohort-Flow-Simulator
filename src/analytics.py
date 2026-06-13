"""Pure functions that derive metrics from SimulationResult objects.
No plotting here — visualize.py handles that.

Block-signal units (important for interpretation):
  fail_counts          — per-attempt failure events
  capacity_block_counts — per-student-per-term seat-denied events
  offering_block_counts — per-student-per-term waiting events (accumulates each term a
                          course is eligible but not offered; a Spring-only course accrues
                          one entry per active student per Fall term they're waiting)
  prereq_block_counts  — per-student-per-term prereq-unmet events

Do NOT rank these four signals against each other directly — they measure different things.
Compare within each type across courses.
"""
from __future__ import annotations

import csv
from pathlib import Path
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from src.simulator import SimulationResult


def compute_metrics(result: SimulationResult) -> dict:
    students = result.students
    history  = result.history
    config   = result.config
    total: int = config["cohort_size"]

    graduated = [s for s in students if s.status == "GRADUATED"]
    dropped   = [s for s in students if s.status == "DROPPED"]    # academic (3-fails rule)
    censored  = [s for s in students if s.status == "CENSORED"]   # hit max_terms horizon

    grad_count     = len(graduated)
    dropout_count  = len(dropped)
    censored_count = len(censored)

    times        = history.graduation_times
    avg_time     = sum(times) / len(times) if times else 0.0
    on_time_count = sum(1 for t in times if t <= 8)
    on_time_rate  = on_time_count / total

    prob_count = sum(1 for s in students if s.ever_probation)

    gpas     = [s.gpa for s in graduated]
    mean_gpa = sum(gpas) / len(gpas) if gpas else 0.0

    def top3(counter: dict) -> list[tuple[str, int]]:
        return sorted(counter.items(), key=lambda x: -x[1])[:3]

    return {
        "graduation_rate":        grad_count / total,
        "academic_dropout_rate":  dropout_count / total,   # 3-fails rule only
        "censored_rate":          censored_count / total,  # hit 12-semester horizon
        "avg_graduation_time":    avg_time,
        "on_time_rate":           on_time_rate,
        "probation_rate":         prob_count / total,
        "mean_gpa_at_graduation": mean_gpa,
        "top_fail_courses":       top3(history.fail_counts),
        "top_capacity_blocks":    top3(history.capacity_block_counts),
        "top_offering_blocks":    top3(history.offering_block_counts),
        "top_prereq_blocks":      top3(history.prereq_block_counts),
    }


def build_summary_csv(
    results: dict[str, SimulationResult],
    output_path: Path,
) -> None:
    rows = []
    for name, result in results.items():
        m = result.metrics
        rows.append({
            "scenario":              name,
            "graduation_rate":       f"{m['graduation_rate']:.3f}",
            "academic_dropout_rate": f"{m['academic_dropout_rate']:.3f}",
            "censored_rate":         f"{m['censored_rate']:.3f}",
            "avg_graduation_time":   f"{m['avg_graduation_time']:.2f}",
            "on_time_rate":          f"{m['on_time_rate']:.3f}",
            "probation_rate":        f"{m['probation_rate']:.3f}",
            "mean_gpa_at_grad":      f"{m['mean_gpa_at_graduation']:.3f}",
            "top_fail_1":            m["top_fail_courses"][0][0] if m["top_fail_courses"] else "",
            "top_fail_2":            m["top_fail_courses"][1][0] if len(m["top_fail_courses"]) > 1 else "",
            "top_capacity_block_1":  m["top_capacity_blocks"][0][0] if m["top_capacity_blocks"] else "",
            "top_offering_block_1":  m["top_offering_blocks"][0][0] if m["top_offering_blocks"] else "",
            "top_prereq_block_1":    m["top_prereq_blocks"][0][0] if m["top_prereq_blocks"] else "",
        })

    if not rows:
        return

    output_path.parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)
