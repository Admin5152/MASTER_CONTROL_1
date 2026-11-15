"""Tests for Section 17: What We Track, Group Rule, Non-reading records,
and NASA MRID Dataset Grounding (Single Source of Truth).
"""
import pytest
from fastapi.testclient import TestClient

from brain.indicators import (
    INDEPENDENCE_GROUPS,
    NON_READING_SCHEMAS,
    TRACKED_INDICATORS,
    count_independent_signals,
    evaluate_pattern_layer,
    get_indicator_group,
    get_indicator_mrid_evidence,
    group_signals,
    load_mrid_database,
    resolve_indicator_id,
    validate_non_reading_record,
    verify_single_source_of_truth,
)
from server import app


@pytest.fixture
def client():
    return TestClient(app)


# ---------------------------------------------------------------------------
# 1. 22 Tracked Indicators Catalog Integrity
# ---------------------------------------------------------------------------

def test_tracked_indicators_catalog_completeness():
    """Verify Section 17 tracked indicators table: all 22 indicators present."""
    required_indicators = [
        "heart_rate", "bp_sys", "bp_dia", "breathing_rate", "spo2",
        "blood_glucose", "temperature", "sleep_hours", "sleep_quality",
        "reaction_ms", "reaction_lapses", "valence", "arousal",
        "mood_self", "stress_self", "energy_self", "connection_self",
        "talk_share", "time_alone_pct", "voice_pitch", "exercise_minutes",
        "hydration_log", "cabin_o2", "cabin_co2", "rad_dose_rate",
        "rad_cumulative", "rad_event_level", "shelter_status", "missed_checkins",
    ]
    for ind_id in required_indicators:
        assert ind_id in TRACKED_INDICATORS, f"Missing indicator {ind_id} from Section 17 table"
        ind = TRACKED_INDICATORS[ind_id]
        assert any(lbl in ind["label"] for lbl in ("LIVE", "MANUAL", "SIM", "DESIGNED"))
        assert ind["group"] in INDEPENDENCE_GROUPS
        assert ind["hrp_risk"]
        assert len(ind["nasa_mrids"]) > 0


def test_indicator_labels_and_worse_when():
    """Verify specific labels and worse-when directions from Section 17."""
    hr = TRACKED_INDICATORS["heart_rate"]
    assert hr["label"] == "LIVE estimate"
    assert hr["worse_when"] == "high or low"
    assert hr["group"] == "cardio"

    spo2 = TRACKED_INDICATORS["spo2"]
    assert spo2["label"] == "SIM"
    assert spo2["worse_when"] == "low"
    assert spo2["group"] == "respiratory"

    reaction = TRACKED_INDICATORS["reaction_ms"]
    assert reaction["label"] == "LIVE"
    assert reaction["worse_when"] == "high"
    assert reaction["group"] == "cognitive"

    bp_sys = TRACKED_INDICATORS["bp_sys"]
    assert bp_sys["label"] == "MANUAL"
    assert bp_sys["group"] == "cardio"

    glucose = TRACKED_INDICATORS["blood_glucose"]
    assert glucose["label"] == "MANUAL"
    assert glucose["group"] == "metabolic"


# ---------------------------------------------------------------------------
# 2. Section 17 Group Rule & Independence Groups
# ---------------------------------------------------------------------------

def test_group_rule_same_group_counts_as_one_signal():
    """Section 17 Group Rule: Two indicators in the same group count as one signal."""
    # heart_rate and bp_sys are both in the 'cardio' group
    assert get_indicator_group("heart_rate") == "cardio"
    assert get_indicator_group("bp_sys") == "cardio"
    assert get_indicator_group("bp_dia") == "cardio"

    # Three indicators from the same group -> exactly 1 independent signal!
    signals_count = count_independent_signals(["heart_rate", "bp_sys", "bp_dia"])
    assert signals_count == 1

    # State path syntax also resolves to the same group
    signals_from_paths = count_independent_signals(["vitals.heart_rate", "manual.bp_systolic"])
    assert signals_from_paths == 1


def test_group_rule_different_groups_count_as_multiple_signals():
    """Section 17: Indicators in different groups count as distinct signals."""
    # cardio + sleep -> 2 independent signals
    assert count_independent_signals(["heart_rate", "sleep_hours"]) == 2

    # cardio + sleep + cognitive -> 3 independent signals
    assert count_independent_signals(["heart_rate", "sleep_hours", "reaction_ms"]) == 3

    # cardio (2 items) + sleep (2 items) + cognitive (2 items) -> still 3 unique signals!
    items = ["heart_rate", "bp_sys", "sleep_hours", "sleep_quality", "reaction_ms", "reaction_lapses"]
    assert count_independent_signals(items) == 3


# ---------------------------------------------------------------------------
# 3. Layer 4 Pattern Across Signals (Section 19.2)
# ---------------------------------------------------------------------------

def test_pattern_layer_triggers_when_two_or_more_groups_drift():
    """Layer 4: Two or more independent signal groups moving the wrong way raise a pattern flag."""
    drifts = [
        {"metric": "vitals.heart_rate", "delta_pct": 22.0, "severity": "watch"},
        {"metric": "manual.sleep_hours", "delta_pct": -25.0, "severity": "watch"},
    ]
    res = evaluate_pattern_layer(drifts)
    assert res["flag"] is True
    assert res["level"] == 2  # Level 2 Act per Section 19.2
    assert res["action"] == "flag_pattern"
    assert res["signal_count"] == 2
    assert "cardio" in res["groups_involved"]
    assert "sleep" in res["groups_involved"]
    assert "Cardiovascular Adaptations" in res["hrp_risks"]
    assert "Inadequate Sleep and Irregular Schedules" in res["hrp_risks"]
    assert "Multi-signal pattern detected across 2 independent systems" in res["summary"]


def test_pattern_layer_does_not_trigger_for_single_group_drift():
    """Layer 4: Drifts within the same group do not raise a pattern flag."""
    # Both indicators belong to cardio group
    drifts = [
        {"metric": "vitals.heart_rate", "delta_pct": 20.0, "severity": "watch"},
        {"metric": "manual.bp_systolic", "delta_pct": 18.0, "severity": "watch"},
    ]
    res = evaluate_pattern_layer(drifts)
    assert res["flag"] is False
    assert res["signal_count"] == 1
    assert res["action"] == "none"


# ---------------------------------------------------------------------------
# 4. Non-Reading Records Schema & Privacy Enforcement
# ---------------------------------------------------------------------------

def test_non_reading_symptom_record_validation():
    """Test non-reading symptom record schema validation."""
    data = {"zone": "head", "type": "headache", "severity": 4, "onset": "2h", "duration": "persistent"}
    rec = validate_non_reading_record("symptom", data)
    assert rec["zone"] == "head"
    assert rec["severity"] == 4
    assert "timestamp" in rec


def test_non_reading_journal_entry_privacy_rule():
    """Strict Privacy: Journal text is never stored in the clinical engine."""
    secret_text = "Personal confidential notes not for ground"
    data = {"timestamp": "2026-11-15T12:00:00Z", "text": secret_text, "content": secret_text, "entry_count": 1}
    rec = validate_non_reading_record("journal_entry", data)
    assert "text" not in rec
    assert "content" not in rec
    assert rec["entry_count"] == 1
    assert rec["timestamp"] == "2026-11-15T12:00:00Z"


def test_non_reading_crew_pulse_anonymization():
    """Strict Privacy: Crew pulse answers carry no identity."""
    data = {"answers": [{"q": "team_support", "val": 4}], "crew_id": "james", "name": "James Cole"}
    rec = validate_non_reading_record("crew_pulse", data)
    assert "crew_id" not in rec
    assert "name" not in rec
    assert len(rec["answers"]) == 1


# ---------------------------------------------------------------------------
# 5. NASA MRID Single Source of Truth Grounding & Zero Invented Limits
# ---------------------------------------------------------------------------

def test_nasa_mrid_database_loads_all_68_docs():
    """Verify that all 68 NASA MRIDs from dataset/ are indexed in shared/nasa_mrid.json."""
    docs = load_mrid_database()
    assert len(docs) == 68
    ids = {d["id"] for d in docs}
    assert "MEDB 2.1" in ids
    assert "MR006L" in ids
    assert "MR029L" in ids
    assert "MR042S" in ids
    assert "MEDB 3.1" in ids


def test_every_tracked_indicator_is_grounded_in_nasa_mrid():
    """Single Source of Truth: Every tracked indicator references authoritative NASA MRIDs."""
    verification = verify_single_source_of_truth()
    assert verification["all_indicators_grounded"] is True
    assert verification["single_source_of_truth_verified"] is True
    assert verification["missing_sources"] == 0


def test_indicator_mrid_evidence_lookup():
    """Retrieve full NASA MRID document excerpt for an indicator."""
    docs = get_indicator_mrid_evidence("heart_rate")
    assert len(docs) >= 1
    doc_ids = [d["id"] for d in docs]
    assert any("MEDB" in did or "MR" in did for did in doc_ids)
    assert "title" in docs[0]
    assert "purpose" in docs[0]


# ---------------------------------------------------------------------------
# 6. REST API Endpoints Verification
# ---------------------------------------------------------------------------

def test_api_indicators_catalog(client):
    """GET /api/indicators returns complete Section 17 catalog."""
    res = client.get("/api/indicators")
    assert res.status_code == 200
    data = res.json()
    assert data["count"] >= 22
    assert "heart_rate" in data["indicators"]
    assert "cardio" in data["groups"]


def test_api_indicators_groups(client):
    """GET /api/indicators/groups returns the 15 independence groups."""
    res = client.get("/api/indicators/groups")
    assert res.status_code == 200
    data = res.json()
    assert len(data["groups"]) == 15
    assert "cardio" in data["group_to_indicators"]
    assert "heart_rate" in data["group_to_indicators"]["cardio"]


def test_api_single_indicator_with_mrid(client):
    """GET /api/indicators/{indicator_id} returns indicator with NASA MRID evidence."""
    res = client.get("/api/indicators/heart_rate")
    assert res.status_code == 200
    data = res.json()
    assert data["id"] == "heart_rate"
    assert data["group"] == "cardio"
    assert "mrid_evidence" in data
    assert len(data["mrid_evidence"]) >= 1


def test_api_pattern_evaluate(client):
    """POST /api/pattern/evaluate evaluates multi-signal pattern."""
    payload = {
        "drift_items": [
            {"metric": "vitals.heart_rate", "delta_pct": 25.0, "severity": "watch"},
            {"metric": "cognitive.reaction_ms", "delta_pct": 30.0, "severity": "watch"},
        ]
    }
    res = client.post("/api/pattern/evaluate", json=payload)
    assert res.status_code == 200
    data = res.json()
    assert data["flag"] is True
    assert data["signal_count"] == 2
    assert "cardio" in data["groups_involved"]
    assert "cognitive" in data["groups_involved"]


def test_api_dataset_verify(client):
    """GET /api/dataset/verify validates single source of truth."""
    res = client.get("/api/dataset/verify")
    assert res.status_code == 200
    data = res.json()
    assert data["all_indicators_grounded"] is True
    assert data["missing_sources"] == 0
    assert data["single_source_of_truth_verified"] is True


def test_api_dataset_mrid_lookup(client):
    """GET /api/dataset/mrid/{mrid_id} returns specific NASA document."""
    res = client.get("/api/dataset/mrid/MEDB 3.1")
    assert res.status_code == 200
    data = res.json()
    assert data["id"] == "MEDB 3.1"
    assert "Radiation Monitoring" in data["title"]


def test_api_records_lifecycle(client):
    """POST and GET /api/records/{cid}/{record_type} for non-reading records."""
    cid = "james"
    # Record kit usage
    kit_payload = {"item_id": "paracetamol_500", "dose": "500mg", "reason": "mild headache"}
    res = client.post(f"/api/records/{cid}/kit_usage", json=kit_payload)
    assert res.status_code == 200
    assert res.json()["ok"] is True

    # Retrieve kit usage records
    get_res = client.get(f"/api/records/{cid}/kit_usage")
    assert get_res.status_code == 200
    records = get_res.json()["records"]
    assert len(records) >= 1
    assert records[-1]["item_id"] == "paracetamol_500"


def test_api_indicator_detail_enriched_with_mrid(client):
    """GET /api/indicator/{cid}/{metric} returns NASA MRID single source of truth grounding."""
    res = client.get("/api/indicator/james/vitals.heart_rate")
    assert res.status_code == 200
    data = res.json()
    assert data["indicator_id"] == "heart_rate"
    facts = data["facts"]
    assert "NASA MRID" in facts["source_mrid"]
    assert facts["group"] == "cardio"
    assert "Cardiovascular Adaptations" in facts["why_it_matters"]
