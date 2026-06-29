"""Phase 3: live, stepwise simulation via deterministic REPLAY (no fragile state
serialization). See CLAUDE.md and the API layer (src/api.py's /livesim routes) for the
product-level contract; this module is purely the engine seam.

A live simulation is: one base `(curriculum, base_config, base_scenario)` triple plus an
append-only, ordered list of edits — `{"effective_from_term": int, "patch": {...}}`. Each
edit's patch may set any of `course_sections`, `pass_rate_overrides`, `offering_overrides`,
`cohort_size`, `capacity_overrides`. "Advancing" the live sim to term N means: replay the
engine from term 0, applying every edit whose `effective_from_term <= t` as of each term
`t`, then take term N's frame. Because edits only ever apply forward and are never mutated
in place, replaying to term N reproduces terms 0..N-1 byte-identically to any earlier
replay that already passed through them — this is the whole basis for snapshots staying
valid as more edits accumulate (see tests/test_livesim.py's determinism tests).

`LiveRunner` doesn't persist anything itself — `src/api.py` owns the DB rows
(`LiveSimulation`/`LiveTermSnapshot`); this module only knows how to turn
`(curriculum, base_config, base_scenario, edits)` into a list of timeline frames.
"""
from __future__ import annotations

import copy
from dataclasses import dataclass

from src.datasource import CohortSpec, DataSource, SyntheticDataSource
from src.models.course import Course
from src.models.semester import effective_admit_interval_terms, mandatory_horizon_end_term, term_season
from src.models.student import Student
from src.simulator import Simulator

# The only config keys a live-sim edit patch is allowed to touch. `course_sections`/
# `cohort_size` land in the working `config`; the rest land in the working `scenario` (see
# CLAUDE.md's Capacity Planning Model / Scenarios sections for what each one means to the
# engine). Anything else in a patch dict is ignored rather than erroring, so a slightly
# over-eager frontend payload (e.g. accidentally including an unrelated key) degrades
# gracefully instead of breaking a live sim mid-run.
CONFIG_PATCH_KEYS = ("course_sections", "cohort_size")
SCENARIO_PATCH_KEYS = ("pass_rate_overrides", "offering_overrides", "capacity_overrides")


def _cumulative_patch(edits: list[dict], term_idx: int) -> dict:
    """Shallow-merge every edit's patch whose effective_from_term <= term_idx, in
    ascending effective_from_term order (ties broken by list order) so a later edit's keys
    win over an earlier one's for the same key — "what's the current value of each knob as
    of this term" rather than a deep per-course merge. Each individual map-valued knob
    (`course_sections`, etc.) replaces the prior edit's map wholesale for that key: callers
    that want an incremental change (bump one course's sections) must pass the full
    resulting map, same as the existing /simulate ScenarioRequest contract.
    """
    applicable = sorted(
        (e for e in edits if e.get("effective_from_term", 0) <= term_idx),
        key=lambda e: e.get("effective_from_term", 0),
    )
    merged: dict = {}
    for edit in applicable:
        merged.update(edit.get("patch") or {})
    return merged


def _make_overlay_provider(edits: list[dict]):
    def _provider(term_idx: int) -> tuple[dict, dict]:
        patch = _cumulative_patch(edits, term_idx)
        config_patch = {k: patch[k] for k in CONFIG_PATCH_KEYS if k in patch}
        scenario_patch = {k: patch[k] for k in SCENARIO_PATCH_KEYS if k in patch}
        return config_patch, scenario_patch
    return _provider


class _TimeVaryingCohortDataSource(DataSource):
    """A `SyntheticDataSource` variant where each cohort's *size* reflects whatever
    `cohort_size` was in effect (per `edits`) at that cohort's own entry term — not the
    live-sim's current/base cohort_size. Earlier-admitted cohorts keep the size they were
    actually admitted with even after a later edit changes `cohort_size` going forward;
    only cohorts admitted at or after an edit's `effective_from_term` see the new size.
    Everything else (admission interval, incumbents, seeding) is identical to
    `SyntheticDataSource` — this only overrides how big each cohort spec is.
    """

    def __init__(self, base_config: dict, edits: list[dict]) -> None:
        self._base = SyntheticDataSource(base_config)
        self._base_config = base_config
        self._edits = edits

    def _cohort_size_at(self, entry_term: int) -> int:
        patch = _cumulative_patch(self._edits, entry_term)
        if "cohort_size" in patch:
            return int(patch["cohort_size"])
        return int(self._base_config["cohort_size"])

    def cohort_specs(self) -> list[CohortSpec]:
        specs = self._base.cohort_specs()
        return [
            CohortSpec(cohort_id=s.cohort_id, entry_term=s.entry_term,
                       size=self._cohort_size_at(s.entry_term))
            for s in specs
        ]

    def create_students(self, spec: CohortSpec) -> list[Student]:
        # Student identity (seed + globally-unique id) must stay stable for cohorts whose
        # size never changed — base = (cohort_id + num_incumbents) * BASE cohort_size keeps
        # CRN streams for untouched cohorts byte-identical to a plain SyntheticDataSource
        # run. A resized cohort's own students get fresh ids starting at that same base;
        # this can only collide with a later cohort's id range if cohort_size shrank, which
        # would already change that later cohort's entry composition under any scheme, so
        # there's no meaningfully "more correct" alternative seeding here.
        base = (spec.cohort_id + self._base.num_incumbent_cohorts) * self._base.cohort_size
        return [
            Student(base + i, self._base.seed, cohort_id=spec.cohort_id, entry_term=spec.entry_term)
            for i in range(spec.size)
        ]


@dataclass
class ReplayResult:
    frames: list[dict]
    start_term: int
    end_term: int  # exclusive horizon, i.e. total_terms == end_term
    cohorts: list[dict]


class LiveRunner:
    """Deterministic replay engine for one live simulation.

    `curriculum`/`base_config`/`base_scenario` never change after the live sim is created
    (initial_state included — it lives inside base_config). `edits` is the live sim's
    append-only edit log; pass the *current* full list every time — LiveRunner always
    replays from term 0, it never resumes mid-run state.
    """

    def __init__(self, curriculum: dict[str, Course], base_config: dict, base_scenario: dict) -> None:
        self.curriculum = curriculum
        self.base_config = base_config
        self.base_scenario = base_scenario

    def horizon(self, edits: list[dict] | None = None) -> tuple[int, int]:
        """(start_term, end_term) for this live sim's base config — the engine clock that
        governs Simulator regardless of edits (none of the four edit knobs change the
        cohort admission schedule's interval or max_terms, only sizes/capacity/pass
        rates/offerings), so this can be read directly off base_config without a replay.
        """
        config = self.base_config
        num_cohorts = config.get("num_cohorts", 1)
        num_incumbents = config.get("num_incumbent_cohorts", 0)
        interval = effective_admit_interval_terms(config)
        max_terms = config["max_terms"]
        entry_terms = [c * interval for c in range(num_cohorts)] + [
            -k * interval for k in range(1, num_incumbents + 1)
        ]
        start_term = min(entry_terms)
        end_term = max(mandatory_horizon_end_term(et, max_terms, config) for et in entry_terms)
        return start_term, end_term

    def replay(self, edits: list[dict], target_term: int) -> ReplayResult:
        """Run the engine from scratch through `target_term` (inclusive) and return every
        frame up to and including it. `edits` is the live sim's full, current edit log —
        each edit only ever takes effect from its own `effective_from_term` onward, so
        terms strictly before the earliest edit's effective term are identical across any
        two calls to this method regardless of how many later edits have since been added.
        """
        config = copy.deepcopy(self.base_config)
        scenario = copy.deepcopy(self.base_scenario)
        data_source = _TimeVaryingCohortDataSource(config, edits)
        overlay_provider = _make_overlay_provider(edits)

        sim = Simulator(
            self.curriculum, config, scenario,
            data_source=data_source, overlay_provider=overlay_provider,
        )

        by_entry: dict[int, list[int]] = {}
        for cohort_id, entry_term in sim.admission_schedule.items():
            by_entry.setdefault(entry_term, []).append(cohort_id)

        last_term = min(target_term, sim.end_term - 1)
        for term_idx in range(sim.start_term, last_term + 1):
            sim._apply_overlay(term_idx)
            for cohort_id in sorted(by_entry.get(term_idx, [])):
                sim._admit_cohort(cohort_id, term_idx)
            season = term_season(term_idx, sim.config)
            sim._run_term(term_idx, season)

        cohorts_meta = [
            {"id": cid, "is_incumbent": cid < 0, "entry_term": et}
            for cid, et in sorted(sim.admission_schedule.items())
        ]
        return ReplayResult(
            frames=sim.history.timeline,
            start_term=sim.start_term,
            end_term=sim.end_term,
            cohorts=cohorts_meta,
        )
