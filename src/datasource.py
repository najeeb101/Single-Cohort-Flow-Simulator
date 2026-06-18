"""The data seam: where the student population comes from, decoupled from how it flows.

This is the central abstraction of the ACIP transformation (see docs/acip_transformation_plan.md
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
        self.seed: int = config["seed"]
        self.cohort_size: int = config["cohort_size"]
        self.num_cohorts: int = config.get("num_cohorts", 1)
        self.num_incumbent_cohorts: int = config.get("num_incumbent_cohorts", 0)
        self.admit_interval: int = config.get("admit_interval_terms", 2)

    def cohort_specs(self) -> list[CohortSpec]:
        specs: list[CohortSpec] = []
        # Incumbents warm-start the university before term 0 (negative ids and entry terms).
        for k in range(1, self.num_incumbent_cohorts + 1):
            specs.append(CohortSpec(cohort_id=-k, entry_term=-k * self.admit_interval,
                                    size=self.cohort_size))
        # Study cohorts enter at 0, interval, 2*interval, ...
        for c in range(self.num_cohorts):
            specs.append(CohortSpec(cohort_id=c, entry_term=c * self.admit_interval,
                                    size=self.cohort_size))
        return specs

    def create_students(self, spec: CohortSpec) -> list[Student]:
        # Globally-unique, evenly-spaced ids keep each student's CRN stream (seed + id) stable.
        base = (spec.cohort_id + self.num_incumbent_cohorts) * self.cohort_size
        return [
            Student(base + i, self.seed, cohort_id=spec.cohort_id, entry_term=spec.entry_term)
            for i in range(spec.size)
        ]
