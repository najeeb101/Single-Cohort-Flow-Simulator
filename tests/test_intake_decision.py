"""The intake analysis's decision math (src/planner/intake.py), on synthetic tables — no simulation:
isotonic smoothing, the t quantile, the per-limit verdicts (ok / infeasible / imprecise), the
recommendation, and the diminishing-returns upper limit.
"""
from __future__ import annotations

import math
import statistics

import pytest

from src.planner.intake import (
    IntakePolicy,
    _apply_limits,
    _why,
    diminishing_returns,
    isotonic_increasing,
    recommend,
    t_quantile,
)

REFERENCE = {"grad_rate": 0.70, "on_time_rate": 0.50, "se_grad": 0.004, "se_on_time": 0.004}
POLICY = IntakePolicy(max_grad_rate_loss_pts=2.0, max_on_time_loss_pts=10.0)


def _point(n, grad, on_time, se=0.004, seeds=40, gpy=None):
    return {"intake": n, "seeds": seeds, "grad_rate": grad, "grad_se": se,
            "on_time_rate": on_time, "on_time_se": se,
            "graduates_per_year": gpy if gpy is not None else n * grad,
            "top_courses": [{"code": "CMPS303", "denials_per_student": 0.3}]}


def test_isotonic_pools_violations():
    fitted, groups = isotonic_increasing([1.0, 3.0, 2.0, 4.0], [1, 1, 1, 1])
    assert fitted == pytest.approx([1.0, 2.5, 2.5, 4.0])
    assert groups == [[0], [1, 2], [3]]
    fitted, _ = isotonic_increasing([5.0, 4.0, 3.0], [1, 1, 1])
    assert fitted == pytest.approx([4.0, 4.0, 4.0])


def _with_per_seed(point, on_time_by_seed):
    point["_per_seed"] = {"grad_rate": [point["grad_rate"]] * len(on_time_by_seed),
                          "on_time_rate": on_time_by_seed}
    return point


def test_pooled_intakes_without_per_seed_data_are_treated_as_correlated():
    # 5 then 4 pts of on-time loss: the isotonic fit pools them at 4.5. Neighbouring intakes share
    # seeds, so with no per-seed data to measure it, pooling must not shrink the margin as if the
    # two estimates were independent: SE stays 1 pt, and the 20 shared seeds count once.
    points = [_point(40, 0.70, 0.45, se=0.01, seeds=20), _point(50, 0.70, 0.46, se=0.01, seeds=20)]
    _apply_limits(points, REFERENCE, POLICY)
    margin = t_quantile(0.95, 19) * math.sqrt(1.0**2 + 0.4**2)
    for p in points:
        assert p["on_time_loss_fit"] == pytest.approx(4.5)
        assert p["on_time_loss_upper"] == pytest.approx(4.5 + margin)


def test_pooled_margin_uses_the_measured_seed_correlation():
    a = [0.40, 0.50, 0.44, 0.47, 0.42, 0.49]
    shuffled = [0.47, 0.42, 0.50, 0.40, 0.49, 0.44]  # same values, uncorrelated order
    rho = max(0.0, statistics.correlation(a, shuffled))

    def bound(other):
        points = [_with_per_seed(_point(40, 0.70, 0.45, se=0.01, seeds=6), a),
                  _with_per_seed(_point(50, 0.70, 0.46, se=0.01, seeds=6), other)]
        _apply_limits(points, REFERENCE, POLICY)
        return points[0]["on_time_loss_upper"]

    t = t_quantile(0.95, 5)
    # Identical per-seed series: correlation 1, the margin keeps each point's own SE.
    assert bound(list(a)) == pytest.approx(4.5 + t * math.sqrt(1.0 + 0.16))
    # Uncorrelated series: pooling two estimates does shrink the SE, by sqrt((1 + rho) / 2).
    assert bound(shuffled) == pytest.approx(4.5 + t * math.sqrt((1 + rho) / 2 + 0.16))
    assert bound(shuffled) < bound(list(a))


def test_single_point_blocks_use_their_own_se():
    points = [_point(40, 0.70, 0.46, se=0.01, seeds=20), _point(50, 0.70, 0.44, se=0.02, seeds=40)]
    _apply_limits(points, REFERENCE, POLICY)
    assert points[0]["on_time_loss_upper"] == pytest.approx(4.0 + t_quantile(0.95, 19) * math.sqrt(1.0 + 0.16))
    assert points[1]["on_time_loss_upper"] == pytest.approx(6.0 + t_quantile(0.95, 39) * math.sqrt(4.0 + 0.16))


def test_t_quantile_close_to_tables():
    assert t_quantile(0.95, 19) == pytest.approx(1.729, abs=0.005)
    assert t_quantile(0.95, 9) == pytest.approx(1.833, abs=0.01)
    assert t_quantile(0.95, 10_000) == pytest.approx(1.645, abs=0.002)


def test_largest_passing_intake_is_recommended():
    # Grad loss: 0, 0.5, 1, 5, 9 pts; on-time loss: 2, 4, 6, 8, 20 pts.
    points = [_point(40, 0.70, 0.48), _point(60, 0.695, 0.46), _point(80, 0.69, 0.44),
              _point(100, 0.65, 0.42), _point(120, 0.61, 0.30)]
    limits = _apply_limits(points, REFERENCE, POLICY)
    grad, on_time = limits
    assert grad["max_intake"] == 80 and grad["first_failing_intake"] == 100
    assert on_time["max_intake"] == 100 and on_time["first_failing_intake"] == 120
    rec = recommend(points, limits)
    assert rec == {"recommended_intake": 80, "binding_limit": "grad_rate_loss", "feasible": True}
    assert "100" in _why(rec, limits, points) and "CMPS303" in _why(rec, limits, points)


def test_noisy_dip_cannot_reopen_a_failed_intake():
    # 100 fails, 120 "recovers" by noise; the monotone fit keeps 120 failing too.
    points = [_point(60, 0.70, 0.50), _point(80, 0.695, 0.50), _point(100, 0.66, 0.50),
              _point(120, 0.69, 0.50)]
    limits = _apply_limits(points, REFERENCE, POLICY)
    fits = [p["grad_rate_loss_fit"] for p in points]
    assert fits == sorted(fits)
    assert limits[0]["max_intake"] == 80


def test_infeasible_when_harm_exists_even_at_lowest_intake():
    points = [_point(40, 0.70, 0.35), _point(60, 0.70, 0.30)]  # on-time loss 15 pts already
    limits = _apply_limits(points, REFERENCE, POLICY)
    on_time = limits[1]
    assert on_time["max_intake"] is None and on_time["status"] == "infeasible"
    rec = recommend(points, limits)
    assert rec["recommended_intake"] is None and rec["feasible"] is False
    assert "Even at 40" in _why(rec, limits, points)


def test_imprecise_when_uncertainty_alone_breaks_the_limit():
    points = [_point(40, 0.69, 0.50, se=0.03, seeds=3), _point(60, 0.69, 0.50, se=0.03, seeds=3)]
    limits = _apply_limits(points, REFERENCE, POLICY)
    assert limits[0]["status"] == "imprecise"
    assert "more seeds" in _why(recommend(points, limits), limits, points)


def test_absolute_grad_floor():
    policy = IntakePolicy(max_grad_rate_loss_pts=50, max_on_time_loss_pts=100, min_grad_rate=0.66)
    points = [_point(40, 0.70, 0.5), _point(60, 0.68, 0.5), _point(80, 0.62, 0.5)]
    limits = _apply_limits(points, REFERENCE, policy)
    floor = next(l for l in limits if l["name"] == "min_grad_rate")
    assert floor["max_intake"] == 60


def test_diminishing_returns_marks_the_plateau():
    # Graduates per year: 28, 42, 52, 54, 55 -> marginal 0.7, 0.5, 0.1, 0.05 per extra student.
    pts = [_point(n, g, 0.4) for n, g in [(40, 0.70), (60, 0.70), (80, 0.65), (100, 0.54), (120, 0.4583)]]
    upper, marginal = diminishing_returns(pts, threshold=0.25)
    assert upper == 80
    assert [round(m["graduates_per_extra_student"], 2) for m in marginal][:2] == [0.7, 0.5]
