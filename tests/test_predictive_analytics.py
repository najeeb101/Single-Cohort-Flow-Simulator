"""Tests for administrative predictive demand analytics."""
from __future__ import annotations

from src.analytics import predict_next_terms_demand


def test_predict_next_terms_demand_structure():
    class DummyHistory:
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

    class DummyResult:
        history = DummyHistory()

    predictions = predict_next_terms_demand(DummyResult())
    assert "term_forecasts" in predictions
    assert "warnings" in predictions
    assert len(predictions["term_forecasts"]) == 2
    assert len(predictions["warnings"]) >= 2
    
    # Verify high severity warning sorting
    high_warn = [w for w in predictions["warnings"] if w["severity"] == "high"]
    assert len(high_warn) >= 1
    assert high_warn[0]["course"] == "CS102"
