"""Prerequisite-cycle check for Settings' curriculum editor (docs/input_system_history.md §2.4).

Pure function over a hypothetical post-edit dict[str, Course] — no DB/globals knowledge,
so it's easy to unit test and to call from src/api.py before committing a PUT /curriculum
edit.
"""
from __future__ import annotations

from src.models.course import Course
from src.rules import gate_edges


class CycleError(Exception):
    def __init__(self, cycle: list[tuple[str, str]]):
        self.cycle = cycle
        super().__init__(f"This edit would introduce a prerequisite cycle: {cycle}")


class PlanImportError(Exception):
    """Raised by src/db.py::import_plan on a malformed entry or a cyclic curriculum —
    src/api.py turns this into a 422 with `str(exc)` as the detail."""


def check_no_cycle(curriculum: dict[str, Course]) -> None:
    """Raise CycleError if curriculum's prerequisite + rule_expr graph has a cycle.

    Builds the graph fresh each call rather than caching — curriculum is small (38
    courses) and this only runs on a PUT /curriculum write, not on any hot path.
    """
    import networkx as nx  # local import matches src/visualize.py:180's existing convention

    graph = nx.DiGraph()
    for course in curriculum.values():
        graph.add_node(course.code)
        for prereq in course.prerequisites:
            graph.add_edge(prereq, course.code)
        if course.rule_expr is not None:
            for prereq_code, _kind in gate_edges(course.rule_expr):
                graph.add_edge(prereq_code, course.code)

    if not nx.is_directed_acyclic_graph(graph):
        cycle = nx.find_cycle(graph)
        raise CycleError(cycle)


def validate_missing_prerequisites(curriculum: dict[str, Course]) -> None:
    """Raise PlanImportError if any course references a prerequisite that doesn't exist."""
    for code, course in curriculum.items():
        prereqs = list(course.prerequisites)
        if course.rule_expr is not None:
            prereqs.extend(p_code for p_code, _ in gate_edges(course.rule_expr))
        missing = [p for p in prereqs if p not in curriculum]
        if missing:
            raise PlanImportError(
                f"Course {code} references non-existent prerequisite(s): {', '.join(missing)}"
            )


def validate_unreachable_prereq_depth(curriculum: dict[str, Course], config: dict | None = None) -> None:
    """Raise PlanImportError if the longest prerequisite path exceeds max_terms."""
    import networkx as nx

    max_terms = (config or {}).get("max_terms", 12)
    graph = nx.DiGraph()
    for course in curriculum.values():
        graph.add_node(course.code)
        for p in course.prerequisites:
            if p in curriculum:
                graph.add_edge(p, course.code)

    if nx.is_directed_acyclic_graph(graph):
        # Only the path-length computation itself is defensive here (e.g. an empty graph) —
        # the threshold check must run outside the try so its raise isn't swallowed by it.
        try:
            depth = len(nx.dag_longest_path(graph)) - 1
        except Exception:
            return
        if depth > max_terms:
            raise PlanImportError(
                f"Prerequisite path depth ({depth}) exceeds max_terms ({max_terms})"
            )


def validate_curriculum_topology(curriculum: dict[str, Course], config: dict | None = None) -> None:
    """Run all curriculum topology guardrails (missing prereqs, cycles, path depth)."""
    validate_missing_prerequisites(curriculum)
    check_no_cycle(curriculum)
    validate_unreachable_prereq_depth(curriculum, config)

