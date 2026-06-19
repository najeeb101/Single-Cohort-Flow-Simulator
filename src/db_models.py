"""SQLAlchemy ORM tables for Phase 2 persistence (see docs/input_system_plan.md §2.1).

`Course`/`AppConfig` mirror data/curriculum.json and data/simulation_config.json exactly —
`src/db.py`'s loaders reconstruct the same dict[str, Course] / plain-dict shapes
src/simulator.py and src/analytics.py have always consumed, so neither of those files change.
"""
from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import JSON, DateTime, ForeignKey, String
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


class Course(Base):
    """Mirrors src/models/course.py::Course field-for-field; `code` is the natural key."""

    __tablename__ = "courses"

    code: Mapped[str] = mapped_column(String, primary_key=True)
    title: Mapped[str] = mapped_column(String, nullable=False)
    credits: Mapped[int] = mapped_column(nullable=False)
    prerequisites: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    pass_rate: Mapped[float] = mapped_column(nullable=False)
    offering: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    category: Mapped[str] = mapped_column(String, nullable=False)
    capacity: Mapped[int] = mapped_column(nullable=False)
    rule_expr: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    study_plan_order: Mapped[int] = mapped_column(default=99)


class AppConfig(Base):
    """Single-row table (id is always 1) holding the full simulation_config.json shape."""

    __tablename__ = "app_config"

    id: Mapped[int] = mapped_column(primary_key=True)
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
