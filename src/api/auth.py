"""Auth removed — all requests resolve to a single shared auto-provisioned user.
get_current_user is kept as a FastAPI dependency so every endpoint's signature is unchanged,
but it never checks a token or cookie; it just gets-or-creates the demo user on every call.
The /auth/register and /auth/login endpoints are gone; the frontend needs no login flow.
"""
from __future__ import annotations

from fastapi import Depends
from sqlalchemy.orm import Session

from src.db import get_db, get_or_create_default_plan
from src.db_models import User

DEMO_USER_EMAIL = "demo@local"


def get_current_user(db: Session = Depends(get_db)) -> User:
    user = db.query(User).filter_by(email=DEMO_USER_EMAIL).first()
    if user is None:
        default_plan = get_or_create_default_plan(db)
        user = User(
            email=DEMO_USER_EMAIL,
            hashed_password="",
            active_plan_id=default_plan.id,
        )
        db.add(user)
        db.commit()
        db.refresh(user)
    return user
