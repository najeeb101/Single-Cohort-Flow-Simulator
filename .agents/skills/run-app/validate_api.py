"""In-process API smoke test for the Single-Cohort Flow Simulator — no running server needed.

Drives the real FastAPI app via TestClient against a throwaway on-disk SQLite DB (seeded fresh
from the JSON files), so it never touches data/app.db. Covers the recently-shipped surfaces:
the Advisor's data source (/simulate payload), the Auto-fill solver (/autofill), and the
initial-state flow (/meta + /config persist + 422 validation + reaches-the-engine).

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
adm = sim.get("admissions_recommendation") or summary.get("admissions_recommendation")
check("simulate: health criteria present", isinstance((adm or {}).get("criteria"), list) and len(adm["criteria"]) > 0)

# Auto-fill solver
af = client.post("/autofill", json={"run_budget": 3}).json()
check("autofill shape", {"feasible", "recommended", "criteria", "runs"} <= set(af))
check("autofill runs within budget", af["runs"] <= 3)
for code, rec in (af.get("recommended") or {}).items():
    check(f"autofill rec {code} is an increase", rec["recommended"] > rec["current"])

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
