"""Tests for Clinical Experience & Workflows (Section 12 & Section 13).

Covers:
1. Section 12.1: The Five Modes (Monitor, Check-up, Triage, Treat & follow up, Escalate)
2. Section 12.2: A Day with Sentinel:
   - Wake (2-tap sleep & mood logging)
   - Morning check-in
   - Work block (passive monitoring)
   - Exercise (session logging + post_exercise pulse suppression)
   - EVA or sortie (readiness check + strict suit-air limits)
   - Something feels off (symptom triage)
   - Evening wind-down (stress check + Orb Calm offer)
   - Night (rest mode / DND)
   - Weekly review (adherence + countermeasure trends)
3. Section 13.1: Environment & Mode Spoken Understanding:
   - Station, transit, planetary base
   - EVA or sortie mode
   - Rest mode
   - Ambiguous phrases ask which applies
   - Same problem, different plan (severe, air, sleep, mood)
"""
import pytest
from brain.mission import environment as envmod
from brain.clinical.clinic import Clinic, CLINICAL_MODES, DAY_BLOCKS
from brain.mission.ops import Ops


def test_section_12_1_five_clinical_modes_defined():
    """Verify all 5 clinical modes from Section 12.1 exist with metadata."""
    assert set(CLINICAL_MODES.keys()) == {"monitor", "checkup", "triage", "treat", "escalate"}
    for mode, meta in CLINICAL_MODES.items():
        assert meta["title"]
        assert meta["description"]
        assert meta["icon"]


def test_section_12_1_clinical_mode_transitions(store):
    """Verify state transitions between the 5 clinical modes."""
    clinic = Clinic()
    cid = "james"
    ops = Ops()

    # 1. Nominal state -> monitor or checkup
    s = store.get(cid)
    asmt = store.assessment(cid)
    # Mark checkin done today to see monitor mode
    store.patch(cid, {"engagement": {"checkins_today": 1}})
    s = store.get(cid)
    assert clinic.get_clinical_mode(s, asmt, ops.status(cid, s)) == "monitor"

    # Reset checkins today to 0 -> checkup mode
    store.patch(cid, {"engagement": {"checkins_today": 0}})
    s = store.get(cid)
    assert clinic.get_clinical_mode(s, asmt, ops.status(cid, s)) == "checkup"

    # 2. Symptom reported or watch zone -> triage mode
    store.patch(cid, {"manual": {"symptom_log": [
        {"zone": "head", "region": "head", "type": "headache", "severity": 2, "onset": "now", "at": ""}
    ]}})
    s = store.get(cid)
    asmt = store.assessment(cid)
    assert clinic.get_clinical_mode(s, asmt, ops.status(cid, s)) in ("triage", "treat")

    # 3. Action recommendation active -> treat mode
    store.patch(cid, {"manual": {"symptoms": ["headache"]}})
    s = store.get(cid)
    asmt = store.assessment(cid)
    assert clinic.get_clinical_mode(s, asmt, ops.status(cid, s)) == "treat"

    # 4. Cabin air alert or severe redflag -> escalate mode
    store.patch(cid, {"cabin": {"oxygen_pct": 17.0}})
    s = store.get(cid)
    asmt = store.assessment(cid)
    assert clinic.get_clinical_mode(s, asmt, ops.status(cid, s)) == "escalate"


def test_section_12_2_day_blocks_mapping():
    """Verify mapping of mission hours to clinical day blocks."""
    clinic = Clinic()

    # 06:30 -> Wake block
    assert clinic.current_block(6.5)["id"] == "wake"

    # 07:45 -> Morning check-in
    assert clinic.current_block(7.75)["id"] == "morning_checkin"

    # 10:00 -> Work block
    assert clinic.current_block(10.0)["id"] == "work_block"

    # 13:00 -> Exercise block
    assert clinic.current_block(13.0)["id"] == "exercise"

    # 15:30 -> EVA or sortie
    assert clinic.current_block(15.5)["id"] == "eva_sortie"

    # 21:00 -> Evening wind-down
    assert clinic.current_block(21.0)["id"] == "evening_winddown"

    # 23:30 -> Night sleep block
    assert clinic.current_block(23.5)["id"] == "night_sleep"


def test_section_12_2_wake_flow_fast_logging(client, store):
    """Wake block: 2 taps for sleep hours and mood under 10 seconds."""
    cid = "kenji"

    r = client.post(f"/api/clinic/{cid}/block", json={
        "block": "wake",
        "sleep_hours": 7.5,
        "mood": 4,
    })
    assert r.status_code == 200
    data = r.json()
    assert data["ok"] is True
    assert data["sleep_hours"] == 7.5
    assert data["mood"] == 4

    # Verify state updated
    s = client.get(f"/api/state/{cid}").json()
    assert s["manual"]["sleep_hours"] == 7.5
    assert s["manual"]["mood"] == 4


def test_section_12_2_exercise_flow_with_pulse_suppression(client):
    """Exercise block: logs session and activates post-exercise pulse suppression (S4)."""
    cid = "amara"

    r = client.post(f"/api/clinic/{cid}/block", json={
        "block": "exercise",
        "minutes": 45,
        "activity": "cycle_ergometer",
    })
    assert r.status_code == 200
    data = r.json()
    assert data["ok"] is True
    assert data["minutes"] == 45

    # Context post_exercise is active
    aux = client.get(f"/api/aux/{cid}").json()
    assert aux["extras"]["post_exercise"] is True


def test_section_12_2_evening_winddown_and_night_rest(client):
    """Evening wind-down checks stress and Night block activates rest mode."""
    cid = "sofia"

    # Evening winddown with low stress
    r_winddown = client.post(f"/api/clinic/{cid}/block", json={
        "block": "evening_winddown",
        "mood": 3,
    })
    assert r_winddown.status_code == 200
    res = r_winddown.json()
    assert res["ok"] is True
    assert "recommendation" in res

    # Night block activates Rest mode (DND)
    r_night = client.post(f"/api/clinic/{cid}/block", json={"block": "night_sleep"})
    assert r_night.status_code == 200
    assert r_night.json()["mode"] == "rest"

    # Ops status confirms routine reminders paused
    aux = client.get(f"/api/aux/{cid}").json()
    assert aux["ops"]["mode"] == "rest"
    assert aux["ops"]["reminders_paused"] is True
    assert aux["ops"]["urgent_only"] is True


def test_section_12_2_weekly_review_summary(client):
    """Weekly review returns 7-day adherence, averages, and surgeon text."""
    cid = "lukas"
    r = client.get(f"/api/clinic/{cid}/weekly")
    assert r.status_code == 200
    rev = r.json()
    assert rev["ok"] is True
    assert "adherence_pct" in rev
    assert "summary_text" in rev
    assert "SENTINEL WEEKLY REVIEW" in rev["summary_text"]
    assert "sleep" in rev["stats"]
    assert "heart_rate" in rev["stats"]


def test_section_13_1_spoken_environment_and_mode_understanding():
    """Verify all phrases in Section 13.1 are understood correctly with confirmation."""
    # 1. Environment: station
    for phrase in [
        "Hey Sentinel, we're on the space station now",
        "we are in orbit",
        "on the station",
    ]:
        m = envmod.match(phrase)
        assert m is not None, f"Failed for '{phrase}'"
        assert m.get("env") == "station" or m.get("profile") == "iss"
        assert "Confirm?" in m["confirmation"]

    # 2. Environment: transit
    for phrase in [
        "Hey Sentinel, we're in the transit cabin now",
        "aboard the spacecraft",
        "we are on the way to Mars",
        "switch environment to transit",
    ]:
        m = envmod.match(phrase)
        assert m is not None, f"Failed for '{phrase}'"
        assert m.get("env") == "transit" or m.get("profile") == "mars_transit"
        assert "Confirm?" in m["confirmation"]

    # 3. Environment: planetary base
    for phrase in [
        "we have arrived at the moon base",
        "on the Mars base",
        "in the surface habitat",
    ]:
        m = envmod.match(phrase)
        assert m is not None, f"Failed for '{phrase}'"
        assert m.get("env") == "base"
        assert "Confirm?" in m["confirmation"]

    # 4. Mode: EVA or sortie
    for phrase in [
        "going outside",
        "starting an EVA",
        "ready for a spacewalk",
        "taking the rover out",
    ]:
        m = envmod.match(phrase)
        assert m is not None, f"Failed for '{phrase}'"
        assert m["type"] == "mode"
        assert m["mode"] == "eva"
        assert "Confirm?" in m["confirmation"]

    # 5. Mode: rest
    for phrase in [
        "going to sleep",
        "rest time",
        "bedtime",
    ]:
        m = envmod.match(phrase)
        assert m is not None, f"Failed for '{phrase}'"
        assert m["type"] == "mode"
        assert m["mode"] == "rest"
        assert "Confirm?" in m["confirmation"]

    # 6. Ambiguous query asks which option applies
    for phrase in [
        "we're somewhere cold",
        "what environment are we in",
    ]:
        m = envmod.match(phrase)
        assert m is not None, f"Failed for '{phrase}'"
        assert "ask" in m
        assert "planetary base" in m["question"]
        assert "EVA or sortie" in m["question"]


def test_section_13_3_same_problem_different_plan(client):
    """Verify notes per situation across mission profiles and EVA sortie mode (Section 13.3)."""
    for situation in ("severe", "air", "sleep", "mood"):
        note_station = envmod.card_note("iss", situation)
        note_transit = envmod.card_note("mars_transit", situation)
        note_base = envmod.card_note("mars_surface", situation)
        note_eva = envmod.card_note("mars_transit", situation, mode="eva")

        assert note_station, f"Missing note for iss.{situation}"
        assert note_transit, f"Missing note for transit.{situation}"
        assert note_base, f"Missing note for base.{situation}"
        assert note_eva, f"Missing note for eva.{situation}"

        # 1. Severe symptom (level 3)
        if situation == "severe":
            assert "return vehicle" in note_station.lower()
            assert "delayed reply" in note_transit.lower()
            assert "medical area" in note_base.lower()
            assert "stop work" in note_eva.lower() and "return to airlock" in note_eva.lower()

        # 2. Air alarm
        elif situation == "air":
            assert "mission emergency procedure" in note_station.lower()
            assert "compartment" in note_transit.lower()
            assert "suit stores" in note_base.lower()
            assert "suit values first" in note_eva.lower()

        # 3. Poor-sleep pattern
        elif situation == "sleep":
            assert "wind-down reminders" in note_station.lower()
            assert "light and schedule" in note_transit.lower()
            assert "day-length" in note_base.lower()
            assert "fatigue check before eva" in note_eva.lower()

        # 4. Low mood or high stress
        elif situation == "mood":
            assert "ground psychological support" in note_station.lower()
            assert "what helps me" in note_transit.lower()
            assert "connection nudges" in note_base.lower()
            assert "pause and breathing" in note_eva.lower()

    # Protocol variants query endpoint
    r_proto = client.get("/api/clinic/protocol/severe?env=transit&mode=eva")
    assert r_proto.status_code == 200
    p = r_proto.json()
    assert p["situation"] == "severe"
    assert p["variant"]["abort_advised"] is True
    assert "airlock" in p["escalation_note"].lower()


def test_section_13_2_environments_and_modes_specification():
    """Verify all 4 environments and 4 modes defined in Section 13.2."""
    # 4 Environments
    envs = envmod.ENVS
    assert set(envs.keys()) >= {"station", "transit", "base", "critical"}
    assert envs["station"]["in_plain_words"] == "Orbiting station with regular contact"
    assert envs["transit"]["in_plain_words"] == "Spacecraft cabin between worlds"
    assert envs["base"]["in_plain_words"] == "Surface habitat on the Moon or Mars"
    assert envs["critical"]["in_plain_words"] == "Short critical phases"

    # Wait tolerance rule: long wait carries more treatment locally; short escalates sooner
    assert envmod.wait_tolerance_min("iss") == 15.0
    assert envmod.wait_tolerance_min("mars_transit") == 180.0
    assert envmod.wait_tolerance_min("mars_surface") == 180.0
    assert envmod.wait_tolerance_min("critical") == 0.0

    # 4 Modes
    modes = envmod.MODES_SPEC
    assert set(modes.keys()) == {"routine", "eva", "rest", "contingency"}
    assert modes["routine"]["reminders_paused"] is False
    assert modes["eva"]["reminders_paused"] is True
    assert modes["rest"]["urgent_only"] is True
    assert modes["contingency"]["urgent_only"] is True


def test_section_13_2_wait_tolerance_in_ops_status(store):
    """Verify Ops.status reports wait tolerance and contingency mode behavior."""
    ops = Ops()
    cid = "james"

    # Station environment: short wait tolerance (15 min)
    s_iss = store.patch(cid, {"radiation": {"mission_profile": "iss"}})
    st_iss = ops.status(cid, s_iss)
    assert st_iss["wait_tolerance_min"] == 15.0
    assert "escalate early" in st_iss["escalation_policy"]
    assert "cardiovascular" in st_iss["watches_harder"].lower() or "heart" in st_iss["watches_harder"].lower()

    # Transit environment: long wait tolerance (180 min)
    s_transit = store.patch(cid, {"radiation": {"mission_profile": "mars_transit"}})
    st_transit = ops.status(cid, s_transit)
    assert st_transit["wait_tolerance_min"] == 180.0
    assert "on board first" in st_transit["escalation_policy"]
    assert "behavioral" in st_transit["watches_harder"].lower() or "behaviour" in st_transit["watches_harder"].lower()

    # Contingency mode
    ops.set_mode(cid, "contingency")
    st_cont = ops.status(cid, s_transit)
    assert st_cont["mode"] == "contingency"
    assert st_cont["contingency"] is True
    assert st_cont["urgent_only"] is True
    assert st_cont["reminders_paused"] is True


def test_section_13_4_environment_profiles_api(client):
    """Verify Section 13.4 environment profile JSON configuration endpoints."""
    # List profiles
    r_list = client.get("/api/environment/profiles")
    assert r_list.status_code == 200
    data = r_list.json()
    assert "station" in data["environments"]
    assert "transit" in data["environments"]
    assert "modes" in data

    # Detail profile for transit
    r_transit = client.get("/api/environment/profile/transit")
    assert r_transit.status_code == 200
    cfg = r_transit.json()
    assert cfg["id"] == "transit"
    assert cfg["comms"]["mode"] == "delayed"
    assert cfg["return_option"] == "none"
    assert cfg["escalation_policy"]["wait_tolerance_min"] == 180.0
    assert "isolation_confinement" in cfg["hazard_focus"]

    # Verify dataset evidence links to real files in dataset/
    assert len(cfg["dataset_evidence"]) >= 1
    mrid_entry = cfg["dataset_evidence"][0]
    assert mrid_entry["mrid"]
    from pathlib import Path
    root = Path(__file__).resolve().parent.parent
    assert (root / mrid_entry["file"]).exists()

    # Verify switching environment returns the profile config (Section 13.4)
    r_switch = client.post("/api/environment/james", json={"profile": "mars_transit"})
    assert r_switch.status_code == 200
    res_sw = r_switch.json()
    assert res_sw["to"] == "mars_transit"
    assert "profile_config" in res_sw
    assert res_sw["profile_config"]["id"] == "transit"

