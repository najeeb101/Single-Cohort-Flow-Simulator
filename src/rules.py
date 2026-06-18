"""Generic boolean rule expressions for compound course-gating rules.

This is the `rule_expr` referenced in docs/acip_transformation_plan.md §2.4's canonical
Course-catalog schema. Today only CMPS493's compound rule (CMPS310 AND (CMPS350 OR
CMPS405) AND completed_ch >= 84) uses it, but the evaluator itself knows nothing about
CMPS493 — any program's capstone/gateway rule, of any shape, is data, not a special case
in student.py.

Expression shape (JSON-compatible, recursive):
    "CMPS310"                              -> student has passed CMPS310
    {"all": [expr, ...]}                   -> every sub-expression holds
    {"any": [expr, ...]}                   -> at least one sub-expression holds
    {"min_ch": 84}                         -> student.completed_ch >= 84
"""
from __future__ import annotations

from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from src.models.student import Student

RuleExpr = Any  # str | {"all": [RuleExpr]} | {"any": [RuleExpr]} | {"min_ch": int}


def evaluate_rule(expr: RuleExpr, student: "Student") -> bool:
    if isinstance(expr, str):
        return student.has_passed(expr)
    if "all" in expr:
        return all(evaluate_rule(sub, student) for sub in expr["all"])
    if "any" in expr:
        return any(evaluate_rule(sub, student) for sub in expr["any"])
    if "min_ch" in expr:
        return student.completed_ch >= expr["min_ch"]
    raise ValueError(f"Unrecognized rule_expr node: {expr!r}")


def gate_edges(expr: RuleExpr) -> list[tuple[str, str]]:
    """Flatten a rule expression into (course_code, edge_kind) pairs for graph display.

    edge_kind is "all" or "any" — the boolean context the course-code leaf appeared
    under — so curriculum-network views can draw a solid edge for a hard requirement
    and a dashed edge for an either-or, without knowing the rule's shape in advance.
    """
    edges: list[tuple[str, str]] = []

    def walk(node: RuleExpr, kind: str) -> None:
        if isinstance(node, str):
            edges.append((node, kind))
        elif "all" in node:
            for sub in node["all"]:
                walk(sub, "all")
        elif "any" in node:
            for sub in node["any"]:
                walk(sub, "any")
        elif "min_ch" in node:
            pass  # references no course, so it contributes no edge
        else:
            raise ValueError(f"Unrecognized rule_expr node: {node!r}")

    walk(expr, "all")
    return edges
