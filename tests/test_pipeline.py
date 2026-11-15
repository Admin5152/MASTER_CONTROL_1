"""Tests for Sections 18 & 19: Clinical Pipeline, 5 Layers, Alert Lifecycle,
and Recommendation Cards Grounded in NASA MRIDs.
"""
import pytest
from fastapi.testclient import TestClient

from brain.alerts import AlertManager, alerts
from brain.pipeline import ClinicalPipeline, pipeline
from brain.protocols import (
    PROTOCOLS_CATALOG,
    build_recommendation_card,
    find_matching_protocols,
    get_protocol,
)
from brain.store import Store
from server import app


@pytest.fixture
def client():
    return TestClient(app)


# ---------------------------------------------------------------------------
# 1. Pipeline Stages 1, 2, 3: Ingest, Validate, Normalize
# ---------------------------------------------------------------------------

def test_pipeline_ingest_rejects_unknown_source():
    """Stage 1: Ingest rejects unknown source and logs audit."""
    pipe = ClinicalPipeline()
    with pytest.raises(ValueError, match="Unknown or rejected reading source"):
        pipe.ingest({"metric": "heart_rate", "value": 75, "source": "unverified_satellite"})


def test_pipeline_validate_catches_implausible_jump():
    """Stage 2: Rapid jump > 60 bpm/min is flagged as implausible; never silently dropped."""
    pipe = ClinicalPipeline()
    first = pipe.ingest({"metric": "vitals.heart_rate", "value": 70, "source": "camera", "timestamp": 1000.0})
    val_first = pipe.validate(first)
    assert val_first["valid"] is True

    # Sudden jump to 160 bpm 30 seconds later (180 bpm/min rate) without exercise
    second = pipe.ingest({"metric": "vitals.heart_rate", "value": 160, "source": "camera", "timestamp": 1030.0})
    val_second = pipe.validate(second, last_reading=first)
    assert val_second["valid"] is False
    assert val_second["remeasure_required"] is True
    assert "exceeds physiological rate limit" in val_second["reason"]


def test_pipeline_validate_catches_physical_bounds():
    """Stage 2: Out-of-bounds physical reading prompts remeasurement."""
    pipe = ClinicalPipeline()
    reading = pipe.ingest({"metric": "manual.temp_c", "value": 47.0, "source": "manual"})
    val = pipe.validate(reading)
    assert val["valid"] is False
    assert val["remeasure_required"] is True
    assert "outside sane physical bounds" in val["reason"]


def test_pipeline_normalize_converts_units():
    """Stage 3: Normalizes Fahrenheit to Celsius and kPa to mmHg."""
    pipe = ClinicalPipeline()
    # Temp in Fahrenheit
    t_f = pipe.ingest({"metric": "manual.temp_c", "value": 98.6, "unit": "degF", "source": "manual"})
    norm_t = pipe.normalize(pipe.validate(t_f))
    assert norm_t["unit"] == "C"
    assert round(norm_t["value"], 1) == 37.0

    # Blood pressure in kPa
    bp_kpa = pipe.ingest({"metric": "manual.bp_systolic", "value": 16.0, "unit": "kPa", "source": "manual"})
    norm_bp = pipe.normalize(pipe.validate(bp_kpa))
    assert norm_bp["unit"] == "mmHg"
    assert round(norm_bp["value"]) == 120


# ---------------------------------------------------------------------------
# 2. Pipeline Stage 5: Derive (Median + MAD, Trend Slopes, Calibration)
# ---------------------------------------------------------------------------

def test_pipeline_derive_calibration_progression():
    """Stage 5: When readings < 7, status is 'Calibrating (n of 7)'."""
    pipe = ClinicalPipeline()
    # 4 points
    points = [{"v": 70}, {"v": 72}, {"v": 69}, {"v": 71}]
    res = pipe.derive("james", points)
    assert res["calibrated"] is False
    assert res["stage"] == "Calibrating (4 of 7)"
    assert res["calibration_progress"] == "4 of 7"


def test_pipeline_derive_robust_median_and_mad():
    """Stage 5: Robust median and spread (MAD) with outlier exclusion."""
    pipe = ClinicalPipeline()
    # 8 points with one post-exercise point excluded
    points = [
        {"v": 70, "confidence": 1.0},
        {"v": 72, "confidence": 1.0},
        {"v": 71, "confidence": 1.0},
        {"v": 70, "confidence": 1.0},
        {"v": 73, "confidence": 1.0},
        {"v": 69, "confidence": 1.0},
        {"v": 71, "confidence": 1.0},
        {"v": 150, "confidence": 1.0, "context": {"post_exercise": True}},  # Excluded!
        {"v": 70, "confidence": 0.2},  # Excluded low confidence!
    ]
    res = pipe.derive("james", points)
    assert res["calibrated"] is True
    assert res["stage"] == "Calibrated"
    assert res["count"] == 7
    assert res["median"] == 71.0
    assert res["spread"] > 0


# ---------------------------------------------------------------------------
# 3. Pipeline Stage 6: Assess (5 Layers & Section 19.3 Clinical Safety Law)
# ---------------------------------------------------------------------------

def test_pipeline_assess_clinical_safety_law_level_3():
    """Section 19.3 Safety Law: Level 3 comes ONLY from range limits, red flags, or cabin limits,
    never from statistics alone. Personal deviation alone never exceeds Level 2.
    """
    pipe = ClinicalPipeline()
    derived = {"calibrated": True, "median": 70.0, "spread": 2.0, "trend_slope": 0.0}

    # Huge statistical deviation (HR 95 is 12.5x spread away), but safe limit not crossed
    asmt = pipe.assess("james", 95.0, "vitals.heart_rate", derived, absolute_thresholds=None)
    assert asmt["level"] == 2  # Capped at Level 2 Act! Never Level 3!
    assert "Personal baseline" in asmt["reasons"][0]

    # Safe limit crossed (e.g. cabin O2 < 17.1%) -> Level 3
    cabin_spec = {"levels": [{"severity": "alert", "below": 17.1, "kind": "nasa"}]}
    cabin_asmt = pipe.assess("james", 16.5, "cabin.oxygen_pct", derived, absolute_thresholds=cabin_spec)
    assert cabin_asmt["level"] == 3
    assert cabin_asmt["layer_hit"] == 1


def test_pipeline_assess_layer_5_context_suppression():
    """Layer 5: Post-exercise pulse elevation is suppressed."""
    pipe = ClinicalPipeline()
    derived = {"calibrated": True, "median": 70.0, "spread": 2.0, "trend_slope": 0.0}
    asmt = pipe.assess("james", 130.0, "vitals.heart_rate", derived, context={"post_exercise": True})
    assert asmt["level"] == 0
    assert "suppressed" in asmt["reasons"][0].lower()


# ---------------------------------------------------------------------------
# 4. Pipeline Stages 7, 8, 9: Decide, Present, Learn
# ---------------------------------------------------------------------------

def test_pipeline_decide_generic_card_on_unmatched_protocol():
    """Stage 7: No protocol matches -> generic card plus escalate (Level at least 2)."""
    pipe = ClinicalPipeline()
    res = pipe.decide("james", level=1, symptom="unusual tingling in toes", zone="whole_body")
    card = res["recommendation_card"]
    assert card["is_generic"] is True
    assert card["level"] >= 2
    assert "generic card" in card["now"][3].lower()


def test_pipeline_present_modalities_and_quiet_hours():
    """Stage 8: Presentation matrix and quiet hours breakthrough rules."""
    pipe = ClinicalPipeline()
    # Level 1 during quiet hours -> suppressed / queued for morning
    pres_l1 = pipe.present({"level": 1}, quiet_hours=True)
    assert pres_l1["suppressed_by_quiet_hours"] is True
    assert pres_l1["stage"] == "queued_for_morning"

    # Level 3 during quiet hours -> BREAKS THROUGH!
    pres_l3 = pipe.present({"level": 3}, quiet_hours=True)
    assert pres_l3["suppressed_by_quiet_hours"] is False
    assert pres_l3["presentation"]["breakthrough"] is True
    assert pres_l3["presentation"]["orb"] == "red_takeover"


# ---------------------------------------------------------------------------
# 5. Alert Lifecycle & Fatigue Controls (Sections 19.4 & 19.5)
# ---------------------------------------------------------------------------

def test_alert_lifecycle_states_progression():
    """Section 19.4: Alert transitions through lifecycle states."""
    mgr = AlertManager()
    alt = mgr.create_alert("james", "vital_drift", level=2, title="HR Drift", reason="HR elevated")
    assert alt["state"] == "detected"

    presented = mgr.present_alert(alt["alert_id"])
    assert presented["state"] == "presented"

    acting = mgr.start_acting(alt["alert_id"], protocol_run_id="run_123")
    assert acting["state"] == "acting"

    # Recheck resolves alert
    resolved = mgr.recheck_alert(alt["alert_id"], in_range=True)
    assert resolved["state"] == "resolved"


def test_alert_fatigue_urgent_cannot_be_snoozed():
    """Section 19.5: Level 3 urgent alerts CANNOT be snoozed."""
    mgr = AlertManager()
    alt = mgr.create_alert("james", "cabin_alert", level=3, title="Cabin O2 Drop", reason="O2 low")
    with pytest.raises(ValueError, match="Urgent level 3 alerts cannot be snoozed"):
        mgr.snooze_alert(alt["alert_id"], minutes=15, reason="Need more time")


def test_alert_snooze_limit_enforced():
    """Section 19.5: Snooze limit (max 2) enforced with reason."""
    mgr = AlertManager()
    alt = mgr.create_alert("james", "vital_drift", level=1, title="Mild HR Drift", reason="HR elevated")
    # Missing reason rejected
    with pytest.raises(ValueError, match="reason is required"):
        mgr.snooze_alert(alt["alert_id"], minutes=15, reason="")

    # Snooze 1 & 2 pass
    mgr.snooze_alert(alt["alert_id"], minutes=15, reason="In middle of exercise")
    mgr.snooze_alert(alt["alert_id"], minutes=15, reason="Still wrapping up workout")

    # Snooze 3 blocked!
    with pytest.raises(ValueError, match="Snooze limit reached"):
        mgr.snooze_alert(alt["alert_id"], minutes=15, reason="Third snooze")


def test_alert_explainability_why_this():
    """Section 19.5: 'Why this?' plain-language explainability breakdown."""
    mgr = AlertManager()
    alt = mgr.create_alert(
        crew_id="kenji",
        cause_id="heart_rate",
        level=2,
        title="Resting Heart Rate Elevation",
        reason="Heart rate +25% vs usual baseline",
        rule_id="rule_heart_rate_drift",
        readings={"heart_rate": 85.0},
        baseline={"heart_rate": 68.0},
        mrid="NASA MRID MEDB 2.1 (JSC 28913)",
    )
    exp = mgr.explain_alert(alt["alert_id"])
    assert exp["level"] == 2
    assert "delta +25.0%" in exp["plain_language"]
    assert "NASA MRID MEDB 2.1" in exp["plain_language"]


# ---------------------------------------------------------------------------
# 6. Sourced Protocols Library & Recommendation Cards (Sections 19.3, 19.4)
# ---------------------------------------------------------------------------

def test_protocol_library_10_sourced_protocols():
    """Section 19.4: 10 starter protocols with verified NASA MRID sources."""
    expected = [
        "headache_tx", "stress_low_mood_tx", "poor_sleep_tx",
        "high_resting_hr_tx", "high_bp_tx", "glucose_out_of_range_tx",
        "raised_temp_tx", "cabin_hypoxia_co2_tx", "motion_sickness_tx",
        "vision_change_tx",
    ]
    for pid in expected:
        proto = get_protocol(pid)
        assert proto is not None, f"Missing protocol {pid}"
        assert proto["verified"] is True
        assert proto["source"]["mrid"]
        assert len(proto["steps"]) >= 3


def test_vision_change_protocol_always_escalates():
    """Section 19.4: Vision change protocol always escalates and ties to SANS risk."""
    proto = get_protocol("vision_change_tx")
    assert "SANS" in proto["hrp_risk"]
    assert "ALWAYS ESCALATES" in proto["title"]
    assert "MANDATORY ESCALATION" in proto["steps"][0]["text"]


def test_protocol_environment_variants_override_base():
    """Section 19.5: Environment variants merge over base; variant steps win."""
    base = get_protocol("headache_tx", env="station")
    assert "Columbus airflow" in base["steps"][0]["text"]

    transit = get_protocol("headache_tx", env="transit")
    assert "transit cabin" in transit["steps"][0]["text"]

    eva = get_protocol("headache_tx", env="station", mode="eva")
    assert "EVA SORTIE ADVISORY" in eva["steps"][0]["text"]


def test_recommendation_card_7_part_format():
    """Section 19.3: Recommendation card strictly follows 7-part format."""
    proto = get_protocol("headache_tx")
    card = build_recommendation_card(
        cid="james",
        level=2,
        trigger_summary="Resting heart rate +22% vs baseline; persistent mild cephalea",
        protocol=proto,
        sure="Medium",
        sure_reason="camera estimate; sleep entry is typed",
        env="transit",
    )
    # The 7 required fields:
    assert "seen" in card
    assert "sure" in card
    assert "now" in card
    assert "use" in card
    assert "recheck" in card
    assert "escalate_if" in card
    assert "why" in card

    assert card["level_name"] == "ACT"
    assert len(card["now"]) >= 3
    assert "Acetaminophen" in card["use"]
    assert "Risk of Adverse Cognitive" in card["why"]


# ---------------------------------------------------------------------------
# 7. Server REST API Integration Verification
# ---------------------------------------------------------------------------

def test_api_pipeline_process_end_to_end(client):
    """POST /api/pipeline/process executes full 9-stage pipeline."""
    payload = {
        "crew_id": "james",
        "reading": {
            "metric": "vitals.heart_rate",
            "value": 82.0,
            "unit": "bpm",
            "source": "camera",
            "confidence": 0.95,
        },
    }
    res = client.post("/api/pipeline/process", json=payload)
    assert res.status_code == 200
    data = res.json()
    assert data["ok"] is True
    assert "normalized" in data
    assert "derived" in data
    assert "assessment" in data
    assert "decision" in data
    assert "presentation" in data


def test_api_alerts_lifecycle_and_snooze(client):
    """POST /api/alerts/{alert_id}/snooze and GET explain."""
    # Create an alert first via AlertManager
    alt = alerts.create_alert("james", "vital_drift", level=1, title="Mild Drift", reason="HR elevated")
    aid = alt["alert_id"]

    # Explain alert
    exp_res = client.get(f"/api/alerts/{aid}/explain")
    assert exp_res.status_code == 200
    assert "Alert Level 1" in exp_res.json()["plain_language"]

    # Snooze alert
    snooze_res = client.post(f"/api/alerts/{aid}/snooze", json={"minutes": 15, "reason": "Busy with maintenance"})
    assert snooze_res.status_code == 200
    assert snooze_res.json()["snooze_count"] == 1


def test_api_protocols_catalog_and_variants(client):
    """GET /api/protocols returns all 10 clinical protocols with variants."""
    res = client.get("/api/protocols?env=transit")
    assert res.status_code == 200
    data = res.json()
    assert data["count"] == 10
    headache = next(p for p in data["protocols"] if p["id"] == "headache_tx")
    assert "transit cabin" in headache["steps"][0]["text"]
