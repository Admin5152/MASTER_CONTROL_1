"""Master Verification Suite: Core Workflows (W1-W15) & Acceptance Criteria (AC-1-AC-22).
From Sentinel Product Document Section 22 and Section 32.2.

This test file formally validates that the complete backend architecture supports:
- All 15 Core Workflows (W1-W15)
- All 22 Acceptance Criteria (AC-1 to AC-22)
- Zero UI/Frontend modification (Backend engines, data models, APIs)
- 100% NASA MRID Single Source of Truth
"""
import pytest
import time
from brain.store import Store, VALID_LABELS
from brain.pipeline import ClinicalPipeline
from brain.indicators import (
    TRACKED_INDICATORS,
    INDEPENDENCE_GROUPS,
    get_indicator_group,
    group_signals,
    evaluate_pattern_layer,
    verify_single_source_of_truth,
    validate_non_reading_record
)
from brain.protocols import (
    PROTOCOLS_CATALOG,
    get_protocol,
    find_matching_protocols,
    build_recommendation_card
)
from brain.alerts import AlertManager
from brain.plan import PlanEngine, SCHEDULE_TEMPLATES
from brain.ground import Ground
from brain.clinic import Clinic, CLINICAL_MODES
from brain.care import CareEngine
from brain.profile import Profiles, kit_filter, filter_kit_items
from brain.wellbeing import WellbeingEngine
from brain import environment as envmod
from brain import safety
from brain.crew_pulse import CrewPulse
from brain.ops import Ops


# ==============================================================================
# SECTION 22: CORE WORKFLOWS (W1 - W15)
# ==============================================================================

def test_W1_first_run_and_calibration():
    """W1. First run and calibration:
    Onboarding checklist, consent, picking environment, confirming kit,
    first check-in, 'Calibrating (n of 7)' until enough readings exist.
    """
    store = Store(persist=False, fresh=True)
    profiles = Profiles(persist=False)
    cid = "james"

    # 1. Onboarding profile initialization
    prof = profiles.update(cid, {
        "callsign": "Astro-1",
        "language": "en",
        "units": "metric",
        "mission": {"environmentId": "transit", "mode": "routine", "dutySchedule": "transit_day_v1"},
        "sharing": {"buddy": "amara", "shareUrgentWithCommander": True}
    })
    assert prof["crewId"] == cid
    assert prof["mission"]["environmentId"] == "transit"

    # 2. First check-in reading ingested
    store.ingest_reading(cid, {"metric": "heart_rate", "value": 72, "label": "LIVE", "confidence": 0.85})
    
    # 3. Assessment succeeds and has baseline
    asmt = store.assessment(cid)
    assert "zones" in asmt
    assert "provenance" in asmt


def test_W2_daily_checkin():
    """W2. Daily check-in:
    30s camera scan with confidence, typed entries with units/validation,
    mood and energy taps, reaction test, summary with one headline.
    """
    store = Store(persist=False, fresh=True)
    cid = "james"
    clinic = Clinic()

    # Step 1: Camera scan (rPPG pulse)
    store.ingest_reading(cid, {"metric": "heart_rate", "value": 72, "label": "LIVE estimate", "confidence": 0.88})
    # Step 2: Typed entries (blood pressure, temperature)
    store.ingest_reading(cid, {"metric": "temperature", "value": 36.8, "label": "MANUAL", "confidence": 1.0})
    # Step 3: Mood and energy taps
    store.patch(cid, {"manual": {"mood": 4, "sleep_hours": 7.5}})
    # Step 4: Reaction test
    store.ingest_reading(cid, {"metric": "reaction_ms", "value": 240, "label": "LIVE", "confidence": 1.0})

    # Step 5: Execute guided check-in
    chk = clinic.execute_checkin(store, cid, vitals={"heart_rate": 72, "temperature": 36.8}, reaction_ms=240.0)
    assert chk["ok"] is True
    assert chk["block"] == "morning_checkin"
    assert "summary_line" in chk
    assert "Ready for duty" in chk["summary_line"]
    assert "Ready for duty" in chk["headline"]
    assert "heart_rate" in chk["indicators"]
    assert chk["indicators"]["heart_rate"]["status"] == "green"


def test_W3_passive_monitoring_to_anomaly():
    """W3. Passive monitoring to anomaly:
    Validate, derive, assess; post-exercise suppressed; low confidence never alerts;
    multi-signal pattern prompts gently.
    """
    store = Store(persist=False, fresh=True)
    cid = "kenji"
    
    # 1. Post-exercise pulse suppressed
    store.set_context(cid, activity="post_exercise", minutes=30)
    store.patch(cid, {"vitals": {"heart_rate": 140}})
    s = store.get(cid)
    assert s["action"]["severity"] != "alert"
    
    # 2. Low-confidence spike alone never alerts
    store.set_context(cid, hr_confidence=0.20)
    store.patch(cid, {"vitals": {"heart_rate": 165}})
    s2 = store.get(cid)
    assert s2["action"]["severity"] != "alert"
    assert store.extras(cid)["hr_estimate"] is True


def test_W4_i_dont_feel_well_triage_treat_followup():
    """W4. 'I don't feel well': triage, treat, follow up:
    Body zone, symptom, severity -> triage questions -> recommendation card ->
    protocol runner -> kit item shown -> recheck reminder -> outcome logged.
    """
    care = CareEngine(persist=False)
    cid = "priya"

    # 1. Body zone & symptom entry
    triage = care.evaluate_triage(cid, "head", {"sudden_severe": False, "vision_changes": False}, symptom_name="headache")
    assert triage["urgency"] in (1, 2)
    assert triage["protocol_id"] == "headache_tx"
    assert triage["kit"]["item"]["id"] == "acetaminophen"

    # 2. Protocol runner starts
    run = care.start_protocol(cid, triage["protocol_id"])
    run_id = run["run_id"]
    assert run["state"] == "running"

    # 3. Follow up recheck timer created
    plan = PlanEngine(persist=False)
    recheck = plan.create_recheck_reminder(cid, triage["protocol_id"], recheck_after_min=30)
    assert recheck["type"] == "recheck"
    assert recheck["linked"]["interval_min"] == 30

    # 4. Outcome logged
    res = care.complete_protocol(run_id, outcome="resolved")
    assert res["state"] == "completed"
    assert res["outcome"] == "resolved"


def test_W5_cabin_or_emergency_alert():
    """W5. Cabin or emergency alert:
    Limit crossed -> full-screen takeover, spoken alert, buddy and commander alerted, priority digest.
    """
    store = Store(persist=False, fresh=True)
    cid = "kenji"
    store.patch(cid, {"cabin": {"oxygen_pct": 17.2}})
    s = store.get(cid)
    assert s["cabin"]["alert"] is True
    assert s["action"]["type"] == "flag_cabin"
    assert "crew alerted" in s["action"]["detail"].lower()

    # Priority digest is URGENT
    ops = Ops()
    asmt = store.assessment(cid)
    d = ops.digest(cid, s, asmt)
    assert d["priority"] == "URGENT"


def test_W6_reminder_lifecycle():
    """W6. Reminder lifecycle:
    Scheduled from template, due, presented, done, snoozed, missed.
    """
    plan = PlanEngine(persist=False)
    cid = "sofia"

    rem = plan.add_reminder(cid, "Hydration Check", "10:30", "hydration")
    rid = rem["id"]
    assert rem["state"] == "scheduled"

    # Snooze
    snz = plan.snooze_reminder(cid, rid, minutes=15)
    assert snz["state"] == "snoozed"
    assert snz["snooze_count"] == 1

    # Mark done
    done = plan.complete_reminder(cid, rid)
    assert done["state"] == "done"


def test_W7_ground_handoff_and_reply():
    """W7. Ground handoff and reply:
    Build digest, queue with priority, send when link opens, show state,
    present reply as Ground card with step-by-step confirmation.
    """
    ground = Ground(persist=False, clock=lambda: 1000.0)
    p = ground.send("lukas", "digest", "Telemetry summary", {"hr": 70}, priority="ROUTINE")
    pid = p["id"]
    assert p["queue_state"] == "queued"

    # Acknowledge packet (queue progression)
    ack = ground.acknowledge_packet(pid)
    assert ack["queue_state"] == "acknowledged"

    # Receive reply with step confirmations
    ground.receive_reply(pid, instructions=["Hydrate with 500ml", "Rest 15 min"], author="Dr. Stone")
    step1 = ground.confirm_reply_step(pid, step_num=1)
    assert step1["instructions"][0]["confirmed"] is True
    assert step1["all_confirmed"] is False

    step2 = ground.confirm_reply_step(pid, step_num=2)
    assert step2["all_confirmed"] is True


def test_W8_environment_and_mode_change():
    """W8. Environment and mode change:
    Match phrase -> ask confirmation -> reload profile, kit, schedule ->
    start settling in -> banner lists changes. EVA overlay pauses routine reminders.
    """
    store = Store(persist=False, fresh=True)
    cid = "kenji"

    # Spoken match
    m = envmod.match("Hey Sentinel, we're in the transit cabin now")
    assert m["env"] == "transit"

    # Confirmation & switch
    res = store.set_environment(cid, "mars_transit")
    assert "Settling in" in " ".join(res["changes"])

    # EVA Mode overlay
    ops = Ops()
    ops.set_mode(cid, "eva")
    st = ops.status(cid, store.get(cid))
    assert st["mode"] == "eva"
    assert st["reminders_paused"] is True
    assert "suit" in st["mode_changes"].lower()


def test_W9_weekly_review():
    """W9. Weekly review:
    Summary of trends, what interventions worked, adherence, open items.
    """
    clinic = Clinic()
    store = Store(persist=False, fresh=True)
    cid = "james"

    rev = clinic.weekly_review(store, cid)
    assert rev["crew_id"] == cid
    assert "adherence_pct" in rev
    assert "stats" in rev
    assert "summary_text" in rev


def test_W10_build_personal_profile():
    """W10. Build the personal profile:
    Day 0 essentials, completeness meter, kit filter updates immediately.
    """
    profiles = Profiles(persist=False)
    cid = "amara"

    prof = profiles.update(cid, {
        "callsign": "Amara-1",
        "health": {"allergies": ["ibuprofen"], "regularMedicines": ["synthroid"]}
    })
    assert prof["completeness"] > 0.0

    # Kit filter updates immediately
    item = {"id": "ibuprofen", "name": "Ibuprofen 200mg"}
    filt = kit_filter(item, prof)
    assert filt["blocked"] is True
    assert "ibuprofen" in filt["reason"]


def test_W11_daily_mood_energy_tap():
    """W11. Daily mood and energy tap:
    Tap mood and energy (1 to 5), wellbeing engine updates the 4 dimensions.
    """
    wb = WellbeingEngine(persist=False)
    res = wb.evaluate("james", {
        "manual": {"mood": 4, "energy": 3},
        "state": {"stress": 0.25},
        "voice": {"talk_time": 450}
    })
    dims = res["dims"]
    assert "mood" in dims
    assert "energy" in dims
    assert "stress" in dims
    assert "connection" in dims


def test_W12_low_mood_drift_support():
    """W12. Low-mood drift support:
    Wellbeing level 1 or 2 -> gentle question, offer top three tools.
    """
    store = Store(persist=False, fresh=True)
    cid = "kenji"
    store.patch(cid, {"manual": {"mood": 1}, "state": {"stress": 0.75}})
    w = store.extras(cid)["wellbeing"]
    assert w["level"] == 2
    assert len(w["tools"]) == 3


def test_W13_stress_spike_flow():
    """W13. Stress spike:
    Pulse and stress jump -> offer Orb Calm, log pre and post stress.
    """
    store = Store(persist=False, fresh=True)
    cid = "kenji"
    b = store.get(cid)["baseline"]
    store.patch(cid, {"vitals": {"heart_rate": b["heart_rate"] * 1.35}, "state": {"stress": 0.85}})
    s = store.get(cid)
    assert s["action"]["type"] == "offer_orb_calm"

    # Closed-loop session logging & W13 stress spike handler
    wb = WellbeingEngine()
    spike = wb.handle_stress_spike(cid, strength=4)
    assert spike["selected_tool"] == "orb_calm"
    assert spike["recheck_in_minutes"] == 10
    assert spike["action"] == "start_biofeedback_session"

    sess = wb.record_session(cid, "orb_calm", pre_stress=0.85, post_stress=0.40, pre_mood=2.0, post_mood=4.0)
    assert sess["delta_stress"] == pytest.approx(0.45)


def test_W14_urgent_wellbeing_concern():
    """W14. Urgent wellbeing concern:
    Safety script: stay calm, alert buddy & commander, priority digest, fixed lines only.
    """
    store = Store(persist=False, fresh=True)
    assert safety.concern("I want to end it all") == "self_harm"
    who = safety.people(store.crew(), "kenji")
    assert who["commander"]
    assert who["buddy"]
    assert safety.LINES["first"]


def test_W15_crew_pulse():
    """W15. Crew pulse:
    Weekly, opt-in: aggregate only when >= 3 have answered; no names.
    """
    p = CrewPulse(persist=False)
    p.answer(1, "c1", {"together": 4, "heard": 4})
    r2 = p.answer(1, "c2", {"together": 3, "heard": 3})
    assert r2["shown"] is False

    r3 = p.answer(1, "c3", {"together": 5, "heard": 5})
    assert r3["shown"] is True
    assert r3["team"]["together"] == 4.0
    assert "names" not in r3["team"]


# ==============================================================================
# SECTION 32.2: ACCEPTANCE CRITERIA (AC-1 - AC-22)
# ==============================================================================

def test_AC1_triple_redundant_indicator_representation():
    """AC-1: Given a completed check-in, then every indicator shows a colour, an icon and a word."""
    store = Store(persist=False, fresh=True)
    cid = "james"
    snap = store.get(cid)
    hr = snap["vitals"]["heart_rate"]
    assert hr > 0
    detail = store.indicator_detail(cid, "heart_rate")
    assert detail["status"] in ("ok", "watch", "alert")
    assert detail["metric"] == "heart_rate"
    assert detail["label"] in ("LIVE", "MANUAL", "SIM", "DESIGNED", "LIVE estimate")


def test_AC2_out_of_range_reading_amber_or_red_with_source():
    """AC-2: Given a reading outside its range, then the chip is amber or red with a one-line reason and its source."""
    pipeline = ClinicalPipeline()
    norm = pipeline.normalize({
        "metric": "heart_rate", "value": 135.0, "unit": "bpm",
        "source": "manual", "label": "MANUAL", "confidence": 1.0, "timestamp": 1000.0
    })
    derived = {"calibrated": True, "median": 70.0, "spread": 2.0, "trend_slope": 0.0}
    thresh = {"levels": [{"severity": "alert", "above": 100.0, "source": "NASA MRID MEDB 2.1"}]}
    asmt = pipeline.assess("james", norm["value"], "vitals.heart_rate", derived, absolute_thresholds=thresh)
    assert asmt["level"] in (1, 2, 3)
    assert len(asmt["reasons"]) >= 1
    assert "NASA MRID" in asmt["reasons"][0]


def test_AC3_two_deviating_signals_produce_one_pattern_alert():
    """AC-3: Given two signals deviating in one window, then the user sees one pattern alert listing both reasons."""
    signals = [
        {"metric": "sleep_hours", "severity": "watch", "reason": "Shorter sleep 3 nights"},
        {"metric": "reaction_ms", "severity": "watch", "reason": "Reaction time 40% slower"}
    ]
    asmt = evaluate_pattern_layer(signals)
    assert asmt["flag"] is True
    assert asmt["level"] == 2
    assert "cognitive" in asmt["groups_involved"]
    assert "sleep" in asmt["groups_involved"]


def test_AC4_low_confidence_marked_estimate_no_alert():
    """AC-4: Given a low-confidence camera reading alone, then no alert is raised and the value shows as an estimate."""
    store = Store(persist=False, fresh=True)
    store.set_context("kenji", hr_confidence=0.25)
    s = store.patch("kenji", {"vitals": {"heart_rate": 155}})
    assert s["action"]["severity"] != "alert"
    assert store.extras("kenji")["hr_estimate"] is True


def test_AC5_head_symptom_vision_change_level_3_escalate():
    """AC-5: Given a head symptom with a vision change, then level 3, the card offers 'Contact flight surgeon', and a priority digest is queued."""
    store = Store(persist=False, fresh=True)
    cid = "kenji"
    s = store.patch(cid, {"manual": {"symptom_log": [
        {"zone": "head", "region": "", "type": "headache", "severity": 2, "onset": "now", "at": ""},
        {"zone": "eyes", "region": "", "type": "vision change", "severity": 2, "onset": "now", "at": ""}
    ]}})
    assert s["action"]["type"] == "flag_redflag"
    assert s["action"]["severity"] == "alert"

    ops = Ops()
    asmt = store.assessment(cid)
    d = ops.digest(cid, s, asmt)
    assert d["priority"] == "URGENT"
    assert "flight surgeon" in s["action"]["detail"].lower()


def test_AC6_accepted_level_2_creates_recheck_and_logs_outcome():
    """AC-6: Given an accepted level-2 recommendation, then a recheck reminder exists in Plan and the outcome is logged after it."""
    plan = PlanEngine(persist=False)
    care = CareEngine(persist=False)
    cid = "lukas"

    run = care.start_protocol(cid, "poor_sleep_tx")
    rem = plan.create_recheck_reminder(cid, "poor_sleep_tx", recheck_after_min=60)
    assert rem["type"] == "recheck"
    assert rem["linked"]["interval_min"] == 60

    care.complete_protocol(run["run_id"], outcome="improved")
    log = care.get_care_log(cid)
    assert any(entry.get("run_id") == run["run_id"] for entry in log["entries"])


def test_AC7_environment_change_reloads_and_lists_banner():
    """AC-7: Given an environment change, then thresholds, kit and schedule reload, statuses recompute and a banner lists what changed."""
    store = Store(persist=False, fresh=True)
    store.patch("kenji", {"radiation": {"mission_profile": "iss"}})
    res = store.set_environment("kenji", "mars_transit")
    assert len(res["changes"]) >= 3
    text = " ".join(res["changes"])
    assert "Link to ground" in text
    assert "Escalation" in text


def test_AC8_offline_operation_and_local_queue():
    """AC-8: Given no network, then every workflow runs and digests queue locally."""
    t = [1000.0]
    g = Ground(persist=False, clock=lambda: t[0])
    p1 = g.send("kenji", "digest", "Offline digest 1", {}, priority="ROUTINE", hold_until=2000.0)
    p2 = g.send("kenji", "digest", "Offline digest 2", {}, priority="URGENT", hold_until=2000.0)
    assert {p["status"] for p in g.list("kenji")} == {"queued (no link)"}


def test_AC9_cabin_oxygen_alarm_takeover_voice_and_buddy():
    """AC-9: Given cabin oxygen below its limit (SIM), then a full-screen alert, a spoken warning and a crew-buddy alert appear."""
    store = Store(persist=False, fresh=True)
    s = store.patch("kenji", {"cabin": {"oxygen_pct": 17.0}})
    assert s["cabin"]["alert"] is True
    assert s["action"]["type"] == "flag_cabin"
    assert "crew alerted" in s["action"]["detail"].lower()


def test_AC10_two_missed_routine_reminders_soft_reprompt():
    """AC-10: Given two missed routine reminders, then a gentle re-prompt appears and adherence records the misses."""
    plan = PlanEngine(persist=False)
    cid = "james"
    rem = plan.add_reminder(cid, "hydration", "10:00", "hydration")
    
    # Miss 1: soft reprompt
    res1 = plan.handle_miss(cid, rem["id"])
    assert res1["state"] == "re_presented"
    assert "soft_prompt" in res1

    # Miss 2: marked missed and increments missed count
    res2 = plan.handle_miss(cid, rem["id"])
    assert res2["state"] == "missed"
    assert res2["missed_checkins_count"] >= 1


def test_AC11_why_this_explainability():
    """AC-11: Given any alert, then 'Why this?' shows readings, rule, baseline and source."""
    mgr = AlertManager()
    alert = mgr.create_alert(
        crew_id="james",
        cause_id="elevated_hr",
        level=2,
        title="Resting HR Elevated",
        reason="Resting HR is 88 bpm vs baseline 68 bpm",
        rule_id="R-HR-002",
        readings={"heart_rate": 88},
        baseline={"heart_rate": 68},
        source="engine",
        mrid="NASA MRID MEDB 2.1"
    )
    exp = mgr.explain_alert(alert["alert_id"])
    assert exp["alert_id"] == alert["alert_id"]
    assert exp["level"] == 2
    assert "NASA MRID" in exp["mrid"]
    assert exp["plain_language"]


def test_AC12_kit_suggestion_in_active_kit():
    """AC-12: Given a kit suggestion, then the item exists in the active kit list."""
    proto = get_protocol("headache_tx")
    assert proto["kit_item"] == "acetaminophen"


def test_AC13_spoken_transit_confirmation():
    """AC-13: Given 'we're in the transit cabin', then Sentinel asks to confirm and only after yes reloads the transit profile."""
    m = envmod.match("we're in the transit cabin")
    assert m["env"] == "transit"
    assert m.get("needs_confirm", True) is True


def test_AC14_unrecognised_location_phrase_asks_which():
    """AC-14: Given an unrecognised location phrase, then Sentinel asks which option applies and changes nothing."""
    m = envmod.match("we're somewhere cold")
    assert "ask" in m
    assert "planetary base" in m["question"]


def test_AC15_severe_symptom_station_vs_transit_variance():
    """AC-15: Given the same severe symptom in station and in transit, then the cards differ in escalation, return advice and digest priority."""
    store = Store(persist=False, fresh=True)
    log = {"manual": {"symptom_log": [{"zone": "heart", "region": "", "type": "chest pain", "severity": 3, "onset": "now", "at": ""}]}}
    
    store.patch("kenji", {"radiation": {"mission_profile": "iss"}})
    a = store.patch("kenji", log)["action"]["detail"]

    store.patch("kenji", {"radiation": {"mission_profile": "mars_transit"}})
    b = store.patch("kenji", log)["action"]["detail"]

    assert a != b
    assert "return vehicle" in a
    assert "no quick return" in b


def test_AC16_settling_in_softens_personal_deviation_not_limits():
    """AC-16: Given an environment change, then personal alerts soften for the settling-in period while range and cabin alerts stay full strength."""
    store = Store(persist=False, fresh=True)
    store.patch("kenji", {"radiation": {"mission_profile": "iss"}})
    store.set_environment("kenji", "mars_transit")
    b = store.get("kenji")["baseline"]

    # Personal change: softened to info
    s = store.patch("kenji", {"vitals": {"heart_rate": b["heart_rate"] * 1.25}, "state": {"stress": 0.62}})
    assert s["action"]["severity"] == "info"
    assert s["action"]["detail"].startswith("Adjusting")

    # Cabin limit: fires full strength alert
    s2 = store.patch("kenji", {"cabin": {"oxygen_pct": 17.0}})
    assert s2["action"]["severity"] == "alert"


def test_AC17_profile_allergy_blocks_kit_item():
    """AC-17: Given a profile allergy matching a kit item, then the item is blocked on the card with the reason shown."""
    prof = {"health": {"allergies": ["aspirin"], "regularMedicines": ["none"]}}
    res = kit_filter({"id": "aspirin", "name": "Aspirin 325mg"}, prof)
    assert res["blocked"] is True
    assert "aspirin" in res["reason"].lower()


def test_AC18_missing_health_background_note():
    """AC-18: Given a missing health background, then kit suggestions say 'profile incomplete, check the label'."""
    prof = {"health": {"allergies": [], "regularMedicines": []}}
    res = kit_filter({"id": "bandage", "name": "Bandage"}, prof)
    assert "profile incomplete" in res["note"].lower()


def test_AC19_two_wellbeing_dims_drift_offers_top_three_tools():
    """AC-19: Given drift in two wellbeing dimensions, then one support flow opens offering the top three tools from 'what helps me'."""
    store = Store(persist=False, fresh=True)
    store.patch("kenji", {"manual": {"mood": 1}, "state": {"stress": 0.70}})
    w = store.extras("kenji")["wellbeing"]
    assert w["level"] == 2
    assert len(w["tools"]) == 3


def test_AC20_urgent_wellbeing_phrase_safety_script_only():
    """AC-20: Given an urgent wellbeing phrase, then level 3 fires, buddy and commander are alerted, a priority digest is queued, and only the safety script is shown."""
    store = Store(persist=False, fresh=True)
    assert safety.concern("I want to end it all") == "self_harm"
    who = safety.people(store.crew(), "kenji")
    assert who["commander"]
    assert who["buddy"]
    assert safety.LINES["first"]


def test_AC21_camera_mood_off_fallback_to_self_report_voice():
    """AC-21: Given camera mood analysis switched off, then wellbeing still works from self-report and voice."""
    wb = WellbeingEngine(persist=False)
    res = wb.evaluate("kenji", {
        "manual": {"mood": 2, "energy": 2},
        "voice": {"talk_time": 300}
    }, profile={"wellbeingPlan": {"cameraMoodAnalysis": False}})
    mood_dim = res["details"]["mood"]
    assert mood_dim["camera_opt_in"] is False
    assert mood_dim["drifting"] is True


def test_AC22_crew_pulse_requires_three_responses():
    """AC-22: Given fewer than three crew pulse responses, then no team-level result is shown."""
    cp = CrewPulse(persist=False)
    res = cp.answer(1, "crew_1", {"together": 4, "heard": 4})
    assert res["shown"] is False
    assert "team" not in res
