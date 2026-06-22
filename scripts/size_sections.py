"""Auto-calibrate the number of sections per course.

Real universities open a fixed number of *sections* per course (each holding
`seats_per_section` students) and add/cut them as demand changes. They do NOT staff for
their single worst-ever term — they staff for typical load, so popular/gateway courses
fill up and run short during enrolment bulges. This script mirrors that: it sizes each
course to a **demand percentile** (`section_demand_percentile`, default 0.75) of the
per-term enrolment it would see if seats were unconstrained, then writes the result into
`data/simulation_config.json` as `course_sections`.

Sizing to a percentile below 1.0 deliberately leaves capacity binding during the bulge
terms when several cohorts collide on a gateway (e.g. CMPS303), so the `capacity_block`
signal becomes a real bottleneck. Because the study horizon is long (12 semesters), a
blocked student usually just takes the course a term later, so this mostly adds *delay*
rather than non-completion — graduation stays near the QU 72.3% benchmark.

Only **CS courses** (`cs_core`, `cs_elective`) are sized to the percentile; non-CS courses
(math/science/english/gen-ed) are sized to their full peak so they never bind. That focuses
all seat scarcity on the CS major's own specialist-taught courses — which are the genuinely
section-limited ones in reality — instead of on university-wide gen-ed offerings.

After running once you have concrete, hand-tunable integers per course — bump CMPS303 from
N to N+1 to "open another section", etc. Re-run whenever the curriculum or cohort plan changes.

    py scripts/size_sections.py
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

# Only these categories are squeezed to the demand percentile; everything else is sized
# to its full peak so non-CS courses never become the capacity bottleneck.
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


def demand_per_course(curriculum, config, percentile: float) -> tuple[dict[str, float], dict[str, int]]:
    """Run with effectively unlimited seats so `registered` reflects true demand, then for
    each course return (percentile demand, peak demand) over the terms it was actually
    demanded. Only terms where the course is offered and has non-zero demand count, so a
    course taught every term but wanted in few of them isn't dragged toward zero.

    Restricted to mandatory-season (Fall/Spring) frames: `course_sections` sizes *regular*-term
    capacity, so optional-term (Summer/Winter) demand — much smaller and separately modeled via
    `optional_term_course_sections` — must not dilute this percentile. See CLAUDE.md's
    "Term/Season Model".

    The calibration run also drops `terms_per_year`/`mandatory_terms` entirely (pure legacy
    2-season simulation), not just the post-hoc frame filter above: the "blow up capacity"
    trick below only inflates the *regular* section map, so if optional terms still existed
    here, their capacity would stay small while everything else is artificially unlimited —
    demand would leak into those comparatively-attractive optional terms instead of showing
    up as real mandatory-term peak demand, systematically under-sizing course_sections.
    """
    cfg = copy.deepcopy(config)
    cfg["course_sections"] = {}          # use fallback sizing...
    cfg.pop("terms_per_year", None)      # ...and remove optional terms entirely, see above
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

    sized = {code: _percentile(series[code], percentile) for code in curriculum}
    peak  = {code: (max(series[code]) if series[code] else 0) for code in curriculum}
    return sized, peak


def main() -> None:
    config = load_json(CONFIG_PATH)
    curriculum = load_curriculum(CURRIC_PATH)
    sps = int(config.get("seats_per_section", 35))
    percentile = float(config.get("section_demand_percentile", 0.75))

    sized, peak = demand_per_course(curriculum, config, percentile)
    # CS courses are squeezed to the percentile; non-CS courses keep their full peak.
    def target(code: str) -> float:
        return sized[code] if curriculum[code].category in CS_CATEGORIES else peak[code]
    sections = {code: max(1, math.ceil(target(code) / sps)) for code in curriculum}

    config["course_sections"] = {c: sections[c] for c in sorted(sections)}
    config.pop("capacity_scale", None)  # retire the old global knob if present
    with open(CONFIG_PATH, "w", encoding="utf-8") as f:
        json.dump(config, f, indent=2)

    print(f"Calibrated sections (seats_per_section = {sps}, "
          f"CS demand percentile = {percentile:.0%}, non-CS = peak):\n")
    total_seats = 0
    for code in sorted(sections, key=lambda c: -sections[c]):
        s = sections[code]
        total_seats += s * sps
        tag = "CS " if curriculum[code].category in CS_CATEGORIES else "   "
        print(f"  {tag}{code:10s} {s:2d} sections = {s * sps:4d} seats   "
              f"(p{percentile*100:.0f} demand {sized[code]:.0f}, peak {peak[code]})")
    print(f"\nTotal section-seats per term across all courses: {total_seats}")
    print(f"Wrote course_sections to {CONFIG_PATH}")


if __name__ == "__main__":
    main()
