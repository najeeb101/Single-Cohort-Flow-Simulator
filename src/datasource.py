"""The data seam: where the student population comes from, decoupled from how it flows.

This is the central abstraction of the ACIP transformation (see docs/roadmap.md
§2.4). The engine never constructs students itself — it asks a ``DataSource``. Two
implementations are interchangeable behind this interface:

  - ``SyntheticDataSource``  — generates the population from config + CRN (current behaviour).
  - ``RealDataSource`` (future) — reads it from an institution's SIS export.

Getting this contract right is what makes the eventual real-data hand-off a config swap
rather than a rewrite. Phase 0 covers the *forward-simulation* population
(``cohort_specs`` + ``create_students``). Phase 1 adds the replay/fit side: the canonical
historical-record schema below (``StudentRecord``, ``EnrollmentRecord``, ``OutcomeRecord``)
plus ``analytics.compute_historical_transcripts()``, which extracts them from any completed
``SimulationResult``. That extraction is the synthetic stand-in for ``RealDataSource`` —
incumbent cohorts are warm-started before the study window and reach a terminal status well
before it ends, so they play the role real institutional history would play, giving
calibration/validation real-shaped input without a SIS export. It lives in ``analytics.py``
rather than as a ``DataSource`` method because the two directions aren't symmetric: this
extracts a view *out of* a finished run, while a future ``RealDataSource`` would read the
same three record types straight from the institution's export, with no run involved at all.
"""
from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass

from src.models.semester import admission_seasons, term_season
from src.models.student import Student


@dataclass(frozen=True)
class CohortSpec:
    """One admission group: who enters, when, and how many.

    The population-level contract the engine consumes. A ``SyntheticDataSource`` derives
    specs from config; a future ``RealDataSource`` derives them from real admission records.
    """
    cohort_id: int
    entry_term: int
    size: int


@dataclass(frozen=True)
class StudentRecord:
    """Canonical, portable view of one student (the "Student" entity in §2.4's schema
    table). Deliberately lean: simulation internals (GPA, RNG stream, ability score) aren't
    portable to a real SIS export and stay on the engine's internal ``Student``; this is
    only what an admissions/registration system would actually hand over.
    """
    student_id: int
    program_id: str
    admission_term: int
    status: str


@dataclass(frozen=True)
class EnrollmentRecord:
    """One transcript line: a single course attempt in a single term."""
    student_id: int
    term: int
    course_code: str
    grade: str
    credits: int
    attempt_no: int


@dataclass(frozen=True)
class OutcomeRecord:
    """A student's terminal fate — exactly one per student, once their journey ends."""
    student_id: int
    graduation_term: int | None
    exit_reason: str  # "graduated" | "dropped" | "censored"


class DataSource(ABC):
    """Seam between the population and the flow engine."""

    @abstractmethod
    def cohort_specs(self) -> list[CohortSpec]:
        """All admission groups, in admission order (incumbents first, at negative terms)."""

    @abstractmethod
    def create_students(self, spec: CohortSpec) -> list[Student]:
        """Materialise the students for one cohort at admission time."""


class SyntheticDataSource(DataSource):
    """Generates the student population deterministically from config (seed + CRN).

    Owns the synthetic-only knobs — cohort sizing, incumbent warm-start count, admission
    interval — and student identity/seeding. These are synthetic concerns and live here,
    not in the engine: real students arrive with real ids and histories instead.
    """

    def __init__(self, config: dict) -> None:
        self.config: dict = config
        self.seed: int = config["seed"]
        self.cohort_size: int = config["cohort_size"]
        self.num_cohorts: int = config.get("num_cohorts", 1)
        self.num_incumbent_cohorts: int = config.get("num_incumbent_cohorts", 0)
        self.ability_sd: float = config.get("ability_sd", 0.15)
        self.ability_clip: float = config.get("ability_clip", 0.30)
        # Admission cadence is now driven by *which seasons admit* (Fall-only, or Fall+Spring)
        # rather than a single "every N terms" interval — see semester.admission_seasons. A
        # per-season size override lets a department set a different Spring intake; a season
        # absent from it falls back to cohort_size.
        self.admission_terms: frozenset[str] = frozenset(admission_seasons(config))
        self.admission_sizes: dict[str, int] = config.get("admission_sizes") or {}
        self._specs: list[CohortSpec] = self._build_specs()
        # Globally-unique, contiguous ids by cumulative size in admission order (incumbents
        # earliest-first, then study cohorts). For equal-size Fall-only admission this reproduces
        # the old `(cohort_id + num_incumbents) * cohort_size` base exactly, so the CRN stream
        # (seed + student_id) — and every result — is byte-identical to before.
        self._base_by_cohort: dict[int, int] = {}
        running = 0
        for spec in self._specs:
            self._base_by_cohort[spec.cohort_id] = running
            running += spec.size

    def _size_for_season(self, season: str) -> int:
        return int(self.admission_sizes.get(season, self.cohort_size))

    def _build_specs(self) -> list[CohortSpec]:
        # Study cohorts: walk the calendar forward from term 0, admitting a cohort each time the
        # season is an admission season, until num_cohorts have been admitted. Fall-only lands
        # them one year apart (0, cycle, 2*cycle, ...); Fall+Spring adds the half-year Spring
        # slots. Optional seasons (Summer) are excluded by admission_seasons, so a cohort never
        # enters in one.
        study: list[CohortSpec] = []
        t = 0
        while len(study) < self.num_cohorts:
            season = term_season(t, self.config)
            if season in self.admission_terms:
                study.append(CohortSpec(cohort_id=len(study), entry_term=t,
                                        size=self._size_for_season(season)))
            t += 1
        # Incumbents warm-start the university before term 0: walk the same admission rhythm
        # backward from term -1, assigning ids -1 (nearest to 0), -2, ... A collapsed cycle puts
        # Fall-only incumbents at exactly the old negative interval terms.
        incumbents: list[CohortSpec] = []
        t = -1
        while len(incumbents) < self.num_incumbent_cohorts:
            season = term_season(t, self.config)
            if season in self.admission_terms:
                incumbents.append(CohortSpec(cohort_id=-(len(incumbents) + 1), entry_term=t,
                                             size=self._size_for_season(season)))
            t -= 1
        # Admission order: incumbents earliest (most negative) first, then study cohorts. This
        # order is what makes the cumulative-id bases match the legacy scheme for equal sizes.
        return list(reversed(incumbents)) + study

    def cohort_specs(self) -> list[CohortSpec]:
        return list(self._specs)

    def create_students(self, spec: CohortSpec) -> list[Student]:
        base = self._base_by_cohort[spec.cohort_id]
        return [
            Student(base + i, self.seed, cohort_id=spec.cohort_id, entry_term=spec.entry_term,
                    ability_sd=self.ability_sd, ability_clip=self.ability_clip)
            for i in range(spec.size)
        ]
