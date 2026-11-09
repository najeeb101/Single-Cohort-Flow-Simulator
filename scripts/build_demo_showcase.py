"""Build data/demo_showcase.json: the precomputed intake analysis + seat plan a new visitor of the
public demo (DEMO_MODE=1, src/api/demo.py) sees straight away.

It runs the FULL-size analysis (not the demo's lite settings) on the shipped default plan, in a
throwaway database, so the result is exactly what a fresh host would compute from the JSON seed
and your real data/app.db is never touched. Takes a minute or two on a multi-core PC.

    py scripts/build_demo_showcase.py

Re-run it (and commit the file) whenever data/curriculum.json, data/simulation_config.json or the
planner's logic changes. tests/test_demo_mode.py fails if the file no longer matches the seed.
"""
from __future__ import annotations

import dataclasses
import json
import os
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))


def main() -> None:
    tmp = Path(tempfile.mkdtemp(prefix="demo_showcase_")) / "app.db"
    os.environ["DATABASE_URL"] = f"sqlite:///{tmp.as_posix()}"   # before src.storage.db is imported

    from src.api.app import _course_to_dict          # importing the app seeds + migrates the temp DB
    from src.planner import intake
    from src.storage.db import (SessionLocal, get_or_create_default_plan, load_config_from_db,
                                load_curriculum_from_db)

    with SessionLocal() as db:
        plan = get_or_create_default_plan(db)
        curriculum = load_curriculum_from_db(db, plan.id)
        config = load_config_from_db(db, plan.id)

    snapshot = {
        "curriculum": [_course_to_dict(c) for c in sorted(curriculum.values(), key=lambda c: c.study_plan_order)],
        "config": config,
    }
    policy = intake.policy_from_config(config)
    label = (config.get("planning") or {}).get("next_intake_label")

    def progress(fraction: float, note: str) -> None:
        print(f"\r  {fraction:5.0%}  {note[:70]:<70}", end="", flush=True)

    print("Running the intake sweep...")
    sweep = intake.run_intake_sweep(curriculum, config, policy=policy, progress=progress)
    print()
    rec = sweep["recommendation"]
    target = rec.get("recommended_intake") or rec.get("sustainable_intake") or 60
    print(f"Recommended {rec.get('recommended_intake')}, sustainable {rec.get('sustainable_intake')}; "
          f"planning seats for an intake of {target}...")
    plan_result = intake.run_seat_plan(curriculum, config, int(target), policy=policy, progress=progress)
    print()

    base_params = {"policy": {}, "params": {}, "target_intake": None, "run_budget": 6,
                   "policy_used": dataclasses.asdict(policy)}
    analyses = [
        {"kind": "intake_sweep", "label": label,
         "params": {**base_params, "policy": dataclasses.asdict(policy)},
         "inputs_snapshot": snapshot, "result": sweep},
        {"kind": "seat_plan", "label": label,
         "params": {**base_params, "policy": dataclasses.asdict(policy), "target_intake": int(target)},
         "inputs_snapshot": snapshot, "result": plan_result},
    ]
    out = ROOT / "data" / "demo_showcase.json"
    out.write_text(json.dumps({"analyses": analyses}, separators=(",", ":")), encoding="utf-8")
    print(f"Wrote {out} ({out.stat().st_size / 1024:.0f} KB)")


if __name__ == "__main__":
    main()
