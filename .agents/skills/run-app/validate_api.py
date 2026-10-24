"""In-process API smoke test for the CS Intake Planner — no running server needed.

Drives the real FastAPI app via TestClient against a throwaway on-disk SQLite DB (seeded fresh
from the JSON files), so it never touches data/app.db. Covers: the /simulate payload, the
Intake Planner job API (/intake-analyses: a tiny sweep + a tiny seat plan, run inline), and the
other-program-seats (initial_state) flow (/meta + /config persist + 422 validation +
reaches-the-engine).

Run from the repo root with the repo root on PYTHONPATH:
    PYTHONPATH=. py .claude/skills/run-app/validate_api.py
"""
import json
import os
import sys
import tempfile

_db = os.path.join(tempfile.gettempdir(), "scfs_validate_api.db")
if os.path.exists(_db):
    os.remove(_db)
os.environ["DATABASE_URL"] = f"sqlite:///{_db}"
# Run intake jobs synchronously and serially so the checks see finished rows.
os.environ["INTAKE_JOBS_INLINE"] = "1"
os.environ["INTAKE_WORKERS"] = "1"

from fastapi.testclient import TestClient  # noqa: E402
from src.api import app  # noqa: E402

client = TestClient(app)
fails = []


def check(name, cond, detail=""):
    print(f"[{'PASS' if cond else 'FAIL'}] {name}" + (f"  -- {detail}" if detail and not cond else ""))
    if not cond:
        fails.append(name)


# meta
meta = client.get("/meta").json()
check("meta has initial_state", set(meta.get("initial_state", {})) >= {"occupancy"})
check("meta has graph nodes", bool(meta.get("graph", {}).get("nodes")))

# Advisor data source: /simulate payload
sim = client.post("/simulate", json={}).json()
summary = sim["flow_timeline"]["summary"]
check("simulate: headline metrics present", {"graduation_rate", "on_time_rate"} <= set(summary["headline"]))
check("simulate: retired admissions_recommendation is gone", "admissions_recommendation" not in summary)
check("meta has intake_policy", {"max_grad_rate_loss_pts", "max_on_time_loss_pts"} <= set(meta.get("intake_policy", {})))

# Intake Planner jobs (tiny params so this stays a few seconds)
TINY = {"grid_min": 60, "grid_max": 80, "grid_step": 20, "seeds": 3, "refine_seeds": 3, "reference_runs": 1,
        "min_history_years": 0, "steady_seeds": 3, "robustness": False}
r = client.post("/intake-analyses", json={"params": TINY})
check("POST /intake-analyses 202", r.status_code == 202, r.text)
sweep = client.get(f"/intake-analyses/{r.json()['id']}").json()
check("sweep finished", sweep["status"] == "done", sweep.get("error") or "")
check("sweep has recommendation", "recommended_intake" in (sweep.get("result") or {}).get("recommendation", {}))
check("reference has no denials", (sweep.get("result") or {}).get("reference", {}).get("denials") == 0)
r = client.post("/intake-analyses", json={"kind": "seat_plan", "target_intake": 120, "run_budget": 1, "params": TINY})
plan = client.get(f"/intake-analyses/{r.json()['id']}").json()
check("seat plan finished", plan["status"] == "done", plan.get("error") or "")
section = meta.get("section_size", 35)
for ch in (plan.get("result") or {}).get("changes", []):
    check(f"seat plan {ch['code']} adds whole sections", ch["seats_added"] > 0 and ch["seats_added"] % section == 0)
check("seat plan without target -> 422", client.post("/intake-analyses", json={"kind": "seat_plan"}).status_code == 422)
check("retired admission_targets -> 422", client.put("/config", json={"admission_targets": {}}).status_code == 422)

# Initial-state persist + reject
r = client.put("/config", json={"initial_state": {"occupancy": {"CMPS151": 5}}})
check("PUT /config initial_state 200", r.status_code == 200)
persisted = client.get("/meta").json()["initial_state"]
check("initial_state persisted", persisted["occupancy"].get("CMPS151") == 5)
check("negative occupancy -> 422", client.put("/config", json={"initial_state": {"occupancy": {"CMPS151": -3}}}).status_code == 422)


def total_denied(payload):
    return sum(st.get("denied", 0) for f in payload["flow_timeline"]["frames"] for st in f.get("courses", {}).values())


client.put("/config", json={"initial_state": {"occupancy": {}}})
base = client.post("/simulate", json={}).json()
gateway_nodes = meta["graph"]["nodes"][:8]
# occupancy must not exceed a course's own capacity (validate_capacity_vs_occupancy) — use
# capacity - 1 per course (the heaviest allowed load) rather than a fixed value that could
# exceed a smaller course's capacity and 422 instead of reaching the engine.
heavy_occupancy = {n["code"]: max(0, n["capacity"] - 1) for n in gateway_nodes}
heavy = client.post("/simulate", json={"initial_state": {"occupancy": heavy_occupancy}}).json()
check("initial_state reaches engine (heavy occupancy raises denials)", total_denied(heavy) > total_denied(base),
      f"base={total_denied(base)} heavy={total_denied(heavy)}")

print()
if fails:
    print(f"==== {len(fails)} CHECK(S) FAILED: {fails} ====")
    sys.exit(1)
print("==== ALL API CHECKS PASSED ====")
