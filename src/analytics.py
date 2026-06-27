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
import json
import statistics
from dataclasses import asdict
from pathlib import Path
from typing import TYPE_CHECKING

from src.datasource import StudentRecord
from src.models.semester import mandatory_horizon_end_term
from src.rules import gate_edges

if TYPE_CHECKING:
    from src.simulator import SimulationResult
    from src.models.course import Course


# ------------------------------------------------------------------ #
# Helpers                                                             #
# ------------------------------------------------------------------ #

def _study_students(result: "SimulationResult") -> list:
    """Students from real (non-incumbent) cohorts — the ones we report on."""
    return [s for s in result.students if s.entry_term >= 0]


def _incumbent_students(result: "SimulationResult") -> list:
    """Warm-start students admitted before the study window — see compute_historical_transcripts."""
    return [s for s in result.students if s.entry_term < 0]


def _top3(counter: dict) -> list[tuple[str, int]]:
    return sorted(counter.items(), key=lambda x: -x[1])[:3]


def _top1_code(counter: dict) -> str:
    top = _top3(counter)
    return top[0][0] if top else ""


def _histogram(values: list[int]) -> list[tuple[int, int]]:
    counts: dict[int, int] = {}
    for v in values:
        counts[v] = counts.get(v, 0) + 1
    return sorted(counts.items())


# ------------------------------------------------------------------ #
# Headline metrics (scoped to study cohorts)                          #
# ------------------------------------------------------------------ #

def compute_metrics(result: "SimulationResult") -> dict:
    history = result.history
    students = _study_students(result)
    total = len(students) or 1

    graduated = [s for s in students if s.status == "GRADUATED"]
    dropped   = [s for s in students if s.status == "DROPPED"]
    censored  = [s for s in students if s.status == "CENSORED"]

    times = [s.grad_semester for s in graduated if s.grad_semester is not None]
    avg_time = sum(times) / len(times) if times else 0.0
    on_time_count = sum(1 for t in times if t <= 8)

    prob_count = sum(1 for s in students if s.ever_probation)
    gpas = [s.gpa for s in graduated]
    mean_gpa = sum(gpas) / len(gpas) if gpas else 0.0

    return {
        "graduation_rate":        len(graduated) / total,
        "academic_dropout_rate":  len(dropped) / total,
        "censored_rate":          len(censored) / total,
        "avg_graduation_time":    avg_time,
        "graduation_time_distribution": _histogram(times),
        "on_time_rate":           on_time_count / total,
        "probation_rate":         prob_count / total,
        "mean_gpa_at_graduation": mean_gpa,
        "top_fail_courses":       _top3(history.fail_counts),
        "top_capacity_blocks":    _top3(history.capacity_block_counts),
        "top_offering_blocks":    _top3(history.offering_block_counts),
        "top_prereq_blocks":      _top3(history.prereq_block_counts),
    }


# ------------------------------------------------------------------ #
# Per-cohort metrics + "where did they get stuck"                     #
# ------------------------------------------------------------------ #

def compute_cohort_metrics(result: "SimulationResult") -> dict[int, dict]:
    history = result.history
    by_cohort: dict[int, list] = {}
    for s in result.students:
        by_cohort.setdefault(s.cohort_id, []).append(s)

    out: dict[int, dict] = {}
    for cid in sorted(by_cohort):
        members = by_cohort[cid]
        n = len(members) or 1
        graduated = [s for s in members if s.status == "GRADUATED"]
        dropped   = [s for s in members if s.status == "DROPPED"]
        censored  = [s for s in members if s.status == "CENSORED"]
        times = [s.grad_semester for s in graduated if s.grad_semester is not None]

        out[cid] = {
            "cohort_id": cid,
            "is_incumbent": cid < 0,
            "n": len(members),
            "graduation_rate":       len(graduated) / n,
            "academic_dropout_rate": len(dropped) / n,
            "censored_rate":         len(censored) / n,
            "on_time_rate":          sum(1 for t in times if t <= 8) / n,
            "avg_time_to_degree":    (sum(times) / len(times)) if times else 0.0,
            "probation_rate":        sum(1 for s in members if s.ever_probation) / n,
            "top_fail":           _top1_code(history.fail_by_cohort.get(cid, {})),
            "top_capacity_block": _top1_code(history.capacity_block_by_cohort.get(cid, {})),
            "top_offering_block": _top1_code(history.offering_block_by_cohort.get(cid, {})),
            "top_prereq_block":   _top1_code(history.prereq_block_by_cohort.get(cid, {})),
        }
    return out


# ------------------------------------------------------------------ #
# Historical transcripts (ACIP plan §2.4 replay/fit input)            #
# ------------------------------------------------------------------ #

def compute_historical_transcripts(result: "SimulationResult", incumbents_only: bool = True) -> dict:
    """Canonical-schema historical records extracted from a completed run.

    Incumbent cohorts are warm-started before the study window and reach a terminal status
    well before it ends, so by default this returns only their records — they stand in for
    "the institution's existing history" the way a real SIS export would supply it, fully
    decoupled from the study cohorts' own forward-looking outcomes. Pass incumbents_only=False
    to also include the (by now equally complete) study-cohort histories.

    Returns {"students": [...], "enrollments": [...], "outcomes": [...]}, each a list of
    plain dicts (StudentRecord / EnrollmentRecord / OutcomeRecord) ready to serialize.
    """
    students = _incumbent_students(result) if incumbents_only else result.students
    keep_ids = {s.student_id for s in students}
    program_id = result.config.get("program_id", "CS")

    return {
        "students": [
            asdict(StudentRecord(
                student_id=s.student_id,
                program_id=program_id,
                admission_term=s.entry_term,
                status=s.status,
            ))
            for s in students
        ],
        "enrollments": [
            asdict(r) for r in result.history.transcript if r.student_id in keep_ids
        ],
        "outcomes": [
            asdict(r) for r in result.history.outcomes if r.student_id in keep_ids
        ],
    }


# ------------------------------------------------------------------ #
# Admissions recommendation (single-run heuristic)                    #
# ------------------------------------------------------------------ #

def compute_admissions_recommendation(result: "SimulationResult") -> dict:
    config = result.config
    targets = config.get("admission_targets", {})
    cohort_metrics = compute_cohort_metrics(result)

    # Representative steady-state cohort = latest study cohort that has finished
    # its horizon; fall back to the mean across study cohorts.
    study = {cid: m for cid, m in cohort_metrics.items() if not m["is_incumbent"]}
    if not study:
        return {}

    rep = _representative_cohort(result, study)

    # Throughput stability: graduates-per-term coefficient (1 - cv), clipped to [0,1].
    stability = _throughput_stability(result)

    g = rep["graduation_rate"]
    T = rep["avg_time_to_degree"] or config["max_terms"]
    # capacity blocks per study student
    total_denied = sum(
        sum(c.values()) for cid, c in result.history.capacity_block_by_cohort.items() if cid >= 0
    )
    n_study = len(_study_students(result)) or 1
    d = total_denied / n_study

    tgt_g = targets.get("target_grad_rate", 0.70)
    tgt_T = targets.get("max_avg_time_to_degree", 10.0)
    tgt_d = targets.get("max_seats_denied_per_student", 1.0)
    tgt_s = targets.get("min_throughput_stability", 0.85)

    criteria = [
        {"name": "graduation_rate",      "observed": round(g, 4),  "target": tgt_g,
         "slack": (g / tgt_g) if tgt_g else float("inf")},
        {"name": "time_to_degree",       "observed": round(T, 4),  "target": tgt_T,
         "slack": (tgt_T / T) if T else float("inf")},
        {"name": "seats_denied_per_stud","observed": round(d, 4),  "target": tgt_d,
         "slack": (tgt_d / d) if d else float("inf")},
        {"name": "throughput_stability", "observed": round(stability, 4), "target": tgt_s,
         "slack": (stability / tgt_s) if tgt_s else float("inf")},
    ]

    binding = min(criteria, key=lambda c: c["slack"])
    f = binding["slack"]
    f_capped = min(f, 1.25)  # don't extrapolate growth beyond observed range
    current = config["cohort_size"]
    recommended = max(1, round(current * f_capped))

    return {
        "current_intake": current,
        "recommended_intake": recommended,
        "binding_criterion": binding["name"],
        "binding_slack": round(f, 4),
        "growth_capped_at": 1.25,
        "representative_cohort": rep["cohort_id"],
        "criteria": criteria,
        "note": "Single-run heuristic: intake scaled by the worst-performing health "
                "criterion (slack<1 = breach -> shrink; slack>1 = headroom -> grow, capped 1.25x). "
                "Not an optimum; an intake sweep would be the rigorous follow-up.",
    }


def _representative_cohort(result: "SimulationResult", study: dict[int, dict]) -> dict:
    """Latest fully-observed study cohort, else the mean across study cohorts."""
    max_terms = result.config["max_terms"]
    end_term = result.history.timeline[-1]["term"] if result.history.timeline else 0
    entry_by_cohort = {s.cohort_id: s.entry_term for s in result.students}

    # "Finished" means this cohort's max_terms-th *mandatory* semester has already occurred
    # within the simulated window — a raw calendar-term subtraction would overcount once
    # optional (non-mandatory) seasons exist in the cycle. See CLAUDE.md's "Term/Season Model".
    finished = [
        cid for cid in study
        if mandatory_horizon_end_term(entry_by_cohort.get(cid, 0), max_terms, result.config) - 1 <= end_term
    ]
    if finished:
        cid = max(finished)
        return study[cid]

    # Mean across study cohorts.
    keys = ["graduation_rate", "academic_dropout_rate", "censored_rate",
            "on_time_rate", "avg_time_to_degree", "probation_rate"]
    mean = {k: statistics.fmean(study[c][k] for c in study) for k in keys}
    mean["cohort_id"] = "mean"
    mean["is_incumbent"] = False
    return mean


def _throughput_stability(result: "SimulationResult") -> float:
    """1 - coefficient of variation of graduates-per-term (study cohorts), clipped to [0,1]."""
    # Read the real calendar term of graduation from OutcomeRecord (already the true term_idx
    # _record_outcome saw) rather than reconstructing it from entry_term + grad_semester — that
    # reconstruction drifts once grad_semester only counts mandatory terms.
    grad_term_by_student = {
        r.student_id: r.graduation_term
        for r in result.history.outcomes if r.exit_reason == "graduated"
    }
    per_term: dict[int, int] = {}
    for s in result.students:
        if s.status == "GRADUATED" and s.entry_term >= 0 and s.student_id in grad_term_by_student:
            grad_term = grad_term_by_student[s.student_id]
            per_term[grad_term] = per_term.get(grad_term, 0) + 1
    counts = list(per_term.values())
    if len(counts) < 2:
        return 1.0
    mean = statistics.fmean(counts)
    if mean == 0:
        return 0.0
    cv = statistics.pstdev(counts) / mean
    return max(0.0, min(1.0, 1.0 - cv))


# ------------------------------------------------------------------ #
# Course demand / utilization                                         #
# ------------------------------------------------------------------ #

def build_course_utilization(result: "SimulationResult") -> list[dict]:
    """One row per (course, term) where the course was offered."""
    rows: list[dict] = []
    for frame in result.history.timeline:
        for code, st in frame["courses"].items():
            if not st["offered"]:
                continue
            cap = st["capacity"] or 1
            util = st["granted"] / cap
            rows.append({
                "course": code,
                "term": frame["term"],
                "label": frame["label"],
                "capacity": st["capacity"],
                "registered": st["registered"],
                "granted": st["granted"],
                "denied": st["denied"],
                "utilization": round(util, 4),
                "status": "oversubscribed" if st["denied"] > 0
                          else ("full" if st["full"] else "open"),
            })
    return rows


# ------------------------------------------------------------------ #
# Curriculum graph (static structure for the flow chart)              #
# ------------------------------------------------------------------ #

def build_curriculum_graph(curriculum: dict[str, "Course"]) -> dict:
    nodes = []
    edges = []
    for code, c in curriculum.items():
        nodes.append({
            "code": code,
            "title": c.title,
            "credits": c.credits,
            "category": c.category,
            "offering": list(c.offering),
            "capacity": c.capacity,
            "study_plan_order": c.study_plan_order,
            "study_plan_term": c.study_plan_term,
        })
        for pre in c.prerequisites:
            if pre in curriculum:
                edges.append({"from": pre, "to": code, "kind": "prereq"})
        if c.rule_expr is not None:
            for src, kind in gate_edges(c.rule_expr):
                if src in curriculum:
                    edges.append({"from": src, "to": code,
                                  "kind": "required" if kind == "all" else "one_of"})
    return {"nodes": nodes, "edges": edges}


# ------------------------------------------------------------------ #
# Output writers                                                      #
# ------------------------------------------------------------------ #

def build_summary_csv(results: dict[str, "SimulationResult"], output_path: Path) -> None:
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
            "top_capacity_block_1":  m["top_capacity_blocks"][0][0] if m["top_capacity_blocks"] else "",
            "top_offering_block_1":  m["top_offering_blocks"][0][0] if m["top_offering_blocks"] else "",
            "top_prereq_block_1":    m["top_prereq_blocks"][0][0] if m["top_prereq_blocks"] else "",
        })
    _write_csv(output_path, rows)


def build_cohort_flow_csv(result: "SimulationResult", output_path: Path) -> None:
    _write_csv(output_path, result.history.cohort_snapshots)


def build_cohort_summary_csv(result: "SimulationResult", output_path: Path) -> None:
    metrics = compute_cohort_metrics(result)
    rows = []
    for cid in sorted(metrics):
        m = metrics[cid]
        rows.append({
            "cohort_id": m["cohort_id"],
            "is_incumbent": m["is_incumbent"],
            "n": m["n"],
            "graduation_rate":       f"{m['graduation_rate']:.3f}",
            "academic_dropout_rate": f"{m['academic_dropout_rate']:.3f}",
            "censored_rate":         f"{m['censored_rate']:.3f}",
            "on_time_rate":          f"{m['on_time_rate']:.3f}",
            "avg_time_to_degree":    f"{m['avg_time_to_degree']:.2f}",
            "probation_rate":        f"{m['probation_rate']:.3f}",
            "top_fail":           m["top_fail"],
            "top_capacity_block": m["top_capacity_block"],
            "top_offering_block": m["top_offering_block"],
            "top_prereq_block":   m["top_prereq_block"],
        })
    _write_csv(output_path, rows)


def build_course_utilization_csv(result: "SimulationResult", output_path: Path) -> None:
    _write_csv(output_path, build_course_utilization(result))


def build_monte_carlo_csv(mc: dict, output_path: Path) -> None:
    rows = [
        {"metric": k, "mean": f"{v['mean']:.4f}",
         "ci_low": f"{v['ci_low']:.4f}", "ci_high": f"{v['ci_high']:.4f}",
         "stdev": f"{v['stdev']:.4f}", "n_runs": v["n_runs"]}
        for k, v in mc.items()
    ]
    _write_csv(output_path, rows)


def flow_timeline_payload(
    result: "SimulationResult",
    curriculum: dict[str, "Course"],
    monte_carlo: dict | None = None,
    instructors: list[dict] | None = None,
) -> dict:
    """The full frontend contract object (meta + frames + summary).

    `instructors` (src/db_models.py::Instructor rows, as plain dicts) feeds the
    `capacity_planning` summary key — src.capacity is imported locally here, not at module
    level, because src.capacity itself imports build_course_utilization/
    compute_admissions_recommendation from this module; a top-level import would be circular.
    """
    from src.capacity import build_capacity_report
    history = result.history
    cohorts_meta = [
        {"id": cid, "is_incumbent": cid < 0, "entry_term": et}
        for cid, et in sorted(
            {s.cohort_id: s.entry_term for s in result.students}.items()
        )
    ]
    headline = compute_metrics(result)
    if monte_carlo:
        headline["confidence_intervals"] = monte_carlo

    return {
        "meta": {
            "scenario": result.scenario.get("name"),
            "stage_nodes": ["Admitted", "Year1", "Year2", "Year3", "Year4",
                            "Graduated", "Dropped", "Censored"],
            "cohorts": cohorts_meta,
            "graph": build_curriculum_graph(curriculum),
            "seed": result.config.get("seed"),
            "cohort_size": result.config.get("cohort_size"),
            "max_terms": result.config.get("max_terms"),
            "num_cohorts": result.config.get("num_cohorts"),
            "num_incumbent_cohorts": result.config.get("num_incumbent_cohorts", 0),
            "initial_state": result.config.get("initial_state", {"occupancy": {}, "standing": {}}),
            "seats_per_section": result.config.get("seats_per_section", 35),
        },
        "frames": history.timeline,
        "summary": {
            "headline": headline,
            "per_cohort": list(compute_cohort_metrics(result).values()),
            "admissions_recommendation": compute_admissions_recommendation(result),
            "top_bottlenecks": {
                "fail":     _top3(history.fail_counts),
                "capacity": _top3(history.capacity_block_counts),
                "offering": _top3(history.offering_block_counts),
                "prereq":   _top3(history.prereq_block_counts),
            },
            "capacity_planning": build_capacity_report(result, instructors or [], curriculum),
        },
    }


def build_flow_timeline_json(
    result: "SimulationResult",
    curriculum: dict[str, "Course"],
    output_path: Path,
    monte_carlo: dict | None = None,
    instructors: list[dict] | None = None,
) -> dict:
    payload = flow_timeline_payload(result, curriculum, monte_carlo, instructors=instructors)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2)
    return payload


def _write_csv(output_path: Path, rows: list[dict]) -> None:
    if not rows:
        return
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)
