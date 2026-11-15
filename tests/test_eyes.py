"""Daily eye check: blinking, eyelids, eye tracking, vision self-tests; baseline and plain verdicts."""
from brain.eyes import EyeChecks, BASELINE_N

M = {"blink_rate": 16.0, "incomplete": 0.1, "aperture": 0.30, "asymmetry": 0.04, "pursuit": 0.85, "lag_ms": 120}
SNAP = "data:image/jpeg;base64,AAAA"


def check(e, near_blur=False, amsler_change=False, **over):
    return e.add("james", {"metrics": {**M, **over}, "near_blur": near_blur, "amsler_change": amsler_change, "snapshot": SNAP})


def baseline(e):
    for _ in range(BASELINE_N):
        check(e)


def test_the_first_checks_build_a_baseline_and_never_alarm():
    e = EyeChecks(persist=False)
    for i in range(BASELINE_N):
        s = check(e, blink_rate=10 + i * 20)
        assert s["building_baseline"] and s["verdict"] == "ok"
    assert "baseline" in s["message"]


def test_steady_eyes_are_as_usual():
    e = EyeChecks(persist=False)
    baseline(e)
    s = check(e)
    assert s["verdict"] == "ok" and s["message"] == "Your eyes look and work as usual today."


def test_blinking_much_more_points_to_dry_or_tired_eyes_with_a_tip():
    e = EyeChecks(persist=False)
    baseline(e)
    s = check(e, blink_rate=30)
    assert s["verdict"] == "watch" and "dry or tired" in s["message"] and "drops" in s["message"]


def test_drooping_lids_uneven_lids_and_less_smooth_tracking():
    e = EyeChecks(persist=False)
    baseline(e)
    assert "eyelids are lower" in check(e, aperture=0.24)["message"]
    assert "one eyelid is lower" in " ".join(check(e, asymmetry=0.25)["notes"])
    assert "less smoothly" in check(e, pursuit=0.6)["message"]


def test_vision_self_tests():
    e = EyeChecks(persist=False)
    baseline(e)
    assert check(e, near_blur=True)["verdict"] == "watch"
    s = check(e, amsler_change=True)
    assert s["verdict"] == "act" and s["message"].startswith("Tell the flight surgeon today")


def test_never_a_diagnosis_and_cites_nasa():
    e = EyeChecks(persist=False)
    baseline(e)
    s = check(e, amsler_change=True, blink_rate=40)
    text = (s["message"] + " " + s["nasa"]).lower()
    assert "you have" not in text and "diagnos" not in text
    assert "MEDB 1.10" in s["nasa"] and "MR014S" in s["nasa"]


def test_the_mesh_snapshot_is_kept_and_can_be_forgotten():
    e = EyeChecks(persist=False)
    s = check(e)
    assert s["baseline"]["snapshot"] == SNAP and s["latest"]["snapshot"] == SNAP
    assert e.add("james", {"metrics": M, "snapshot": "javascript:alert(1)"})["latest"]["snapshot"] == ""   # only JPEG data
    assert e.forget("james")["checks"] == 0


def test_eye_routes(client):
    r = client.post("/api/eyes/james", json={"metrics": M, "near_blur": False, "amsler_change": False})
    assert r.status_code == 200 and r.json()["checks"] >= 1
    assert client.get("/api/eyes/james").json()["checks"] >= 1
    assert client.get("/api/eyes/nobody").status_code == 404
    assert client.delete("/api/eyes/james").json()["checks"] == 0
