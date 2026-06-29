"""SQLAlchemy ORM tables for Phase 2 persistence (see docs/input_system_history.md §2.1) and
multi-plan support (each `Plan` is a distinct curriculum + baseline config; `User.active_plan_id`
makes plan selection per-user rather than a single global).

`Course`/`AppConfig` mirror data/curriculum.json and data/simulation_config.json exactly —
`src/db.py`'s loaders reconstruct the same dict[str, Course] / plain-dict shapes
src/simulator.py and src/analytics.py have always consumed, so neither of those files change.
"""
from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import JSON, DateTime, ForeignKey, String, UniqueConstraint
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String, unique=True, index=True, nullable=False)
    hashed_password: Mapped[str] = mapped_column(String, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow)
    active_plan_id: Mapped[int | None] = mapped_column(ForeignKey("plans.id"), nullable=True)


class Plan(Base):
    """A distinct curriculum + baseline config. `owner_user_id is None` marks the shared,
    system-seeded default plan (visible/editable by everyone, like Phase 2's single global
    curriculum was) — anything else is private to the user who imported it."""

    __tablename__ = "plans"

    id: Mapped[int] = mapped_column(primary_key=True)
    owner_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    name: Mapped[str] = mapped_column(String, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow)


class Course(Base):
    """Mirrors src/models/course.py::Course field-for-field; `code` is unique only within
    a plan (multiple plans can each have their own "CMPS151"), hence the surrogate `id`."""

    __tablename__ = "courses"
    __table_args__ = (UniqueConstraint("plan_id", "code", name="uq_course_plan_code"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    plan_id: Mapped[int] = mapped_column(ForeignKey("plans.id"), nullable=False)
    code: Mapped[str] = mapped_column(String, nullable=False)
    title: Mapped[str] = mapped_column(String, nullable=False)
    credits: Mapped[int] = mapped_column(nullable=False)
    prerequisites: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    pass_rate: Mapped[float] = mapped_column(nullable=False)
    offering: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    category: Mapped[str] = mapped_column(String, nullable=False)
    capacity: Mapped[int] = mapped_column(nullable=False)
    rule_expr: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    study_plan_order: Mapped[int] = mapped_column(default=99)
    study_plan_term: Mapped[int] = mapped_column(default=0)  # recommended semester column (1..N)


class Instructor(Base):
    """Synthetic/configurable faculty roster, plan-scoped like Course. `categories` is the
    set of Course.category values (src/models/course.py) this instructor is qualified to
    teach; `max_sections_per_term` is their teaching-load cap expressed in the same "sections"
    unit course_sections uses, so capacity comparisons need no credit-hour conversion."""

    __tablename__ = "instructors"
    __table_args__ = (UniqueConstraint("plan_id", "name", name="uq_instructor_plan_name"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    plan_id: Mapped[int] = mapped_column(ForeignKey("plans.id"), nullable=False)
    name: Mapped[str] = mapped_column(String, nullable=False)
    categories: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    max_sections_per_term: Mapped[int] = mapped_column(nullable=False)


class AppConfig(Base):
    """One row per plan, holding the full simulation_config.json shape for that plan."""

    __tablename__ = "app_config"

    id: Mapped[int] = mapped_column(primary_key=True)
    plan_id: Mapped[int] = mapped_column(ForeignKey("plans.id"), unique=True, nullable=False)
    data: Mapped[dict] = mapped_column(JSON, nullable=False)


class Scenario(Base):
    __tablename__ = "scenarios"

    id: Mapped[int] = mapped_column(primary_key=True)
    owner_user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    name: Mapped[str] = mapped_column(String, nullable=False)
    overrides: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow, onupdate=_utcnow)


class Run(Base):
    __tablename__ = "runs"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    scenario_id: Mapped[int | None] = mapped_column(ForeignKey("scenarios.id"), nullable=True)
    requested_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow)
    overrides_json: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    summary_json: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)


class LiveSimulation(Base):
    """Phase 3: a live, stepwise simulation — persisted, advanced one term at a time, and
    shared within a plan (any user whose active plan == `plan_id` can view/advance it; see
    src/api.py's /livesim routes). `base_config`/`base_scenario` are frozen at creation time
    (initial_state lives inside base_config) and never mutated; forward changes are
    expressed as append-only `edits` entries consumed by src/livesim.py::LiveRunner's
    replay, never by editing base_config/base_scenario directly — that's what keeps earlier
    terms' snapshots byte-identical no matter how many edits accumulate later.
    """

    __tablename__ = "live_simulations"

    id: Mapped[int] = mapped_column(primary_key=True)
    plan_id: Mapped[int] = mapped_column(ForeignKey("plans.id"), nullable=False)
    created_by_user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    name: Mapped[str] = mapped_column(String, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow)
    # None = created, no term simulated yet (first /advance call moves this to 0).
    current_term: Mapped[int | None] = mapped_column(nullable=True)
    status: Mapped[str] = mapped_column(String, default="active")  # "active" | "finished"
    base_config: Mapped[dict] = mapped_column(JSON, nullable=False)
    base_scenario: Mapped[dict] = mapped_column(JSON, nullable=False)
    edits: Mapped[list] = mapped_column(JSON, nullable=False, default=list)


class LiveTermSnapshot(Base):
    """One saved term of a LiveSimulation's replay — the frame plus a cheap running
    summary and exactly which edit (if any) just took effect for this term. Unique on
    (live_sim_id, term_index) since /advance only ever appends the next term in order."""

    __tablename__ = "live_term_snapshots"
    __table_args__ = (UniqueConstraint("live_sim_id", "term_index", name="uq_livesim_term"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    live_sim_id: Mapped[int] = mapped_column(ForeignKey("live_simulations.id"), nullable=False)
    term_index: Mapped[int] = mapped_column(nullable=False)
    season: Mapped[str] = mapped_column(String, nullable=False)
    label: Mapped[str] = mapped_column(String, nullable=False)
    frame: Mapped[dict] = mapped_column(JSON, nullable=False)
    summary: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    edits_applied: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow)
