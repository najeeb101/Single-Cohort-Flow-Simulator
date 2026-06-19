"""Prerequisite-cycle check for Settings' curriculum editor (docs/input_system_plan.md §2.4).

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
