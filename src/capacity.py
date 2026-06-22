"""Capacity-planning report: combines seat capacity, instructor/staffing capacity, and the
admissions recommendation into one department-facing artifact (`flow_timeline.summary.
capacity_planning`).

Instructor capacity is synthetic/configurable today (`Instructor` rows, src/db_models.py) —
the same synthetic-first approach the rest of the engine uses; a real faculty roster plugs
into the same `list[dict]` shape later.

Design notes:
  - Load unit is **sections per term**, the same unit `course_sections` already uses, so no
    credit-hour-equivalent assumption is invented.
  - Qualification axis is `Course.category` (cs_core/cs_elective/college_req/math/science/
    english/gen_ed) — the only grouping axis the curriculum already has. There is no
    per-course instructor assignment; an instructor qualified for a category is assumed able
    to teach any course in it. This is an optimistic upper bound (a multi-category instructor
    counts fully toward each of their categories), correct for a feasibility check but NOT a
    scheduler/assignment optimizer.
  - Per-course risk rows are therefore also category-derived: a course only appears in
    `course_staffing_risks` if its category's aggregate capacity is "tight" or "shortfall",
    and it's marked `top_driver` if it's the single largest contributor to that category's
    peak per-term demand. This is the most specific claim the category-only data supports
    without fabricating a per-course qualification signal.
"""
from __future__ import annotations

import statistics
from typing import TYPE_CHECKING

from src.analytics import build_course_utilization, compute_admissions_recommendation
from src.models.semester import get_mandatory_seasons

if TYPE_CHECKING:
    from src.models.course import Course
    from src.simulator import SimulationResult

# Within 10% of capacity counts as "tight" (no breach yet, but no slack either).
_TIGHT_MARGIN = 0.9


def _status(peak_needed: float, capacity: float) -> str:
    if capacity <= 0:
        return "shortfall" if peak_needed > 0 else "ok"
    if peak_needed > capacity:
        return "shortfall"
    if peak_needed >= _TIGHT_MARGIN * capacity:
        return "tight"
    return "ok"


def build_instructor_capacity(
    result: "SimulationResult",
    instructors: list[dict],
    curriculum: dict[str, "Course"],
) -> dict:
    """Per-category instructor-section feasibility check + per-course staffing-risk rows.

    Only mandatory-season frames (Fall/Spring) feed this report — optional (Summer/Winter)
    frames carry much smaller, separately-modeled demand (see
    src/simulator.py::_section_count) and would dilute the peak/representative figures meant
    to size *regular*-term staffing. Optional-term staffing isn't modeled here yet.
    """
    mandatory_seasons = get_mandatory_seasons(result.config)
    sections_by_category_term: dict[str, dict[int, int]] = {}
    peak_sections_by_course: dict[str, int] = {}

    for frame in result.history.timeline:
        if frame["season"] not in mandatory_seasons:
            continue
        for code, stats in frame["courses"].items():
            sections = stats.get("sections", 0)
            if not stats.get("offered") or sections <= 0:
                continue
            course = curriculum.get(code)
            if course is None:
                continue
            cat = course.category
            sections_by_category_term.setdefault(cat, {})
            sections_by_category_term[cat][frame["term"]] = (
                sections_by_category_term[cat].get(frame["term"], 0) + sections
            )
            peak_sections_by_course[code] = max(peak_sections_by_course.get(code, 0), sections)

    capacity_by_category: dict[str, int] = {}
    headcount_by_category: dict[str, int] = {}
    for instructor in instructors:
        for cat in instructor.get("categories", []):
            capacity_by_category[cat] = capacity_by_category.get(cat, 0) + int(
                instructor.get("max_sections_per_term", 0)
            )
            headcount_by_category[cat] = headcount_by_category.get(cat, 0) + 1

    all_categories = sorted(set(sections_by_category_term) | set(capacity_by_category))

    by_category: list[dict] = []
    status_by_category: dict[str, str] = {}
    for cat in all_categories:
        per_term = sections_by_category_term.get(cat, {})
        term_totals = list(per_term.values())
        peak_needed = max(term_totals) if term_totals else 0
        representative_needed = statistics.median(term_totals) if term_totals else 0.0
        capacity = capacity_by_category.get(cat, 0)
        headcount = headcount_by_category.get(cat, 0)
        status = _status(peak_needed, capacity)
        status_by_category[cat] = status
        by_category.append({
            "category": cat,
            "peak_sections_needed": peak_needed,
            "representative_sections_needed": round(representative_needed, 1),
            "instructor_capacity": capacity,
            "qualified_headcount": headcount,
            "shortfall": max(0, peak_needed - capacity),
            "status": status,
        })

    course_staffing_risks: list[dict] = []
    # Group courses by category so the single biggest driver per at-risk category can be
    # flagged without a per-course qualification signal the data doesn't actually support.
    courses_by_category: dict[str, list[str]] = {}
    for code, course in curriculum.items():
        if code in peak_sections_by_course:
            courses_by_category.setdefault(course.category, []).append(code)

    for cat, codes in courses_by_category.items():
        if status_by_category.get(cat, "ok") == "ok":
            continue
        top_code = max(codes, key=lambda c: peak_sections_by_course[c])
        for code in sorted(codes, key=lambda c: -peak_sections_by_course[c]):
            course_staffing_risks.append({
                "course": code,
                "category": cat,
                "peak_sections": peak_sections_by_course[code],
                "category_status": status_by_category[cat],
                "top_driver": code == top_code,
            })

    return {
        "by_category": by_category,
        "course_staffing_risks": course_staffing_risks,
        "note": (
            "Qualification is modeled at the category level (cs_core, cs_elective, ...), not "
            "per course — an instructor qualified for a category is assumed able to teach any "
            "course in it, and a multi-category instructor counts fully toward each category's "
            "capacity (an optimistic upper bound). This is a staffing feasibility check, not a "
            "scheduler/assignment optimizer. Per-course rows only list courses in a category "
            "whose aggregate capacity is 'tight' or 'shortfall'; 'top_driver' marks the single "
            "course contributing most to that category's peak per-term demand. Scoped to "
            "mandatory terms (Fall/Spring) only; optional-term (Summer/Winter) staffing isn't "
            "modeled here yet."
        ),
    }


def build_capacity_report(
    result: "SimulationResult",
    instructors: list[dict],
    curriculum: dict[str, "Course"],
) -> dict:
    """The combined seats + instructors + admissions report (`summary.capacity_planning`)."""
    return {
        "seat_utilization": build_course_utilization(result),
        "instructor_capacity": build_instructor_capacity(result, instructors, curriculum),
        "admissions_recommendation": compute_admissions_recommendation(result),
    }
