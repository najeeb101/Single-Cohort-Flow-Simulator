"""Auto-calibrate each course's per-term seat `capacity`.

Real universities don't staff for their single worst-ever term — they staff for typical
load, so popular/gateway courses fill up and run short during enrolment bulges. This script
mirrors that: it sizes each course to a **demand percentile** (`DEMAND_PERCENTILE`, default
0.75) of the per-term enrolment it would see if seats were unconstrained, then writes the
result directly into `data/curriculum.json` as that course's `capacity`.

Sizing to a percentile below 1.0 deliberately leaves capacity binding during the bulge terms
when several cohorts collide, so the `capacity_block` signal becomes a real bottleneck. This
is only safe where a blocked student can just retake next term (half a year of delay).

**Only electives (`cs_elective`) are squeezed to the percentile; everything else — the whole
cs_core critical path and all non-CS courses — is sized to peak demand.** Electives are the one
genuinely flexible group (4 interchangeable slots, no prerequisites), so scarcity there only
redistributes across them. The required cs_core sequence is different: because several upper
courses are offered only once a year (Fall-only / Spring-only), a missed seat in an *early*
gateway (CMPS251/CMPS303/CMPE263/...) knocks a student off the annual rhythm, so they reach a
once-a-year upper course off-cycle and lose a *full* year — which compounds into
non-completion (CENSORED), not just delay. Under-provisioning the required sequence and running
half its upper courses once a year are jointly incompatible, so the sequence is sized to
actually seat its cohort and the deliberate scarcity lives on electives.

After running once you have concrete, hand-tunable integers per course — bump CMPS303's
capacity to open more seats, etc. Re-run whenever the curriculum or cohort plan changes.

    py scripts/size_capacity.py
"""
from __future__ import annotations

import copy
import json
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from src.models.course import load_curriculum
from src.models.semester import get_mandatory_seasons
from src.simulator import Simulator
from src.utils import load_json

CONFIG_PATH = Path("data/simulation_config.json")
CURRIC_PATH = Path("data/curriculum.json")

DEMAND_PERCENTILE = 0.75

# A real registrar doesn't open exactly N seats — they open whole class sections and each
# course's capacity lands on a multiple of its typical section size. Rounding each course's
# demand up to the nearest SEAT_INCREMENT reproduces that realistic slack (it's also the
# buffer the model's other calibrated constants, e.g. dropout_base_hazard, were tuned against
# — see docs/assumptions.md — so changing it shifts the graduation rate even though nothing
# else did).
SEAT_INCREMENT = 35

# Display-only: which categories get the "CS" tag in the printed summary below. (The squeeze
# itself now keys on `cs_elective` alone — see target() in main().)
CS_CATEGORIES = frozenset({"cs_core", "cs_elective"})


def _percentile(values: list[int], p: float) -> float:
    """Linear-interpolation percentile of a list (p in [0, 1])."""
    if not values:
        return 0.0
    vals = sorted(values)
    k = (len(vals) - 1) * p
    lo, hi = math.floor(k), math.ceil(k)
    if lo == hi:
        return float(vals[lo])
    return vals[lo] + (vals[hi] - vals[lo]) * (k - lo)


def demand_per_course(curriculum, config) -> tuple[dict[str, float], dict[str, int]]:
    """Run with effectively unlimited seats so `registered` reflects true demand, then for
    each course return (percentile demand, peak demand) over the terms it was actually
    demanded. Only terms where the course is offered and has non-zero demand count, so a
    course taught every term but wanted in few of them isn't dragged toward zero.

    Restricted to mandatory-season (Fall/Spring) frames: this sizes *regular*-term capacity,
    so optional-term (Summer/Winter) demand — much smaller and separately scaled via
    `optional_term_capacity_scale` — must not dilute this percentile. See CLAUDE.md's
    "Term/Season Model".

    The calibration run also drops `terms_per_year`/`mandatory_terms` entirely (pure legacy
    2-season simulation), not just the post-hoc frame filter above: the "blow up capacity"
    trick below only inflates the *regular* capacity, so if optional terms still existed
    here, their capacity would stay small while everything else is artificially unlimited —
    demand would leak into those comparatively-attractive optional terms instead of showing
    up as real mandatory-term peak demand, systematically under-sizing capacity.
    """
    cfg = copy.deepcopy(config)
    cfg.pop("terms_per_year", None)      # remove optional terms entirely, see above
    cfg.pop("mandatory_terms", None)
    scenario = {"name": "calibration", "capacity_multiplier": 1000.0}  # ...then blow it up
    result = Simulator(curriculum, cfg, scenario).run()
    mandatory_seasons = get_mandatory_seasons(cfg)

    series: dict[str, list[int]] = {code: [] for code in curriculum}
    for frame in result.history.timeline:
        if frame["season"] not in mandatory_seasons:
            continue
        for code, st in frame["courses"].items():
            if st["offered"] and st["registered"] > 0:
                series[code].append(st["registered"])

    sized = {code: _percentile(series[code], DEMAND_PERCENTILE) for code in curriculum}
    peak = {code: (max(series[code]) if series[code] else 0) for code in curriculum}
    return sized, peak


def main() -> None:
    config = load_json(CONFIG_PATH)
    curriculum = load_curriculum(CURRIC_PATH)

    sized, peak = demand_per_course(curriculum, config)
    # Only **electives** are squeezed to the percentile; everything else (cs_core + all non-CS)
    # is sized to peak demand. The squeeze's whole premise is that missing a seat "mostly adds
    # delay" — a blocked student retries next term (half a year). That holds for interchangeable
    # electives (4 slots, no prerequisites: scarcity just redistributes across them), but it
    # breaks for the cs_core critical path once upper courses are offered only once a year:
    # a missed seat in an early gateway (CMPS251/CMPS303/...) knocks a student off the annual
    # rhythm, so they reach a Fall-only or Spring-only upper course off-cycle and lose a *full*
    # year, which cascades into non-completion (CENSORED), not just delay. So the required
    # sequence must be sized to actually seat its cohort; deliberate scarcity lives on electives.
    def target(code: str) -> float:
        return sized[code] if curriculum[code].category == "cs_elective" else peak[code]
    capacities = {
        code: max(SEAT_INCREMENT, math.ceil(target(code) / SEAT_INCREMENT) * SEAT_INCREMENT)
        for code in curriculum
    }

    with open(CURRIC_PATH, encoding="utf-8") as f:
        curric_json = json.load(f)
    for entry in curric_json:
        entry["capacity"] = capacities[entry["code"]]
    with open(CURRIC_PATH, "w", encoding="utf-8") as f:
        json.dump(curric_json, f, indent=2)
        f.write("\n")

    print(f"Calibrated capacity (CS demand percentile = {DEMAND_PERCENTILE:.0%}, non-CS = peak):\n")
    for code in sorted(capacities, key=lambda c: -capacities[c]):
        cap = capacities[code]
        tag = "CS " if curriculum[code].category in CS_CATEGORIES else "   "
        print(f"  {tag}{code:10s} capacity {cap:4d}   "
              f"(p{DEMAND_PERCENTILE*100:.0f} demand {sized[code]:.0f}, peak {peak[code]})")
    print(f"\nWrote per-course capacity to {CURRIC_PATH}")
    print("Run `py scripts/migrate_json_to_db.py --force` to push these into the default plan.")


if __name__ == "__main__":
    main()
