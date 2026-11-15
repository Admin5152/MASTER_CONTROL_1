"""Personal health profile (Product Document section 14):
- Section 14.1: Principles (progressive growth, preloaded & confirmed, stays on device)
- Section 14.2: What the profile holds (7 sections)
- Section 14.3: How it is built (Day 0 -> Days 1-3 -> Days 3-7 Calibrating -> Completeness meter)
- Section 14.4: What the profile changes (AC-17 allergy block, AC-18 incomplete note, surgeon baseline adjustment, export, digest privacy)
"""
from brain.profile import Profiles, kit_filter, calibration_info
from brain.store import Store
from brain.ops import Ops
from brain.clinic import Clinic

ITEM = {"id": "ibuprofen", "name": "Ibuprofen (NSAID)"}


def test_completeness_grows_and_names_what_is_missing():
    p = Profiles(persist=False)
    first = p.get("a")
    assert first["completeness"] < 0.2 and "Allergies" in first["missing"]   # only the default reminder times are set
    later = p.update("a", {"callsign": "Ace", "health": {"allergies": ["none"]}, "sharing": {"buddy": "Seth"}})
    assert later["completeness"] > first["completeness"] and "Allergies" not in later["missing"]
    assert p.update("a", {"bogus": 1, "health": {"secret": 2}})["callsign"] == "Ace"   # unknown fields are ignored


def test_an_allergy_blocks_the_kit_item_with_the_reason():
    p = Profiles(persist=False)
    f = kit_filter(ITEM, p.update("a", {"health": {"allergies": ["ibuprofen"], "regularMedicines": ["none"]}}))
    assert f["blocked"] and "ibuprofen" in f["reason"]


def test_a_regular_medicine_adds_a_note_and_an_empty_profile_says_so():
    p = Profiles(persist=False)
    assert "check the label" in kit_filter(ITEM, p.get("x"))["note"].lower()
    f = kit_filter(ITEM, p.update("b", {"health": {"allergies": ["none"], "regularMedicines": ["warfarin"]}}))
    assert not f["blocked"] and "warfarin" in f["note"]


def test_section_14_1_preload_and_confirmation():
    p = Profiles(persist=False)
    preloaded = p.preload("kenji", {
        "callsign": "Kenji-1",
        "health": {"allergies": ["penicillin"], "regularMedicines": ["none"]},
        "sharing": {"buddy": "Eliah"},
    }, preloaded_by="flight_surgeon_dr_smith")
    assert preloaded["onboarding"]["preloaded"] is True
    assert preloaded["onboarding"]["preloadedBy"] == "flight_surgeon_dr_smith"
    assert preloaded["onboarding"]["confirmed"] is False

    confirmed = p.confirm("kenji", confirmed_by="kenji")
    assert confirmed["onboarding"]["confirmed"] is True
    assert confirmed["callsign"] == "Kenji-1"


def test_section_14_2_all_seven_profile_sections():
    p = Profiles(persist=False)
    prof = p.update("eliah", {
        "callsign": "El",
        "preferences": {"voice": "calm", "gloveMode": True, "reminderTimes": {"checkin": "07:30", "winddown": "22:00"}},
        "mission": {"environmentId": "transit", "mode": "routine", "dutySchedule": "shift_a", "sleepBlock": "22:00-06:00"},
        "health": {"allergies": ["none"], "conditions": ["mild_astigmatism"], "regularMedicines": ["multivitamin"], "pastKitReactions": ["none"]},
        "baselines": {"heart_rate": 62.0, "reaction_ms": 270.0},
        "wellbeingPlan": {"earlySigns": ["headache", "quietness"], "whatHelps": ["orb_calm", "greenhouse"], "whoToTalkTo": "Kenji"},
        "sharing": {"buddy": "Kenji", "shareUrgentWithCommander": True, "shareTrendsWithSurgeon": "on_request"},
        "emergency": {"buddy": "Kenji", "commander": "Sarah", "orderOfContact": ["buddy", "commander", "ground"]},
    })

    # Verify all 7 sections exist and are populated
    assert prof["preferences"]["voice"] == "calm"
    assert prof["mission"]["environmentId"] == "transit"
    assert "mild_astigmatism" in prof["health"]["conditions"]
    assert prof["baselines"]["heart_rate"] == 62.0
    assert "orb_calm" in prof["wellbeingPlan"]["whatHelps"]
    assert prof["sharing"]["buddy"] == "Kenji"
    assert prof["emergency"]["orderOfContact"] == ["buddy", "commander", "ground"]
    assert prof["completeness"] >= 0.9


def test_section_14_3_stages_and_calibrating_indicator():
    p = Profiles(persist=False)

    # Day 0: Onboarding
    d0 = calibration_info(p.get("kenji"), mission_day=0)
    assert d0["stage"] == "day_0"
    assert not d0["calibrating"]
    assert "Day 0" in d0["status_text"]

    # Day 2: Early days (health background & wellbeing)
    d2 = calibration_info(p.get("kenji"), mission_day=2)
    assert d2["stage"] == "days_1_3"
    assert not d2["calibrating"]

    # Day 4: Days 3-7 Calibrating ("Calibrating (n of N)")
    d4 = calibration_info(p.get("kenji"), mission_day=4, total_days=7)
    assert d4["stage"] == "calibrating"
    assert d4["calibrating"] is True
    assert d4["status_text"] == "Calibrating (4 of 7)"

    # Day 6: Still calibrating
    d6 = calibration_info(p.get("kenji"), mission_day=6, total_days=7)
    assert d6["status_text"] == "Calibrating (6 of 7)"

    # Day 8: Calibrated
    d8 = calibration_info(p.get("kenji"), mission_day=8, total_days=7)
    assert d8["stage"] == "established"
    assert d8["status_text"] == "Calibrated"
    assert d8["calibrated"] is True


def test_section_14_4_ac17_and_ac18_kit_filter_contract():
    p = Profiles(persist=False)

    # AC-17: Allergy blocks item and displays reason
    p.update("user_allergy", {"health": {"allergies": ["ibuprofen"], "regularMedicines": ["none"]}})
    filtered = kit_filter(ITEM, p.get("user_allergy"))
    assert filtered["blocked"] is True
    assert "Blocked: your profile lists ibuprofen" in filtered["reason"]

    # AC-18: Missing health background returns "profile incomplete, check the label"
    p_empty = p.get("user_empty")
    filtered_empty = kit_filter(ITEM, p_empty)
    assert filtered_empty["blocked"] is False
    assert "profile incomplete, check the label" in filtered_empty["note"].lower()


def test_section_14_4_surgeon_adjusted_baseline_syncs_to_store():
    store = Store(persist=False, fresh=True)
    p = Profiles(persist=False)
    # Surgeon adjusts Kenji's baseline heart rate to 75 bpm
    p.adjust_baseline("kenji", "heart_rate", 75.0, adjusted_by="flight_surgeon", reason="Post-EVA cardiovascular calibration", store=store)

    prof = p.get("kenji")
    assert prof["baselines"]["heart_rate"]["value"] == 75.0
    assert prof["baselines"]["heart_rate"]["adjustedBy"] == "flight_surgeon"

    # Runtime store baseline updated
    assert store.get("kenji")["baseline"]["heart_rate"] == 75.0


def test_section_14_4_export_and_sensitive_redaction():
    p = Profiles(persist=False)
    p.update("kenji", {
        "callsign": "Kenji-1",
        "health": {"allergies": ["aspirin"], "conditions": ["hypertension"], "regularMedicines": ["lisinopril"]},
    })

    # Full export includes sensitive health background
    full = p.export("kenji", include_sensitive=True)
    assert full["format"] == "sentinel_profile_export_v1"
    assert full["profile"]["health"]["allergies"] == ["aspirin"]

    # Redacted export strips confidential items
    redacted = p.export("kenji", include_sensitive=False)
    assert redacted["profile"]["health"]["allergies"] == ["[REDACTED]"]
    assert redacted["profile"]["health"]["conditions"] == ["[REDACTED]"]
    assert redacted["profile"]["health"]["regularMedicines"] == ["[REDACTED]"]
    assert redacted["profile"]["callsign"] == "Kenji-1"


def test_section_14_4_health_background_in_digest_requires_consent():
    store = Store(persist=False, fresh=True)
    ops = Ops()
    from brain.profile import profiles

    # Default profile: includeInDigest is False
    profiles.update("kenji", {
        "health": {"allergies": ["penicillin"], "regularMedicines": ["vitamin_d"], "includeInDigest": False}
    })
    s = store.get("kenji")
    d1 = ops.digest("kenji", s)
    assert "Health background" not in d1["text"]
    assert "penicillin" not in d1["text"]

    # Astronaut or surgeon explicitly opts in
    profiles.update("kenji", {
        "health": {"includeInDigest": True}
    })
    d2 = ops.digest("kenji", s)
    assert "Health background (consented)" in d2["text"]
    assert "penicillin" in d2["text"]


def test_section_14_morning_checkin_integration():
    store = Store(persist=False, fresh=True)
    clinic = Clinic()
    res = clinic.execute_checkin(
        store,
        "kenji",
        vitals={"heart_rate": 68.0, "spo2": 98.0},
        reaction_ms=295.0,
        profile_answer={"health": {"allergies": ["none"]}},
    )

    assert res["ok"] is True
    assert res["block"] == "morning_checkin"
    assert "Check-in complete" in res["summary_line"]
    assert res["profile_updated"] is True
    assert res["state"]["engagement"]["checkins_today"] >= 1
    assert res["next_question"] is not None
    assert res["next_question_prompt"] is not None


def test_delete_and_endpoints():
    from fastapi.testclient import TestClient
    import server
    c = TestClient(server.app)
    cid = c.get("/api/crew").json()[0]["crew_id"]

    # Patch and check
    assert c.patch(f"/api/profile/{cid}", json={"wellbeingPlan": {"whatHelps": ["orb_calm"]}}).json()["wellbeingPlan"]["whatHelps"] == ["orb_calm"]

    # Preload endpoint
    preload_resp = c.post(f"/api/profile/{cid}/preload", json={"callsign": "TestCall", "preloadedBy": "flight_surgeon"}).json()
    assert preload_resp["onboarding"]["preloaded"] is True

    # Confirm endpoint
    confirm_resp = c.post(f"/api/profile/{cid}/confirm").json()
    assert confirm_resp["onboarding"]["confirmed"] is True

    # Baseline adjustment endpoint
    base_resp = c.post(f"/api/profile/{cid}/baseline", json={"indicator": "heart_rate", "value": 72.0, "adjustedBy": "flight_surgeon"}).json()
    assert base_resp["baselines"]["heart_rate"]["value"] == 72.0

    # Export endpoint (full and redacted)
    export_full = c.get(f"/api/profile/{cid}/export?sensitive=true").json()
    assert export_full["format"] == "sentinel_profile_export_v1"

    export_redacted = c.get(f"/api/profile/{cid}/export?sensitive=false").json()
    assert export_redacted["format"] == "sentinel_profile_export_v1"

    # Clinic morning check-in endpoint
    checkin_resp = c.post(f"/api/clinic/{cid}/checkin", json={"vitals": {"heart_rate": 65}, "reaction_ms": 280}).json()
    assert checkin_resp["ok"] is True
    assert "Check-in complete" in checkin_resp["summary_line"]

    # Delete resets profile
    assert c.delete(f"/api/profile/{cid}").json()["completeness"] < 0.2


def test_section_14_4_table_row_early_signs_recognized():
    """Row 5: 'My early signs' -> Sentinel recognises them when the astronaut reports them."""
    store = Store(persist=False, fresh=True)
    from brain.profile import profiles
    # Configure Kenji's early signs in profile
    profiles.update("kenji", {
        "health": {"allergies": ["none"], "regularMedicines": ["none"]},
        "wellbeingPlan": {"earlySigns": ["headache", "tight_shoulders"], "whatHelps": ["orb_calm", "greenhouse"]},
    })
    # Kenji reports headache in symptoms
    s = store.patch("kenji", {"manual": {"symptoms": ["headache"]}})
    action = s.get("action", {})
    # Sentinel recognizes it from early signs
    assert "recognized from your personal early signs" in action.get("detail", "").lower()


def test_section_14_4_table_row_what_helps_me_tool_order():
    """Row 4: 'What helps me' -> Calming tools offered in the order that suits that person."""
    store = Store(persist=False, fresh=True)
    from brain.profile import profiles
    # User ranks greenhouse first, then race
    profiles.update("kenji", {
        "wellbeingPlan": {"whatHelps": ["greenhouse", "race"]},
    })
    # Simulate multi-dimension wellbeing drift (Level 2 support plan)
    s = store.patch("kenji", {"manual": {"mood": 2}, "state": {"stress": 0.7}})
    extras = store.extras("kenji")
    wb = extras.get("wellbeing", {})
    assert wb["level"] == 2
    # Top tools must start with user's preferred tool order
    assert wb["tools"][0] == "greenhouse"
    assert wb["tools"][1] == "race"


def test_section_14_4_table_row_duty_and_sleep_schedule_rest_respect():
    """Row 3: Duty and sleep schedule -> Reminders land at sensible times and respect rest."""
    from brain.profile import is_in_sleep_block, get_reminder_schedule
    prof = {
        "preferences": {"reminderTimes": {"checkin": "07:00", "winddown": "22:00"}},
        "mission": {"sleepBlock": "22:30-06:30", "dutySchedule": "transit_shift_b"},
    }
    sched = get_reminder_schedule(prof)
    assert sched["checkin_time"] == "07:00"
    assert sched["winddown_time"] == "22:00"

    # 23:00 is within 22:30-06:30 sleep block
    assert is_in_sleep_block(sched["sleep_block"], 23.0) is True
    # 03:00 is within sleep block
    assert is_in_sleep_block(sched["sleep_block"], 3.0) is True
    # 14:00 is awake hours
    assert is_in_sleep_block(sched["sleep_block"], 14.0) is False


def test_section_14_4_table_row_buddy_and_consent_crisis_routing():
    """Row 6: Buddy and consent choices -> Urgent alerts go to the right person; nothing else is shared."""
    from fastapi.testclient import TestClient
    import server
    c = TestClient(server.app)

    # Crew member sets designated buddy and opts out of commander alert
    c.patch("/api/profile/kenji", json={
        "sharing": {"buddy": "Eliah", "shareUrgentWithCommander": False},
        "emergency": {"buddy": "Eliah"},
    })

    resp = c.post("/api/safety/kenji", json={"category": "severe_distress"}).json()
    assert resp["buddy"] == "Eliah"
    assert "consent withheld" in resp["commander"].lower()
    assert "Eliah" in resp["lines"][1]

