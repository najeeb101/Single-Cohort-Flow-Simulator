"""Auth is disabled for local demo use — get_current_user auto-resolves a single shared
demo account instead of checking a token, so every request succeeds with no login wall.
register/login endpoints are kept (harmless) but nothing requires calling them anymore.
"""
from __future__ import annotations

import os
from datetime import datetime, timedelta, timezone

import jwt
from fastapi import APIRouter, Depends, HTTPException
from passlib.context import CryptContext
from pydantic import BaseModel
from sqlalchemy.orm import Session

from src.db import get_db, get_or_create_default_plan
from src.db_models import User

AUTH_SECRET = os.environ.get("AUTH_SECRET", "auth-disabled-unused-secret")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24 * 7
DEMO_USER_EMAIL = "demo@local"

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(password: str, hashed: str) -> bool:
    return pwd_context.verify(password, hashed)


def create_access_token(user_id: int, email: str) -> str:
    expire = datetime.now(timezone.utc) + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    payload = {"sub": str(user_id), "email": email, "exp": expire}
    return jwt.encode(payload, AUTH_SECRET, algorithm=ALGORITHM)


def decode_access_token(token: str) -> dict:
    return jwt.decode(token, AUTH_SECRET, algorithms=[ALGORITHM])


class RegisterRequest(BaseModel):
    email: str
    password: str


class LoginRequest(BaseModel):
    email: str
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/register", response_model=TokenResponse)
def register(req: RegisterRequest, db: Session = Depends(get_db)) -> TokenResponse:
    existing = db.query(User).filter_by(email=req.email).first()
    if existing is not None:
        raise HTTPException(status_code=409, detail="Email already registered")
    default_plan = get_or_create_default_plan(db)
    user = User(email=req.email, hashed_password=hash_password(req.password), active_plan_id=default_plan.id)
    db.add(user)
    db.commit()
    db.refresh(user)
    return TokenResponse(access_token=create_access_token(user.id, user.email))


@router.post("/login", response_model=TokenResponse)
def login(req: LoginRequest, db: Session = Depends(get_db)) -> TokenResponse:
    user = db.query(User).filter_by(email=req.email).first()
    if user is None or not verify_password(req.password, user.hashed_password):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    return TokenResponse(access_token=create_access_token(user.id, user.email))


def get_current_user(db: Session = Depends(get_db)) -> User:
    user = db.query(User).filter_by(email=DEMO_USER_EMAIL).first()
    if user is None:
        default_plan = get_or_create_default_plan(db)
        user = User(
            email=DEMO_USER_EMAIL,
            hashed_password=hash_password(os.urandom(16).hex()),
            active_plan_id=default_plan.id,
        )
        db.add(user)
        db.commit()
        db.refresh(user)
    return user
