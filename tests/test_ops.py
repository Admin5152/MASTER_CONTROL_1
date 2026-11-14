"""Mission operations: environment and link from the profile, a blackout holds the digest, the priority rule."""
from brain.ground import Ground
from brain.ops import Ops


def state(**kw):
    s = {"display_name": "Eliah", "radiation": {"mission_profile": "mars_transit"}, "vitals": {"heart_rate": 64, "spo2": 98},
         "baseline": {"heart_rate": 64}, "manual": {"sleep_hours": 7.5}, "action": {"severity": "ok"}, "cabin": {"alert": False},
         "drift": {"items": []}}
    s.update(kw); return s


def test_environment_and_link_follow_the_profile():
    o = Ops()
    assert o.status("a", state())["env"] == "transit" and o.status("a", state())["comms"]["status"] == "delayed"
    assert o.status("a", state(radiation={"mission_profile": "iss"}))["comms"]["status"] == "live"
    o.set_mode("a", "rest")
    st = o.status("a", state())
    assert st["reminders_paused"] and st["urgent_only"]


def test_a_blackout_holds_the_digest_until_the_link_returns():
    t = [1000.0]
    o, g = Ops(clock=lambda: t[0]), Ground(persist=False, clock=lambda: t[0])
    o.blackout(10)
    assert o.status("a", state())["comms"]["status"] == "blackout"
    p = g.send("a", "digest", "Digest", {"text": "x"}, "ACT", o.hold_until())
    assert p["status"] == "queued (no link)"
    t[0] += 11 * 60
    assert g.list("a")[0]["status"] in ("queued", "in transit")


def test_statistics_alone_never_make_a_digest_urgent():
    o = Ops()
    drifted = state(drift={"items": [{"metric": "voice.talk_time", "delta_pct": -93, "severity": "alert"}]})
    d = o.digest("a", drifted, {"absolute": [], "zones": {"head": "alert"}})
    assert d["priority"] == "ACT" and "talk time -93%" in d["text"] and d["text"].startswith("SENTINEL DIGEST")
    assert o.digest("a", state(cabin={"alert": True}), {"absolute": []})["priority"] == "URGENT"
    assert o.digest("a", state(), {"absolute": []}, {"mode": "eva", "integrity": "breach", "pressure_psi": 3.8})["priority"] == "URGENT"


def test_eva_readiness_holds_for_short_sleep():
    r = Ops.readiness(state(manual={"sleep_hours": 4.5}))
    assert not r["ready"] and r["summary"].startswith("Hold the EVA") and "under 6 h" in r["summary"]
    assert Ops.readiness(state())["ready"]


def test_held_messages_leave_when_the_link_returns_early():
    t = [1000.0]
    o, g = Ops(clock=lambda: t[0]), Ground(persist=False, clock=lambda: t[0])
    o.blackout(15)
    g.send("a", "digest", "Digest", {"text": "x"}, "ACT", o.hold_until())
    t[0] += 60; o.blackout(0); g.release(); t[0] += 3
    assert g.list("a")[0]["status"] in ("queued", "in transit")
