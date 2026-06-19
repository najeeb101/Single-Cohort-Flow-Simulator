"""SQLAlchemy engine/session seam + DB<->engine-shape loaders (docs/input_system_plan.md §2.1).

`load_curriculum_from_db`/`load_config_from_db` are the only two functions allowed to know
about both the ORM (src/db_models.py) and the engine's plain dict[str, Course] / dict shapes
(src/models/course.py, src/service.py) — everything downstream of src/api.py's module load
stays unaware the data ever lived in a database.
"""
from __future__ import annotations

import copy
import os
from pathlib import Path

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from src import db_models
from src.models.course import Course, load_curriculum
from src.utils import load_json

DB_URL = os.environ.get("DATABASE_URL", "sqlite:///data/app.db")

# :memory: SQLite gives each new connection its own empty DB unless pinned to a single
# shared connection via StaticPool — without this, init_db()'s CREATE TABLE and a later
# query can land on two different (both "in-memory") databases.
_is_memory_db = ":memory:" in DB_URL
ENGINE = create_engine(
    DB_URL,
    connect_args={"check_same_thread": False},
    poolclass=StaticPool if _is_memory_db else None,
)
SessionLocal = sessionmaker(bind=ENGINE)

CURRICULUM_JSON_PATH = Path("data/curriculum.json")
CONFIG_JSON_PATH = Path("data/simulation_config.json")


def init_db() -> None:
    db_models.Base.metadata.create_all(bind=ENGINE)


def get_db():
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()


def _course_to_row(course: Course) -> db_models.Course:
    return db_models.Course(
        code=course.code,
        title=course.title,
        credits=course.credits,
        prerequisites=list(course.prerequisites),
        pass_rate=course.pass_rate,
        offering=list(course.offering),
        category=course.category,
        capacity=course.capacity,
        rule_expr=course.rule_expr,
        study_plan_order=course.study_plan_order,
    )


def seed_if_empty(session: Session, force: bool = False) -> dict:
    """Seed Course/AppConfig from the JSON files. Auto-runs on API startup when empty;
    `force=True` (scripts/migrate_json_to_db.py --force) re-seeds even if rows already exist.
    """
    courses_inserted = 0
    courses_skipped = 0

    has_courses = session.query(db_models.Course).first() is not None
    if force or not has_courses:
        curriculum = load_curriculum(CURRICULUM_JSON_PATH)
        for course in curriculum.values():
            existing = session.get(db_models.Course, course.code)
            if existing is None:
                session.add(_course_to_row(course))
                courses_inserted += 1
            elif force:
                fresh = _course_to_row(course)
                for field in ("title", "credits", "prerequisites", "pass_rate", "offering",
                              "category", "capacity", "rule_expr", "study_plan_order"):
                    setattr(existing, field, getattr(fresh, field))
                courses_inserted += 1
            else:
                courses_skipped += 1

    config_created = False
    config_updated = False
    existing_config = session.get(db_models.AppConfig, 1)
    if existing_config is None:
        config_data = load_json(CONFIG_JSON_PATH)
        session.add(db_models.AppConfig(id=1, data=config_data))
        config_created = True
    elif force:
        existing_config.data = load_json(CONFIG_JSON_PATH)
        config_updated = True

    session.commit()
    return {
        "courses_inserted": courses_inserted,
        "courses_skipped": courses_skipped,
        "config_created": config_created,
        "config_updated": config_updated,
    }


def load_curriculum_from_db(session: Session) -> dict[str, Course]:
    rows = session.query(db_models.Course).all()
    courses = {
        row.code: Course(
            code=row.code,
            title=row.title,
            credits=row.credits,
            prerequisites=tuple(row.prerequisites),
            pass_rate=row.pass_rate,
            offering=tuple(row.offering),
            category=row.category,
            capacity=row.capacity,
            rule_expr=row.rule_expr,
            study_plan_order=row.study_plan_order,
        )
        for row in rows
    }
    return courses


def load_config_from_db(session: Session) -> dict:
    row = session.get(db_models.AppConfig, 1)
    return copy.deepcopy(row.data)
