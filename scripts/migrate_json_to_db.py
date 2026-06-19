"""One-time seed: data/curriculum.json + data/simulation_config.json -> data/app.db.

src/api.py's seed_if_empty() already auto-runs this on a fresh DB at startup, so a clean
clone "just works" with zero manual steps. Run this script explicitly when you've
hand-edited the JSON files mid-development and need to resync the DB:

    py scripts/migrate_json_to_db.py            # seed only if empty (no-op if already seeded)
    py scripts/migrate_json_to_db.py --force     # overwrite existing rows from the JSON files
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from src.db import SessionLocal, init_db, seed_if_empty


def main() -> int:
    force = "--force" in sys.argv[1:]
    init_db()
    with SessionLocal() as session:
        summary = seed_if_empty(session, force=force)
    print(
        f"courses inserted: {summary['courses_inserted']}, "
        f"skipped (already present): {summary['courses_skipped']}"
    )
    if summary["config_created"]:
        print("AppConfig row created")
    elif summary["config_updated"]:
        print("AppConfig row updated (--force)")
    else:
        print("AppConfig row already present, left unchanged")
    return 0


if __name__ == "__main__":
    sys.exit(main())
