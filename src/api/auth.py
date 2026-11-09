"""Auth removed — every request resolves to an auto-provisioned user.
get_current_user is kept as a FastAPI dependency so every endpoint's signature is unchanged,
but it never checks a token; it just gets-or-creates the user on every call.

Normally that is one shared local user (the department PC has one person at a time). In the
public demo (`DEMO_MODE=1`, src/api/demo.py) it is one user per visitor, picked by a cookie, so
visitors don't share Walkthrough sessions or analyses; a new visitor is also handed the
precomputed showcase analyses so the headline result is on screen immediately.
"""
from __future__ import annotations

from datetime import datetime, timezone

from fastapi import Depends
from sqlalchemy.orm import Session

from src.api import demo
from src.storage.db import get_db, get_or_create_default_plan
from src.storage.db_models import Analysis, User

DEMO_USER_EMAIL = "demo@local"


def _seed_showcase(db: Session, user: User, plan_id: int) -> None:
    now = datetime.now(timezone.utc)
    for row in demo.load_showcase():
        db.add(Analysis(
            user_id=user.id, plan_id=plan_id, kind=row["kind"], source="plan",
            label=row.get("label"), status="done", progress=1.0, progress_note="Done",
            params=row.get("params") or {}, inputs_snapshot=row.get("inputs_snapshot") or {},
            result=row["result"], started_at=now, finished_at=now,
        ))
    db.commit()


def get_current_user(db: Session = Depends(get_db)) -> User:
    sid = demo.current_sid() if demo.enabled() else None
    email = demo.demo_email(sid) if sid else DEMO_USER_EMAIL
    user = db.query(User).filter_by(email=email).first()
    if user is None:
        default_plan = get_or_create_default_plan(db)
        user = User(
            email=email,
            hashed_password="",
            active_plan_id=default_plan.id,
        )
        db.add(user)
        db.commit()
        db.refresh(user)
        if sid:
            _seed_showcase(db, user, default_plan.id)
    return user
