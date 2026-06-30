"""The engine-as-a-service boundary (ACIP plan §2.3): run one scenario purely in memory
and return every derived result as a dict, with no file I/O and no stdout. This is the
seam an API layer calls; `run.py` is a thin disk-writing wrapper around it, and
analytics.py's CSV/JSON writers + visualize.py's figure writers remain optional
serializers callers can still apply to the `SimulationResult` this returns.

Monte Carlo (src.montecarlo.run_monte_carlo) is a separate, optional, expensive layer —
deliberately not folded in here — that a caller invokes itself when it wants confidence
intervals (re-running one scenario dozens of times isn't something every caller wants
paid for by default).
"""
from __future__ import annotations

from typing import TYPE_CHECKING

from src.analytics import (
    compute_admissions_recommendation,
    compute_cohort_metrics,
    compute_metrics,
    flow_timeline_payload,
)
from src.simulator import Simulator

if TYPE_CHECKING:
    from src.datasource import DataSource
    from src.models.course import Course


def run_simulation(
    curriculum: dict[str, "Course"],
    config: dict,
    scenario: dict,
    data_source: "DataSource | None" = None,
) -> dict:
    """Run one scenario end-to-end and return its results as a plain dict.

    Keys: `result` (the raw SimulationResult, for callers that want to pass it on to
    analytics.py/visualize.py's writers), `metrics`, `cohort_metrics`,
    `admissions_recommendation`, and `flow_timeline` (the full frontend-contract payload,
    without Monte Carlo — pass `monte_carlo=...` to flow_timeline_payload yourself on
    `result` if you need CIs merged in). `data_source` defaults to `SyntheticDataSource`;
    pass a `RealDataSource` here once one exists.
    """
    result = Simulator(curriculum, config, scenario, data_source=data_source).run()
    result.metrics = compute_metrics(result)
    return {
        "result": result,
        "metrics": result.metrics,
        "cohort_metrics": compute_cohort_metrics(result),
        "admissions_recommendation": compute_admissions_recommendation(result),
        "flow_timeline": flow_timeline_payload(result, curriculum),
    }
