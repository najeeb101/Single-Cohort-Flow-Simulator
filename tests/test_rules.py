"""Tests for the generic rule_expr evaluator (src/rules.py), independent of any one
curriculum. CMPS493's specific compound rule is covered in test_prerequisites.py; these
tests prove the evaluator itself handles arbitrary nesting, not just that one shape.
"""
from __future__ import annotations

import pytest

from src.models.student import Student
from src.rules import evaluate_rule, gate_edges

SEED = 42


def _make_student(passed: list[str] | None = None, completed_ch: int = 0) -> Student:
    s = Student(0, SEED)
    for code in passed or []:
        s.completed_courses[code] = "B"
    s.completed_ch = completed_ch
    return s


# ─── evaluate_rule ───────────────────────────────────────────────────────── #

def test_string_leaf_is_has_passed():
    s = _make_student(passed=["X"])
    assert evaluate_rule("X", s)
    assert not evaluate_rule("Y", s)


def test_all_requires_every_branch():
    s = _make_student(passed=["A", "B"])
    assert evaluate_rule({"all": ["A", "B"]}, s)
    assert not evaluate_rule({"all": ["A", "B", "C"]}, s)


def test_any_requires_one_branch():
    s = _make_student(passed=["B"])
    assert evaluate_rule({"any": ["A", "B"]}, s)
    assert not evaluate_rule({"any": ["A", "C"]}, s)


def test_min_ch_threshold():
    s = _make_student(completed_ch=84)
    assert evaluate_rule({"min_ch": 84}, s)
    assert not evaluate_rule({"min_ch": 85}, s)


def test_nested_any_inside_all():
    # A AND (B OR C) AND ch >= 10 — same shape as CMPS493, smaller numbers.
    rule = {"all": ["A", {"any": ["B", "C"]}, {"min_ch": 10}]}
    assert evaluate_rule(rule, _make_student(passed=["A", "B"], completed_ch=10))
    assert evaluate_rule(rule, _make_student(passed=["A", "C"], completed_ch=10))
    assert not evaluate_rule(rule, _make_student(passed=["A"], completed_ch=10))  # neither B nor C
    assert not evaluate_rule(rule, _make_student(passed=["A", "B"], completed_ch=9))  # ch too low


def test_deeper_nesting_all_inside_any():
    # (A AND B) OR C — a shape no current curriculum course uses, proving the
    # evaluator isn't special-cased to CMPS493's particular tree.
    rule = {"any": [{"all": ["A", "B"]}, "C"]}
    assert evaluate_rule(rule, _make_student(passed=["A", "B"]))
    assert evaluate_rule(rule, _make_student(passed=["C"]))
    assert not evaluate_rule(rule, _make_student(passed=["A"]))


def test_unrecognized_node_raises():
    with pytest.raises(ValueError):
        evaluate_rule({"unknown": []}, _make_student())


# ─── gate_edges ──────────────────────────────────────────────────────────── #

def test_gate_edges_tags_all_and_any():
    rule = {"all": ["A", {"any": ["B", "C"]}, {"min_ch": 84}]}
    assert sorted(gate_edges(rule)) == [("A", "all"), ("B", "any"), ("C", "any")]


def test_gate_edges_bare_string_is_all():
    assert gate_edges("A") == [("A", "all")]


def test_gate_edges_handles_nested_any_of_all():
    rule = {"any": [{"all": ["A", "B"]}, "C"]}
    assert sorted(gate_edges(rule)) == [("A", "all"), ("B", "all"), ("C", "any")]


def test_gate_edges_unrecognized_node_raises():
    with pytest.raises(ValueError):
        gate_edges({"unknown": []})
