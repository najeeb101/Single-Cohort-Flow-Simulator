"""Tests for the FastAPI wrapper (src/api.py) — the HTTP boundary over run_simulation
(ACIP plan §2.3/§3.2). Parity with run_simulation() mirrors the pattern in
tests/test_service.py::test_matches_manual_construction.
"""
from __future__ import annotations

from fastapi.testclient import TestClient

from src.api import app
from src.db import (
    SessionLocal,
    get_or_create_default_plan,
    load_config_from_db,
    load_curriculum_from_db,
)
from src.service import run_simulation

client = TestClient(app)

with SessionLocal() as _session:
    _plan = get_or_create_default_plan(_session)
    CURRICULUM = load_curriculum_from_db(_session, _plan.id)
    BASE_CONFIG = load_config_from_db(_session, _plan.id)
    BASE_SCENARIO = BASE_CONFIG["scenarios"][0]


def test_health():
    resp = client.get("/health")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}


def test_meta_shape():
    resp = client.get("/meta")
    assert resp.status_code == 200
    body = resp.json()
    assert set(body) == {
        "graph", "course_pass_rates",
        "baseline_scenario", "cohort_size", "num_cohorts", "num_incumbent_cohorts",
        "initial_state",
        "admission_terms", "admission_sizes",
        "optional_terms_enabled", "terms_per_year", "mandatory_terms",
        "max_terms", "seed",
        "dropout_gpa_floor",
        "dropout_base_hazard", "dropout_early_multiplier", "dropout_early_sem_cutoff",
        "dropout_fails_threshold", "dropout_prob_on_repeated_fail",
        "registration_tier_thresholds", "enrollment_priority_tiers",
        "year_standing_thresholds", "on_time_terms",
        "admission_targets", "llm_chat_enabled",
    }
    assert len(body["graph"]["nodes"]) == len(CURRICULUM)
    assert set(body["course_pass_rates"]) == set(CURRICULUM)
    assert set(body["initial_state"]) == {"occupancy", "standing"}


def test_simulate_initial_state_override_changes_capacity_and_background():
    code = next(iter(CURRICULUM))
    capacity = CURRICULUM[code].capacity
    overridden = {"occupancy": {code: 7}, "standing": {"Year3": 123}}

    resp = client.post("/simulate", json={"initial_state": overridden})
    assert resp.status_code == 200
    frames = resp.json()["flow_timeline"]["frames"]
    frame0 = next(f for f in frames if f["term"] == 0)

    # Occupancy reduced the course's free seats by exactly 7 on this mandatory term.
    assert frame0["courses"][code]["capacity"] == capacity - 7
    # Standing flowed into the aggregate stage nodes / background.
    assert frame0["background"] == {"Year3": 123}
    assert frame0["stages"]["totals"]["nodes"]["Year3"] >= 123


def test_update_config_rejects_malformed_initial_state():
    resp = client.put("/config", json={"initial_state": {"standing": {"Year9": 5}}})
    assert resp.status_code == 422


def test_update_config_rejects_non_positive_cohort_size():
    resp = client.put("/config", json={"cohort_size": 0})
    assert resp.status_code == 422


def test_update_config_rejects_occupancy_exceeding_capacity():
    # update_config does a shallow {**row.data, **patch} merge (pre-existing behavior, not
    # introduced here) — a partial `initial_state` patch replaces the WHOLE key, so every
    # write in these tests must round-trip the full initial_state, not just the one field
    # under test, or it silently drops the seeded baseline's real occupancy/standing data.
    code = next(iter(CURRICULUM))
    capacity = CURRICULUM[code].capacity
    original_initial_state = client.get("/config").json()["initial_state"]
    resp = client.put("/config", json={
        "initial_state": {
            **original_initial_state,
            "occupancy": {**original_initial_state["occupancy"], code: capacity + 1},
        },
    })
    assert resp.status_code == 422


def test_update_curriculum_rejects_capacity_below_existing_occupancy():
    code = next(iter(CURRICULUM))
    original_capacity = CURRICULUM[code].capacity
    original_initial_state = client.get("/config").json()["initial_state"]
    over = client.put("/config", json={
        "initial_state": {
            **original_initial_state,
            "occupancy": {**original_initial_state["occupancy"], code: 5},
        },
    })
    assert over.status_code == 200
    try:
        resp = client.put(f"/curriculum/{code}", json={"capacity": 4})
        assert resp.status_code == 422
        # The rejected edit must not have been committed.
        current = next(c for c in client.get("/curriculum").json() if c["code"] == code)
        assert current["capacity"] == original_capacity
    finally:
        client.put("/config", json={"initial_state": original_initial_state})


def test_simulate_rejects_non_positive_cohort_size():
    resp = client.post("/simulate", json={"cohort_size": 0})
    assert resp.status_code == 422


def test_simulate_rejects_admission_in_optional_season():
    # Same guardrail PUT /config already enforces (test_config_rejects_admission_in_optional_
    # season below) — POST /simulate's ephemeral ScenarioRequest overrides previously bypassed
    # it entirely, since _apply_scenario_overrides just copies admission_terms straight into
    # the config with no validation.
    resp = client.post("/simulate", json={"admission_terms": ["Fall", "Summer"]})
    assert resp.status_code == 422


def test_simulate_rejects_malformed_initial_state():
    resp = client.post("/simulate", json={"initial_state": {"standing": {"Year9": 5}}})
    assert resp.status_code == 422


def test_simulate_rejects_occupancy_exceeding_capacity():
    code = next(iter(CURRICULUM))
    capacity = CURRICULUM[code].capacity
    resp = client.post("/simulate", json={"initial_state": {"occupancy": {code: capacity + 1}}})
    assert resp.status_code == 422


def test_plan_rename_updates_private_and_default_plans():
    default_plan = next(p for p in client.get("/plans").json() if p["is_default"])
    original_default_name = default_plan["name"]
    export_payload = client.get(f"/plans/{default_plan['id']}/export").json()

    created = client.post(
        "/plans/import",
        json={**export_payload, "name": "Rename API Fixture"},
    )
    assert created.status_code == 200
    plan_id = created.json()["id"]

    try:
        renamed = client.patch(f"/plans/{plan_id}", json={"name": "Renamed API Fixture"})
        assert renamed.status_code == 200
        assert renamed.json()["name"] == "Renamed API Fixture"
        assert any(p["id"] == plan_id and p["name"] == "Renamed API Fixture" for p in client.get("/plans").json())

        default_rename = client.patch(f"/plans/{default_plan['id']}", json={"name": "Renamed Default Fixture"})
        assert default_rename.status_code == 200
        assert default_rename.json()["name"] == "Renamed Default Fixture"
    finally:
        client.patch(f"/plans/{default_plan['id']}", json={"name": original_default_name})
        client.delete(f"/plans/{plan_id}")


def test_simulate_default_matches_run_simulation():
    resp = client.post("/simulate", json={})
    assert resp.status_code == 200
    body = resp.json()
    assert set(body) == {"metrics", "cohort_metrics", "admissions_recommendation", "flow_timeline"}

    expected = run_simulation(CURRICULUM, BASE_CONFIG, BASE_SCENARIO)
    expected_top_fail = [list(pair) for pair in expected["metrics"].pop("top_fail_courses")]
    expected_top_capacity = [list(pair) for pair in expected["metrics"].pop("top_capacity_blocks")]
    expected_top_offering = [list(pair) for pair in expected["metrics"].pop("top_offering_blocks")]
    expected_top_prereq = [list(pair) for pair in expected["metrics"].pop("top_prereq_blocks")]
    expected_grad_dist = [list(pair) for pair in expected["metrics"].pop("graduation_time_distribution")]
    actual_metrics = dict(body["metrics"])
    assert actual_metrics.pop("top_fail_courses") == expected_top_fail
    assert actual_metrics.pop("top_capacity_blocks") == expected_top_capacity
    assert actual_metrics.pop("top_offering_blocks") == expected_top_offering
    assert actual_metrics.pop("top_prereq_blocks") == expected_top_prereq
    assert actual_metrics.pop("graduation_time_distribution") == expected_grad_dist
    assert actual_metrics == expected["metrics"]
    assert body["flow_timeline"]["meta"]["graph"] == expected["flow_timeline"]["meta"]["graph"]


def test_simulate_capacity_override_changes_result():
    # Pick whichever course tops the baseline's capacity-block ranking — hardcoding
    # CMPS303 would silently no-op if hand-tuned section counts move the bottleneck.
    baseline = client.post("/simulate", json={}).json()
    code, baseline_count = baseline["metrics"]["top_capacity_blocks"][0]

    boosted = client.post("/simulate", json={"capacity_overrides": {code: 3.0}}).json()
    boosted_count = dict(boosted["metrics"]["top_capacity_blocks"]).get(code, 0)

    assert boosted_count < baseline_count


def test_simulate_admissions_overrides_change_population():
    baseline = client.post("/simulate", json={}).json()
    shrunk = client.post("/simulate", json={"num_cohorts": 1, "num_incumbent_cohorts": 0}).json()

    assert shrunk["flow_timeline"]["meta"]["num_cohorts"] == 1
    assert shrunk["flow_timeline"]["meta"]["num_incumbent_cohorts"] == 0
    assert len(shrunk["flow_timeline"]["meta"]["cohorts"]) < len(baseline["flow_timeline"]["meta"]["cohorts"])


def test_simulate_fall_plus_spring_admission_override():
    # An ephemeral /simulate override (no DB mutation) adds a Spring intake: the study cohorts'
    # entry terms now include a Spring slot (t % 3 == 1 under the 3-season default cycle), never a
    # Summer one (t % 3 == 2), and a per-season size override is honored.
    resp = client.post("/simulate", json={
        "num_cohorts": 4,
        "admission_terms": ["Fall", "Spring"],
        "admission_sizes": {"Spring": 40},
    })
    assert resp.status_code == 200
    cohorts = resp.json()["flow_timeline"]["meta"]["cohorts"]
    entry_terms = sorted(c["entry_term"] for c in cohorts if not c["is_incumbent"])
    assert entry_terms == [0, 1, 3, 4]                 # Fall, Spring, Fall, Spring
    assert all(t % 3 != 2 for t in entry_terms)        # never Summer


def test_config_rejects_admission_in_optional_season():
    # Summer is optional in the default plan and can never admit — PUT /config must 422 without
    # mutating anything (a rejected write leaves the active plan untouched).
    resp = client.put("/config", json={"admission_terms": ["Fall", "Summer"]})
    assert resp.status_code == 422
    assert client.get("/meta").json()["admission_terms"] == ["Fall"]


def test_simulate_dropout_overrides_change_result():
    baseline = client.post("/simulate", json={}).json()
    raised = client.post("/simulate", json={"dropout_base_hazard": 0.9}).json()

    assert raised["metrics"]["academic_dropout_rate"] > baseline["metrics"]["academic_dropout_rate"]


def test_simulate_registration_tier_thresholds_override_accepted():
    resp = client.post("/simulate", json={"registration_tier_thresholds": [100, 80, 60, 40, 20]})
    assert resp.status_code == 200
    assert resp.json()["flow_timeline"]["meta"]["graph"]["nodes"]


def test_simulate_enrollment_priority_tiers_override_accepted():
    resp = client.post(
        "/simulate",
        json={"enrollment_priority_tiers": [{"categories": ["cs_core", "college_req"]}]},
    )
    assert resp.status_code == 200
    assert resp.json()["flow_timeline"]["meta"]["graph"]["nodes"]


# ── Per-student trace endpoints ──────────────────────────────────── #

def test_search_students_returns_capped_candidates():
    resp = client.post("/simulate/students/search", json={"limit": 5})
    assert resp.status_code == 200
    body = resp.json()
    assert set(body) == {"candidates", "total_matched"}
    assert len(body["candidates"]) <= 5
    for c in body["candidates"]:
        assert c["cohort_id"] >= 0  # study cohorts only
        assert c["final_status"] in {"GRADUATED", "DROPPED", "CENSORED"}


def test_search_students_status_filter():
    resp = client.post(
        "/simulate/students/search", json={"filter_final_status": "graduated", "limit": 50}
    )
    assert resp.status_code == 200
    assert all(c["final_status"] == "GRADUATED" for c in resp.json()["candidates"])


def test_search_students_rejects_bad_status():
    resp = client.post("/simulate/students/search", json={"filter_final_status": "nonsense"})
    assert resp.status_code == 422


def test_search_students_rejects_admission_in_optional_season():
    # Search shares _apply_scenario_overrides with /simulate, so the same guardrail applies.
    resp = client.post("/simulate/students/search", json={"admission_terms": ["Fall", "Summer"]})
    assert resp.status_code == 422


def test_student_trace_rejects_admission_in_optional_season():
    resp = client.post("/simulate/students/1/trace", json={"admission_terms": ["Fall", "Summer"]})
    assert resp.status_code == 422


def test_student_trace_full_journey():
    # Grab a real student id from a search, then trace it with the same (baseline) overrides.
    found = client.post("/simulate/students/search", json={"limit": 1}).json()
    sid = found["candidates"][0]["student_id"]

    resp = client.post(f"/simulate/students/{sid}/trace", json={})
    assert resp.status_code == 200
    trace = resp.json()
    assert trace["student_id"] == sid
    assert trace["final_status"] in {"GRADUATED", "DROPPED", "CENSORED"}
    assert trace["terms"], "a traced student should have at least one term"
    terms = [t["term"] for t in trace["terms"]]
    assert terms == sorted(terms)
    # Block events are captured on the trace path, so at least some term should show a signal
    # (early terms almost always have prereq-blocked courses).
    signals = {b["signal"] for t in trace["terms"] for b in t["blocked"]}
    assert signals <= {"capacity", "offering", "prereq"}


def test_student_trace_unknown_id_404():
    resp = client.post("/simulate/students/99999999/trace", json={})
    assert resp.status_code == 404
