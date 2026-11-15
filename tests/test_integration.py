"""Person 6 Integration and Acceptance Tests (Section 11.8: SI1–SI7).

Verifies the end-to-end integration of all Sentinel modules:
- SI1: Store rejects reading without label and confidence (INT-1)
- SI2: Full decision pipeline on a drifting crew member generates Level 2 card (INT-2)
- SI3: Ground digest queued offline, link opens: urgent sent first (INT-5)
- SI4: All 6 mock crew members load with 14-day SIM history (INT-4)
- SI5: End-to-end check-in -> assessment -> card -> recheck -> digest (INT-7)
- SI6: Event bus audit: every emitted event appears in audit without leaking PHI (INT-3)
- SI7: Golden scenarios S1–S19 pass (INT-8)
"""
import pytest
from brain.mission.ground import Ground
from brain.mission.ops import Ops
from brain.core.store import Store, VALID_LABELS


def test_SI1_store_rejects_reading_without_label_or_confidence(client, store):
    """SI1: Store rejects reading without label/confidence; returns error; does not store."""
    cid = "james"

    # Missing label
    with pytest.raises(ValueError, match="missing or invalid label"):
        store.ingest_reading(cid, {"metric": "heart_rate", "value": 75, "confidence": 1.0})

    # Invalid label
    with pytest.raises(ValueError, match="missing or invalid label"):
        store.ingest_reading(cid, {"metric": "heart_rate", "value": 75, "label": "UNKNOWN", "confidence": 1.0})

    # Missing confidence
    with pytest.raises(ValueError, match="missing or invalid confidence"):
        store.ingest_reading(cid, {"metric": "heart_rate", "value": 75, "label": "LIVE"})

    # Invalid confidence range
    with pytest.raises(ValueError, match="missing or invalid confidence"):
        store.ingest_reading(cid, {"metric": "heart_rate", "value": 75, "label": "LIVE", "confidence": 1.5})

    with pytest.raises(ValueError, match="missing or invalid confidence"):
        store.ingest_reading(cid, {"metric": "heart_rate", "value": 75, "label": "LIVE", "confidence": -0.1})

    # Missing metric
    with pytest.raises(ValueError, match="missing metric"):
        store.ingest_reading(cid, {"value": 75, "label": "LIVE", "confidence": 0.9})

    # Missing value
    with pytest.raises(ValueError, match="missing numeric value"):
        store.ingest_reading(cid, {"metric": "heart_rate", "label": "LIVE", "confidence": 0.9})

    # HTTP API verification: 422 Unprocessable Entity
    r_bad_label = client.post(f"/api/reading/{cid}", json={"metric": "heart_rate", "value": 80, "confidence": 1.0})
    assert r_bad_label.status_code == 422
    assert "label" in r_bad_label.json()["detail"]

    r_bad_conf = client.post(f"/api/reading/{cid}", json={"metric": "heart_rate", "value": 80, "label": "LIVE"})
    assert r_bad_conf.status_code == 422
    assert "confidence" in r_bad_conf.json()["detail"]

    # Valid reading succeeds
    r_valid = client.post(f"/api/reading/{cid}", json={
        "metric": "heart_rate", "value": 74, "label": "MANUAL", "confidence": 1.0
    })
    assert r_valid.status_code == 200
    res = r_valid.json()
    assert res["ok"] is True
    assert res["state"]["vitals"]["heart_rate"] == 74


def test_SI2_full_decision_pipeline_on_drifting_crew(store):
    """SI2: Full decision pipeline on a drifting crew member: Level 2 assessment, recommendation card generated."""
    cid = "kenji"
    b = store.get(cid)["baseline"]

    # Ingest multiple drifting readings via the ingestion pipeline
    store.ingest_reading(cid, {"metric": "sleep_hours", "value": 4.5, "label": "MANUAL", "confidence": 1.0})
    store.ingest_reading(cid, {"metric": "mood", "value": 2, "label": "MANUAL", "confidence": 1.0})
    store.ingest_reading(cid, {"metric": "reaction_ms", "value": (b.get("reaction_ms") or 300) * 1.6, "label": "MANUAL", "confidence": 1.0})

    s = store.get(cid)
    # Drift items flagged
    drifted_metrics = {i["metric"] for i in s["drift"]["items"] if i["severity"] != "ok"}
    assert len(drifted_metrics) >= 2

    # Assessment priority is Level 2 (ACT)
    ops = Ops()
    asmt = store.assessment(cid)
    d = ops.digest(cid, s, asmt)
    assert d["priority"] == "ACT"

    # Actionable card is generated
    assert s["action"]["type"] != "none"
    assert s["action"]["severity"] in ("watch", "alert")
    assert s["action"]["detail"]


def test_SI3_ground_digest_queued_offline_link_opens():
    """SI3: Ground digest queued offline, link opens: urgent sends first."""
    t = [1000.0]
    ops = Ops(clock=lambda: t[0])
    ground = Ground(persist=False, clock=lambda: t[0])

    # Put link into blackout
    ops.blackout(30)
    assert ops.status("james", {"radiation": {"mission_profile": "mars_transit"}})["comms"]["status"] == "blackout"

    # Queue routine and urgent packets
    p_routine = ground.send("james", "digest", "routine_report", {"vitals": "stable"}, "ROUTINE", ops.hold_until())
    p_urgent = ground.send("james", "digest", "urgent_event", {"alert": "radiation storm"}, "URGENT", ops.hold_until())

    assert p_routine["status"] == "queued (no link)"
    assert p_urgent["status"] == "queued (no link)"

    # Fast forward time within blackout: both remain held
    t[0] += 600
    assert {p["status"] for p in ground.list("james")} == {"queued (no link)"}

    # Link opens: blackout cleared, packets released
    ops.blackout(0)
    ground.release()
    t[0] += 2.5

    # Urgent packet departs first
    st = {p["title"]: p["status"] for p in ground.list("james")}
    assert st["urgent_event"] in ("queued", "in transit")
    assert st["routine_report"] == "queued (no link)"


def test_SI4_all_6_mock_crew_members_load(store):
    """SI4: All 6 mock crew members load with 14 days of history each."""
    crew = store.crew()
    assert len(crew) == 6
    expected_ids = {"james", "amara", "kenji", "sofia", "lukas", "priya"}
    assert {c["crew_id"] for c in crew} == expected_ids

    # Verify each member has 14-day history loaded
    for cid in expected_ids:
        s = store.get(cid)
        assert s["display_name"]
        hist = store.history[cid]
        # Must have baseline history streams
        assert len(hist) > 0
        for field in ("manual.bp_systolic", "manual.glucose_mgdl", "manual.sleep_hours"):
            pts = hist.get(field, [])
            assert len(pts) >= 14, f"Crew {cid} field {field} points {len(pts)} < 14"
            # Verify timestamps span across ~14 days (14 * 86400 seconds)
            span_s = pts[-1]["t"] - pts[0]["t"]
            assert span_s >= 13 * 86400, f"History span for {cid}.{field} is only {span_s}s"


def test_SI5_end_to_end_checkin_to_digest(client):
    """SI5: End-to-end check-in -> assessment -> card -> recheck -> digest."""
    cid = "james"

    # 1. Crew check-in: Ingest elevated BP reading
    r_checkin = client.post(f"/api/reading/{cid}", json={
        "metric": "bp_systolic", "value": 155, "label": "MANUAL", "confidence": 1.0
    })
    assert r_checkin.status_code == 200

    # 2. Assessment: Evaluate cardiovascular zone
    r_asmt = client.get(f"/api/assessment/{cid}")
    assert r_asmt.status_code == 200
    asmt = r_asmt.json()
    assert asmt["zones"]["heart"] in ("watch", "alert")

    # 3. Card: Check recommendation card generated
    state = client.get(f"/api/state/{cid}").json()
    card = state["action"]
    assert card["type"] != "none"
    assert card["severity"] in ("info", "watch", "alert")

    # 4. Protocol follow-up: Log follow-up diastolic BP reading
    r_followup = client.post(f"/api/reading/{cid}", json={
        "metric": "bp_diastolic", "value": 96, "label": "MANUAL", "confidence": 1.0
    })
    assert r_followup.status_code == 200

    # 5. Digest preview and queue to ground
    r_prev = client.get(f"/api/digest/{cid}?note=Evening+checkin+high+BP")
    assert r_prev.status_code == 200
    preview = r_prev.json()
    assert preview["priority"] in ("ACT", "URGENT")
    assert "blood pressure" in preview["text"].lower() or "bp" in preview["text"].lower()

    # Queue packet for ground
    r_send = client.post(f"/api/digest/{cid}", json={"note": "Evening checkin high BP"})
    assert r_send.status_code == 200
    sent = r_send.json()
    assert sent["packet"]["status"] in ("queued", "queued (no link)")
    assert sent["packet"]["kind"] == "digest"


def test_SI6_event_bus_audit(client):
    """SI6: Event bus audit: every emitted event appears in audit log without leaking PHI."""
    cid = "amara"

    # Post page events
    client.post("/api/audit", json={
        "crew_id": cid,
        "events": [
            {"t": 1001, "event": "bus:screen.opened", "detail": {"screen": "body"}},
            {"t": 1002, "event": "bus:zone.inspected", "detail": {"zone": "lungs"}}
        ],
        "counts": {"bus:telemetry": 120}
    })

    # Ingest reading (triggers brain reading.added audit)
    client.post(f"/api/reading/{cid}", json={
        "metric": "spo2", "value": 94, "label": "LIVE", "confidence": 0.95
    })

    # Queue digest (triggers digest.queued audit)
    client.post(f"/api/digest/{cid}", json={"note": "Routine telemetry check"})

    # Fetch audit log
    r_audit = client.get("/api/audit")
    assert r_audit.status_code == 200
    entries = r_audit.json()["entries"]
    event_names = [e["event"] for e in entries]

    assert "bus:screen.opened" in event_names
    assert "bus:zone.inspected" in event_names
    assert "reading.added" in event_names
    assert "digest.queued" in event_names

    # Privacy check: Ensure sensitive terms or personal health diagnoses are never written
    raw_log = str(entries)
    for forbidden in ("confidential", "psychiatric", "pregnancy", "substance_abuse"):
        assert forbidden not in raw_log.lower()


def test_SI7_all_golden_scenarios_pass():
    """SI7: All golden scenarios S1–S19 pass."""
    import tests.test_golden as tg
    from brain.core.store import Store
    from fastapi.testclient import TestClient
    import server

    # Run each golden test scenario with fresh store isolation
    tg.test_S1_steady_14_days_is_level_0(Store(persist=False, fresh=True))
    tg.test_S2_sleep_reaction_mood_pattern_is_level_2_with_groups(Store(persist=False, fresh=True))
    tg.test_S3_rising_stress_is_level_2(Store(persist=False, fresh=True))
    tg.test_S4_post_exercise_heart_rate_is_suppressed(Store(persist=False, fresh=True))
    tg.test_S5_low_confidence_spike_raises_no_alert(Store(persist=False, fresh=True))
    tg.test_S6_cabin_oxygen_below_limit_is_level_3_with_priority_digest(Store(persist=False, fresh=True))
    tg.test_S6b_cabin_oxygen_alerts_the_crew(Store(persist=False, fresh=True))
    tg.test_S7_head_symptom_with_vision_change_is_level_3(Store(persist=False, fresh=True))
    tg.test_S8_missed_check_ins_are_counted(Store(persist=False, fresh=True))
    tg.test_S9_switching_station_to_transit_changes_the_environment(Store(persist=False, fresh=True))
    tg.test_S9b_switch_lists_what_changes(Store(persist=False, fresh=True))
    tg.test_S10_link_down_then_up_queues_then_sends_urgent_first()
    tg.test_S11_spoken_environment_is_recognised_then_confirmed()
    tg.test_S12_ambiguous_environment_asks_which()
    tg.test_S13_profile_allergy_blocks_the_kit_item()
    tg.test_S14_wellbeing_drift_is_level_2_with_top_three_tools(Store(persist=False, fresh=True))
    server.store.reset()
    with TestClient(server.app) as c:
        tg.test_S15_urgent_phrase_runs_the_safety_script_only(c)
    tg.test_S16_settling_in_softens_personal_alerts_but_not_limits(Store(persist=False, fresh=True))
    tg.test_S17_same_symptom_gives_different_cards_by_environment(Store(persist=False, fresh=True))
    tg.test_S18_camera_mood_off_still_leaves_self_report(Store(persist=False, fresh=True))
    tg.test_S19_crew_pulse_needs_three_responses()
