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

from src.db import SessionLocal, get_or_create_default_plan, init_db
from src.db_models import AppConfig, Course, Plan


def main() -> int:
    force = "--force" in sys.argv[1:]
    init_db()
    with SessionLocal() as session:
        existed = session.query(Plan).filter_by(owner_user_id=None).first() is not None
        plan = get_or_create_default_plan(session, force_reseed=force)
        course_count = session.query(Course).filter_by(plan_id=plan.id).count()
        has_config = session.query(AppConfig).filter_by(plan_id=plan.id).first() is not None
        plan_id = plan.id
        plan_name = plan.name
    if force:
        print(f"Default plan reseeded: {plan_name} (id={plan_id})")
    elif existed:
        print(f"Default plan already present: {plan_name} (id={plan_id})")
    else:
        print(f"Default plan created: {plan_name} (id={plan_id})")
    print(f"Courses: {course_count}")
    print(f"AppConfig: {'present' if has_config else 'missing'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
