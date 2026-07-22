"""Tests for src.analytics.summarize_severe_terms: a retrospective, worst-first ranking of
term-level seat shortfalls / offering blocks that already occurred in a run's own timeline —
not a forecast (see the function's docstring for why "predictive" was the wrong name for this).
"""
from __future__ import annotations

from src.analytics import summarize_severe_terms


def _result(timeline, config=None):
    class DummyHistory:
        pass

    history = DummyHistory()
    history.timeline = timeline

    class DummyResult:
        pass

    result = DummyResult()
    result.history = history
    result.config = config or {}
    return result


def test_summarize_severe_terms_structure():
    timeline = [
        {
            "term": 1,
            "season": "Fall",
            "courses": {
                "CS101": {"denied": 12, "offering_blocked": 0},
                "MATH101": {"denied": 0, "offering_blocked": 6},
            },
        },
        {
            "term": 2,
            "season": "Spring",
            "courses": {
                "CS102": {"denied": 18, "offering_blocked": 0},
            },
        },
    ]

    summary = summarize_severe_terms(_result(timeline))
    assert "term_summaries" in summary
    assert "warnings" in summary
    assert len(summary["term_summaries"]) == 2
    assert len(summary["warnings"]) >= 2


def test_warnings_are_sorted_worst_first_not_by_term_order():
    """A small term-1 blip must not outrank a much larger term-2 shortfall — the old
    implementation sorted by term first, so this would have failed against it."""
    timeline = [
        {"term": 1, "season": "Fall", "courses": {"MINOR": {"denied": 5, "offering_blocked": 0}}},
        {"term": 2, "season": "Spring", "courses": {"MAJOR": {"denied": 40, "offering_blocked": 0}}},
    ]

    summary = summarize_severe_terms(_result(timeline))
    assert summary["warnings"][0]["course"] == "MAJOR"
    assert summary["warnings"][0]["severity"] == "high"


def test_optional_terms_are_excluded():
    """Summer/Winter seats are a deliberately small bonus pool (CLAUDE.md's "Four Block
    Signals") — a shortfall there must never surface as a severe-term warning."""
    config = {
        "terms_per_year": ["Fall", "Winter", "Spring", "Summer"],
        "mandatory_terms": ["Fall", "Spring"],
        "optional_terms_enabled": True,
    }
    timeline = [
        {"term": 0, "season": "Fall", "courses": {"REAL": {"denied": 10, "offering_blocked": 0}}},
        {"term": 1, "season": "Summer", "courses": {"BONUS": {"denied": 50, "offering_blocked": 0}}},
    ]

    summary = summarize_severe_terms(_result(timeline, config))
    codes = {w["course"] for w in summary["warnings"]}
    assert "REAL" in codes
    assert "BONUS" not in codes


def test_below_threshold_shortfalls_produce_no_warning():
    timeline = [{"term": 1, "season": "Fall", "courses": {"CS101": {"denied": 1, "offering_blocked": 0}}}]
    summary = summarize_severe_terms(_result(timeline))
    assert summary["warnings"] == []
    # Still recorded in term_summaries even below the warning threshold.
    assert summary["term_summaries"][0]["capacity_shortfalls"] == {"CS101": 1}
