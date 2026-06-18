from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Optional


@dataclass(frozen=True)
class Course:
    code: str
    title: str
    credits: int
    prerequisites: tuple[str, ...]
    pass_rate: float
    offering: tuple[str, ...]          # ('Fall',), ('Spring',), or ('Fall','Spring')
    category: str                       # cs_core|cs_elective|college_req|math|science|english|gen_ed
    capacity: int                       # seats per offering-instance
    rule_expr: Optional[dict] = None    # compound gate (see src/rules.py); None = plain prerequisites
    study_plan_order: int = 99          # lower = earlier in the study plan


def load_curriculum(path: str | Path) -> dict[str, Course]:
    with open(path, encoding="utf-8") as f:
        data = json.load(f)

    courses: dict[str, Course] = {}
    for entry in data:
        course = Course(
            code=entry["code"],
            title=entry["title"],
            credits=entry["credits"],
            prerequisites=tuple(entry.get("prerequisites", [])),
            pass_rate=entry["pass_rate"],
            offering=tuple(entry["offering"]),
            category=entry["category"],
            capacity=entry["capacity"],
            rule_expr=entry.get("rule_expr"),
            study_plan_order=entry.get("study_plan_order", 99),
        )
        courses[course.code] = course

    return courses
