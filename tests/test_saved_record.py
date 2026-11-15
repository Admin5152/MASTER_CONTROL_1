"""What a crew member enters is stored, survives a restart and feeds the system (Product Document 17, 19.2, 19.4, 20).

Covers the gaps found in the part 4 and 5 audit: typed vitals and self-ratings, the non-reading records and the
alert history were not all persisted; a triage symptom could make the saved state unreadable; a ticked template
reminder lost its title; triage ignored severity.
"""
from __future__ import annotations

import pytest

from brain.core.contract import validate_full


@pytest.fixture()
def disk(tmp_path, monkeypatch):
    """A Store that really writes to disk, in a temp folder, with its own key."""
    from cryptography.fernet import Fernet
    import brain.core.store as store_mod
    import brain.core.vault as vault
    monkeypatch.setenv("SENTINEL_DATA_KEY", Fernet.generate_key().decode())
    monkeypatch.setattr(vault, "_fernet", None)
    monkeypatch.setattr(store_mod, "DATA", tmp_path)
    yield store_mod, tmp_path
    vault._fernet = None


def test_manual_entries_survive_a_restart(disk):
    store_mod, _ = disk
    a = store_mod.Store(persist=True, fresh=True)
    a.patch("james", {"manual": {"bp_systolic": 124, "stress_self": 4, "energy_self": 2, "mood_tags": ["tired"]},
                      "vitals": {"heart_rate": 71, "sources": {"heart_rate": "manual"}}})
    a.record_non_reading("james", "symptom", {"zone": "chest", "type": "chest tightness", "severity": 8, "onset": "now", "duration": "10 min"})
    a.record_non_reading("james", "kit_usage", {"item_id": "acetaminophen", "dose": "as label", "reason": "headache"})

    b = store_mod.Store(persist=True)   # the next start
    hr = b.history_for("james", "vitals.heart_rate")[-1]
    assert (hr["v"], hr["source"], hr["label"], hr["confidence"]) == (71.0, "manual", "MANUAL", 1.0)
    bp = b.history_for("james", "manual.bp_systolic")[-1]
    assert bp["v"] == 124 and bp["label"] == "MANUAL"
    s = b.get("james")
    assert s["manual"]["stress_self"] == 4 and s["manual"]["energy_self"] == 2 and s["manual"]["mood_tags"] == ["tired"]
    assert len(b.get_non_reading("james", "symptom")) == 1 and len(b.get_non_reading("james", "kit_usage")) == 1
    rec = b.saved_record("james")
    assert rec["persisted"] and rec["fields"]["vitals.heart_rate"]["entered"] == 1 and rec["fields"]["vitals.heart_rate"]["last_label"] == "MANUAL"
    assert rec["records"] == {"symptom": 1, "kit_usage": 1}


def test_a_triage_symptom_keeps_the_saved_state_valid(store):
    store.record_non_reading("james", "symptom", {"zone": "skin", "type": "rash", "severity": 8, "onset": "last week", "duration": "2 d"})
    s = store.get("james")
    validate_full(s)   # would raise if the 0-10 record had been copied into the frozen symptom log as it came
    e = s["manual"]["symptom_log"][0]
    assert e["severity"] == 3 and e["zone"] == "whole_body" and e["onset"] == "now" and set(e) == {"zone", "region", "type", "severity", "onset", "at"}


def test_an_unreadable_saved_state_is_kept_not_lost(disk):
    store_mod, tmp = disk
    (tmp / "state.json").write_text('{"states": {"james": {"broken": true}}, "history": {}}', encoding="utf-8")
    s = store_mod.Store(persist=True)
    assert s.has("james") and len(s.crew()) == 6   # a clean roster to carry on with
    assert list(tmp.glob("state.unreadable-*.json")), "the unreadable file must be kept beside the new one"


def test_personal_baseline_is_learned_from_stored_readings_and_bounded(store):
    for v in (78, 79, 80, 79, 78, 80, 79, 80, 79):
        store.patch("james", {"vitals": {"heart_rate": v, "sources": {"heart_rate": "manual"}}})
    before = store.get("james")["baseline"]["heart_rate"]
    r = store.learn_baselines("james", apply=True)
    m = r["indicators"]["vitals.heart_rate"]
    assert m["calibrated"] and m["entered"] == 9 and m["spread"] > 0
    after = store.get("james")["baseline"]["heart_rate"]
    assert r["applied"]["heart_rate"] == {"from": before, "to": after} and before != after
    assert "not a trained classifier" in r["note"]
    # bounded: the personal baseline moved, the range limit did not; an out-of-range value still alerts
    s = store.patch("james", {"manual": {"bp_systolic": 190, "bp_diastolic": 120}})
    assert s["action"]["severity"] == "alert"
    # a surgeon-adjusted baseline is left alone
    store.patch("kenji", {"vitals": {"heart_rate": 90}})
    assert "heart_rate" not in store.learn_baselines("kenji", apply=True, skip={"heart_rate"})["applied"]


def test_a_new_baseline_shows_calibrating_until_seven_readings(store):
    for v in (2, 3, 2):
        store.patch("james", {"manual": {"stress_self": v}})
    m = store.learn_baselines("james")["indicators"]["manual.stress_self"]
    assert not m["calibrated"] and m["stage"] == "Calibrating (3 of 7)"


def test_out_of_range_entry_becomes_one_explainable_alert(client):
    import server
    server.alerts.alerts.clear(); server.alerts.cooldowns.clear()
    client.post("/api/state/james/patch", json={"manual": {"bp_systolic": 172, "bp_diastolic": 104}})
    client.post("/api/state/james/patch", json={"manual": {"bp_systolic": 173, "bp_diastolic": 104}})   # same cause: cooled down
    al = client.get("/api/alerts/james").json()["alerts"]
    assert len(al) == 1 and al[0]["state"] == "presented" and al[0]["readings"].get("manual.bp_systolic") == 172
    why = client.get(f"/api/alerts/{al[0]['alert_id']}/explain").json()
    assert "manual.bp_systolic" in why["plain_language"] and why["mrid"]
    assert client.post(f"/api/alerts/{al[0]['alert_id']}/snooze", json={"reason": ""}).status_code == 400   # a snooze needs a reason
    assert any(e["event"] == "alert.detected" for e in client.get("/api/audit?q=alert").json()["entries"])


def test_wellbeing_self_ratings_feed_their_dimensions(client):
    client.post("/api/state/james/patch", json={"manual": {"stress_self": 5, "energy_self": 1, "connection_self": 1}})
    w = client.get("/api/wellbeing/james").json()
    assert w["dims"]["stress"] == 1 and w["dims"]["energy"] == 1 and w["dims"]["connection"] == 1 and w["level"] == 2
    assert w["details"]["stress"]["self_rating"] == 5
    assert len(w["tools"]) == 3   # the support plan offers the top three
    client.post("/api/state/james/patch", json={"manual": {"stress_self": 1, "energy_self": 4, "connection_self": 4}})
    assert client.get("/api/wellbeing/james").json()["dims"]["stress"] == 0


def test_triage_level_follows_severity_and_a_red_flag_escalates(client):
    def tri(sev, answers=None):
        return client.post("/api/care/triage/james", json={"zone": "head", "symptom": "headache", "severity": sev, "answers": answers or {}, "log": True}).json()
    assert [tri(2)["urgency"], tri(5)["urgency"], tri(8)["urgency"]] == [1, 2, 3]
    r = tri(1, {"vision_changes": True})
    assert r["urgency"] == 3 and r["packet"]["priority"] == "URGENT" and r["alerted"]["buddy"]
    log = client.get("/api/care/log/james").json()
    assert sum(1 for e in log["entries"] if e["type"] == "triage") >= 4
    validate_full(client.get("/api/state/james").json())


def test_a_symptom_with_no_protocol_gets_the_generic_card_not_a_wrong_one(client):
    r = client.post("/api/care/triage/james", json={"zone": "chest", "symptom": "hiccups", "severity": 2, "answers": {}}).json()
    assert r["protocol_id"] is None and r["urgency"] >= 2 and r["kit"] is None
    assert "could not match" in r["detail"] and r["recommendation_card"]["is_generic"]
    assert client.post("/api/care/protocol/start", json={"crew_id": "james", "protocol_id": "not_a_protocol"}).status_code == 404
    run = client.post("/api/care/protocol/start", json={"crew_id": "james", "protocol_id": "poor_sleep_tx"}).json()   # from the sourced library
    assert run["state"] == "running" and len(run["steps"]) >= 3 and "sleep" in run["title"].lower()


def test_symptoms_reach_the_right_protocol_and_vision_always_escalates(client):
    def tri(zone, symptom, sev=2):
        return client.post("/api/care/triage/james", json={"zone": zone, "symptom": symptom, "severity": sev, "answers": {}}).json()
    assert tri("gut", "stomach pain")["protocol_id"] == "stomach_upset_tx"          # not the motion-sickness plan
    assert tri("gut", "nausea")["protocol_id"] == "space_motion_sickness_tx"
    assert tri("head", "dizziness")["protocol_id"] == "space_motion_sickness_tx"    # not the headache plan
    assert tri("chest", "racing heart")["protocol_id"] == "high_resting_hr_tx"
    assert tri("whole_body", "fever or chills")["protocol_id"] == "raised_temp_tx"
    v = tri("eyes", "blurred vision", 1)
    assert v["protocol_id"] == "vision_change_tx" and v["urgency"] == 3              # always escalate (SANS)
    card = tri("gut", "stomach pain")["recommendation_card"]
    assert not card.get("is_generic") and len(card["now"]) >= 3 and "demo default" in card["source"]["title"].lower()
    run = client.post("/api/care/protocol/start", json={"crew_id": "james", "protocol_id": "stomach_upset_tx"}).json()
    assert run["demo_default"] and len(run["steps"]) == 5


def test_a_protocol_run_carries_its_alert_through_acting_to_resolved_or_escalated(client):
    import server
    server.alerts.alerts.clear(); server.alerts.cooldowns.clear()
    client.post("/api/state/james/patch", json={"manual": {"bp_systolic": 172, "bp_diastolic": 104}})
    aid = client.get("/api/alerts/james").json()["alerts"][0]["alert_id"]
    run = client.post("/api/care/protocol/start", json={"crew_id": "james", "protocol_id": "high_bp_tx"}).json()
    assert run["alert_id"] == aid and server.alerts.alerts[aid]["state"] == "acting"
    client.post(f"/api/care/protocol/{run['run_id']}/complete", json={"outcome": "Resolved after step 2 of 3"})
    assert server.alerts.alerts[aid]["state"] == "resolved"
    # not resolving: the alert escalates and a digest goes to the flight surgeon with what was done
    server.alerts.cooldowns.clear()
    client.post("/api/state/kenji/patch", json={"manual": {"bp_systolic": 175, "bp_diastolic": 105}})
    aid2 = client.get("/api/alerts/kenji").json()["alerts"][0]["alert_id"]
    run2 = client.post("/api/care/protocol/start", json={"crew_id": "kenji", "protocol_id": "high_bp_tx"}).json()
    esc = client.post(f"/api/care/protocol/{run2['run_id']}/escalate", json={"note": "Worse after step 1"}).json()
    assert server.alerts.alerts[aid2]["state"] == "escalated" and esc["packet"]["kind"] == "digest" and "Worse after step 1" in esc["packet"]["body"]["text"]


def test_an_unanswered_alert_is_presented_again_then_expires_and_alerts_the_buddy():
    from brain.clinical.alerts import AlertManager
    m = AlertManager()
    a = m.create_alert("james", "flag_ground:heart", level=3, title="Reading past the alert line", reason="x")
    m.present_alert(a["alert_id"])
    t0 = m.alerts[a["alert_id"]]["presented_at"]
    assert m.tick("james", now=t0 + 30) == {"represent": [], "expired": []}          # inside the timeout
    assert [x["represent_count"] for x in m.tick("james", now=t0 + 61)["represent"]] == [1]
    assert [x["represent_count"] for x in m.tick("james", now=t0 + 122)["represent"]] == [2]
    out = m.tick("james", now=t0 + 190)
    assert len(out["expired"]) == 1 and m.alerts[a["alert_id"]]["state"] == "expired" and m.alerts[a["alert_id"]].get("escalated_to_buddy")
    b = m.create_alert("james", "gentle:head", level=2, title="t", reason="r")
    m.present_alert(b["alert_id"]); m.acknowledge_alert(b["alert_id"])
    assert m.tick("james", now=m.alerts[b["alert_id"]]["presented_at"] + 9999)["represent"] == []   # answered: left alone


def test_not_useful_feedback_makes_the_personal_rules_less_sensitive_but_never_the_limits(store):
    b = store.get("kenji")["baseline"]["heart_rate"]
    pct = store.thresholds["drift"]["vitals.heart_rate"]["pct"]
    hr = round(b * (1 + (pct + 2) / 100.0), 1)        # just past the personal cut-off
    assert any(i["metric"] == "vitals.heart_rate" for i in store.patch("kenji", {"vitals": {"heart_rate": hr}})["drift"]["items"])
    store.sensitivity["gentle_checkin"] = 0.20          # four "not useful" answers: the bound
    assert not any(i["metric"] == "vitals.heart_rate" for i in store.patch("kenji", {"vitals": {"heart_rate": hr}})["drift"]["items"])
    store.sensitivity["gentle_checkin"] = 5.0           # out of bounds: clamped to 20%
    big = round(b * (1 + (pct * 1.25) / 100.0), 1)
    assert any(i["metric"] == "vitals.heart_rate" for i in store.patch("kenji", {"vitals": {"heart_rate": big}})["drift"]["items"])
    assert store.patch("kenji", {"manual": {"bp_systolic": 190, "bp_diastolic": 120}})["action"]["severity"] == "alert"   # safe limits unchanged


def test_ticked_and_snoozed_template_reminders_keep_their_title(client):
    done = client.post("/api/plan/james/complete", json={"reminder_id": "rem_checkin"}).json()
    assert done["state"] == "done"
    client.post("/api/plan/james/snooze", json={"reminder_id": "rem_lunch", "minutes": 15})
    client.post("/api/plan/james/snooze", json={"reminder_id": "rem_lunch", "minutes": 15})
    assert client.post("/api/plan/james/snooze", json={"reminder_id": "rem_lunch", "minutes": 15}).status_code == 400   # the limit
    plan = {r["id"]: r for r in client.get("/api/plan/james").json()["today_reminders"]}
    assert plan["rem_checkin"]["state"] == "done" and plan["rem_checkin"]["title"] and plan["rem_checkin"]["time"] == "08:00"
    assert plan["rem_lunch"]["state"] == "snoozed" and plan["rem_lunch"]["snooze_count"] == 2 and plan["rem_lunch"]["title"]
    assert all(r.get("title") for r in plan.values())
    # nothing is called done that was not done
    assert not any(r["state"] == "done" for i, r in plan.items() if i != "rem_checkin")
    # a new mission day starts clean
    client.post("/api/clock", json={"advance_hours": 24})
    assert {r["id"]: r for r in client.get("/api/plan/james").json()["today_reminders"]}["rem_checkin"]["state"] != "done"


def test_every_body_area_gets_steps_and_can_escalate(client):
    from brain.clinical.care import DEFAULT_PROTOCOLS
    cases = {"hand or wrist pain": ("bones", "muscle_joint_tx"), "numb or tingling fingers": ("bones", "muscle_joint_tx"), "swollen foot": ("bones", "muscle_joint_tx"),
             "knee or ankle pain": ("bones", "muscle_joint_tx"), "back pain": ("bones", "muscle_joint_tx"), "neck pain": ("bones", "muscle_joint_tx"),
             "chest tightness": ("chest", "chest_discomfort_tx"), "cough": ("lungs", "airway_cold_tx"), "sore throat": ("lungs", "airway_cold_tx"), "ear pain": ("lungs", "airway_cold_tx"),
             "rash": ("skin", "skin_care_tx"), "cut or scrape": ("skin", "skin_care_tx"), "unwell all over": ("whole_body", "general_unwell_tx"), "stomach pain": ("gut", "stomach_upset_tx")}
    for symptom, (zone, pid) in cases.items():
        r = client.post("/api/care/triage/james", json={"zone": zone, "symptom": symptom, "severity": 2, "answers": {}}).json()
        assert r["protocol_id"] == pid, (symptom, r["protocol_id"])
        card = r["recommendation_card"]
        assert len(card["now"]) >= 3 and card["escalate_if"] and "demo default" in card["source"]["title"].lower(), symptom
        run = client.post("/api/care/protocol/start", json={"crew_id": "james", "protocol_id": pid, "context": {"symptom": symptom}}).json()
        assert run["demo_default"] and len(run["steps"]) >= 4
        esc = client.post(f"/api/care/protocol/{run['run_id']}/escalate", json={"note": "Worse after step 1"}).json()
        assert esc["state"] == "escalated" and esc["packet"]["kind"] == "digest", symptom
    # numbness, swelling and chest symptoms are never just "watch"
    for zone, symptom in (("bones", "numb foot"), ("chest", "chest tightness"), ("bones", "swollen hand")):
        assert client.post("/api/care/triage/james", json={"zone": zone, "symptom": symptom, "severity": 1, "answers": {}}).json()["urgency"] >= 2
    # a red flag in any area still jumps to urgent
    r = client.post("/api/care/triage/james", json={"zone": "bones", "symptom": "hand or wrist pain", "severity": 2, "answers": {"deformity_bone": True}}).json()
    assert r["urgency"] == 3
    assert all(p.get("red_flags") for k, p in DEFAULT_PROTOCOLS.items() if p.get("demo_default"))


def test_a_finished_face_scan_is_saved_labelled_and_enters_the_pipeline(client):
    r = client.post("/api/scan/james", json={"kind": "face", "seconds": 15, "samples": 9, "heart_rate": 71.4, "confidence": 0.62, "breathing_rate": 15, "emotion": "neutral", "emotion_confidence": 0.7}).json()
    assert r["scan"]["saved"] == ["heart_rate", "breathing_rate", "expression"] and r["scan"]["label"] == "LIVE estimate"
    rec = client.get("/api/record/james").json()
    hr = rec["fields"]["vitals.heart_rate"]
    assert hr["last"] == 71 and hr["last_label"] == "LIVE estimate" and hr["last_source"] == "camera" and rec["records"]["scan"] == 1
    assert client.get("/api/state/james").json()["vitals"]["sources"]["heart_rate"] == "camera"
    assert client.get("/api/scans/james").json()["scans"][0]["heart_rate"] == 71
    assert any(e["event"] == "scan.recorded" for e in client.get("/api/audit?q=scan").json()["entries"])
    # a weak signal is kept as an estimate and raises nothing on its own (S5)
    r = client.post("/api/scan/james", json={"kind": "face", "seconds": 15, "samples": 3, "heart_rate": 150, "confidence": 0.2}).json()
    assert r["action"]["severity"] != "alert" and client.get("/api/aux/james").json()["extras"]["hr_estimate"] is True
    # nothing usable: nothing saved
    assert client.post("/api/scan/james", json={"kind": "face", "seconds": 15, "samples": 0}).status_code == 422
    # the body scan is kept too
    b = client.post("/api/scan/james", json={"kind": "body", "zones_flagged": ["heart"]}).json()["scan"]
    assert b["kind"] == "body" and b["zones_flagged"] == ["heart"] and "heart" in b["zones"]
    validate_full(client.get("/api/state/james").json())


def test_a_missed_schedule_checkin_is_reprompted_once_then_counted(client):
    first = client.post("/api/plan/james/miss", json={"reminder_id": "rem_checkin"}).json()
    assert first["state"] == "re_presented" and "soft_prompt" in first
    before = client.get("/api/state/james").json()["engagement"]["missed_checkins"]
    second = client.post("/api/plan/james/miss", json={"reminder_id": "rem_checkin"}).json()
    assert second["state"] == "missed" and second["missed_checkins_count"] == before + 1
    assert client.get("/api/state/james").json()["engagement"]["missed_checkins"] == before + 1
    assert client.post("/api/plan/james/miss", json={"reminder_id": "nope"}).status_code == 404


def test_the_nlsp_catalogue_is_human_data_grouped_and_linked():
    import json
    from pathlib import Path
    d = json.loads((Path(__file__).resolve().parent.parent / "shared" / "nlsp_catalog.json").read_text(encoding="utf-8"))
    assert d["kept"] == len(d["datasets"]) > 100 and "not training data" in d["use"].lower()
    assert all(x["groups"] and x["url"].startswith("https://nlsp.nasa.gov/") and x["title"] for x in d["datasets"])
    assert sum(d["by_group"].values()) >= d["kept"]


def test_a_new_crew_member_starts_clean_and_everything_works_for_them(client):
    c = client.post("/api/crew", json={"display_name": "Noor", "body_model": "female"}).json()
    cid = c["crew_id"]
    assert cid == "noor" and any(x["crew_id"] == cid for x in client.get("/api/crew").json())
    s = client.get(f"/api/state/{cid}").json()
    validate_full(s)
    assert s["manual"]["bp_systolic"] is None and s["manual"]["symptom_log"] == [] and s["action"]["type"] == "none"
    assert client.get(f"/api/record/{cid}").json()["fields"] == {}                      # no borrowed or SIM history
    assert client.post("/api/crew", json={"display_name": "noor"}).status_code == 422   # no duplicates
    assert client.post("/api/crew", json={"display_name": "x"}).status_code == 422
    client.post(f"/api/state/{cid}/patch", json={"manual": {"bp_systolic": 121, "bp_diastolic": 78, "sleep_hours": 7}})
    assert client.get(f"/api/baselines/{cid}").json()["indicators"]["manual.bp_systolic"]["stage"] == "Calibrating (1 of 7)"
    for path in ("clinic", "plan", "wellbeing", "trends", "care/log", "alerts", "onboarding", "profile", "exercise", "scans", "crew/%s/card"):
        url = f"/api/{path % cid}" if "%s" in path else f"/api/{path}/{cid}"
        assert client.get(url).status_code == 200, url
    assert client.post(f"/api/care/triage/{cid}", json={"zone": "head", "symptom": "headache", "severity": 5, "answers": {}, "log": True}).json()["urgency"] == 2
    assert client.post(f"/api/state/{cid}/patch", json={"manual": {"bp_systolic": 192, "bp_diastolic": 124}}).json()["action"]["severity"] == "alert"


def test_exercise_is_specific_and_sessions_add_up_over_the_day(client):
    plan = client.get("/api/exercise/james").json()
    assert plan["target_min"] == 120 and [s["id"] for s in plan["sessions"]][:3] == ["ared", "t2", "cevis"]
    assert all(s["minutes"] > 0 and s["how"] and s["why"] for s in plan["sessions"]) and plan["source"]["url"].startswith("https://www.nasa.gov/")
    a = client.post("/api/clinic/james/block", json={"block": "exercise", "minutes": 60, "activity": "ared"}).json()
    b = client.post("/api/clinic/james/block", json={"block": "exercise", "minutes": 30, "activity": "t2"}).json()
    assert a["total_today"] == 60 and b["total_today"] == 90 and "90 of 120 min today, 30 to go" in b["summary"]
    assert client.get("/api/state/james").json()["manual"]["exercise_minutes"] == 90
    today = client.get("/api/exercise/james").json()
    assert [s["activity"] for s in today["today"]] == ["ared", "t2"] and today["post_exercise"] is True
    client.post("/api/clock", json={"advance_hours": 24})   # a new mission day starts from zero
    assert client.post("/api/clinic/james/block", json={"block": "exercise", "minutes": 20, "activity": "cevis"}).json()["total_today"] == 20


def test_the_crew_card_shares_radiation_and_help_state_but_no_health_readings(client):
    k = client.get("/api/crew/amara/card").json()
    assert k["display_name"] == "Annie" and {"cumulative_msv", "storm_level", "sheltered", "margin_days"} <= set(k["radiation"]) and k["needs_help"] is False
    assert not ({"vitals", "manual", "health", "wellbeing", "drift", "action"} & set(k))


def test_seeded_demo_profiles_fill_in_until_the_person_saves_or_deletes(monkeypatch):
    from brain.core.profile import Profiles
    monkeypatch.delenv("SENTINEL_NO_SEED_PROFILES", raising=False)
    p = Profiles(persist=False)
    a = p.get("amara")
    assert a["callsign"] == "Annie" and a["health"]["allergies"] == ["ibuprofen"] and a["onboarding"]["preloaded"] and a["completeness"] > 0.8
    assert p.get("someone_new")["callsign"] == ""                                # only the roster is preloaded
    assert p.update("amara", {"health": {"allergies": ["latex"]}})["health"]["allergies"] == ["latex"]
    assert p.get("amara")["wellbeingPlan"]["whoToTalkTo"] == "Eliah"            # the rest of the preload is kept
    assert p.delete("amara")["callsign"] == "" and p.get("amara")["health"]["allergies"] == []   # deleted means empty


def test_sentinel_can_make_conversation_without_a_language_model():
    from brain.ai.llm import rules_reply, small_talk, OFFLINE_GENERAL
    st = {"display_name": "Eliah"}
    for said in ("hello", "how are you", "thanks", "tell me a joke", "I'm bored", "I miss my family", "can we talk", "good night"):
        line, cmds = rules_reply(st, said)
        assert line != OFFLINE_GENERAL and cmds == [], said
    assert "Eliah" in rules_reply(st, "good morning")[0]
    assert small_talk("what is the capital of france") is None and rules_reply(st, "what is the capital of france")[0] == OFFLINE_GENERAL   # no guessing


def test_the_chosen_buddy_is_notified_and_can_clear_it(client):
    import server
    server.notes.box.clear()
    server.profiles.update("james", {"sharing": {"buddy": "Seth", "shareUrgentWithCommander": True}})
    r = client.post("/api/care/triage/james", json={"zone": "head", "symptom": "headache", "severity": 2, "answers": {"vision_changes": True}, "log": True}).json()
    assert r["urgency"] == 3
    box = client.get("/api/notifications/kenji").json()          # Seth is kenji
    assert box["unread"] == 1 and "Eliah needs help now" == box["items"][0]["title"] and box["items"][0]["level"] == 3
    assert not ({"readings", "vitals", "symptom", "health"} & set(box["items"][0]))   # that help is needed, never what the readings are
    assert client.get("/api/notifications/amara").json()["count"] == 1              # the commander too, since Eliah allows it
    assert client.get("/api/notifications/james").json()["count"] == 0              # never to yourself
    assert client.get("/api/notifications/kenji?seen=true").json()["unread"] == 1 and client.get("/api/notifications/kenji").json()["unread"] == 0
    assert client.post("/api/notifications/kenji/clear", json={"id": box["items"][0]["id"]}).json()["count"] == 0
    # consent withheld: the commander is not told
    server.notes.box.clear()
    server.profiles.update("james", {"sharing": {"buddy": "Seth", "shareUrgentWithCommander": False}})
    client.post("/api/care/triage/james", json={"zone": "head", "symptom": "headache", "severity": 2, "answers": {"vision_changes": True}, "log": True})
    assert client.get("/api/notifications/kenji").json()["count"] == 1 and client.get("/api/notifications/amara").json()["count"] == 0
    assert client.post("/api/notifications/kenji/clear", json={}).json()["cleared"] == 1


def test_a_suit_leak_puts_a_notice_in_every_crewmates_inbox(client):
    import server
    server.notes.box.clear()
    client.post("/api/suit/james", json={"action": "eva"})
    client.post("/api/suit/james", json={"action": "leak", "region": "helmet"})
    others = [c["crew_id"] for c in client.get("/api/crew").json() if c["crew_id"] != "james"]
    assert all("suit pressure dropping" in client.get(f"/api/notifications/{o}").json()["items"][0]["title"] for o in others)
    assert client.get("/api/notifications/james").json()["count"] == 0
    client.post("/api/suit/james", json={"action": "seal"}); client.post("/api/suit/james", json={"action": "iva"})


def test_every_device_feeds_the_same_pipeline_through_one_door(client):
    # a watch reading is checked, labelled and stored like any other, and marks the watch connected
    r = client.post("/api/device/james", json={"device": "watch", "readings": [{"metric": "heart_rate", "value": 74, "confidence": 0.95}, {"metric": "spo2", "value": 97}]}).json()
    assert [a["metric"] for a in r["accepted"]] == ["heart_rate", "spo2"] and r["label"] == "LIVE" and r["rejected"] == []
    rec = client.get("/api/record/james").json()["fields"]
    assert rec["vitals.heart_rate"]["last"] == 74 and rec["vitals.heart_rate"]["last_label"] == "LIVE" and rec["vitals.heart_rate"]["last_source"] == "sensor"
    assert client.get("/api/state/james").json()["vitals"]["sources"]["heart_rate"] == "sensor"
    d = {x["id"]: x for x in client.get("/api/devices/james").json()["devices"]}
    assert d["watch"]["connected"] and d["watch"]["state"] == "LIVE" and d["watch"]["last"]["heart_rate"] == 74 and not d["chest_hub"]["connected"]
    # a simulator is labelled SIM, never LIVE
    client.post("/api/device/james", json={"device": "chest_hub", "sim": True, "readings": [{"metric": "breathing_rate", "value": 15}]})
    assert {x["id"]: x for x in client.get("/api/devices/james").json()["devices"]}["chest_hub"]["state"] == "SIM"
    assert client.get("/api/record/james").json()["fields"]["vitals.breathing_rate"]["last_label"] == "SIM"
    # a device cannot report what it does not measure; a sensor fault is refused, not stored
    r = client.post("/api/device/james", json={"device": "watch", "readings": [{"metric": "cabin_co2", "value": 600}, {"metric": "heart_rate", "value": 999}]}).json()
    assert r["accepted"] == [] and len(r["rejected"]) == 2 and client.get("/api/record/james").json()["fields"]["vitals.heart_rate"]["last"] == 74
    assert client.post("/api/device/james", json={"device": "toaster", "readings": [{"metric": "heart_rate", "value": 70}]}).status_code == 422
    # a device reading out of range raises the same alert a typed one would
    assert client.post("/api/device/kenji", json={"device": "watch", "readings": [{"metric": "spo2", "value": 82}]}).json()["action"]["severity"] == "alert"
    # the cabin sensors reach the whole crew
    client.post("/api/device/james", json={"device": "cabin", "sim": True, "readings": [{"metric": "cabin_co2", "value": 900}]})
    assert client.get("/api/state/amara").json()["cabin"]["co2_ppm"] == 900


def test_suit_telemetry_drives_the_suit_state_and_tells_the_crew(client):
    import server, time as _t
    server.notes.box.clear()
    ok = client.post("/api/device/james", json={"device": "suit", "sim": True, "readings": [{"metric": "suit_pressure_psi", "value": 4.3}, {"metric": "heart_rate", "value": 95}]}).json()
    assert ok["suit"]["mode"] == "eva" and ok["suit"]["integrity"] == "ok" and ok["suit"]["source"] == "suit telemetry" and ok["suit"]["label"] == "SIM"
    bad = client.post("/api/device/james", json={"device": "suit", "sim": True, "readings": [{"metric": "suit_pressure_psi", "value": 3.6}]}).json()
    assert bad["suit"]["integrity"] == "breach" and bad["suit"]["pressure_psi"] == 3.6 and len(bad["suit"]["steps"]) == 4
    assert "suit pressure dropping" in client.get("/api/notifications/amara").json()["items"][0]["title"]
    assert "EVA suit" in server.devices.summary("james", server.suits.status("james"))
    client.post("/api/suit/james", json={"action": "iva"})
    assert client.get("/api/aux/james").json()["suit"]["mode"] == "iva"


def test_the_assistant_can_say_what_is_connected():
    from brain.ai.llm import rules_reply
    line, cmds = rules_reply({"display_name": "Eliah", "devices": "Connected now: SpaceWear watch: heart rate 74, spo2 97."}, "which devices are connected")
    assert "SpaceWear watch" in line and cmds == [{"cmd": "open_screen", "name": "devices"}]
    assert "camera" in rules_reply({"display_name": "Eliah"}, "what sensors are working")[0].lower()
