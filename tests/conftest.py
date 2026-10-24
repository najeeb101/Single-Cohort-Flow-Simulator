"""Pytest collects this before any test module's imports run, so setting DATABASE_URL here
(before src.db is ever imported) keeps the whole suite on an in-memory SQLite DB —
never touching the real data/app.db a dev server might be using.
"""
import os

os.environ.setdefault("DATABASE_URL", "sqlite:///:memory:")
# Intake Planner jobs run synchronously and in-process under test (src/jobs.py): no background
# thread to race the assertions, and no process pool to spawn for a handful of tiny runs.
os.environ.setdefault("INTAKE_JOBS_INLINE", "1")
os.environ.setdefault("INTAKE_WORKERS", "1")
