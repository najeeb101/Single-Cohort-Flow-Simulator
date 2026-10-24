"""Background jobs for the Intake Planner: run one intake sweep or seat plan at a time without
blocking the API, persisting progress and the result on its `Analysis` row.

Design (local, single-machine — see CLAUDE.md "Intake Planner"):
- **One job at a time.** An analysis already saturates every CPU core through its own process
  pool, so a second concurrent job would only slow both down; the API answers 409 instead.
- **Daemon thread** with its **own DB session** (sessions aren't thread-safe). The thread owns
  the process pool for the job's whole life (src/parallel.py::make_pool).
- **Throttled progress writes** (at most ~1/s) so the job doesn't hammer SQLite while the
  frontend polls `GET /intake-analyses/{id}`.
- **Cancellation** via a threading.Event the runner checks between simulations; on cancel the
  pool's workers are terminated (src/intake.py::_Runner).
- **Inline mode** (`INLINE = True`, used by tests) runs the job synchronously in the request.
- A server killed mid-job leaves its row `running`; src/db.py::recover_interrupted_analyses
  marks it failed at the next startup.

Worker processes import only src.intake (engine code) — never src.api — so spawning them never
re-runs the API's import-time DB setup.
"""
from __future__ import annotations

import os
import threading
import time
from datetime import datetime, timezone

from src import intake
from src.db import SessionLocal
from src.db_models import Analysis

# Tests run jobs synchronously (no thread), so assertions see the finished row — set via
# INTAKE_JOBS_INLINE=1 (tests/conftest.py) or by assigning this flag.
INLINE = os.environ.get("INTAKE_JOBS_INLINE") == "1"

_lock = threading.Lock()
_running_id: int | None = None
_cancel_event = threading.Event()


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _workers() -> int | None:
    """Process-pool size: INTAKE_WORKERS env (tests set 1), else one per CPU."""
    raw = os.environ.get("INTAKE_WORKERS")
    return int(raw) if raw else None


def is_busy() -> bool:
    with _lock:
        return _running_id is not None


def running_id() -> int | None:
    with _lock:
        return _running_id


def request_cancel(analysis_id: int) -> bool:
    """Ask the running job to stop. Returns False if that job isn't the one running."""
    with _lock:
        if _running_id != analysis_id:
            return False
        _cancel_event.set()
        return True


def start(analysis_id: int, kind: str, curriculum: dict, config: dict, job_params: dict) -> None:
    """Claim the single job slot and run `analysis_id`. Raises RuntimeError if a job is already
    running (the API checks `is_busy()` first and answers 409)."""
    global _running_id
    with _lock:
        if _running_id is not None:
            raise RuntimeError("an analysis is already running")
        _running_id = analysis_id
        _cancel_event.clear()
    if INLINE:
        _run(analysis_id, kind, curriculum, config, job_params)
    else:
        threading.Thread(
            target=_run, args=(analysis_id, kind, curriculum, config, job_params),
            name=f"intake-analysis-{analysis_id}", daemon=True,
        ).start()


def _run(analysis_id: int, kind: str, curriculum: dict, config: dict, job_params: dict) -> None:
    global _running_id
    session = SessionLocal()
    try:
        row = session.get(Analysis, analysis_id)
        row.status = "running"
        row.started_at = _now()
        session.commit()

        last_write = [0.0]

        def progress(fraction: float, note: str) -> None:
            now = time.monotonic()
            if fraction < 1.0 and now - last_write[0] < 1.0:
                return
            last_write[0] = now
            row.progress = round(max(0.0, min(1.0, fraction)), 4)
            row.progress_note = note
            session.commit()

        policy = intake.policy_from_config(config, job_params.get("policy"))
        common = dict(policy=policy, params_override=job_params.get("params"), workers=_workers(),
                      progress=progress, cancel=_cancel_event.is_set)
        if kind == "seat_plan":
            result = intake.run_seat_plan(curriculum, config, int(job_params["target_intake"]),
                                          run_budget=int(job_params.get("run_budget", 6)), **common)
        else:
            result = intake.run_intake_sweep(curriculum, config, **common)

        row.result = result
        row.status = "done"
        row.progress = 1.0
        row.progress_note = "Done"
        row.finished_at = _now()
        session.commit()
    except intake.AnalysisCancelled:
        session.rollback()
        row = session.get(Analysis, analysis_id)
        row.status = "cancelled"
        row.progress_note = "Cancelled"
        row.finished_at = _now()
        session.commit()
    except Exception as exc:  # noqa: BLE001 - any failure is recorded on the row for the UI
        session.rollback()
        row = session.get(Analysis, analysis_id)
        row.status = "failed"
        row.error = f"{type(exc).__name__}: {exc}"
        row.finished_at = _now()
        session.commit()
    finally:
        session.close()
        with _lock:
            _running_id = None
            _cancel_event.clear()
