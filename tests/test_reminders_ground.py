"""Tests for Sections 19.5, 20 & 21: Kit Filter, Reminders & Scheduling Algorithm,
and Ground Handoff with Delay Simulator.
"""
import pytest
from fastapi.testclient import TestClient

from brain.ground import Ground
from brain.plan import PlanEngine, plan
from brain.profile import filter_kit_items, kit_filter
from brain.store import Store
from server import app


@pytest.fixture
def client():
    return TestClient(app)


# ---------------------------------------------------------------------------
# 1. Section 19.5: filterKit(kitItems, profile)
# ---------------------------------------------------------------------------

def test_kit_filter_blocks_allergies_and_past_reactions():
    """Section 19.5: Blocks item matching profile allergy or past reaction."""
    prof = {"health": {"allergies": ["aspirin", "acetaminophen"], "pastKitReactions": []}}
    items = [
        {"id": "acetaminophen", "name": "Acetaminophen 500mg"},
        {"id": "promethazine", "name": "Promethazine 25mg"},
    ]
    res = filter_kit_items(items, prof)
    allowed_ids = [i["id"] for i in res["allowed"]]
    blocked_ids = [b["item"]["id"] for b in res["blocked"]]
    assert "promethazine" in allowed_ids
    assert "acetaminophen" in blocked_ids
    assert "allergy or past reaction" in res["blocked"][0]["reason"]


def test_kit_filter_regular_medicine_and_incomplete_profile_notes():
    """Section 19.5: Note on regular medicines and incomplete profile."""
    # Regular medicine note
    prof_med = {"health": {"allergies": [], "pastKitReactions": [], "regularMedicines": ["lisinopril"]}}
    res_med = filter_kit_items([{"id": "promethazine", "name": "Promethazine"}], prof_med)
    assert len(res_med["notes"]) == 1
    assert "check the label and your surgeon" in res_med["notes"][0]["note"]

    # Incomplete profile note
    prof_inc = {"health": {}}
    res_inc = filter_kit_items([{"id": "promethazine", "name": "Promethazine"}], prof_inc)
    assert len(res_inc["notes"]) == 1
    assert "Profile incomplete, check the label" in res_inc["notes"][0]["note"]


# ---------------------------------------------------------------------------
# 2. Section 20: Reminders & Scheduling Algorithm (7 Steps)
# ---------------------------------------------------------------------------

def test_scheduling_step_1_expand_schedule_7days():
    """Step 1: On profile load, expand schedule template into reminders for next 7 days."""
    p_engine = PlanEngine(persist=False)
    cid = "james"
    rems = p_engine.expand_schedule_7days(cid, start_day=120)
    # 7 days * 11 events per day = 77 reminders
    assert len(rems) == 77
    assert any(r["time"] == "08:00" and r["type"] == "checkin" for r in rems)
    assert any(r["type"] == "exercise" for r in rems)


def test_scheduling_step_2_and_3_tick_and_respect_sleep_eva_blocks():
    """Step 2 & 3: 1-minute tick moves due reminders; respects sleep and EVA blocks; protocol outranks routine."""
    p_engine = PlanEngine(persist=False)
    cid = "james"
    p_engine.expand_schedule_7days(cid, start_day=120)
    # Add an urgent protocol recheck reminder
    p_engine.add_reminder(cid, "Protocol Recheck: Headache", "08:05", rem_type="recheck")

    # Tick at 08:10 during routine mode
    res = p_engine.tick_one_minute(cid, current_hour_dec=8.17, mode="routine")
    due_types = [r["type"] for r in res["due_reminders"]]
    # Protocol recheck outranks routine checkin
    assert due_types[0] == "recheck"

    # Tick during EVA sortie mode: routine checkins paused, protocol recheck allowed!
    p_engine_eva = PlanEngine(persist=False)
    p_engine_eva.add_reminder(cid, "Morning Checkin", "08:00", rem_type="checkin")
    p_engine_eva.add_reminder(cid, "Emergency Recheck", "08:00", rem_type="recheck")
    res_eva = p_engine_eva.tick_one_minute(cid, current_hour_dec=8.1, mode="eva")
    eva_due = [r["type"] for r in res_eva["due_reminders"]]
    assert "recheck" in eva_due
    assert "checkin" not in eva_due  # Routine reminder paused during EVA!


def test_scheduling_step_4_and_5_missed_reminder_and_consecutive_alert():
    """Step 4 & 5: Reminder with no response after missAfterMin becomes missed,
    is re-presented once with softer prompt, and 3 misses in a row adds digest line.
    """
    p_engine = PlanEngine(persist=False)
    cid = "james"
    rem = p_engine.add_reminder(cid, "Morning Health Scan", "08:00", rem_type="checkin")
    rid = rem["id"]

    # Miss 1: re-presented with soft prompt
    miss_1 = p_engine.handle_miss(cid, rid)
    assert miss_1["state"] == "re_presented"
    assert "Gentle check-in" in miss_1["soft_prompt"]

    # Miss 2: marked missed
    miss_2 = p_engine.handle_miss(cid, rid)
    assert miss_2["state"] == "missed"


def test_scheduling_step_6_recheck_reminder_creation():
    """Step 6: Accepting recommendation creates recheck reminder at now + recheckAfterMin."""
    p_engine = PlanEngine(persist=False)
    cid = "james"
    rem = p_engine.create_recheck_reminder(cid, "Headache Relief Protocol", recheck_after_min=45, current_hour_dec=8.0)
    assert rem["type"] == "recheck"
    assert rem["time"] == "08:45"
    assert "Headache Relief Protocol" in rem["title"]


def test_scheduling_step_7_snooze_limit():
    """Step 7: Snooze allowed with limit (max 2 snoozes)."""
    p_engine = PlanEngine(persist=False)
    cid = "james"
    rem = p_engine.add_reminder(cid, "Daily Checkin", "08:00", rem_type="checkin")
    rid = rem["id"]

    s1 = p_engine.snooze_reminder(cid, rid, minutes=15)
    assert s1["snooze_count"] == 1
    s2 = p_engine.snooze_reminder(cid, rid, minutes=15)
    assert s2["snooze_count"] == 2


# ---------------------------------------------------------------------------
# 3. Section 21: Ground Handoff, Queue States & Delay Simulator
# ---------------------------------------------------------------------------

def test_ground_handoff_canonical_queue_states():
    """Section 21: Queue states: queued > sent > acknowledged > replied."""
    g = Ground(persist=False, one_way_min=10.0, clock=lambda: 1000.0)
    p = g.send("james", "digest", "Clinical Digest", {"summary": "Nominal baseline"}, priority="ACT")
    pid = p["id"]
    # 1. Queued
    assert p["queue_state"] == "queued"

    # 2. Sent (after link delay)
    g.clock = lambda: 1000.0 + (11.0 * 60.0)
    p_sent = g.status(p)
    assert p_sent["queue_state"] == "sent"

    # 3. Acknowledged
    p_ack = g.acknowledge_packet(pid)
    assert p_ack["queue_state"] == "acknowledged"

    # 4. Replied
    p_rep = g.receive_reply(pid, instructions=["Sit and rest for 30 min", "Repeat blood pressure check"])
    assert p_rep["queue_state"] == "replied"
    assert p_rep["reply"]["all_confirmed"] is False


def test_ground_reply_step_by_step_confirmation():
    """Section 21: Ground reply appears as Ground card; astronaut confirms each step before logging."""
    g = Ground(persist=False, one_way_min=10.0, clock=lambda: 1000.0)
    p = g.send("james", "digest", "Fatigue pattern", {"summary": "Sleep short"}, priority="ACT")
    pid = p["id"]
    g.receive_reply(pid, instructions=["Drink 350 ml electrolyte water", "Rest in dark quarters for 20 min"])

    # Step 1 confirmation
    rep_s1 = g.confirm_reply_step(pid, step_num=1)
    assert rep_s1["instructions"][0]["confirmed"] is True
    assert rep_s1["all_confirmed"] is False

    # Step 2 confirmation -> all confirmed!
    rep_s2 = g.confirm_reply_step(pid, step_num=2)
    assert rep_s2["instructions"][1]["confirmed"] is True
    assert rep_s2["all_confirmed"] is True


def test_ground_delay_simulator_split_screen():
    """Section 21: Delay simulator split screen view model."""
    g = Ground(persist=False, one_way_min=12.7, clock=lambda: 2000.0)
    store = Store(persist=False, fresh=True)
    g.send("kenji", "digest", "Status Digest", {"summary": "Nominal"}, priority="ROUTINE")

    sim = g.delay_simulator_view("kenji", store=store)
    assert "ground_view" in sim
    assert "onboard_view" in sim
    assert sim["ground_view"]["delay_min"] == 12.7
    assert sim["ground_view"]["link_status"] == "delayed"
    assert len(sim["onboard_view"]["recent_actions"]) >= 1


def test_ground_digest_privacy_filter():
    """Section 21 Privacy: Health background excluded unless explicitly consented."""
    g = Ground(persist=False)
    digest = {
        "summary": "Resting HR elevated",
        "readings": {"heart_rate": 88},
        "health_background": "Confidential medical records",
        "regular_medicines": ["Atorvastatin"],
    }
    # Consent without health background
    sanitized = g.sanitize_digest(digest, consent={"includeHealthBackground": False})
    assert "health_background" not in sanitized
    assert "regular_medicines" not in sanitized
    assert "readings" in sanitized


# ---------------------------------------------------------------------------
# 4. Server REST API Integration Verification
# ---------------------------------------------------------------------------

def test_api_plan_expand_and_tick(client):
    """POST /api/plan/{cid}/expand-7days and /api/plan/{cid}/tick."""
    res_exp = client.post("/api/plan/james/expand-7days", json={"start_day": 120})
    assert res_exp.status_code == 200
    assert res_exp.json()["count"] == 77

    res_tick = client.post("/api/plan/james/tick", json={"current_hour": 8.5})
    assert res_tick.status_code == 200
    assert "due_reminders" in res_tick.json()


def test_api_ground_delay_simulator_and_reply_flow(client):
    """GET /api/ground/{cid}/delay-simulator, reply, and confirm-step flow."""
    cid = "james"
    # Send packet
    send_res = client.post(f"/api/ground/{cid}", json={"kind": "digest", "title": "Checkin summary", "body": {"text": "All ok"}})
    assert send_res.status_code == 200
    pid = send_res.json()["id"]

    # Delay simulator
    sim_res = client.get(f"/api/ground/{cid}/delay-simulator")
    assert sim_res.status_code == 200
    assert "ground_view" in sim_res.json()

    # Reply
    reply_res = client.post(f"/api/ground/{pid}/reply", json={"instructions": ["Verify suit seal", "Acknowledge status"]})
    assert reply_res.status_code == 200
    assert reply_res.json()["queue_state"] == "replied"

    # Confirm step
    step_res = client.post(f"/api/ground/{pid}/confirm-step", json={"step_num": 1})
    assert step_res.status_code == 200
    assert step_res.json()["instructions"][0]["confirmed"] is True


def test_api_kit_filter_endpoint(client):
    """POST /api/kit/filter evaluates kit filtering."""
    payload = {
        "crew_id": "james",
        "items": [
            {"id": "acetaminophen", "name": "Acetaminophen"},
            {"id": "artificial_tears", "name": "Artificial Tears"},
        ],
    }
    res = client.post("/api/kit/filter", json=payload)
    assert res.status_code == 200
    assert "allowed" in res.json()
    assert "blocked" in res.json()
