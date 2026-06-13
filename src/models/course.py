from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Optional


@dataclass(frozen=True)
class SeniorProjectRule:
    required: tuple[str, ...]
    one_of: tuple[str, ...]
    min_credits: int


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
    is_senior_project: bool = False
    senior_project_rule: Optional[SeniorProjectRule] = None
    study_plan_order: int = 99          # lower = earlier in the study plan


def load_curriculum(path: str | Path) -> dict[str, Course]:
    with open(path, encoding="utf-8") as f:
        data = json.load(f)

    courses: dict[str, Course] = {}
    for entry in data:
        spr: Optional[SeniorProjectRule] = None
        if entry.get("senior_project_rule"):
            rule = entry["senior_project_rule"]
            spr = SeniorProjectRule(
                required=tuple(rule["required"]),
                one_of=tuple(rule["one_of"]),
                min_credits=rule["min_credits"],
            )
        course = Course(
            code=entry["code"],
            title=entry["title"],
            credits=entry["credits"],
            prerequisites=tuple(entry.get("prerequisites", [])),
            pass_rate=entry["pass_rate"],
            offering=tuple(entry["offering"]),
            category=entry["category"],
            capacity=entry["capacity"],
            is_senior_project=entry.get("is_senior_project", False),
            senior_project_rule=spr,
            study_plan_order=entry.get("study_plan_order", 99),
        )
        courses[course.code] = course

    return courses
