"""Persistent scenarios + run history (docs/input_system_history.md §2.3) — every endpoint is
scoped to the logged-in user (src/auth.py::get_current_user); cross-user access 404s rather
than 403ing, so an attacker can't distinguish "not yours" from "doesn't exist"."""
from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from src.auth import get_current_user
from src.db import get_db
from src.db_models import Run, Scenario, User

router = APIRouter()


class ScenarioCreate(BaseModel):
    name: str
    overrides: dict = {}


class ScenarioUpdate(BaseModel):
    name: str | None = None
    overrides: dict | None = None


def _scenario_to_dict(row: Scenario) -> dict:
    return {
        "id": row.id,
        "name": row.name,
        "overrides": row.overrides,
        "created_at": row.created_at.isoformat(),
        "updated_at": row.updated_at.isoformat(),
    }


def _run_to_dict(row: Run) -> dict:
    return {
        "id": row.id,
        "scenario_id": row.scenario_id,
        "requested_at": row.requested_at.isoformat(),
        "overrides_json": row.overrides_json,
        "summary_json": row.summary_json,
    }


def _get_owned_scenario(db: Session, scenario_id: int, user: User) -> Scenario:
    row = db.get(Scenario, scenario_id)
    if row is None or row.owner_user_id != user.id:
        raise HTTPException(status_code=404, detail="Scenario not found")
    return row


@router.get("/scenarios")
def list_scenarios(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)) -> list[dict]:
    rows = db.query(Scenario).filter_by(owner_user_id=current_user.id).order_by(Scenario.updated_at.desc()).all()
    return [_scenario_to_dict(row) for row in rows]


@router.post("/scenarios")
def create_scenario(
    req: ScenarioCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)
) -> dict:
    row = Scenario(owner_user_id=current_user.id, name=req.name, overrides=req.overrides)
    db.add(row)
    db.commit()
    db.refresh(row)
    return _scenario_to_dict(row)


@router.get("/scenarios/{scenario_id}")
def get_scenario(
    scenario_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)
) -> dict:
    return _scenario_to_dict(_get_owned_scenario(db, scenario_id, current_user))


@router.put("/scenarios/{scenario_id}")
def update_scenario(
    scenario_id: int,
    req: ScenarioUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    row = _get_owned_scenario(db, scenario_id, current_user)
    if req.name is not None:
        row.name = req.name
    if req.overrides is not None:
        row.overrides = req.overrides
    row.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(row)
    return _scenario_to_dict(row)


@router.delete("/scenarios/{scenario_id}")
def delete_scenario(
    scenario_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)
) -> dict:
    row = _get_owned_scenario(db, scenario_id, current_user)
    db.delete(row)
    db.commit()
    return {"ok": True}


@router.get("/runs")
def list_runs(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)) -> list[dict]:
    rows = db.query(Run).filter_by(user_id=current_user.id).order_by(Run.requested_at.desc()).all()
    return [_run_to_dict(row) for row in rows]


@router.get("/runs/{run_id}")
def get_run(run_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)) -> dict:
    row = db.get(Run, run_id)
    if row is None or row.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Run not found")
    return _run_to_dict(row)
