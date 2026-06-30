"""SQLAlchemy engine/session seam + DB<->engine-shape loaders, plan-scoped.

`load_curriculum_from_db`/`load_config_from_db` are the only two functions allowed to know
about both the ORM (src/db_models.py) and the engine's plain dict[str, Course] / dict shapes
(src/models/course.py, src/service.py) — everything downstream of src/api.py's per-request
plan resolution stays unaware the data ever lived in a database.

Every Course/AppConfig row belongs to a Plan (src/db_models.py::Plan) — the shared,
system-seeded default plan (owner_user_id is None) plus however many a user has imported.
"""
from __future__ import annotations

import copy
import os
from pathlib import Path

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from src import db_models
from src.curriculum_validation import CycleError, PlanImportError, check_no_cycle
from src.models.course import Course, course_from_dict, load_curriculum
from src.utils import load_json

DB_URL = os.environ.get("DATABASE_URL", "sqlite:///data/app.db")

# :memory: SQLite gives each new connection its own empty DB unless pinned to a single
# shared connection via StaticPool — without this, init_db()'s CREATE TABLE and a later
# query can land on two different (both "in-memory") databases.
_is_sqlite = DB_URL.startswith("sqlite")
_is_memory_db = ":memory:" in DB_URL
ENGINE = create_engine(
    DB_URL,
    # check_same_thread is a SQLite-only connect arg; psycopg2 (production Postgres) rejects
    # it outright, so only pass it on the sqlite dialect.
    connect_args={"check_same_thread": False} if _is_sqlite else {},
    poolclass=StaticPool if _is_memory_db else None,
)
SessionLocal = sessionmaker(bind=ENGINE)

CURRICULUM_JSON_PATH = Path("data/curriculum.json")
CONFIG_JSON_PATH = Path("data/simulation_config.json")

DEFAULT_PLAN_NAME = "QU CS Baseline (default)"


def init_db() -> None:
    db_models.Base.metadata.create_all(bind=ENGINE)
    _ensure_columns()


def _ensure_columns() -> None:
    """Additive, idempotent column backfills for DBs created before a column existed.

    create_all() only creates *missing tables*, never alters existing ones — so a
    pre-existing data/app.db (or a deployed Postgres) won't get a newly-added column from
    the ORM definition. We add the few we've introduced post-launch with a guarded
    ADD COLUMN (both SQLite and Postgres support the IF-NOT-EXISTS-style guard below).
    New/fresh DBs already have the column from create_all and skip every branch.
    """
    from sqlalchemy import inspect, text

    inspector = inspect(ENGINE)
    existing_tables = set(inspector.get_table_names())
    # (table, column, DDL type + default) tuples — extend as new columns are introduced.
    additions = [
        ("courses", "study_plan_term", "INTEGER DEFAULT 0"),
    ]
    with ENGINE.begin() as conn:
        for table, column, coltype in additions:
            if table not in existing_tables:
                continue
            cols = {c["name"] for c in inspector.get_columns(table)}
            if column not in cols:
                conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {column} {coltype}"))


def get_db():
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()


def _course_to_row(course: Course, plan_id: int) -> db_models.Course:
    return db_models.Course(
        plan_id=plan_id,
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
        study_plan_term=course.study_plan_term,
    )


def _insert_plan_data(
    session: Session,
    plan_id: int,
    curriculum: dict[str, Course],
    config: dict,
) -> None:
    for course in curriculum.values():
        session.add(_course_to_row(course, plan_id))
    session.add(db_models.AppConfig(plan_id=plan_id, data=config))


def get_or_create_default_plan(session: Session, force_reseed: bool = False) -> db_models.Plan:
    """Idempotent: finds the shared system plan (owner_user_id is None), creating + seeding
    it from the JSON files on first call. `force_reseed=True` (scripts/migrate_json_to_db.py
    --force) overwrites its Course/AppConfig rows from the JSON files even if it already
    exists, for resyncing after a hand-edit to the JSON files.
    """
    plan = session.query(db_models.Plan).filter_by(owner_user_id=None).first()
    if plan is None:
        plan = db_models.Plan(owner_user_id=None, name=DEFAULT_PLAN_NAME)
        session.add(plan)
        session.flush()  # assigns plan.id
        curriculum = load_curriculum(CURRICULUM_JSON_PATH)
        config = load_json(CONFIG_JSON_PATH)
        _insert_plan_data(session, plan.id, curriculum, config)
        session.commit()
    elif force_reseed:
        session.query(db_models.Course).filter_by(plan_id=plan.id).delete()
        config_row = session.query(db_models.AppConfig).filter_by(plan_id=plan.id).first()
        if config_row is not None:
            session.delete(config_row)
        session.flush()
        curriculum = load_curriculum(CURRICULUM_JSON_PATH)
        config = load_json(CONFIG_JSON_PATH)
        _insert_plan_data(session, plan.id, curriculum, config)
        session.commit()
    return plan


def import_plan(
    session: Session,
    owner_user_id: int,
    name: str,
    curriculum_list: list[dict],
    config: dict,
) -> db_models.Plan:
    """Validate + insert a new user-owned Plan from uploaded curriculum/config data.
    Raises PlanImportError (caller maps to 422) on a malformed course entry or a
    prerequisite cycle — nothing is committed in any failure case.
    """
    curriculum: dict[str, Course] = {}
    for entry in curriculum_list:
        try:
            course = course_from_dict(entry)
        except ValueError as exc:
            raise PlanImportError(str(exc)) from exc
        curriculum[course.code] = course

    if not curriculum:
        raise PlanImportError("Curriculum must contain at least one course")

    try:
        check_no_cycle(curriculum)
    except CycleError as exc:
        raise PlanImportError(str(exc)) from exc

    if "cohort_size" not in config or "scenarios" not in config:
        raise PlanImportError("Config must include at least cohort_size and scenarios")

    plan = db_models.Plan(owner_user_id=owner_user_id, name=name)
    session.add(plan)
    session.flush()
    _insert_plan_data(session, plan.id, curriculum, config)
    session.commit()
    return plan


def resolve_active_plan_id(session: Session, user: db_models.User) -> int:
    """`user.active_plan_id` if that plan still exists (handles a deleted-while-active
    plan gracefully), else the shared default plan's id."""
    if user.active_plan_id is not None:
        plan = session.get(db_models.Plan, user.active_plan_id)
        if plan is not None:
            return plan.id
    return get_or_create_default_plan(session).id


def load_curriculum_from_db(session: Session, plan_id: int) -> dict[str, Course]:
    rows = session.query(db_models.Course).filter_by(plan_id=plan_id).all()
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
            study_plan_term=row.study_plan_term,
        )
        for row in rows
    }
    return courses


def load_config_from_db(session: Session, plan_id: int) -> dict:
    row = session.query(db_models.AppConfig).filter_by(plan_id=plan_id).first()
    return copy.deepcopy(row.data)


