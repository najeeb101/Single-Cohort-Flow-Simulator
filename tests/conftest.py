"""Pytest collects this before any test module's imports run, so setting DATABASE_URL/
AUTH_SECRET here (before src.db/src.api are ever imported) keeps the whole suite on an
in-memory SQLite DB — never touching the real data/app.db a dev server might be using.
"""
import os

os.environ.setdefault("DATABASE_URL", "sqlite:///:memory:")
os.environ.setdefault("AUTH_SECRET", "test-secret-at-least-32-bytes-long-for-hs256")
