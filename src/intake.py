"""Intake analysis: how many students should the department admit in the next intake, and what
seats does that number need?

This is the decision layer the whole product is built around (see docs/methodology.md). It
sits on top of the unchanged engine and answers the question with a sweep, not a one-run
heuristic:

1. **Two views of every candidate intake N.**
   - *next*: today's student body is rebuilt from the department's real past intakes (padded
     with estimated older years so the oldest cohort isn't walking into an empty university),
     then the next intake of N is admitted, followed by more intakes of N. We measure the next
     ``next_measured`` intakes. This drives the headline number.
   - *steady*: a long-run department that has always admitted N — ``min_history_years`` of
     earlier intakes of N, then ``steady_cohorts`` more, measured on the first
     ``steady_measured``. This is the "sustainable standard intake" check.
2. **Many independent replications** per N (``spaced_seeds`` — consecutive seeds would replay the
   same students, see src/utils.py), so every number carries a confidence range.
3. **An unlimited-seat reference.** With ``unlimited_seats="all"`` students never compete, so
   their outcomes don't depend on N; one pooled reference estimate (a few runs, ~10k students)
   stands in for every N. *Loss from seat shortages* = reference − real-seat outcome. That is
   exactly the part intake controls; failures and dropout (which intake can't fix) cancel out.
4. **Monotone smoothing.** Losses can only grow with N, so per-N means are fitted to an
   isotonic (non-decreasing) curve before the decision rule reads them — noise can't produce a
   jagged "fails at 70, passes at 80" answer.
5. **Decision rule.** For each policy limit, the largest N whose fitted loss stays within the
   limit at the one-sided 95% upper bound, with every smaller N passing too. The recommended
   intake is the smallest of those. The "upper limit" is where an extra admit stops adding
   graduates (marginal graduates per extra student < ``diminishing_returns``).

Everything here is a pure in-memory layer over ``Simulator`` (no DB, no file I/O) so a background
job (src/jobs.py) can drive it and tests can call it directly. Worker functions are module-level
and this module imports only engine code, so spawned pool workers never import the API.
"""
from __future__ import annotations

import copy
import dataclasses
import math
import statistics
import time
from dataclasses import dataclass
from typing import Callable

from src.datasource import SyntheticDataSource
from src.models.semester import admission_seasons, get_mandatory_seasons
from src.parallel import iter_ordered, make_pool, resolve_workers, terminate_pool
from src.simulator import Simulator
from src.utils import spaced_seeds

ANALYSIS_VERSION = 1

DEFAULT_POLICY: dict = {
    "max_grad_rate_loss_pts": 2.0,   # 6-year graduation may drop at most this much because of seats
    "max_on_time_loss_pts": 10.0,    # on-time (within on_time_terms) graduation may drop at most this much
    "min_grad_rate": None,           # optional absolute floor on the graduation rate (0..1)
}

DEFAULT_ANALYSIS: dict = {
    "grid_min": 20,
    "grid_max": 200,
    "grid_step": 10,
    "seeds": 20,
    "refine_step": 5,
    "refine_seeds": 40,
    "reference_runs": 8,
    "reference_intake": 100,
    "min_history_years": 8,
    "next_measured": 2,
    "successor_intakes": 2,
    "steady_cohorts": 6,
    "steady_measured": 4,
    "steady_seeds": 12,
    "robustness_seeds": 12,
    "diminishing_returns": 0.25,
    "robustness": True,
    "base_seed": None,               # None -> config["seed"]
}

DEFAULT_SECTION_SIZE = 35

_LIMIT_LABELS = {
    "grad_rate_loss": "graduation-rate limit",
    "on_time_loss": "on-time graduation limit",
    "min_grad_rate": "minimum graduation rate",
}


class AnalysisCancelled(Exception):
    """Raised inside a run when the caller's cancel callback returns True."""


# ------------------------------------------------------------------ #
# Policy / parameters                                                 #
# ------------------------------------------------------------------ #

@dataclass(frozen=True)
class IntakePolicy:
    max_grad_rate_loss_pts: float = 2.0
    max_on_time_loss_pts: float = 10.0
    min_grad_rate: float | None = None


def policy_from_config(config: dict, override: dict | None = None) -> IntakePolicy:
    merged = {**DEFAULT_POLICY, **(config.get("intake_policy") or {}), **(override or {})}
    mgr = merged.get("min_grad_rate")
    return IntakePolicy(
        max_grad_rate_loss_pts=float(merged["max_grad_rate_loss_pts"]),
        max_on_time_loss_pts=float(merged["max_on_time_loss_pts"]),
        min_grad_rate=float(mgr) if mgr is not None else None,
    )


def analysis_params(config: dict, override: dict | None = None) -> dict:
    params = {**DEFAULT_ANALYSIS, **(config.get("intake_analysis") or {}), **(override or {})}
    if params.get("base_seed") is None:
        params["base_seed"] = int(config.get("seed", 42))
    return params


def section_size(config: dict) -> int:
    return max(1, int(config.get("section_size", DEFAULT_SECTION_SIZE)))


def intake_grid(params: dict) -> list[int]:
    lo, hi, step = int(params["grid_min"]), int(params["grid_max"]), int(params["grid_step"])
    grid = list(range(lo, hi + 1, step))
    if grid[-1] != hi:
        grid.append(hi)
    return grid


# ------------------------------------------------------------------ #
# Today's student body                                                #
# ------------------------------------------------------------------ #

def _seasons_per_year(config: dict) -> int:
    return max(1, len(admission_seasons(config)))


def resolve_incumbent_sizes(config: dict, min_history_years: int) -> list[tuple[int, str]]:
    """Past intakes (most recent first) as ``(size, "entered"|"padded")``, padded with estimated
    older intakes until there are at least ``min_history_years`` worth of cohorts.

    Padding matters: with only ~5 predecessor cohorts the oldest one starts in an empty university
    and the backlog of delayed students is too small, which makes the next cohort look better off
    than it is. Padded intakes use the mean of the real ones (or ``cohort_size`` if none exist)
    and are flagged so the UI can say "estimated history".
    """
    entries = (config.get("current_students") or {}).get("past_intakes") or []
    real = [(int(e["size"]), "entered") for e in entries if int(e.get("size", 0)) > 0]
    needed = max(min_history_years * _seasons_per_year(config), len(real))
    fill = round(statistics.fmean(s for s, _ in real)) if real else int(config["cohort_size"])
    return real + [(fill, "padded")] * (needed - len(real))


def _primary_season(config: dict) -> str:
    return admission_seasons(config)[0]


def _config_for_intake(config: dict, n: int, num_cohorts: int, *, num_incumbents: int, seed: int) -> dict:
    """A run config admitting ``n`` in the primary admission season (other seasons keep their
    configured ``admission_sizes``)."""
    cfg = copy.deepcopy(config)
    primary = _primary_season(cfg)
    sizes = dict(cfg.get("admission_sizes") or {})
    sizes.pop(primary, None)
    cfg["admission_sizes"] = sizes
    cfg["cohort_size"] = int(n)
    cfg["num_cohorts"] = int(num_cohorts)
    cfg["num_incumbent_cohorts"] = int(num_incumbents)
    cfg["seed"] = int(seed)
    return cfg


def _other_season_intake(config: dict) -> int:
    """Students admitted per year outside the primary season (e.g. a fixed Spring intake)."""
    primary = _primary_season(config)
    sizes = config.get("admission_sizes") or {}
    return sum(int(sizes.get(s, config["cohort_size"])) for s in admission_seasons(config) if s != primary)


# ------------------------------------------------------------------ #
# One simulation (module-level so it pickles for the process pool)    #
# ------------------------------------------------------------------ #

def _run_task(task: dict) -> dict:
    """Run one simulation described by ``task`` and return compact, picklable measurements.

    task keys: curriculum, config, scenario, incumbent_sizes (list|None), measured (cohort ids,
    or "all"), current_ids (incumbent cohort ids holding real students), want_demand (bool).
    """
    cfg = task["config"]
    source = SyntheticDataSource(cfg, incumbent_sizes=task.get("incumbent_sizes"))
    result = Simulator(task["curriculum"], cfg, task["scenario"], data_source=source).run()
    history = result.history
    on_time_terms = cfg.get("on_time_terms", 8)

    measured = task["measured"]
    if measured == "all":
        members = result.students
        measured_ids = sorted({s.cohort_id for s in members})
    else:
        measured_ids = list(measured)
        wanted = set(measured_ids)
        members = [s for s in result.students if s.cohort_id in wanted]

    graduated = [s for s in members if s.status == "GRADUATED"]
    times = [s.grad_semester for s in graduated if s.grad_semester is not None]
    out = {
        "n": len(members),
        "graduated": len(graduated),
        "on_time": sum(1 for t in times if t <= on_time_terms),
        "dropped": sum(1 for s in members if s.status == "DROPPED"),
        "censored": sum(1 for s in members if s.status == "CENSORED"),
        "time_sum": sum(times),
        "denials_total": sum(sum(history.capacity_block_by_cohort.get(c, {}).values()) for c in measured_ids),
        "denials_regular": sum(
            sum(history.capacity_block_mandatory_by_cohort.get(c, {}).values()) for c in measured_ids),
    }
    per_course: dict[str, int] = {}
    for c in measured_ids:
        for code, k in history.capacity_block_mandatory_by_cohort.get(c, {}).items():
            per_course[code] = per_course.get(code, 0) + k
    out["denials_by_course"] = per_course

    current_ids = set(task.get("current_ids") or [])
    if current_ids:
        current = [s for s in result.students if s.cohort_id in current_ids]
        out["current_n"] = len(current)
        out["current_graduated"] = sum(1 for s in current if s.status == "GRADUATED")
        # Headcount the next cohort walks into: incumbents still enrolled after the last term
        # before term 0 (the ledger row for global_term -1).
        out["headcount_at_start"] = sum(
            row["active"] + row["delayed"] for row in history.cohort_snapshots
            if row["global_term"] == -1 and row["cohort_id"] < 0
        )

    if task.get("want_demand"):
        mandatory = get_mandatory_seasons(cfg)
        demand: dict[str, list[int]] = {}
        for frame in history.timeline:
            if frame["term"] < 0 or frame["season"] not in mandatory:
                continue
            for code, st in frame["courses"].items():
                if st["offered"] and st["registered"] > 0:
                    demand.setdefault(code, []).append(st["registered"])
        out["demand"] = demand
    return out


# ------------------------------------------------------------------ #
# Statistics                                                          #
# ------------------------------------------------------------------ #

def t_quantile(conf: float, df: int) -> float:
    """One-sided Student-t quantile (Cornish-Fisher expansion around the normal) — accurate to
    ~1e-3 for df >= 5, which is all this module needs; no scipy dependency."""
    z = statistics.NormalDist().inv_cdf(conf)
    if df <= 0:
        return z
    d = float(df)
    return (z + (z**3 + z) / (4 * d) + (5 * z**5 + 16 * z**3 + 3 * z) / (96 * d**2)
            + (3 * z**7 + 19 * z**5 + 17 * z**3 - 15 * z) / (384 * d**3))


def isotonic_increasing(y: list[float], w: list[float]) -> tuple[list[float], list[list[int]]]:
    """Weighted pool-adjacent-violators fit: the closest non-decreasing sequence to ``y``.
    Returns (fitted values, blocks of original indices pooled together)."""
    blocks: list[list] = []  # [value, weight, indices]
    for i, (yi, wi) in enumerate(zip(y, w)):
        blocks.append([yi, max(wi, 1e-12), [i]])
        while len(blocks) > 1 and blocks[-2][0] > blocks[-1][0]:
            v2, w2, i2 = blocks.pop()
            v1, w1, i1 = blocks.pop()
            wt = w1 + w2
            blocks.append([(v1 * w1 + v2 * w2) / wt, wt, i1 + i2])
    fitted = [0.0] * len(y)
    groups: list[list[int]] = []
    for v, _, idx in blocks:
        groups.append(idx)
        for i in idx:
            fitted[i] = v
    return fitted, groups


def _mean_se(values: list[float]) -> tuple[float, float]:
    if not values:
        return 0.0, 0.0
    m = statistics.fmean(values)
    se = statistics.stdev(values) / math.sqrt(len(values)) if len(values) > 1 else 0.0
    return m, se


def estimate_reference(rows: list[dict]) -> dict:
    """Pooled unlimited-seat outcome (students are independent there, so pooling is exact)."""
    n = sum(r["n"] for r in rows) or 1
    grads = sum(r["graduated"] for r in rows)
    on_time = sum(r["on_time"] for r in rows)
    g, o = grads / n, on_time / n
    return {
        "grad_rate": g,
        "on_time_rate": o,
        "avg_time_to_degree": (sum(r["time_sum"] for r in rows) / grads) if grads else None,
        "se_grad": math.sqrt(g * (1 - g) / n),
        "se_on_time": math.sqrt(o * (1 - o) / n),
        "n_students": n,
        "runs": len(rows),
        "denials": sum(r["denials_total"] for r in rows),
    }


def _summarize_point(n: int, rows: list[dict], other_intake: int) -> dict:
    """Aggregate the replications of one (view, N) point."""
    grad = [r["graduated"] / r["n"] for r in rows if r["n"]]
    on_time = [r["on_time"] / r["n"] for r in rows if r["n"]]
    gm, gse = _mean_se(grad)
    om, ose = _mean_se(on_time)
    measured_students = sum(r["n"] for r in rows) or 1
    grads_total = sum(r["graduated"] for r in rows)
    denials_total = sum(r["denials_total"] for r in rows)
    denials_regular = sum(r["denials_regular"] for r in rows)
    by_course: dict[str, int] = {}
    for r in rows:
        for code, k in r["denials_by_course"].items():
            by_course[code] = by_course.get(code, 0) + k
    top = sorted(by_course.items(), key=lambda kv: -kv[1])[:5]
    point = {
        "intake": n,
        "seeds": len(rows),
        "grad_rate": gm, "grad_se": gse,
        "on_time_rate": om, "on_time_se": ose,
        "dropout_rate": sum(r["dropped"] for r in rows) / measured_students,
        "censored_rate": sum(r["censored"] for r in rows) / measured_students,
        "avg_time_to_degree": (sum(r["time_sum"] for r in rows) / grads_total) if grads_total else None,
        "graduates_per_year": (n + other_intake) * gm,
        "denials_per_student": denials_total / measured_students,
        "summer_denial_share": ((denials_total - denials_regular) / denials_total) if denials_total else 0.0,
        "top_courses": [
            {"code": code, "denials_per_student": k / measured_students} for code, k in top if k > 0
        ],
    }
    if rows and "current_n" in rows[0]:
        cur_n = sum(r["current_n"] for r in rows) or 1
        point["current_students_grad_rate"] = sum(r["current_graduated"] for r in rows) / cur_n
        point["headcount_at_start"] = statistics.fmean(r["headcount_at_start"] for r in rows)
    return point


def _apply_limits(points: list[dict], reference: dict, policy: IntakePolicy) -> list[dict]:
    """Attach loss / fitted / upper-bound columns to ``points`` (sorted by intake) and return the
    per-limit verdicts. Mutates ``points`` in place."""
    specs = [
        ("grad_rate_loss", "grad_rate", "grad_se", reference["grad_rate"], reference["se_grad"],
         policy.max_grad_rate_loss_pts),
        ("on_time_loss", "on_time_rate", "on_time_se", reference["on_time_rate"], reference["se_on_time"],
         policy.max_on_time_loss_pts),
    ]
    limits = []
    for name, mean_key, se_key, ref, ref_se, tol in specs:
        loss = [100 * (ref - p[mean_key]) for p in points]
        se = [100 * p[se_key] for p in points]
        weights = [1.0 / max(s, 0.05) ** 2 for s in se]
        fitted, groups = isotonic_increasing(loss, weights)
        upper = [0.0] * len(points)
        for idx in groups:
            block_se = math.sqrt(1.0 / sum(weights[i] for i in idx))
            df = sum(points[i]["seeds"] for i in idx) - len(idx)
            margin = t_quantile(0.95, df) * math.sqrt(block_se**2 + (100 * ref_se) ** 2)
            for i in idx:
                upper[i] = fitted[i] + margin
        for p, l, f, u in zip(points, loss, fitted, upper):
            p[name] = l
            p[f"{name}_fit"] = f
            p[f"{name}_upper"] = u
        limits.append(_verdict(name, points, f"{name}_fit", f"{name}_upper", tol, higher_is_worse=True))

    if policy.min_grad_rate is not None:
        floor = 100 * policy.min_grad_rate
        # Graduation rate can only fall with N: isotonic-increasing on the shortfall below 100%.
        short = [100 * (1 - p["grad_rate"]) for p in points]
        se = [100 * p["grad_se"] for p in points]
        weights = [1.0 / max(s, 0.05) ** 2 for s in se]
        fitted, groups = isotonic_increasing(short, weights)
        for idx in groups:
            block_se = math.sqrt(1.0 / sum(weights[i] for i in idx))
            df = sum(points[i]["seeds"] for i in idx) - len(idx)
            margin = t_quantile(0.95, df) * block_se
            for i in idx:
                points[i]["grad_rate_fit"] = 100 - fitted[i]
                points[i]["grad_rate_lower"] = 100 - fitted[i] - margin
        limits.append(_verdict("min_grad_rate", points, "grad_rate_fit", "grad_rate_lower", floor,
                               higher_is_worse=False))
    return limits


def _verdict(name: str, points: list[dict], fit_key: str, bound_key: str, tol: float,
             *, higher_is_worse: bool) -> dict:
    """Largest intake whose bound stays within ``tol`` with every smaller intake passing too."""
    def ok(p):
        return p[bound_key] <= tol if higher_is_worse else p[bound_key] >= tol

    max_intake = None
    first_fail = None
    for p in points:
        if ok(p):
            max_intake = p["intake"]
        else:
            first_fail = p["intake"]
            break
    status = "ok"
    if max_intake is None:
        fit_ok = (points[0][fit_key] <= tol) if higher_is_worse else (points[0][fit_key] >= tol)
        status = "imprecise" if fit_ok else "infeasible"
    # Precision warning: the confidence margin where the decision is made (the last passing
    # intake, or the first one tested) is more than half the limit — more seeds would firm it up.
    at = next((p for p in points if p["intake"] == max_intake), points[0])
    margin_wide = bool(tol) and abs(at[bound_key] - at[fit_key]) > 0.5 * abs(tol)
    return {
        "name": name,
        "label": _LIMIT_LABELS[name],
        "tolerance": tol,
        "max_intake": max_intake,
        "first_failing_intake": first_fail,
        "status": status,
        "value_at_min": points[0][fit_key],
        "precision_warning": margin_wide,
    }


def recommend(points: list[dict], limits: list[dict]) -> dict:
    """Combine per-limit verdicts into the view's recommendation (pure; unit-tested)."""
    if not limits:
        return {"recommended_intake": None, "binding_limit": None, "feasible": False}
    infeasible = [l for l in limits if l["max_intake"] is None]
    if infeasible:
        binding = infeasible[0]
        return {"recommended_intake": None, "binding_limit": binding["name"], "feasible": False}
    binding = min(limits, key=lambda l: l["max_intake"])
    return {"recommended_intake": binding["max_intake"], "binding_limit": binding["name"], "feasible": True}


def diminishing_returns(points: list[dict], threshold: float,
                        other_intake: int = 0) -> tuple[int | None, list[dict]]:
    """First intake beyond which each extra admitted student adds fewer than ``threshold``
    graduates per year, measured on the (monotone-smoothed) steady-state graduation rate.
    ``other_intake`` is the fixed yearly intake outside the primary season (e.g. Spring)."""
    if len(points) < 2:
        return None, []
    short = [1 - p["grad_rate"] for p in points]
    weights = [1.0 / max(p["grad_se"], 1e-4) ** 2 for p in points]
    fitted, _ = isotonic_increasing(short, weights)
    marginal = []
    upper = None
    for i in range(len(points) - 1):
        n1, n2 = points[i]["intake"], points[i + 1]["intake"]
        g1, g2 = 1 - fitted[i], 1 - fitted[i + 1]
        m = ((n2 + other_intake) * g2 - (n1 + other_intake) * g1) / (n2 - n1)
        marginal.append({"from": n1, "to": n2, "graduates_per_extra_student": m})
        if upper is None and m < threshold:
            upper = n1
    return upper, marginal


# ------------------------------------------------------------------ #
# Runner                                                              #
# ------------------------------------------------------------------ #

ProgressFn = Callable[[float, str], None]
CancelFn = Callable[[], bool]


class _Runner:
    """Holds the pool + progress bookkeeping for one analysis job."""

    def __init__(self, pool, progress: ProgressFn | None, cancel: CancelFn | None):
        self.pool = pool
        self.progress = progress or (lambda f, note: None)
        self.cancel = cancel or (lambda: False)
        self.runs = 0
        self._lo = 0.0
        self._hi = 1.0
        self._note = ""

    def phase(self, lo: float, hi: float, note: str) -> None:
        self._lo, self._hi, self._note = lo, hi, note
        self.progress(lo, note)

    def run(self, tasks: list[dict]) -> list[dict]:
        out = []
        total = len(tasks) or 1
        for i, res in enumerate(iter_ordered(_run_task, tasks, self.pool), start=1):
            if self.cancel():
                terminate_pool(self.pool)  # stop in-flight simulations now, not after they finish
                raise AnalysisCancelled()
            out.append(res)
            self.runs += 1
            if i == total or i % 5 == 0:
                self.progress(self._lo + (self._hi - self._lo) * i / total, self._note)
        return out


@dataclass
class _Views:
    """Run layouts for the two views."""
    curriculum: dict
    config: dict
    params: dict
    incumbents: list[tuple[int, str]]

    def next_task(self, n: int, seed: int, scenario: dict | None = None, *, want_demand: bool = False,
                  curriculum: dict | None = None) -> dict:
        p = self.params
        measured = list(range(int(p["next_measured"])))
        cohorts = len(measured) + int(p["successor_intakes"])
        sizes = [s for s, _ in self.incumbents]
        real = [-(i + 1) for i, (_, src) in enumerate(self.incumbents) if src == "entered"]
        return {
            "curriculum": curriculum or self.curriculum,
            "config": _config_for_intake(self.config, n, cohorts, num_incumbents=0, seed=seed),
            "scenario": scenario or {"name": "intake"},
            "incumbent_sizes": sizes,
            "measured": measured,
            "current_ids": real or [-(i + 1) for i in range(len(sizes))],
            "want_demand": want_demand,
        }

    def steady_task(self, n: int, seed: int, scenario: dict | None = None, *, want_demand: bool = False,
                    curriculum: dict | None = None, measured: str | list | None = None) -> dict:
        p = self.params
        history = int(p["min_history_years"]) * _seasons_per_year(self.config)
        return {
            "curriculum": curriculum or self.curriculum,
            "config": _config_for_intake(self.config, n, int(p["steady_cohorts"]),
                                         num_incumbents=history, seed=seed),
            "scenario": scenario or {"name": "intake"},
            "incumbent_sizes": None,
            "measured": measured if measured is not None else list(range(int(p["steady_measured"]))),
            "current_ids": None,
            "want_demand": want_demand,
        }


def _reference(runner: _Runner, views: _Views, seeds: list[int], curriculum: dict | None = None) -> dict:
    n_ref = int(views.params["reference_intake"])
    tasks = [views.steady_task(n_ref, s, {"name": "reference", "unlimited_seats": "all"},
                               curriculum=curriculum, measured="all") for s in seeds]
    ref = estimate_reference(runner.run(tasks))
    if ref["denials"]:
        raise RuntimeError("unlimited-seat reference recorded seat denials; the reference is invalid")
    return ref


def _sweep(runner: _Runner, views: _Views, view: str, grid: list[int], seeds: list[int],
           rows: dict[int, list[dict]], curriculum: dict | None = None) -> None:
    make = views.next_task if view == "next" else views.steady_task
    tasks, keys = [], []
    for n in grid:
        for s in seeds:
            tasks.append(make(n, s, curriculum=curriculum))
            keys.append(n)
    for n, res in zip(keys, runner.run(tasks)):
        rows.setdefault(n, []).append(res)


def _points(rows: dict[int, list[dict]], other_intake: int) -> list[dict]:
    return [_summarize_point(n, rows[n], other_intake) for n in sorted(rows)]


def _refine_targets(limits: list[dict], grid_points: list[int], step: int) -> tuple[list[int], list[int]]:
    """New intakes to add inside each limit's crossing bracket, and existing ones to top up."""
    new, top_up = set(), set()
    existing = set(grid_points)
    for lim in limits:
        if lim["status"] == "imprecise":
            top_up.update(grid_points[:2])
            continue
        lo, hi = lim["max_intake"], lim["first_failing_intake"]
        if lo is None or hi is None:
            continue
        top_up.update({lo, hi})
        n = lo + step
        while n < hi:
            if n not in existing:
                new.add(n)
            n += step
    return sorted(new), sorted(top_up - new)


# Intakes evaluated per batch of the coarse sweep. Batching lets the sweep stop once every limit
# has clearly failed — the high intakes are both the most expensive to simulate (crowded,
# delayed students stay longer) and the least informative.
_BATCH_INTAKES = 4
_STOP_AFTER_FAILED = 2


def _clearly_failed(points: list[dict], limits: list[dict]) -> bool:
    """Every limit has failed and its *fitted* value is past the limit at the last few points."""
    if not limits or len(points) < _STOP_AFTER_FAILED:
        return False
    tail = points[-_STOP_AFTER_FAILED:]
    for lim in limits:
        if lim["first_failing_intake"] is None:
            return False
        name = lim["name"]
        if name == "min_grad_rate":
            if not all(p["grad_rate_fit"] < lim["tolerance"] for p in tail):
                return False
        elif not all(p[f"{name}_fit"] > lim["tolerance"] for p in tail):
            return False
    return True


def _evaluate_view(runner, views, view, grid, seeds, extra_seeds, params, policy, reference,
                   other_intake, curriculum=None, refine=True, need_upper=False):
    """Coarse sweep in ascending batches (stopping early once every limit has clearly failed —
    and, for the steady view, the diminishing-returns point has been passed), then an optional
    refine pass inside each limit's crossing bracket."""
    rows: dict[int, list[dict]] = {}
    lo, hi = runner._lo, runner._hi
    batches = [grid[i:i + _BATCH_INTAKES] for i in range(0, len(grid), _BATCH_INTAKES)]
    coarse_share = 0.75 if refine and extra_seeds else 1.0
    points: list[dict] = []
    limits: list[dict] = []
    for k, batch in enumerate(batches):
        runner.phase(lo + (hi - lo) * coarse_share * k / len(batches),
                     lo + (hi - lo) * coarse_share * (k + 1) / len(batches), runner._note)
        _sweep(runner, views, view, batch, seeds, rows, curriculum)
        points = _points(rows, other_intake)
        limits = _apply_limits(points, reference, policy)
        done = _clearly_failed(points, limits)
        if done and need_upper:
            upper, _ = diminishing_returns(points, float(params["diminishing_returns"]), other_intake)
            done = upper is not None and sum(1 for p in points if p["intake"] > upper) >= _STOP_AFTER_FAILED
        if done:
            break
    if refine and extra_seeds:
        runner.phase(lo + (hi - lo) * coarse_share, hi, runner._note)
        new, top_up = _refine_targets(limits, [p["intake"] for p in points], int(params["refine_step"]))
        if new:
            _sweep(runner, views, view, new, seeds + extra_seeds, rows, curriculum)
        if top_up:
            _sweep(runner, views, view, top_up, extra_seeds, rows, curriculum)
        if new or top_up:
            points = _points(rows, other_intake)
            limits = _apply_limits(points, reference, policy)
    return points, limits


def _why(rec: dict, limits: list[dict], points: list[dict]) -> str:
    by_name = {l["name"]: l for l in limits}
    binding = by_name.get(rec["binding_limit"]) if rec["binding_limit"] else None
    if binding is None:
        return ""
    name = binding["name"]
    if not rec["feasible"]:
        if binding["status"] == "imprecise":
            return (f"The {binding['label']} can't be confirmed at any tested intake: the estimate is "
                    f"within the limit but too uncertain. Run again with more seeds.")
        if name == "min_grad_rate":
            return (f"Even at {points[0]['intake']} students the graduation rate is "
                    f"{binding['value_at_min']:.1f}%, below the {binding['tolerance']:g}% floor.")
        return (f"Even at {points[0]['intake']} students, seat shortages already cost "
                f"{binding['value_at_min']:.1f} pts of {binding['label'].replace(' limit', '')} "
                f"(limit {binding['tolerance']:g} pts): today's students and other programs already fill these seats.")
    fail_n = binding["first_failing_intake"]
    if fail_n is None:
        return f"Every tested intake up to {points[-1]['intake']} stays within the {binding['label']}."
    at = next((p for p in points if p["intake"] == fail_n), None)
    course = at["top_courses"][0]["code"] if at and at["top_courses"] else None
    tail = f", mainly because {course} runs out of seats" if course else ""
    if at is None or name == "min_grad_rate":
        return f"Above {binding['max_intake']} students the {binding['label']} is no longer met{tail}."
    fit, upper, tol = at[f"{name}_fit"], at[f"{name}_upper"], binding["tolerance"]
    what = "graduation" if name == "grad_rate_loss" else "on-time graduation"
    if fit > tol:
        return f"At {fail_n} students seat shortages cost about {fit:.1f} pts of {what} (limit {tol:g}){tail}."
    return (f"At {fail_n} students seat shortages could cost up to {upper:.1f} pts of {what} "
            f"(limit {tol:g}; best estimate {fit:.1f}){tail}.")


def data_quality(config: dict, curriculum: dict) -> dict:
    """Which inputs are QU data vs estimates — surfaced on every result."""
    sources = config.get("data_sources") or {}
    codes = list(curriculum)

    def share(key: str) -> dict:
        tagged = sources.get(key) or {}
        qu = sum(1 for c in codes if tagged.get(c) == "qu")
        return {"qu": qu, "estimate": len(codes) - qu, "total": len(codes)}

    entries = (config.get("current_students") or {}).get("past_intakes") or []
    real_intakes = sum(1 for e in entries if int(e.get("size", 0)) > 0)
    cap, pr = share("capacity"), share("pass_rate")
    occupancy_src = sources.get("occupancy", "estimate")
    illustrative = (cap["qu"] < cap["total"] / 2 or pr["qu"] < pr["total"] / 2 or real_intakes == 0)
    return {
        "capacity": cap,
        "pass_rate": pr,
        "past_intakes": {"entered": real_intakes, "source": sources.get("past_intakes", "estimate")},
        "occupancy": occupancy_src,
        "as_of": (config.get("planning") or {}).get("data_as_of"),
        "illustrative": illustrative,
    }


def calibration_check(steady_points: list[dict], next_points: list[dict], config: dict) -> dict | None:
    """Compare simulated outcomes at the department's usual intake with what it knows happened."""
    hist = config.get("historical_outcomes") or {}
    entries = (config.get("current_students") or {}).get("past_intakes") or []
    real = [int(e["size"]) for e in entries if int(e.get("size", 0)) > 0]
    usual = round(statistics.fmean(real)) if real else int(config["cohort_size"])
    if not steady_points:
        return None
    at = min(steady_points, key=lambda p: abs(p["intake"] - usual))
    checks = []
    n_hist = int(hist.get("n_students") or usual)
    for key, sim_key, se_key, label in [
        ("grad_rate_6yr", "grad_rate", "grad_se", "Graduation within 6 years"),
        ("on_time_rate_4yr", "on_time_rate", "on_time_se", "On-time graduation (4 years)"),
    ]:
        actual = hist.get(key)
        if actual is None:
            continue
        sim = at[sim_key]
        p = float(actual)
        allowed = 2 * math.sqrt(p * (1 - p) / max(n_hist, 1) + at[se_key] ** 2)
        checks.append({"name": key, "label": label, "actual": p, "simulated": sim,
                       "gap": sim - p, "allowed_gap": allowed, "flag": abs(sim - p) > allowed})
    headcount = hist.get("current_headcount")
    if headcount and next_points and "headcount_at_start" in next_points[0]:
        sim = next_points[0]["headcount_at_start"]
        actual = float(headcount)
        checks.append({"name": "current_headcount", "label": "Students enrolled today", "actual": actual,
                       "simulated": sim, "gap": sim - actual, "allowed_gap": 0.1 * actual,
                       "flag": abs(sim - actual) > 0.1 * actual})
    if not checks:
        return {"usual_intake": usual, "checks": [], "note": "Enter historical outcomes to check the model."}
    flagged = [c for c in checks if c["flag"]]
    note = ("The model matches what the department has seen." if not flagged else
            "The model is off on: " + ", ".join(c["label"] for c in flagged)
            + ". Check the pass rates and dropout settings before relying on the number.")
    return {"usual_intake": usual, "checks": checks, "note": note}


def _robustness(runner, views, rec_n, next_points, params, policy, reference, section, other_intake, seeds):
    """Re-run the decision under (a) one fewer section in each tight course and (b) pass rates
    5 pts lower, on a window of intakes around the recommendation."""
    step = int(params["grid_step"])
    window = [n for n in range(max(int(params["grid_min"]), rec_n - 4 * step), rec_n + step + 1, step)]
    at = next((p for p in next_points if p["intake"] == rec_n), next_points[0])
    tight = [c["code"] for c in at["top_courses"][:3]]
    out = {"window": window, "tight_courses": tight}

    cur = views.curriculum
    fewer = {code: (dataclasses.replace(c, capacity=max(section, c.capacity - section))
                    if code in tight and c.capacity > section else c) for code, c in cur.items()}
    harder = {code: dataclasses.replace(c, pass_rate=max(0.05, round(c.pass_rate - 0.05, 4)))
              for code, c in cur.items()}

    for key, curriculum, needs_ref in [("fewer_sections", fewer, False), ("lower_pass_rates", harder, True)]:
        ref = _reference(runner, views, spaced_seeds(params["base_seed"] + 7, max(2, int(params["reference_runs"]) // 2)),
                         curriculum) if needs_ref else reference
        rows: dict[int, list[dict]] = {}
        _sweep(runner, views, "next", window, seeds, rows, curriculum)
        pts = _points(rows, other_intake)
        lims = _apply_limits(pts, ref, policy)
        r = recommend(pts, lims)
        out[key] = r["recommended_intake"]
        out[f"{key}_below_window"] = r["recommended_intake"] is None
    # The range spans every variant in both directions (a harsher input can move the answer up
    # as well as down — e.g. lower pass rates thin out later cohorts and ease crowding).
    candidates = [rec_n] + [out[k] for k in ("fewer_sections", "lower_pass_rates") if out[k] is not None]
    if out["fewer_sections_below_window"] or out["lower_pass_rates_below_window"]:
        candidates.append(window[0])
    out["range"] = [min(candidates), max(candidates)]
    return out


def run_intake_sweep(
    curriculum: dict,
    config: dict,
    *,
    policy: IntakePolicy | None = None,
    params_override: dict | None = None,
    workers: int | None = None,
    progress: ProgressFn | None = None,
    cancel: CancelFn | None = None,
) -> dict:
    """The full intake analysis. Returns a JSON-ready dict (see module docstring)."""
    started = time.time()
    params = analysis_params(config, params_override)
    policy = policy or policy_from_config(config)
    section = section_size(config)
    grid = intake_grid(params)
    seeds = spaced_seeds(params["base_seed"], int(params["seeds"]))
    extra_seeds = spaced_seeds(params["base_seed"], int(params["refine_seeds"]))[len(seeds):]
    # The steady view measures four cohorts per run (vs two), so fewer replications give it the
    # same precision; robustness is a range, not a verdict, so it gets fewer still.
    steady_seeds = seeds[:int(params["steady_seeds"])]
    robust_seeds = seeds[:int(params["robustness_seeds"])]
    other_intake = _other_season_intake(config)
    incumbents = resolve_incumbent_sizes(config, int(params["min_history_years"]))
    views = _Views(curriculum, config, params, incumbents)
    n_workers = resolve_workers(len(grid) * len(seeds), requested=workers)

    with make_pool(n_workers) as pool:
        runner = _Runner(pool, progress, cancel)
        runner.phase(0.0, 0.06, "Estimating the no-shortage reference")
        reference = _reference(runner, views, spaced_seeds(params["base_seed"] + 1, int(params["reference_runs"])))

        runner.phase(0.06, 0.5, "Testing intakes with today's student body")
        next_points, next_limits = _evaluate_view(runner, views, "next", grid, seeds, extra_seeds, params,
                                                  policy, reference, other_intake)
        runner.phase(0.5, 0.85, "Testing intakes as a long-run standard")
        steady_points, steady_limits = _evaluate_view(runner, views, "steady", grid, steady_seeds, [], params,
                                                      policy, reference, other_intake, refine=False,
                                                      need_upper=True)

        next_rec = recommend(next_points, next_limits)
        steady_rec = recommend(steady_points, steady_limits)
        upper, marginal = diminishing_returns(steady_points, float(params["diminishing_returns"]), other_intake)

        robustness = None
        if params.get("robustness") and next_rec["recommended_intake"] is not None:
            runner.phase(0.85, 1.0, "Checking how sensitive the number is")
            robustness = _robustness(runner, views, next_rec["recommended_intake"], next_points, params,
                                     policy, reference, section, other_intake, robust_seeds)
        runner.progress(1.0, "Done")
        runs = runner.runs

    warnings = []
    rec_n, sus_n = next_rec["recommended_intake"], steady_rec["recommended_intake"]
    if rec_n is not None and sus_n is not None and rec_n > sus_n:
        warnings.append(f"You could take {rec_n} once, but only {sus_n} is sustainable every year.")
    if rec_n is not None and sus_n is not None and rec_n < sus_n:
        warnings.append(f"In the long run {sus_n} a year is sustainable; the lower number now is because "
                        f"today's students (from past intakes) already crowd the seats.")
    if rec_n is not None and upper is not None and rec_n > upper:
        warnings.append(f"The recommendation is above the point ({upper}) where extra students stop "
                        f"adding graduates.")
    if any(l["precision_warning"] for l in next_limits):
        warnings.append("Some estimates are imprecise; increase the number of seeds for a firmer answer.")
    binding_point = None
    binding = next((l for l in next_limits if l["name"] == next_rec["binding_limit"]), None)
    if binding and binding["first_failing_intake"] is not None:
        binding_point = next((p for p in next_points if p["intake"] == binding["first_failing_intake"]), None)
    if binding_point and binding_point["summer_denial_share"] > 0.5:
        warnings.append(f"Most seat denials at {binding_point['intake']} happen in Summer catch-up terms, "
                        f"which regular sections only partly relieve.")
    quality = data_quality(config, curriculum)
    if quality["illustrative"]:
        warnings.append("Most inputs are still estimates — treat this result as illustrative.")
    if any(src == "padded" for _, src in incumbents):
        warnings.append(f"{sum(1 for _, s in incumbents if s == 'padded')} older intakes were estimated "
                        f"to rebuild today's student body.")

    return {
        "analysis_version": ANALYSIS_VERSION,
        "label": (config.get("planning") or {}).get("next_intake_label"),
        "policy": dataclasses.asdict(policy),
        "params": params,
        "section_size": section,
        "reference": reference,
        "history": [{"size": s, "source": src} for s, src in incumbents],
        "views": {
            "next": {"points": next_points, "limits": next_limits, **next_rec},
            "steady": {"points": steady_points, "limits": steady_limits, "marginal": marginal,
                       "upper_limit": upper, **steady_rec},
        },
        "recommendation": {
            "recommended_intake": rec_n,
            "sustainable_intake": sus_n,
            "upper_limit": upper,
            "feasible": next_rec["feasible"],
            "binding_limit": next_rec["binding_limit"],
            "binding_course": (binding_point["top_courses"][0]["code"]
                               if binding_point and binding_point["top_courses"] else None),
            "first_failing_intake": binding["first_failing_intake"] if binding else None,
            "why": _why(next_rec, next_limits, next_points),
            "robustness": robustness,
            "warnings": warnings,
        },
        "calibration": calibration_check(steady_points, next_points, config),
        "data_quality": quality,
        "runs": runs,
        "elapsed_s": round(time.time() - started, 1),
    }


# ------------------------------------------------------------------ #
# Seat plan                                                           #
# ------------------------------------------------------------------ #

def _percentile(values: list[int], p: float) -> float:
    if not values:
        return 0.0
    s = sorted(values)
    k = (len(s) - 1) * p
    lo, hi = math.floor(k), math.ceil(k)
    return s[lo] + (s[hi] - s[lo]) * (k - lo)


def _single_point_check(point: dict, reference: dict, policy: IntakePolicy) -> dict:
    """Policy verdict at one intake (no smoothing): mean loss + one-sided 95% margin."""
    df = max(point["seeds"] - 1, 1)
    t = t_quantile(0.95, df)
    out = {}
    for name, key, se_key, ref, ref_se, tol in [
        ("grad_rate_loss", "grad_rate", "grad_se", reference["grad_rate"], reference["se_grad"],
         policy.max_grad_rate_loss_pts),
        ("on_time_loss", "on_time_rate", "on_time_se", reference["on_time_rate"], reference["se_on_time"],
         policy.max_on_time_loss_pts),
    ]:
        loss = 100 * (ref - point[key])
        upper = loss + t * 100 * math.sqrt(point[se_key] ** 2 + ref_se ** 2)
        out[name] = {"loss": loss, "upper": upper, "tolerance": tol, "met": upper <= tol}
    if policy.min_grad_rate is not None:
        lower = 100 * (point["grad_rate"] - t * point["grad_se"])
        out["min_grad_rate"] = {"value": 100 * point["grad_rate"], "lower": lower,
                                "tolerance": 100 * policy.min_grad_rate,
                                "met": lower >= 100 * policy.min_grad_rate}
    return out


def run_seat_plan(
    curriculum: dict,
    config: dict,
    target_intake: int,
    *,
    policy: IntakePolicy | None = None,
    params_override: dict | None = None,
    run_budget: int = 6,
    workers: int | None = None,
    progress: ProgressFn | None = None,
    cancel: CancelFn | None = None,
) -> dict:
    """Sections each course needs so the policy limits hold at ``target_intake``.

    1. Size from demand: run the target with unlimited regular-term seats and take each course's
       90th-percentile regular-term registrations plus other-program seats, rounded up to whole
       sections (never below today's seats). Sizing from congested shortfalls instead misses
       demand an upstream denial hides downstream.
    2. Verify on both views with real seats; while a limit still fails, add one section to the
       course denying the most students and re-check, up to ``run_budget`` rounds.
    Seats change with ``dataclasses.replace`` (exact integers — no multiplier rounding).
    """
    started = time.time()
    params = analysis_params(config, params_override)
    policy = policy or policy_from_config(config)
    section = section_size(config)
    target = int(target_intake)
    seeds = spaced_seeds(params["base_seed"], int(params["seeds"]))
    demand_seeds = seeds[:10]
    other_intake = _other_season_intake(config)
    incumbents = resolve_incumbent_sizes(config, int(params["min_history_years"]))
    views = _Views(curriculum, config, params, incumbents)
    occupancy = (config.get("initial_state") or {}).get("occupancy") or {}
    run_budget = max(1, min(int(run_budget), 20))

    def evaluate(cur: dict, runner: _Runner) -> dict:
        out = {}
        for view in ("next", "steady"):
            rows: dict[int, list[dict]] = {}
            _sweep(runner, views, view, [target], seeds, rows, cur)
            point = _points(rows, other_intake)[0]
            out[view] = {"point": point, "checks": _single_point_check(point, reference, policy)}
        return out

    def all_met(ev: dict) -> bool:
        return all(c["met"] for v in ev.values() for c in v["checks"].values())

    n_workers = resolve_workers(len(seeds) * 2, requested=workers)
    with make_pool(n_workers) as pool:
        runner = _Runner(pool, progress, cancel)
        runner.phase(0.0, 0.1, "Estimating the no-shortage reference")
        reference = _reference(runner, views, spaced_seeds(params["base_seed"] + 1, int(params["reference_runs"])))

        runner.phase(0.1, 0.3, f"Measuring course demand at {target} students")
        scen = {"name": "demand", "unlimited_seats": "regular"}
        tasks = ([views.next_task(target, s, scen, want_demand=True) for s in demand_seeds]
                 + [views.steady_task(target, s, scen, want_demand=True) for s in demand_seeds])
        demand: dict[str, list[int]] = {}
        for res in runner.run(tasks):
            for code, vals in res["demand"].items():
                demand.setdefault(code, []).extend(vals)

        planned = dict(curriculum)
        for code, course in curriculum.items():
            need = _percentile(demand.get(code, []), 0.9) + int(occupancy.get(code, 0))
            seats = int(math.ceil(need / section) * section) if need > 0 else 0
            if seats > course.capacity:
                planned[code] = dataclasses.replace(course, capacity=seats)

        runner.phase(0.3, 0.45, "Checking today's seats")
        before = evaluate(curriculum, runner)
        trace = []
        rounds = 0
        after = None
        while True:
            runner.phase(0.45 + 0.5 * rounds / run_budget, 0.45 + 0.5 * (rounds + 1) / run_budget,
                         "Checking the proposed seats")
            after = evaluate(planned, runner)
            rounds += 1
            if all_met(after) or rounds >= run_budget:
                break
            failing = next(v for v in ("next", "steady") if not all(c["met"] for c in after[v]["checks"].values()))
            top = after[failing]["point"]["top_courses"]
            if not top:
                trace.append({"round": rounds, "action": "no course is short of seats; the limit isn't seat-driven"})
                break
            code = top[0]["code"]
            planned[code] = dataclasses.replace(planned[code], capacity=planned[code].capacity + section)
            trace.append({"round": rounds, "action": "add section", "course": code,
                          "to": planned[code].capacity})
        runner.progress(1.0, "Done")
        runs = runner.runs

    changes = []
    for code, course in curriculum.items():
        new = planned[code].capacity
        if new != course.capacity:
            added = new - course.capacity
            changes.append({"code": code, "title": course.title, "current": course.capacity,
                            "recommended": new, "seats_added": added,
                            "sections_added": math.ceil(added / section)})
    changes.sort(key=lambda c: -c["seats_added"])

    def strip(ev: dict) -> dict:
        return {v: {"grad_rate": ev[v]["point"]["grad_rate"], "on_time_rate": ev[v]["point"]["on_time_rate"],
                    "avg_time_to_degree": ev[v]["point"]["avg_time_to_degree"],
                    "denials_per_student": ev[v]["point"]["denials_per_student"],
                    "checks": ev[v]["checks"]} for v in ev}

    return {
        "analysis_version": ANALYSIS_VERSION,
        "target_intake": target,
        "section_size": section,
        "feasible": all_met(after),
        "changes": changes,
        "total_seats_added": sum(c["seats_added"] for c in changes),
        "total_sections_added": sum(c["sections_added"] for c in changes),
        "before": strip(before),
        "after": strip(after),
        "reference": reference,
        "trace": trace,
        "runs": runs,
        "elapsed_s": round(time.time() - started, 1),
        "note": ("Seats sized from demand at the target intake, then checked against the policy limits "
                 "with real seats. Sections and seats change every semester; re-run when the schedule changes."),
    }
