"""Daily eye check (SANS screening aid): baseline, comparison, self-tests, privacy."""
from brain.eyes import EyeChecks, BASELINE_N

M = {"aperture": 0.30, "aperture_l": 0.30, "aperture_r": 0.30, "brow_lid": 0.42, "cheek_width": 2.10, "redness": 0.36}
IMG = "data:image/jpeg;base64,AAAA"


def check(e, **over):
    m = {**M, **over.pop("metrics", {})}
    return e.add("james", {"metrics": m, "near_blur": over.get("near_blur", False), "amsler_change": over.get("amsler_change", False),
                           "images": {"right": IMG, "left": IMG}})


def test_the_first_checks_build_a_baseline_and_never_alarm():
    e = EyeChecks(persist=False)
    for i in range(BASELINE_N):
        s = check(e, metrics={"cheek_width": 2.10 + i * 0.3})   # large swings while the baseline forms
        assert s["building_baseline"] and s["verdict"] == "ok"
    assert "baseline" in s["message"]


def test_a_steady_eye_is_no_change():
    e = EyeChecks(persist=False)
    for _ in range(BASELINE_N + 1):
        s = check(e)
    assert s["verdict"] == "ok" and s["message"] == "No change from your baseline today."


def test_facial_puffiness_beyond_the_limit_is_worth_a_look_and_names_the_exam():
    e = EyeChecks(persist=False)
    for _ in range(BASELINE_N):
        check(e)
    s = check(e, metrics={"cheek_width": 2.10 * 1.09})
    assert s["verdict"] == "watch" and s["changes"]["cheek_width"]["flag"]
    assert "flight surgeon" in s["message"] and "eye exam" in s["message"]


def test_blurry_near_vision_and_a_wavy_grid():
    e = EyeChecks(persist=False)
    for _ in range(BASELINE_N):
        check(e)
    assert check(e, near_blur=True)["verdict"] == "watch"
    s = check(e, amsler_change=True)
    assert s["verdict"] == "act" and s["message"].startswith("Tell the flight surgeon today")


def test_it_never_claims_a_diagnosis_and_cites_nasa():
    e = EyeChecks(persist=False)
    for _ in range(BASELINE_N):
        check(e)
    s = check(e, amsler_change=True, metrics={"aperture": 0.2})
    text = (s["message"] + s["nasa"]).lower()
    assert "sans" not in s["message"].lower() and "you have" not in text and "diagnos" not in text
    assert "MEDB 1.10" in s["nasa"] and "MR014S" in s["nasa"]


def test_photos_are_kept_for_comparison_and_can_be_forgotten():
    e = EyeChecks(persist=False)
    s = check(e)
    assert s["baseline"]["images"]["left"] == IMG and s["latest"]["images"]["right"] == IMG
    assert e.add("james", {"metrics": M, "images": {"left": "javascript:alert(1)"}})["latest"]["images"] == {}   # only JPEG data
    assert e.forget("james")["checks"] == 0


def test_eye_routes(client):
    m = {"aperture": 0.3, "aperture_l": 0.3, "aperture_r": 0.3, "brow_lid": 0.4, "cheek_width": 2.1, "redness": 0.35}
    r = client.post("/api/eyes/james", json={"metrics": m, "near_blur": False, "amsler_change": False})
    assert r.status_code == 200 and r.json()["checks"] >= 1
    assert client.get("/api/eyes/james").json()["checks"] >= 1
    assert client.get("/api/eyes/nobody").status_code == 404
    assert client.delete("/api/eyes/james").json()["checks"] == 0
