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
from dataclasses import asdict
from pathlib import Path
from typing import TYPE_CHECKING

from src.engine.datasource import StudentRecord
from src.domain.semester import get_mandatory_seasons
from src.domain.student import stage_node_names
from src.domain.rules import gate_edges

if TYPE_CHECKING:
    from src.engine.simulator import SimulationResult
    from src.domain.course import Course


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
    on_time_terms = result.config.get("on_time_terms", 8)

    graduated = [s for s in students if s.status == "GRADUATED"]
    dropped   = [s for s in students if s.status == "DROPPED"]
    censored  = [s for s in students if s.status == "CENSORED"]

    times = [s.grad_semester for s in graduated if s.grad_semester is not None]
    avg_time = sum(times) / len(times) if times else 0.0
    on_time_count = sum(1 for t in times if t <= on_time_terms)

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
        "top_capacity_blocks":    _top3(history.capacity_block_counts_mandatory),
        "top_offering_blocks":    _top3(history.offering_block_counts_mandatory),
        "top_prereq_blocks":      _top3(history.prereq_block_counts_mandatory),
    }


# ------------------------------------------------------------------ #
# Per-cohort metrics + "where did they get stuck"                     #
# ------------------------------------------------------------------ #

def compute_cohort_metrics(result: "SimulationResult") -> dict[int, dict]:
    history = result.history
    on_time_terms = result.config.get("on_time_terms", 8)
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
            "on_time_rate":          sum(1 for t in times if t <= on_time_terms) / n,
            "avg_time_to_degree":    (sum(times) / len(times)) if times else 0.0,
            "probation_rate":        sum(1 for s in members if s.ever_probation) / n,
            "top_fail":           _top1_code(history.fail_by_cohort.get(cid, {})),
            "top_capacity_block": _top1_code(history.capacity_block_mandatory_by_cohort.get(cid, {})),
            "top_offering_block": _top1_code(history.offering_block_mandatory_by_cohort.get(cid, {})),
            "top_prereq_block":   _top1_code(history.prereq_block_mandatory_by_cohort.get(cid, {})),
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
) -> dict:
    """The full frontend contract object (meta + frames + summary)."""
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
            "stage_nodes": stage_node_names(result.config),
            "cohorts": cohorts_meta,
            "graph": build_curriculum_graph(curriculum),
            "seed": result.config.get("seed"),
            "cohort_size": result.config.get("cohort_size"),
            "max_terms": result.config.get("max_terms"),
            "num_cohorts": result.config.get("num_cohorts"),
            "num_incumbent_cohorts": sum(1 for c in cohorts_meta if c["is_incumbent"]),
            "initial_state": result.config.get("initial_state", {"occupancy": {}}),
        },
        "frames": history.timeline,
        "summary": {
            "headline": headline,
            "per_cohort": list(compute_cohort_metrics(result).values()),
            "top_bottlenecks": {
                "fail":     _top3(history.fail_counts),
                "capacity": _top3(history.capacity_block_counts_mandatory),
                "offering": _top3(history.offering_block_counts_mandatory),
                "prereq":   _top3(history.prereq_block_counts_mandatory),
            },
            "severe_terms": summarize_severe_terms(result),
        },
    }


# Thresholds for summarize_severe_terms below — not derived from config (cohort_size etc.);
# a fixed, curated cut so the list stays a short "look here first" pointer rather than flagging
# every course that ever lost a single seat.
_CAPACITY_SHORTFALL_WARNING_THRESHOLD = 5
_CAPACITY_SHORTFALL_HIGH_THRESHOLD = 15
_OFFERING_BLOCK_WARNING_THRESHOLD = 5
_MAX_SEVERE_TERM_WARNINGS = 10


def summarize_severe_terms(result: "SimulationResult") -> dict:
    """Per-mandatory-term courses with the worst seat shortfalls / offering blocks that
    *already occurred* in this run's own timeline.

    This is a retrospective severity ranking, not a forecast: by the time this is called the
    run has already executed every term it reports on (even mid-checkpoint — `history.timeline`
    only ever holds terms already stepped through, never ones still ahead). Optional
    (Summer/Winter) terms are excluded, matching every other structural bottleneck ranking in
    this module (see CLAUDE.md's "Four Block Signals": that bonus-seat pool is scarce by
    design, and counting it just points admins at the wrong courses). `warnings` is capped and
    sorted worst-first (severity, then shortfall size, then earliest term as a tiebreak) — not
    term order — so the single loudest entry a caller reads off index 0 really is the worst one.
    """
    mandatory = get_mandatory_seasons(result.config)
    timeline = result.history.timeline or []
    term_summaries = []
    warnings = []

    for frame in timeline:
        season = frame.get("season", "")
        if season not in mandatory:
            continue
        term_num = frame.get("term", 0)
        courses_stat = frame.get("courses", {})

        capacity_shortfalls = {
            code: stat["denied"] for code, stat in courses_stat.items() if stat.get("denied", 0) > 0
        }
        offering_blocks = {
            code: stat["offering_blocked"] for code, stat in courses_stat.items()
            if stat.get("offering_blocked", 0) > 0
        }
        if not capacity_shortfalls and not offering_blocks:
            continue

        term_summaries.append({
            "term": term_num,
            "season": season,
            "capacity_shortfalls": capacity_shortfalls,
            "offering_blocks": offering_blocks,
        })

        for code, count in capacity_shortfalls.items():
            if count >= _CAPACITY_SHORTFALL_WARNING_THRESHOLD:
                warnings.append({
                    "term": term_num, "season": season, "course": code,
                    "type": "capacity_shortfall", "count": count,
                    "severity": "high" if count >= _CAPACITY_SHORTFALL_HIGH_THRESHOLD else "medium",
                    "message": f"Term {term_num} ({season}): {count} students were denied a seat in {code}.",
                })
        for code, count in offering_blocks.items():
            if count >= _OFFERING_BLOCK_WARNING_THRESHOLD:
                warnings.append({
                    "term": term_num, "season": season, "course": code,
                    "type": "offering_block", "count": count, "severity": "medium",
                    "message": f"Term {term_num} ({season}): {count} eligible students were blocked "
                               f"because {code} wasn't offered.",
                })

    warnings.sort(key=lambda w: (0 if w["severity"] == "high" else 1, -w["count"], w["term"]))

    return {
        "term_summaries": term_summaries,
        "warnings": warnings[:_MAX_SEVERE_TERM_WARNINGS],
    }


def build_flow_timeline_json(
    result: "SimulationResult",
    curriculum: dict[str, "Course"],
    output_path: Path,
    monte_carlo: dict | None = None,
) -> dict:
    payload = flow_timeline_payload(result, curriculum, monte_carlo)
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
