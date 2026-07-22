"""Tests for administrative predictive demand analytics and proposal validation."""
from __future__ import annotations

import pytest
from src.analytics import predict_next_terms_demand
from src.plan_validation import validate_administrative_proposals


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


def test_validate_administrative_proposals():
    class DummyCourse:
        pass

    curriculum = {"CS101": DummyCourse(), "MATH101": DummyCourse()}
    config = {"cohort_size": 100}

    raw = [
        {"type": "capacity", "code": "CS101", "value": 45, "reason": "seat boost"},
        {"type": "capacity", "code": "INVALID999", "value": 50, "reason": "bad code"},
        {"type": "pass_rate", "code": "MATH101", "value": 0.85, "reason": "tutoring"},
        {"type": "cohort_size", "value": 90, "reason": "lower intake"},
    ]

    valid = validate_administrative_proposals(raw, curriculum, config)
    assert len(valid) == 3
    codes = [p.get("code") for p in valid if "code" in p]
    assert "CS101" in codes
    assert "MATH101" in codes
    assert "INVALID999" not in codes
