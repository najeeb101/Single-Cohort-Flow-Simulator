"""SQLAlchemy ORM tables for Phase 2 persistence (see docs/input_system_history.md §2.1) and
multi-plan support (each `Plan` is a distinct curriculum + baseline config; `User.active_plan_id`
makes plan selection per-user rather than a single global).

`Course`/`AppConfig` mirror data/curriculum.json and data/simulation_config.json exactly —
`src/db.py`'s loaders reconstruct the same dict[str, Course] / plain-dict shapes
src/simulator.py and src/analytics.py have always consumed, so neither of those files change.
"""
from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import JSON, DateTime, ForeignKey, LargeBinary, String, UniqueConstraint
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


class CheckpointSession(Base):
    """One in-progress "Semester Checkpoint Mode" walkthrough (see CLAUDE.md) — a resumable,
    turn-based re-run of the active plan where a department head advances one mandatory term at
    a time and can edit future-facing knobs (capacity/pass_rate/occupancy/intake) between steps.

    `working_curriculum`/`working_config` are a frozen-at-creation COPY of the plan's data
    (plan-export shape: a list of course dicts + the full config dict), mutated in place only by
    `POST /checkpoint/edit` — never the live plan's own `Course`/`AppConfig` rows, so a
    concurrent Settings/Plan edit can't reach into an in-progress session. `snapshot` is the
    pickled dynamic engine state from `Simulator.snapshot()` (students/history/resume cursor);
    `next_term` mirrors the same cursor in a queryable column for cheap reads without unpickling.
    One active session per user, mirroring `User.active_plan_id` — see
    `src/db.py::resolve_active_checkpoint_session`."""

    __tablename__ = "checkpoint_sessions"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    plan_id: Mapped[int] = mapped_column(ForeignKey("plans.id"), nullable=False)  # provenance only
    status: Mapped[str] = mapped_column(String, default="active")  # active | completed | discarded
    next_term: Mapped[int] = mapped_column(nullable=False)
    snapshot: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    working_curriculum: Mapped[list] = mapped_column(JSON, nullable=False)
    working_config: Mapped[dict] = mapped_column(JSON, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow, onupdate=_utcnow)


class CheckpointSnapshot(Base):
    """One per-step engine snapshot within a `CheckpointSession` walkthrough — `seq=0` captures
    the state at session creation, `seq=N` the state right after the Nth successful
    `POST /checkpoint/advance`. Kept separate from `CheckpointSession.snapshot` (which still
    tracks "the current/latest" blob for the existing advance/edit code paths) so
    `POST /checkpoint/rewind` can restore an earlier step by deleting every row past the target
    `seq` — a linear undo with no branching/redo. `next_term` mirrors the engine's resume cursor
    as of this step, stored alongside so the frontend can list/label steps without unpickling."""

    __tablename__ = "checkpoint_snapshots"

    id: Mapped[int] = mapped_column(primary_key=True)
    session_id: Mapped[int] = mapped_column(ForeignKey("checkpoint_sessions.id"), nullable=False)
    seq: Mapped[int] = mapped_column(nullable=False)
    next_term: Mapped[int] = mapped_column(nullable=False)
    snapshot: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow)


