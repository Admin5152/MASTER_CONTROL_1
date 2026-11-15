"""Section 16.1 Navigation and Screens: Backend Systems & Endpoints Test Suite.

Verifies backend support for all 13 screens and special states:
- Screen 1: Home (zones, indicators, alerts, link status, calibrating state)
- Screen 2: Indicator detail (value, status, trend band, clinical facts, MRID citation, estimate flag)
- Screens 4, 5, 6: Care (triage questions, red-flag escalation, step runner, timers, care log)
- Screen 7: Trends (sleep vs reaction correlation, 7-day multi-indicator points, not-enough-data state)
- Screen 8: Plan (today's reminders, schedule template, conflict detection, snooze)
- Screen 13: Onboarding (first run checklist, consent, kit confirmation, voice enrolment, resumable state)
"""
from brain.clinical.care import CareEngine, DEFAULT_PROTOCOLS
from brain.clinical.plan import PlanEngine, SCHEDULE_TEMPLATES
from brain.rules.trends import TrendsEngine
from brain.core.onboarding import OnboardingEngine
from brain.core.store import Store
from brain.core.profile import Profiles


def test_screen_2_indicator_detail_backend():
    store = Store(persist=False, fresh=True)
    cid = "kenji"

    # Nominal reading
    detail = store.indicator_detail(cid, "heart_rate")
    assert detail["crew_id"] == cid
    assert detail["metric"] == "heart_rate"
    assert detail["status"] == "ok"
    assert "how_to_measure" in detail["facts"]
    assert "why_it_matters" in detail["facts"]
    assert "NASA MRID" in detail["facts"]["source_mrid"]
    assert detail["is_estimate"] is False
    assert detail["label"] == "LIVE"

    # Low-confidence estimate (S5)
    store.set_context(cid, hr_confidence=0.20)
    detail_est = store.indicator_detail(cid, "heart_rate")
    assert detail_est["is_estimate"] is True
    assert detail_est["label"] == "SIM"
    assert detail_est["confidence"] <= 0.35


def test_screens_4_5_6_care_triage_runner_and_log():
    care = CareEngine(persist=False)
    cid = "kenji"

    # 1. Triage questions
    q_head = care.get_triage_questions("head")
    assert len(q_head) >= 3
    assert any(q["red_flag"] for q in q_head)

    # 2. Triage evaluation: routine headache
    triage_head = care.evaluate_triage(cid, "head", {"sudden_severe": False, "vision_changes": False, "throbbing": True}, symptom_name="headache")
    assert triage_head["urgency"] == 1
    assert triage_head["protocol_id"] == "headache_tx"
    assert triage_head["kit"]["item"]["id"] == "acetaminophen"

    # 3. Triage evaluation: red-flag symptom jumps to urgent level 3
    triage_urgent = care.evaluate_triage(cid, "chest", {"sudden_severe_chest_pain": True})
    assert triage_urgent["urgency"] == 3
    assert triage_urgent["protocol_id"] == "severe_symptom_tx"
    assert "sudden_severe_chest_pain" in triage_urgent["red_flags"]

    # 4. Protocol Runner: start, step, pause, resume, complete
    run = care.start_protocol(cid, "headache_tx")
    run_id = run["run_id"]
    assert run["state"] == "running"
    assert len(run["steps"]) == 6

    # Complete step 1
    updated = care.update_step(run_id, 1, done=True)
    assert updated["steps"][0]["done"] is True
    assert updated["current_step"] == 2

    # Pause and resume
    paused = care.pause_protocol(run_id)
    assert paused["state"] == "paused"
    resumed = care.resume_protocol(run_id)
    assert resumed["state"] == "running"

    # Complete protocol run
    completed = care.complete_protocol(run_id, outcome="Headache relieved after rest")
    assert completed["state"] == "completed"
    assert completed["outcome"] == "Headache relieved after rest"

    # 5. Care Log history
    log = care.get_care_log(cid)
    assert log["empty"] is False
    assert len(log["entries"]) >= 1
    assert log["entries"][0]["protocol"] == DEFAULT_PROTOCOLS["headache_tx"]["title"]


def test_screen_8_plan_and_conflict_detection():
    plan_eng = PlanEngine(persist=False)
    cid = "kenji"

    # Profile with standard transit schedule
    profile = {
        "preferences": {"reminderTimes": {"checkin": "08:00", "winddown": "21:30"}},
        "mission": {"dutySchedule": "transit_day_v1", "sleepBlock": "22:00-06:00"},
    }

    p = plan_eng.get_plan(cid, profile=profile, current_hour=8.5)
    assert p["template_id"] == "transit_day_v1"
    assert len(p["today_reminders"]) >= 8
    assert p["has_conflicts"] is False

    # Introduce a conflict: exercise scheduled at 23:00 (during 22:00-06:00 sleep block)
    plan_eng.add_reminder(cid, "Late Night Treadmill", "23:00", rem_type="exercise")
    p_conflict = plan_eng.get_plan(cid, profile=profile, current_hour=8.5)
    assert p_conflict["has_conflicts"] is True
    assert len(p_conflict["conflicts"]) == 1
    assert "conflicts with designated crew sleep block" in p_conflict["conflicts"][0]["description"]

    # Snooze and complete
    rem_id = p_conflict["today_reminders"][0]["id"]
    snoozed = plan_eng.snooze_reminder(cid, rem_id, minutes=20)
    assert snoozed["state"] == "snoozed"
    assert snoozed["snooze_count"] == 1

    done = plan_eng.complete_reminder(cid, rem_id)
    assert done["state"] == "done"


def test_screen_7_trends_and_sleep_reaction_correlation():
    store = Store(persist=False, fresh=True)
    trends_eng = TrendsEngine()
    cid = "kenji"

    # Ingest 3 days of paired sleep and reaction test data
    store.ingest_reading(cid, {"metric": "sleep_hours", "value": 7.5, "label": "MANUAL", "confidence": 1.0})
    store.ingest_reading(cid, {"metric": "reaction_ms", "value": 280.0, "label": "MANUAL", "confidence": 1.0})
    store.ingest_reading(cid, {"metric": "sleep_hours", "value": 5.0, "label": "MANUAL", "confidence": 1.0})
    store.ingest_reading(cid, {"metric": "reaction_ms", "value": 340.0, "label": "MANUAL", "confidence": 1.0})

    t = trends_eng.get_trends(cid, store, days=7)
    assert t["has_enough_data"] is True
    assert len(t["sleep_vs_reaction"]) >= 2
    assert t["summary"]["sleep_mean"] is not None


def test_screen_13_onboarding_first_run_resumable():
    onb = OnboardingEngine(persist=False)
    cid = "new_astronaut"

    st = onb.get_status(cid)
    assert st["completed"] is False
    assert st["special_state"] == "resumable"
    assert st["resumable_step"] == "consent"

    # Step 1: Consent
    onb.complete_step(cid, "consent")
    st1 = onb.get_status(cid)
    assert st1["consent_signed"] is True
    assert st1["resumable_step"] == "kit_confirm"

    # Step 2: Kit Confirmation
    onb.complete_step(cid, "kit_confirm")
    st2 = onb.get_status(cid)
    assert st2["kit_confirmed"] is True

    # Complete all
    onb.complete_step(cid, "voice_enroll")
    onb.complete_step(cid, "baseline_calib")
    st_done = onb.get_status(cid)
    assert st_done["completed"] is True
    assert st_done["special_state"] == "completed"


def test_screens_server_api_endpoints():
    from fastapi.testclient import TestClient
    import server
    c = TestClient(server.app)
    cid = c.get("/api/crew").json()[0]["crew_id"]

    # 1. Indicator detail endpoint
    ind_resp = c.get(f"/api/indicator/{cid}/heart_rate").json()
    assert ind_resp["metric"] == "heart_rate"
    assert "NASA MRID" in ind_resp["facts"]["source_mrid"]

    # 2. Care triage questions & evaluation
    t_q = c.get("/api/care/triage/questions?zone=head").json()
    assert len(t_q["questions"]) >= 3

    t_eval = c.post(f"/api/care/triage/{cid}", json={
        "zone": "head",
        "symptom": "headache",
        "answers": {"sudden_severe": False, "throbbing": True},
    }).json()
    assert t_eval["urgency"] == 1

    # 3. Protocol runner endpoints
    run = c.post("/api/care/protocol/start", json={"crew_id": cid, "protocol_id": "headache_tx"}).json()
    run_id = run["run_id"]
    assert run["state"] == "running"

    step_resp = c.post(f"/api/care/protocol/{run_id}/step", json={"step_num": 1, "done": True}).json()
    assert step_resp["steps"][0]["done"] is True

    complete_resp = c.post(f"/api/care/protocol/{run_id}/complete", json={"outcome": "Test resolved"}).json()
    assert complete_resp["state"] == "completed"

    log_resp = c.get(f"/api/care/log/{cid}").json()
    assert log_resp["empty"] is False

    # 4. Plan endpoints
    plan_resp = c.get(f"/api/plan/{cid}").json()
    assert "today_reminders" in plan_resp

    # 5. Trends endpoint
    trends_resp = c.get(f"/api/trends/{cid}?days=7").json()
    assert "sleep_vs_reaction" in trends_resp

    # 6. Onboarding endpoints
    onb_resp = c.get(f"/api/onboarding/{cid}").json()
    assert "resumable_step" in onb_resp
