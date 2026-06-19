"""Tests for src/db.py — the shape-preservation guarantee the DB swap depends on
(everything downstream of src/api.py's module load must see the same dict[str, Course] /
plain-dict shapes it always has)."""
from __future__ import annotations

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from src import db_models
from src.db import (
    DEFAULT_PLAN_NAME,
    get_or_create_default_plan,
    load_config_from_db,
    load_curriculum_from_db,
)
from src.models.course import load_curriculum
from src.utils import load_json


def _fresh_session():
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    db_models.Base.metadata.create_all(bind=engine)
    return sessionmaker(bind=engine)()


def test_migration_round_trips_a_known_course():
    session = _fresh_session()
    plan = get_or_create_default_plan(session)
    curriculum = load_curriculum_from_db(session, plan.id)
    expected = load_curriculum("data/curriculum.json")["CMPS493"]
    assert curriculum["CMPS493"] == expected
    assert curriculum["CMPS493"].rule_expr == {
        "all": ["CMPS310", {"any": ["CMPS350", "CMPS405"]}, {"min_ch": 84}]
    }


def test_migration_round_trips_config():
    session = _fresh_session()
    plan = get_or_create_default_plan(session)
    config = load_config_from_db(session, plan.id)
    expected = load_json("data/simulation_config.json")
    assert config["cohort_size"] == expected["cohort_size"]
    assert config["scenarios"] == expected["scenarios"]


def test_load_curriculum_from_db_matches_load_curriculum_from_json():
    session = _fresh_session()
    plan = get_or_create_default_plan(session)
    assert load_curriculum_from_db(session, plan.id) == load_curriculum("data/curriculum.json")


def test_default_plan_seed_is_idempotent_without_force():
    session = _fresh_session()
    first = get_or_create_default_plan(session)
    second = get_or_create_default_plan(session)
    assert first.id == second.id
    assert first.name == DEFAULT_PLAN_NAME
    assert len(load_curriculum_from_db(session, first.id)) == len(load_curriculum("data/curriculum.json"))


def test_default_plan_force_reseeds_without_duplicating():
    session = _fresh_session()
    plan = get_or_create_default_plan(session)
    n_before = len(load_curriculum_from_db(session, plan.id))
    reseeded = get_or_create_default_plan(session, force_reseed=True)
    n_after = len(load_curriculum_from_db(session, reseeded.id))
    assert plan.id == reseeded.id
    assert n_before == n_after
