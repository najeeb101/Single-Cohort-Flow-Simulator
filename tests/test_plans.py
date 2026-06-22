"""Tests for user-owned curriculum/config plans."""
from __future__ import annotations

from copy import deepcopy

from fastapi.testclient import TestClient

from src.api import app
from src.db import DEFAULT_PLAN_NAME
from src.models.course import load_curriculum
from src.utils import load_json


client = TestClient(app)


def _register(email: str) -> dict[str, str]:
    resp = client.post("/auth/register", json={"email": email, "password": "plan-test-password"})
    assert resp.status_code == 200
    token = resp.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def _import_payload(name: str = "Imported CS Plan") -> dict:
    curriculum = [
        {
            "code": course.code,
            "title": course.title,
            "credits": course.credits,
            "prerequisites": list(course.prerequisites),
            "pass_rate": course.pass_rate,
            "offering": list(course.offering),
            "category": course.category,
            "capacity": course.capacity,
            "rule_expr": course.rule_expr,
            "study_plan_order": course.study_plan_order,
        }
        for course in load_curriculum("data/curriculum.json").values()
    ]
    curriculum[0] = {**curriculum[0], "title": "Imported Plan Marker"}
    config = deepcopy(load_json("data/simulation_config.json"))
    return {"name": name, "curriculum": curriculum, "config": config}


def test_list_plans_starts_with_active_default_plan():
    headers = _register("plans_default@example.com")
    resp = client.get("/plans", headers=headers)

    assert resp.status_code == 200
    assert resp.json() == [
        {"id": resp.json()[0]["id"], "name": DEFAULT_PLAN_NAME, "is_default": True, "is_active": True}
    ]


def test_import_activate_export_and_delete_private_plan():
    headers = _register("plans_lifecycle@example.com")
    imported = client.post("/plans/import", json=_import_payload(), headers=headers)
    assert imported.status_code == 200
    plan = imported.json()
    assert plan["name"] == "Imported CS Plan"
    assert plan["is_default"] is False
    assert plan["is_active"] is False

    activate = client.post(f"/plans/{plan['id']}/activate", headers=headers)
    assert activate.status_code == 200
    assert activate.json()["is_active"] is True

    exported = client.get(f"/plans/{plan['id']}/export", headers=headers)
    assert exported.status_code == 200
    assert exported.json()["curriculum"][0]["title"] == "Imported Plan Marker"

    delete = client.delete(f"/plans/{plan['id']}", headers=headers)
    assert delete.status_code == 200
    assert delete.json() == {"ok": True}

    remaining = client.get("/plans", headers=headers).json()
    assert len(remaining) == 1
    assert remaining[0]["is_default"] is True
    assert remaining[0]["is_active"] is True


def test_private_plan_is_not_visible_to_other_users():
    owner_headers = _register("plans_owner@example.com")
    other_headers = _register("plans_other@example.com")
    plan = client.post("/plans/import", json=_import_payload("Private Plan"), headers=owner_headers).json()

    assert client.post(f"/plans/{plan['id']}/activate", headers=other_headers).status_code == 404
    assert client.get(f"/plans/{plan['id']}/export", headers=other_headers).status_code == 404
    assert all(p["id"] != plan["id"] for p in client.get("/plans", headers=other_headers).json())


def _activate_private_plan(headers: dict[str, str], name: str) -> int:
    plan = client.post("/plans/import", json=_import_payload(name), headers=headers).json()
    client.post(f"/plans/{plan['id']}/activate", headers=headers)
    return plan["id"]


_NEW_COURSE = {
    "code": "CMPS999",
    "title": "Independent Study",
    "credits": 3,
    "prerequisites": [],
    "pass_rate": 0.95,
    "offering": ["Fall", "Spring"],
    "category": "cs_elective",
    "capacity": 20,
    "rule_expr": None,
    "study_plan_order": 99,
}


def test_create_course_adds_to_active_plan():
    headers = _register("curriculum_create@example.com")
    _activate_private_plan(headers, "Create-course plan")

    resp = client.post("/curriculum", json=_NEW_COURSE, headers=headers)
    assert resp.status_code == 200
    assert resp.json()["code"] == "CMPS999"

    codes = [c["code"] for c in client.get("/curriculum", headers=headers).json()]
    assert "CMPS999" in codes


def test_create_course_duplicate_code_rejected():
    headers = _register("curriculum_dup@example.com")
    _activate_private_plan(headers, "Dup-course plan")
    client.post("/curriculum", json=_NEW_COURSE, headers=headers)

    resp = client.post("/curriculum", json=_NEW_COURSE, headers=headers)
    assert resp.status_code == 409


def test_create_course_rejects_self_referential_cycle():
    headers = _register("curriculum_create_cycle@example.com")
    _activate_private_plan(headers, "Create-cycle plan")

    self_referential = {**_NEW_COURSE, "prerequisites": ["CMPS999"]}
    resp = client.post("/curriculum", json=self_referential, headers=headers)
    assert resp.status_code == 422
    assert "cycle" in resp.json()["detail"]["message"]

    codes = [c["code"] for c in client.get("/curriculum", headers=headers).json()]
    assert "CMPS999" not in codes


def test_delete_course_removes_leaf_course():
    headers = _register("curriculum_delete@example.com")
    _activate_private_plan(headers, "Delete-course plan")
    client.post("/curriculum", json=_NEW_COURSE, headers=headers)

    resp = client.delete("/curriculum/CMPS999", headers=headers)
    assert resp.status_code == 200
    assert resp.json() == {"ok": True}

    codes = [c["code"] for c in client.get("/curriculum", headers=headers).json()]
    assert "CMPS999" not in codes


def test_delete_course_referenced_as_prerequisite_rejected():
    headers = _register("curriculum_delete_referenced@example.com")
    _activate_private_plan(headers, "Delete-referenced plan")
    courses = client.get("/curriculum", headers=headers).json()
    referenced_code = courses[0]["code"]
    referencing_code = next(c["code"] for c in courses if referenced_code in c["prerequisites"])

    resp = client.delete(f"/curriculum/{referenced_code}", headers=headers)
    assert resp.status_code == 422
    assert referencing_code in resp.json()["detail"]


def test_delete_course_not_found():
    headers = _register("curriculum_delete_missing@example.com")
    _activate_private_plan(headers, "Delete-missing plan")

    resp = client.delete("/curriculum/NOPE000", headers=headers)
    assert resp.status_code == 404


def test_create_and_delete_course_scoped_to_active_plan_only():
    headers = _register("curriculum_scope@example.com")
    default_courses_before = [c["code"] for c in client.get("/curriculum", headers=headers).json()]

    _activate_private_plan(headers, "Scoped plan")
    client.post("/curriculum", json=_NEW_COURSE, headers=headers)

    # Switch back to the shared default plan: the new course must not have leaked into it.
    plans = client.get("/plans", headers=headers).json()
    default_plan_id = next(p["id"] for p in plans if p["is_default"])
    client.post(f"/plans/{default_plan_id}/activate", headers=headers)

    default_courses_after = [c["code"] for c in client.get("/curriculum", headers=headers).json()]
    assert default_courses_after == default_courses_before
    assert "CMPS999" not in default_courses_after


def test_create_course_rejects_unknown_category():
    headers = _register("curriculum_bad_category@example.com")
    _activate_private_plan(headers, "Bad-category plan")

    resp = client.post("/curriculum", json={**_NEW_COURSE, "category": "not_a_real_category"}, headers=headers)
    assert resp.status_code == 422


def test_create_course_rejects_empty_offering():
    headers = _register("curriculum_empty_offering@example.com")
    _activate_private_plan(headers, "Empty-offering plan")

    resp = client.post("/curriculum", json={**_NEW_COURSE, "offering": []}, headers=headers)
    assert resp.status_code == 422


def test_create_course_rejects_unknown_offering_season():
    headers = _register("curriculum_bad_offering@example.com")
    _activate_private_plan(headers, "Bad-offering plan")

    # "Summer"/"Winter" are valid optional-term seasons (Term/Season Model); use a season
    # that's never valid to exercise the rejection path.
    resp = client.post("/curriculum", json={**_NEW_COURSE, "offering": ["Autumn"]}, headers=headers)
    assert resp.status_code == 422


def test_create_course_rejects_out_of_range_credits_and_capacity():
    headers = _register("curriculum_bad_numbers@example.com")
    _activate_private_plan(headers, "Bad-numbers plan")

    assert client.post("/curriculum", json={**_NEW_COURSE, "credits": -1}, headers=headers).status_code == 422
    assert client.post("/curriculum", json={**_NEW_COURSE, "credits": 10}, headers=headers).status_code == 422
    assert client.post("/curriculum", json={**_NEW_COURSE, "capacity": 0}, headers=headers).status_code == 422


def test_create_course_rejects_blank_code_or_title():
    headers = _register("curriculum_blank_fields@example.com")
    _activate_private_plan(headers, "Blank-fields plan")

    assert client.post("/curriculum", json={**_NEW_COURSE, "code": "   "}, headers=headers).status_code == 422
    assert client.post("/curriculum", json={**_NEW_COURSE, "title": ""}, headers=headers).status_code == 422


def test_update_course_rejects_unknown_category_and_offering():
    headers = _register("curriculum_update_invalid@example.com")
    _activate_private_plan(headers, "Update-invalid plan")
    existing_code = client.get("/curriculum", headers=headers).json()[0]["code"]

    assert client.put(
        f"/curriculum/{existing_code}", json={"category": "nope"}, headers=headers
    ).status_code == 422
    assert client.put(
        f"/curriculum/{existing_code}", json={"offering": ["Autumn"]}, headers=headers
    ).status_code == 422


def test_delete_course_rejects_emptying_the_plan():
    headers = _register("curriculum_delete_last@example.com")
    payload = {"name": "Single-course plan", "curriculum": [_NEW_COURSE], "config": _import_payload()["config"]}
    plan = client.post("/plans/import", json=payload, headers=headers).json()
    client.post(f"/plans/{plan['id']}/activate", headers=headers)

    resp = client.delete("/curriculum/CMPS999", headers=headers)
    assert resp.status_code == 422
    assert "last course" in resp.json()["detail"]


def test_default_plan_comes_seeded_with_instructors():
    headers = _register("instructors_seeded@example.com")
    resp = client.get("/instructors", headers=headers)
    assert resp.status_code == 200
    names = [i["name"] for i in resp.json()]
    assert "Dr. Ahmed Al-Sayed" in names  # data/instructors.json seed roster


_NEW_INSTRUCTOR = {"name": "Dr. Test Person", "categories": ["cs_core"], "max_sections_per_term": 3}


def test_create_list_update_delete_instructor():
    headers = _register("instructors_crud@example.com")
    _activate_private_plan(headers, "Instructor-crud plan")

    created = client.post("/instructors", json=_NEW_INSTRUCTOR, headers=headers)
    assert created.status_code == 200
    instructor_id = created.json()["id"]
    assert created.json()["name"] == "Dr. Test Person"

    listed = client.get("/instructors", headers=headers).json()
    assert any(i["id"] == instructor_id for i in listed)

    updated = client.put(
        f"/instructors/{instructor_id}",
        json={"max_sections_per_term": 5, "categories": ["cs_core", "cs_elective"]},
        headers=headers,
    )
    assert updated.status_code == 200
    assert updated.json()["max_sections_per_term"] == 5
    assert updated.json()["categories"] == ["cs_core", "cs_elective"]

    deleted = client.delete(f"/instructors/{instructor_id}", headers=headers)
    assert deleted.status_code == 200
    assert deleted.json() == {"ok": True}

    listed_after = client.get("/instructors", headers=headers).json()
    assert all(i["id"] != instructor_id for i in listed_after)


def test_create_instructor_duplicate_name_rejected():
    headers = _register("instructors_dup@example.com")
    _activate_private_plan(headers, "Instructor-dup plan")
    client.post("/instructors", json=_NEW_INSTRUCTOR, headers=headers)

    resp = client.post("/instructors", json=_NEW_INSTRUCTOR, headers=headers)
    assert resp.status_code == 409


def test_create_instructor_rejects_unknown_category():
    headers = _register("instructors_bad_category@example.com")
    _activate_private_plan(headers, "Instructor-bad-category plan")

    resp = client.post(
        "/instructors",
        json={**_NEW_INSTRUCTOR, "categories": ["not_a_real_category"]},
        headers=headers,
    )
    assert resp.status_code == 422


def test_create_instructor_rejects_blank_name_and_negative_load():
    headers = _register("instructors_bad_fields@example.com")
    _activate_private_plan(headers, "Instructor-bad-fields plan")

    assert client.post("/instructors", json={**_NEW_INSTRUCTOR, "name": "  "}, headers=headers).status_code == 422
    assert client.post(
        "/instructors", json={**_NEW_INSTRUCTOR, "max_sections_per_term": -1}, headers=headers
    ).status_code == 422


def test_update_delete_instructor_not_found():
    headers = _register("instructors_missing@example.com")
    _activate_private_plan(headers, "Instructor-missing plan")

    assert client.put("/instructors/999999", json={"max_sections_per_term": 1}, headers=headers).status_code == 404
    assert client.delete("/instructors/999999", headers=headers).status_code == 404


def test_instructor_scoped_to_active_plan_only():
    headers = _register("instructors_scope@example.com")
    _activate_private_plan(headers, "Instructor-scope plan")
    client.post("/instructors", json=_NEW_INSTRUCTOR, headers=headers)

    plans = client.get("/plans", headers=headers).json()
    default_plan_id = next(p["id"] for p in plans if p["is_default"])
    client.post(f"/plans/{default_plan_id}/activate", headers=headers)

    default_names = [i["name"] for i in client.get("/instructors", headers=headers).json()]
    assert "Dr. Test Person" not in default_names


def test_plan_import_export_round_trips_instructors():
    headers = _register("plans_instructors_roundtrip@example.com")
    payload = _import_payload("Plan with instructors")
    payload["instructors"] = [_NEW_INSTRUCTOR]

    imported = client.post("/plans/import", json=payload, headers=headers)
    assert imported.status_code == 200
    plan = imported.json()

    exported = client.get(f"/plans/{plan['id']}/export", headers=headers)
    assert exported.status_code == 200
    exported_names = [i["name"] for i in exported.json()["instructors"]]
    assert exported_names == ["Dr. Test Person"]


def test_plan_import_without_instructors_key_still_works():
    """Backward compatibility: a plan exported before this feature shipped has no
    "instructors" key at all — import_plan must default it to []."""
    headers = _register("plans_legacy_import@example.com")
    payload = _import_payload("Legacy plan, no instructors key")
    assert "instructors" not in payload

    imported = client.post("/plans/import", json=payload, headers=headers)
    assert imported.status_code == 200

    plan_id = imported.json()["id"]
    exported = client.get(f"/plans/{plan_id}/export", headers=headers)
    assert exported.json()["instructors"] == []


def test_import_rejects_blank_instructor_name():
    headers = _register("plans_bad_instructor@example.com")
    payload = _import_payload("Bad instructor plan")
    payload["instructors"] = [{"name": "  ", "categories": ["cs_core"], "max_sections_per_term": 3}]

    resp = client.post("/plans/import", json=payload, headers=headers)
    assert resp.status_code == 422


def test_import_rejects_prerequisite_cycle():
    headers = _register("plans_cycle@example.com")
    payload = {
        "name": "Cyclic Plan",
        "curriculum": [
            {
                "code": "A",
                "title": "A",
                "credits": 3,
                "prerequisites": ["B"],
                "pass_rate": 0.9,
                "offering": ["Fall"],
                "category": "cs_core",
                "capacity": 30,
            },
            {
                "code": "B",
                "title": "B",
                "credits": 3,
                "prerequisites": ["A"],
                "pass_rate": 0.9,
                "offering": ["Spring"],
                "category": "cs_core",
                "capacity": 30,
            },
        ],
        "config": {"cohort_size": 10, "scenarios": [{"name": "baseline"}]},
    }

    resp = client.post("/plans/import", json=payload, headers=headers)

    assert resp.status_code == 422
    assert "cycle" in resp.json()["detail"]
