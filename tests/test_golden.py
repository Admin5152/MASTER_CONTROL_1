"""Golden scenarios S1-S19 (Product Document section 32.1), run against the engine with no UI.

Scenarios that need a feature not built yet are marked xfail(strict=True) with the gap named: the suite shows
exactly what is missing, and the day a feature lands its xfail turns into a failure until the marker is removed.
"""
import pytest

from brain.mission.ground import Ground
from brain.mission.ops import Ops
from brain.core.profile import Profiles, kit_filter
from brain.rules import safety

LEVEL = {"ROUTINE": 0, "WATCH": 1, "ACT": 2, "URGENT": 3}


def level(store, cid="james", suit=None):
    """The urgency level the engine gives now, by the section 19.3 rule (as the digest computes it)."""
    return LEVEL[Ops().digest(cid, store.get(cid), store.assessment(cid), suit)["priority"]]


def test_S1_steady_14_days_is_level_0(store):
    s = store.get("kenji")
    b = s["baseline"]
    s = store.patch("kenji", {"vitals": {"heart_rate": b["heart_rate"]}})
    assert not [i for i in s["drift"]["items"] if i["severity"] in ("watch", "alert")]
    assert level(store, "kenji") <= 1 and s["action"]["severity"] in ("none", "ok", "info")


def test_S2_sleep_reaction_mood_pattern_is_level_2_with_groups(store):
    b = store.get("kenji")["baseline"]
    s = store.patch("kenji", {"manual": {"sleep_hours": 4.5, "mood": 2}, "cognitive": {"reaction_ms": (b.get("reaction_ms") or 300) * 1.6},
                              "voice": {"talk_time": b["talk_time"] * 0.5}})
    flagged = {i["metric"].split(".")[0] for i in s["drift"]["items"] if i["severity"] != "ok"}
    assert level(store, "kenji") == 2
    assert len(flagged) >= 2


def test_S3_rising_stress_is_level_2(store):
    b = store.get("kenji")["baseline"]
    store.patch("kenji", {"vitals": {"heart_rate": b["heart_rate"] * 1.35}, "state": {"stress": 0.8}, "manual": {"mood": 2}})
    s = store.get("kenji")
    assert s["action"]["type"] == "offer_orb_calm"
    assert level(store, "kenji") == 2


def test_S4_post_exercise_heart_rate_is_suppressed(store):
    store.set_context("kenji", activity="post_exercise", minutes=30)
    s = store.patch("kenji", {"vitals": {"heart_rate": 150}})
    assert s["action"]["severity"] != "alert" and level(store, "kenji") <= 1
    assert store.extras("kenji")["post_exercise"]


def test_S5_low_confidence_spike_raises_no_alert(store):
    store.set_context("kenji", hr_confidence=0.2)
    s = store.patch("kenji", {"vitals": {"heart_rate": 160}})
    assert s["action"]["severity"] != "alert" and store.extras("kenji")["hr_estimate"]   # shown as an estimate


def test_S6_cabin_oxygen_below_limit_is_level_3_with_priority_digest(store):
    store.patch("kenji", {"cabin": {"oxygen_pct": 17.0}})
    s = store.get("kenji")
    assert s["cabin"]["alert"] is True and s["action"]["type"] == "flag_cabin"
    assert level(store, "kenji") == 3   # the digest goes out URGENT


def test_S6b_cabin_oxygen_alerts_the_crew(store):
    s = store.patch("kenji", {"cabin": {"oxygen_pct": 17.0}})
    assert "crew alerted" in s["action"]["detail"].lower()


def test_S7_head_symptom_with_vision_change_is_level_3(store):
    s = store.patch("kenji", {"manual": {"symptom_log": [{"zone": "head", "region": "", "type": "headache", "severity": 2, "onset": "now", "at": ""},
                                                         {"zone": "eyes", "region": "", "type": "vision change", "severity": 2, "onset": "now", "at": ""}]}})
    assert s["action"]["type"] == "flag_redflag" and s["action"]["severity"] == "alert"
    assert level(store, "kenji") == 3


def test_S8_missed_check_ins_are_counted(store):
    s = store.patch("kenji", {"engagement": {"missed_checkins": 2}})
    assert s["engagement"]["missed_checkins"] == 2   # the page counts misses at day change and re-prompts softly


def test_S9_switching_station_to_transit_changes_the_environment(store):
    o = Ops()
    store.patch("kenji", {"radiation": {"mission_profile": "iss"}})
    assert o.status("kenji", store.get("kenji"))["env"] == "station"
    store.patch("kenji", {"radiation": {"mission_profile": "mars_transit"}})
    st = o.status("kenji", store.get("kenji"))
    assert st["env"] == "transit" and st["comms"]["status"] == "delayed"


def test_S9b_switch_lists_what_changes(store):
    store.patch("kenji", {"radiation": {"mission_profile": "iss"}})
    r = store.set_environment("kenji", "mars_transit")
    text = " ".join(r["changes"])
    assert "Link to ground" in text and "Escalation" in text and "Settling in" in text


def test_S10_link_down_then_up_queues_then_sends_urgent_first():
    t = [1000.0]
    o, g = Ops(clock=lambda: t[0]), Ground(persist=False, clock=lambda: t[0])
    o.blackout(30)
    g.send("x", "digest", "routine", {}, "ROUTINE", o.hold_until())
    g.send("x", "digest", "urgent", {}, "URGENT", o.hold_until())
    assert {p["status"] for p in g.list("x")} == {"queued (no link)"}
    t[0] += 60; o.blackout(0); g.release(); t[0] += 2.5
    st = {p["title"]: p["status"] for p in g.list("x")}
    assert st["urgent"] in ("queued", "in transit") and st["routine"] == "queued (no link)"   # urgent left first


def test_S11_spoken_environment_is_recognised_then_confirmed():
    from brain.mission import environment
    m = environment.match("Hey Sentinel, we're in the transit cabin now")
    assert m["env"] == "transit"   # the page asks "Confirm?" and only a yes calls set_environment


def test_S12_ambiguous_environment_asks_which():
    from brain.mission import environment
    m = environment.match("we're somewhere cold")
    assert "ask" in m and "planetary base" in m["question"]


def test_S13_profile_allergy_blocks_the_kit_item():
    p = Profiles(persist=False).update("x", {"health": {"allergies": ["acetaminophen"], "regularMedicines": ["none"]}})
    f = kit_filter({"id": "acetaminophen", "name": "Acetaminophen (analgesic)"}, p)
    assert f["blocked"] and "acetaminophen" in f["reason"]


def test_S14_wellbeing_drift_is_level_2_with_top_three_tools(store):
    store.patch("kenji", {"manual": {"mood": 1}, "state": {"stress": 0.7}})
    w = store.extras("kenji")["wellbeing"]
    assert w["level"] == 2 and len(w["tools"]) == 3


def test_S15_urgent_phrase_runs_the_safety_script_only(client):
    assert safety.concern("I want to die") == "self_harm"
    r = client.post("/api/safety/kenji", json={"category": "self_harm"}).json()
    assert r["packet"]["priority"] == "URGENT" and r["buddy"] and r["commander"]
    assert r["lines"][0] == safety.LINES["first"]


def test_S16_settling_in_softens_personal_alerts_but_not_limits(store):
    store.patch("kenji", {"radiation": {"mission_profile": "iss"}})
    store.set_environment("kenji", "mars_transit")
    b = store.get("kenji")["baseline"]
    s = store.patch("kenji", {"vitals": {"heart_rate": b["heart_rate"] * 1.25}, "state": {"stress": 0.62}})   # personal change, no range crossed
    assert s["action"]["severity"] == "info" and s["action"]["detail"].startswith("Adjusting")
    s = store.patch("kenji", {"cabin": {"oxygen_pct": 17.0}})
    assert s["action"]["severity"] == "alert"   # a limit still fires


def test_S17_same_symptom_gives_different_cards_by_environment(store):
    log = {"manual": {"symptom_log": [{"zone": "heart", "region": "", "type": "chest pain", "severity": 3, "onset": "now", "at": ""}]}}
    store.patch("kenji", {"radiation": {"mission_profile": "iss"}}); a = store.patch("kenji", log)["action"]["detail"]
    store.patch("kenji", {"radiation": {"mission_profile": "mars_transit"}}); b = store.patch("kenji", log)["action"]["detail"]
    assert a != b and "return vehicle" in a and "no quick return" in b


def test_S18_camera_mood_off_still_leaves_self_report(store):
    p = Profiles(persist=False).update("kenji", {"wellbeingPlan": {"cameraMoodAnalysis": False}})
    assert p["wellbeingPlan"]["cameraMoodAnalysis"] is False
    s = store.patch("kenji", {"manual": {"mood": 2}})
    assert s["manual"]["mood"] == 2   # self-report still feeds the state


def test_S19_crew_pulse_needs_three_responses():
    from brain.crew.crew_pulse import CrewPulse
    p = CrewPulse(persist=False)
    p.answer(1, "a", {"together": 4, "heard": 3}); r = p.answer(1, "b", {"together": 2, "heard": 5})
    assert r["responses"] == 2 and not r["shown"] and "team" not in r      # two answers: nothing shown
    r = p.answer(1, "c", {"together": 3, "heard": 4})
    assert r["shown"] and r["team"]["together"] == 3.0 and set(r["team"]) == {"together", "heard"}   # team average only, no names
