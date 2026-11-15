"""Clinical Intelligence & Indicators Registry (Section 17: What We Track).

Single Source of Truth: NASA Medical Requirements Integration Documents (JSC 28913)
cataloged in shared/nasa_mrid.json and dataset/*.pdf.

The Group Rule (Section 17):
"If a measurement does not change a status, a recommendation or a reminder,
we do not track it. The group column is the independence group used for the pattern
rule: two indicators in the same group count as one signal."

Multi-signal Pattern Detection (Layer 4 in Section 19.2):
"Two or more independent signal groups moving the wrong way inside one window
raise a pattern flag (for example slower reactions, flatter mood and shorter sleep)."
"""
from __future__ import annotations

import datetime as dt
import json
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
SHARED = ROOT / "shared"
NASA_MRID_PATH = SHARED / "nasa_mrid.json"
THRESHOLDS_PATH = SHARED / "thresholds.json"

# All 15 independence groups defined in Section 17
INDEPENDENCE_GROUPS: dict[str, str] = {
    "cardio": "Cardiovascular Adaptations (circulation, heart rate, blood pressure)",
    "respiratory": "Hypoxia and pulmonary dynamics (breathing rate, oxygen saturation)",
    "metabolic": "Inadequate Food and Nutrition (blood glucose, clinical chemistry)",
    "thermal": "Thermal regulation and general illness / fever status",
    "sleep": "Inadequate Sleep and Irregular Schedules (duration, sleep quality)",
    "cognitive": "Fatigue and performance / neurocognitive vigilance (reaction time, lapses)",
    "mood": "Behavioral Changes and Psychiatric Disorders (affect, mood, valence, arousal)",
    "energy": "Readiness and physical/mental energy reserve",
    "social": "Inadequate Teamwork and isolation (connection, speech share, alone time)",
    "voice": "Acoustic and prosodic behavioral biomarker (vocal pitch variability)",
    "activity": "Reduced Cardiorespiratory and Musculoskeletal Fitness (countermeasure exercise)",
    "nutrition": "Inadequate Food and Nutrition / fluid balance (hydration, meal intake)",
    "cabin": "Hypoxia, hostile or closed environment (cabin oxygen, carbon dioxide)",
    "radiation": "Risk of Radiation-Induced Cancers and SPE acute exposure",
    "adherence": "Mission protocol adherence and missed check-in behavioural signal",
}

# 22 Tracked Indicators Catalog (Section 17 Table)
# Single source of truth citations strictly grounded in NASA MRIDs (JSC 28913)
TRACKED_INDICATORS: dict[str, dict[str, Any]] = {
    "heart_rate": {
        "id": "heart_rate",
        "name": "Heart Rate",
        "what": "Heart rate (bpm); camera scan, daily and on demand",
        "label": "LIVE estimate",
        "worse_when": "high or low",
        "group": "cardio",
        "hrp_risk": "Cardiovascular Adaptations",
        "unit": "bpm",
        "state_path": "vitals.heart_rate",
        "nasa_mrids": ["MEDB 2.1", "MR006L", "MEDB 1.6"],
        "how_captured": "Camera photoplethysmography (rPPG), wearable patch, or manual pulse",
    },
    "bp_sys": {
        "id": "bp_sys",
        "name": "Systolic Blood Pressure",
        "what": "Systolic blood pressure (mmHg); typed from a cuff, daily",
        "label": "MANUAL",
        "worse_when": "high or low",
        "group": "cardio",
        "hrp_risk": "Cardiovascular Adaptations",
        "unit": "mmHg",
        "state_path": "manual.bp_systolic",
        "nasa_mrids": ["MEDB 2.1", "MR006L"],
        "how_captured": "In-flight blood pressure cuff monitor",
    },
    "bp_dia": {
        "id": "bp_dia",
        "name": "Diastolic Blood Pressure",
        "what": "Diastolic blood pressure (mmHg); typed from a cuff, daily",
        "label": "MANUAL",
        "worse_when": "high or low",
        "group": "cardio",
        "hrp_risk": "Cardiovascular Adaptations",
        "unit": "mmHg",
        "state_path": "manual.bp_diastolic",
        "nasa_mrids": ["MEDB 2.1", "MR006L"],
        "how_captured": "In-flight blood pressure cuff monitor",
    },
    "breathing_rate": {
        "id": "breathing_rate",
        "name": "Breathing Rate",
        "what": "Breaths per minute; camera and pose, daily",
        "label": "LIVE estimate",
        "worse_when": "high or low",
        "group": "respiratory",
        "hrp_risk": "Supports Hypoxia monitoring",
        "unit": "br/min",
        "state_path": "vitals.breathing_rate",
        "nasa_mrids": ["MEDB 2.2", "MR029L"],
        "how_captured": "Computer vision chest excursion and optical flow",
    },
    "spo2": {
        "id": "spo2",
        "name": "Blood Oxygen Saturation (SpO2)",
        "what": "Oxygen saturation (%); prepared data now, sensor later",
        "label": "SIM",
        "worse_when": "low",
        "group": "respiratory",
        "hrp_risk": "Hypoxia",
        "unit": "%",
        "state_path": "vitals.spo2",
        "nasa_mrids": ["MEDB 2.2", "MR029L", "MR043S"],
        "how_captured": "Pulse oximetry sensor / simulator telemetry",
    },
    "blood_glucose": {
        "id": "blood_glucose",
        "name": "Blood Glucose",
        "what": "mg/dL; typed from a meter, as scheduled",
        "label": "MANUAL",
        "worse_when": "high or low",
        "group": "metabolic",
        "hrp_risk": "Inadequate Food and Nutrition",
        "unit": "mg/dL",
        "state_path": "manual.glucose_mgdl",
        "nasa_mrids": ["MR010L", "MR010S"],
        "how_captured": "Capillary blood glucometer",
    },
    "temperature": {
        "id": "temperature",
        "name": "Body Temperature",
        "what": "Body temperature (C); typed, daily and when unwell",
        "label": "MANUAL",
        "worse_when": "high or low",
        "group": "thermal",
        "hrp_risk": "General status, illness signal",
        "unit": "C",
        "state_path": "manual.temp_c",
        "nasa_mrids": ["MEDB 1.1", "MEDB 1.2"],
        "how_captured": "Tympanic or infrared forehead thermometer",
    },
    "sleep_hours": {
        "id": "sleep_hours",
        "name": "Sleep Duration",
        "what": "Hours slept; typed, daily",
        "label": "MANUAL",
        "worse_when": "low",
        "group": "sleep",
        "hrp_risk": "Inadequate Sleep and Irregular Schedules",
        "unit": "hours",
        "state_path": "manual.sleep_hours",
        "nasa_mrids": ["MR042S", "MEDB 7.1", "MEDB 7.2"],
        "how_captured": "Morning sleep log tap or actigraphy",
    },
    "sleep_quality": {
        "id": "sleep_quality",
        "name": "Sleep Quality",
        "what": "1 to 5; tapped, daily",
        "label": "MANUAL",
        "worse_when": "low",
        "group": "sleep",
        "hrp_risk": "Inadequate Sleep and Irregular Schedules",
        "unit": "rating (1-5)",
        "state_path": "manual.sleep_quality",
        "nasa_mrids": ["MR042S", "MEDB 7.1", "MEDB 7.2"],
        "how_captured": "Morning 1-to-5 Likert scale check-in",
    },
    "reaction_ms": {
        "id": "reaction_ms",
        "name": "Reaction Time",
        "what": "30-second reaction test",
        "label": "LIVE",
        "worse_when": "high",
        "group": "cognitive",
        "hrp_risk": "Fatigue and performance",
        "unit": "ms",
        "state_path": "cognitive.reaction_ms",
        "nasa_mrids": ["MR042S"],
        "how_captured": "Psychomotor vigilance task (PVT) 30s stimulus response",
    },
    "reaction_lapses": {
        "id": "reaction_lapses",
        "name": "Reaction Lapses",
        "what": "Number of reaction test lapses (>500ms)",
        "label": "LIVE",
        "worse_when": "high",
        "group": "cognitive",
        "hrp_risk": "Fatigue and performance",
        "unit": "count",
        "state_path": "cognitive.reaction_lapses",
        "nasa_mrids": ["MR042S"],
        "how_captured": "PVT test lapses count",
    },
    "valence": {
        "id": "valence",
        "name": "Affect Valence",
        "what": "Expression model over a rolling window (-1.0 to +1.0)",
        "label": "LIVE",
        "worse_when": "low valence",
        "group": "mood",
        "hrp_risk": "Behavioral Changes and Psychiatric Disorders",
        "unit": "score (-1 to +1)",
        "state_path": "state.valence",
        "nasa_mrids": ["MEDB 7.1", "MEDB 7.5"],
        "how_captured": "Facial action unit valence detector on device",
    },
    "arousal": {
        "id": "arousal",
        "name": "Affect Arousal",
        "what": "Expression model over a rolling window (-1.0 to +1.0)",
        "label": "LIVE",
        "worse_when": "arousal high or low",
        "group": "mood",
        "hrp_risk": "Behavioral Changes and Psychiatric Disorders",
        "unit": "score (-1 to +1)",
        "state_path": "state.arousal",
        "nasa_mrids": ["MEDB 7.1", "MEDB 7.5"],
        "how_captured": "Facial action unit arousal detector on device",
    },
    "mood_self": {
        "id": "mood_self",
        "name": "Self-Reported Mood",
        "what": "1 to 5 taps, daily",
        "label": "MANUAL",
        "worse_when": "low",
        "group": "mood",
        "hrp_risk": "Behavioral Changes and Psychiatric Disorders",
        "unit": "rating (1-5)",
        "state_path": "manual.mood",
        "nasa_mrids": ["MEDB 7.1", "MEDB 7.2"],
        "how_captured": "Daily 1-to-5 mood slider tap",
    },
    "stress_self": {
        "id": "stress_self",
        "name": "Self-Reported Stress",
        "what": "1 to 5 taps, daily",
        "label": "MANUAL",
        "worse_when": "high",
        "group": "mood",
        "hrp_risk": "Behavioral Changes and Psychiatric Disorders",
        "unit": "rating (1-5)",
        "state_path": "manual.stress",
        "nasa_mrids": ["MEDB 7.1", "MEDB 7.2"],
        "how_captured": "Daily 1-to-5 stress scale tap",
    },
    "energy_self": {
        "id": "energy_self",
        "name": "Self-Reported Energy",
        "what": "1 to 5 taps, daily",
        "label": "MANUAL",
        "worse_when": "low",
        "group": "energy",
        "hrp_risk": "Behavioral Changes and Psychiatric Disorders",
        "unit": "rating (1-5)",
        "state_path": "manual.energy",
        "nasa_mrids": ["MEDB 7.1", "MEDB 7.2"],
        "how_captured": "Daily 1-to-5 energy scale tap",
    },
    "connection_self": {
        "id": "connection_self",
        "name": "Social Connection Rating",
        "what": "1 to 5 tap",
        "label": "MANUAL",
        "worse_when": "low",
        "group": "social",
        "hrp_risk": "Inadequate Teamwork, isolation",
        "unit": "rating (1-5)",
        "state_path": "manual.connection",
        "nasa_mrids": ["MEDB 7.1", "MEDB 7.2", "MR032L"],
        "how_captured": "Weekly or daily connection check-in tap",
    },
    "talk_share": {
        "id": "talk_share",
        "name": "Talk-Time Share",
        "what": "Speaker ID, rolling conversation share vs norm",
        "label": "LIVE or SIM",
        "worse_when": "low vs own norm",
        "group": "social",
        "hrp_risk": "Inadequate Teamwork",
        "unit": "% share",
        "state_path": "voice.talk_share",
        "nasa_mrids": ["MEDB 7.1", "MR032L"],
        "how_captured": "On-device speaker diarization and voice embeddings",
    },
    "time_alone_pct": {
        "id": "time_alone_pct",
        "name": "Time Spent Alone",
        "what": "Proportion of active day spent isolated",
        "label": "LIVE or SIM",
        "worse_when": "high vs own norm",
        "group": "social",
        "hrp_risk": "Inadequate Teamwork",
        "unit": "%",
        "state_path": "state.time_alone_pct",
        "nasa_mrids": ["MEDB 7.1", "MR032L"],
        "how_captured": "Cabin occupancy and proximity beacon tracking",
    },
    "voice_pitch": {
        "id": "voice_pitch",
        "name": "Vocal Pitch Variation",
        "what": "Microphone, rolling fundamental frequency (F0)",
        "label": "LIVE",
        "worse_when": "change vs own norm",
        "group": "voice",
        "hrp_risk": "Behavioral signal",
        "unit": "Hz",
        "state_path": "voice.pitch",
        "nasa_mrids": ["MEDB 7.1", "MEDB 7.2"],
        "how_captured": "Acoustic feature extraction during speech interaction",
    },
    "exercise_minutes": {
        "id": "exercise_minutes",
        "name": "Countermeasure Exercise",
        "what": "Quick log; accelerometer later",
        "label": "MANUAL, DESIGNED",
        "worse_when": "low",
        "group": "activity",
        "hrp_risk": "Reduced Cardiorespiratory and Musculoskeletal Fitness",
        "unit": "min/day",
        "state_path": "manual.exercise_minutes",
        "nasa_mrids": ["MEDB 5.1", "MEDB 5.2", "MEDB 6.1", "MR006L"],
        "how_captured": "TWA treadmill/ergometer log or wearable workout record",
    },
    "hydration_log": {
        "id": "hydration_log",
        "name": "Hydration & Fluid Intake",
        "what": "Meals and fluids, quick log",
        "label": "MANUAL",
        "worse_when": "low",
        "group": "nutrition",
        "hrp_risk": "Inadequate Food and Nutrition",
        "unit": "ml/day",
        "state_path": "manual.hydration_ml",
        "nasa_mrids": ["MEDB N3.06", "MR010L"],
        "how_captured": "Quick fluid dispenser counter or meal log entry",
    },
    "cabin_o2": {
        "id": "cabin_o2",
        "name": "Cabin Oxygen (FiO2)",
        "what": "Simulator now, sensor later, continuous",
        "label": "SIM",
        "worse_when": "low",
        "group": "cabin",
        "hrp_risk": "Hypoxia, hostile or closed environment",
        "unit": "%",
        "state_path": "cabin.oxygen_pct",
        "nasa_mrids": ["MR039L", "MR043S", "MR091L"],
        "how_captured": "Cabin atmosphere analyzer / environmental sensor bus",
    },
    "cabin_co2": {
        "id": "cabin_co2",
        "name": "Cabin Carbon Dioxide (ppCO2)",
        "what": "Simulator now, sensor later, continuous",
        "label": "SIM",
        "worse_when": "high",
        "group": "cabin",
        "hrp_risk": "Hypoxia, hostile or closed environment",
        "unit": "ppm",
        "state_path": "cabin.co2_ppm",
        "nasa_mrids": ["MR039L", "MR043S", "MR091L"],
        "how_captured": "Carbon Dioxide Monitor Kit (CDMK) / Air Quality Monitor",
    },
    "rad_dose_rate": {
        "id": "rad_dose_rate",
        "name": "Radiation Dose Rate",
        "what": "Current dose rate from space-weather feed",
        "label": "SIM",
        "worse_when": "high",
        "group": "radiation",
        "hrp_risk": "Risk of Radiation-Induced Cancers",
        "unit": "uSv/h",
        "state_path": "radiation.dose_rate_usv_h",
        "nasa_mrids": ["MEDB 3.1", "MR005L", "MR092L", "MR094L"],
        "how_captured": "Active Dosimeters (TEPC, RAD, REM2) / space-weather feed",
    },
    "rad_cumulative": {
        "id": "rad_cumulative",
        "name": "Cumulative Radiation Exposure",
        "what": "Running cumulative exposure from feed",
        "label": "SIM",
        "worse_when": "high",
        "group": "radiation",
        "hrp_risk": "Risk of Radiation-Induced Cancers",
        "unit": "mSv",
        "state_path": "radiation.cumulative_msv",
        "nasa_mrids": ["MEDB 3.1", "MEDB 3.2", "MR004L", "MR005L"],
        "how_captured": "Crew Passive Dosimeters (CPD) integrated tracking",
    },
    "rad_event_level": {
        "id": "rad_event_level",
        "name": "Solar Radiation Storm Level",
        "what": "Storm level: quiet, elevated, storm",
        "label": "SIM",
        "worse_when": "storm",
        "group": "radiation",
        "hrp_risk": "Risk of Radiation-Induced Cancers",
        "unit": "scale (S0-S5)",
        "state_path": "radiation.storm_level",
        "nasa_mrids": ["MEDB 3.1", "MR005L", "MR092L"],
        "how_captured": "NOAA Space Weather Solar Radiation Storm scale telemetry",
    },
    "shelter_status": {
        "id": "shelter_status",
        "name": "Radiation Shelter Status",
        "what": "Whether shelter is advised or occupied",
        "label": "SIM",
        "worse_when": "true",
        "group": "radiation",
        "hrp_risk": "Risk of Radiation-Induced Cancers",
        "unit": "boolean",
        "state_path": "radiation.sheltered",
        "nasa_mrids": ["MEDB 3.1", "MR005L", "MR092L"],
        "how_captured": "Mission flight operations advisory & compartment sensor",
    },
    "missed_checkins": {
        "id": "missed_checkins",
        "name": "Missed Check-Ins",
        "what": "System counts missed or skipped reminders",
        "label": "LIVE",
        "worse_when": "high",
        "group": "adherence",
        "hrp_risk": "Missed check-ins are a signal",
        "unit": "count",
        "state_path": "manual.missed_checkins",
        "nasa_mrids": ["MEDB 7.1", "MEDB 7.2"],
        "how_captured": "Scheduler reminder lifecycle engine counter",
    },
}

# Mapping from raw state path to indicator ID
PATH_TO_INDICATOR_ID: dict[str, str] = {
    ind["state_path"]: ind_id for ind_id, ind in TRACKED_INDICATORS.items()
}
# Additional common aliases
PATH_TO_INDICATOR_ID.update({
    "vitals.heart_rate": "heart_rate",
    "manual.bp_systolic": "bp_sys",
    "manual.bp_diastolic": "bp_dia",
    "vitals.breathing_rate": "breathing_rate",
    "vitals.spo2": "spo2",
    "manual.glucose_mgdl": "blood_glucose",
    "manual.temp_c": "temperature",
    "manual.sleep_hours": "sleep_hours",
    "manual.sleep_quality": "sleep_quality",
    "cognitive.reaction_ms": "reaction_ms",
    "cognitive.reaction_lapses": "reaction_lapses",
    "state.valence": "valence",
    "state.arousal": "arousal",
    "manual.mood": "mood_self",
    "manual.stress": "stress_self",
    "state.stress": "stress_self",
    "manual.energy": "energy_self",
    "state.fatigue": "energy_self",
    "manual.connection": "connection_self",
    "voice.talk_time": "talk_share",
    "voice.talk_share": "talk_share",
    "state.time_alone_pct": "time_alone_pct",
    "voice.pitch": "voice_pitch",
    "manual.exercise_minutes": "exercise_minutes",
    "manual.hydration_ml": "hydration_log",
    "cabin.oxygen_pct": "cabin_o2",
    "cabin.co2_ppm": "cabin_co2",
    "radiation.dose_rate_usv_h": "rad_dose_rate",
    "radiation.cumulative_msv": "rad_cumulative",
    "radiation.storm_level": "rad_event_level",
    "radiation.sheltered": "shelter_status",
    "manual.missed_checkins": "missed_checkins",
})


def resolve_indicator_id(metric_or_path: str) -> str | None:
    """Resolve an indicator key or state path into its standard Section 17 indicator ID."""
    clean = str(metric_or_path).strip()
    if clean in TRACKED_INDICATORS:
        return clean
    if clean in PATH_TO_INDICATOR_ID:
        return PATH_TO_INDICATOR_ID[clean]
    # Check suffixes
    suffix = clean.split(".")[-1]
    if suffix in TRACKED_INDICATORS:
        return suffix
    if suffix in PATH_TO_INDICATOR_ID:
        return PATH_TO_INDICATOR_ID[suffix]
    return None


def get_indicator_group(metric_or_path: str) -> str | None:
    """The Group Rule: lookup the independence group for an indicator or metric path."""
    ind_id = resolve_indicator_id(metric_or_path)
    if ind_id and ind_id in TRACKED_INDICATORS:
        return TRACKED_INDICATORS[ind_id]["group"]
    return None


def group_signals(items: list[dict | str]) -> dict[str, list[dict]]:
    """Group drifting metrics or indicator items by their independence group.
    
    Section 17 Group Rule: 'two indicators in the same group count as one signal'.
    """
    grouped: dict[str, list[dict]] = {}
    for item in items:
        if isinstance(item, str):
            metric = item
            obj: dict[str, Any] = {"metric": metric}
        elif isinstance(item, dict):
            metric = str(item.get("metric") or item.get("id") or "")
            obj = dict(item)
        else:
            continue
        group = get_indicator_group(metric)
        if not group:
            continue
        obj["group"] = group
        grouped.setdefault(group, []).append(obj)
    return grouped


def count_independent_signals(items: list[dict | str]) -> int:
    """Count unique independence groups represented in a set of drifting indicators.
    
    Section 17: Two indicators in the same group count as one signal.
    """
    return len(group_signals(items))


def evaluate_pattern_layer(
    drifting_items: list[dict],
    absolute_items: list[dict] | None = None,
) -> dict:
    """Five-layer evaluation: Layer 4 Pattern across signals (Section 19.2).
    
    'Two or more independent signal groups moving the wrong way inside one window
    raise a pattern flag (for example slower reactions, flatter mood and shorter sleep).'
    
    Returns:
        dict with flag (bool), signal_count (int), groups_involved (list),
        hrp_risks (list), level (2: Act), and plain-words explanatory summary.
    """
    candidates: list[dict] = []
    # Collect drift items moving the wrong way
    for item in (drifting_items or []):
        sev = item.get("severity", "ok")
        if sev in ("watch", "alert"):
            candidates.append(item)
    # Collect non-nominal absolute items (excluding cabin/radiation which trigger Layer 1/2)
    for item in (absolute_items or []):
        sev = item.get("severity", "ok")
        if sev in ("watch", "alert"):
            metric = item.get("metric", "")
            grp = get_indicator_group(metric)
            if grp not in ("cabin", "radiation"):
                candidates.append(item)

    grouped = group_signals(candidates)
    unique_groups = sorted(list(grouped.keys()))
    signal_count = len(unique_groups)

    if signal_count >= 2:
        # Multi-signal pattern flag!
        all_items: list[dict] = []
        hrp_risks = set()
        group_summaries = []
        for grp in unique_groups:
            items_in_grp = grouped[grp]
            all_items.extend(items_in_grp)
            for it in items_in_grp:
                ind_id = resolve_indicator_id(it.get("metric", ""))
                if ind_id and ind_id in TRACKED_INDICATORS:
                    hrp_risks.add(TRACKED_INDICATORS[ind_id]["hrp_risk"])
            group_summaries.append(f"{grp} ({len(items_in_grp)} indicator{'s' if len(items_in_grp) > 1 else ''})")

        grp_str = ", ".join(group_summaries[:-1]) + (" and " if len(group_summaries) > 1 else "") + group_summaries[-1]
        summary = (
            f"Multi-signal pattern detected across {signal_count} independent systems: {grp_str}. "
            "Related signals grouped into single pattern alert per clinical fatigue control."
        )
        return {
            "flag": True,
            "level": 2,  # Level 2 "Act" per Section 19.2/19.3
            "action": "flag_pattern",
            "signal_count": signal_count,
            "groups_involved": unique_groups,
            "hrp_risks": sorted(list(hrp_risks)),
            "items": all_items,
            "summary": summary,
        }

    return {
        "flag": False,
        "level": 0,
        "action": "none",
        "signal_count": signal_count,
        "groups_involved": unique_groups,
        "hrp_risks": [],
        "items": [],
        "summary": "No multi-signal pattern detected.",
    }


# =======================================================================
# Non-Reading Records (Section 17 Specification)
# =======================================================================

NON_READING_SCHEMAS = {
    "symptom": {
        "required": ["zone", "type", "severity"],
        "fields": {"zone": str, "type": str, "severity": int, "onset": str, "duration": str},
    },
    "protocol_run": {
        "required": ["protocol_id", "steps_done", "outcome"],
        "fields": {"protocol_id": str, "steps_done": list, "outcome": str, "duration_s": (int, float)},
    },
    "kit_usage": {
        "required": ["item_id", "dose", "reason"],
        "fields": {"item_id": str, "dose": str, "reason": str, "timestamp": str},
    },
    "alert_feedback": {
        "required": ["alert_id", "useful"],
        "fields": {"alert_id": str, "useful": bool, "reason": str, "timestamp": str},
    },
    "schedule_context": {
        "required": ["current_block"],
        "fields": {"current_block": str, "quiet_hours": bool, "timestamp": str},
    },
    "data_quality": {
        "required": ["metric", "confidence"],
        "fields": {"metric": str, "confidence": (int, float), "quality_rating": str, "remeasure_suggested": bool},
    },
    "mood_tags": {
        "required": ["tags"],
        "fields": {"tags": list, "context": str, "timestamp": str},
    },
    "journal_entry": {
        # Strict privacy rule: the text stays in a separate on-device store the engine never reads.
        # Only timestamp and count are stored.
        "required": ["timestamp"],
        "fields": {"timestamp": str, "entry_count": int},
    },
    "crew_pulse": {
        # Strict privacy rule: aggregated, no identity.
        "required": ["answers"],
        "fields": {"answers": list, "timestamp": str},
    },
    "audit_event": {
        "required": ["event_type", "details"],
        "fields": {"event_type": str, "details": dict, "timestamp": str},
    },
}


def validate_non_reading_record(record_type: str, data: dict) -> dict:
    """Validate and sanitize a non-reading record per Section 17 specifications.
    
    Enforces privacy rules (journal text stripped, pulse identity stripped).
    """
    if record_type not in NON_READING_SCHEMAS:
        raise ValueError(f"Unknown non-reading record type: {record_type}. Must be one of {list(NON_READING_SCHEMAS.keys())}")
    
    schema = NON_READING_SCHEMAS[record_type]
    for req in schema["required"]:
        if req not in data:
            raise ValueError(f"Missing required field '{req}' for record type '{record_type}'")

    sanitized = {}
    for k, expected_type in schema["fields"].items():
        if k in data:
            val = data[k]
            if not isinstance(val, expected_type):
                # Try coercion if possible
                if expected_type == int and isinstance(val, (float, str)):
                    val = int(val)
                elif expected_type == bool and isinstance(val, str):
                    val = val.lower() in ("true", "1", "yes")
                else:
                    raise TypeError(f"Field '{k}' must be of type {expected_type}, got {type(val)}")
            sanitized[k] = val

    # Ensure timestamp
    if "timestamp" not in sanitized:
        sanitized["timestamp"] = dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    # Extra security / privacy filters
    if record_type == "journal_entry":
        # Discard any text fields if sent accidentally
        sanitized.pop("text", None)
        sanitized.pop("content", None)
        sanitized.pop("entry", None)

    if record_type == "crew_pulse":
        # Discard any personal identification
        sanitized.pop("crew_id", None)
        sanitized.pop("name", None)

    return sanitized


# =======================================================================
# NASA MRID Dataset Grounding & Evidence (Single Source of Truth)
# =======================================================================

def load_mrid_database() -> list[dict]:
    """Load the full parsed NASA JSC 28913 MRID database (68 documents)."""
    if not NASA_MRID_PATH.exists():
        return []
    try:
        return json.loads(NASA_MRID_PATH.read_text(encoding="utf-8")).get("documents", [])
    except Exception:
        return []


def get_indicator_mrid_evidence(indicator_id: str) -> list[dict]:
    """Retrieve the authoritative NASA MRID documents for a tracked indicator."""
    ind_id = resolve_indicator_id(indicator_id)
    if not ind_id or ind_id not in TRACKED_INDICATORS:
        return []
    target_mrids = set(TRACKED_INDICATORS[ind_id]["nasa_mrids"])
    all_docs = load_mrid_database()
    matched = [d for d in all_docs if d.get("id") in target_mrids]
    return matched


def verify_single_source_of_truth() -> dict:
    """Verify that every tracked indicator is grounded in NASA MRIDs and all thresholds
    possess valid kind and source citations with zero invented limits.
    """
    all_mrids = {d["id"] for d in load_mrid_database()}
    indicator_audit = []
    for ind_id, ind in TRACKED_INDICATORS.items():
        valid_mrids = [m for m in ind["nasa_mrids"] if m in all_mrids or any(m in d_id for d_id in all_mrids)]
        indicator_audit.append({
            "indicator_id": ind_id,
            "group": ind["group"],
            "hrp_risk": ind["hrp_risk"],
            "mrid_citations": ind["nasa_mrids"],
            "grounded": len(valid_mrids) > 0,
        })

    # Verify thresholds.json
    thresholds_data = json.loads(THRESHOLDS_PATH.read_text(encoding="utf-8")) if THRESHOLDS_PATH.exists() else {}
    absolute_thresholds = thresholds_data.get("absolute", {})
    threshold_audit = []
    missing_sources = 0

    for metric, spec in absolute_thresholds.items():
        levels = spec.get("levels", [])
        for lvl in levels:
            has_kind = bool(lvl.get("kind"))
            has_source = bool(lvl.get("source", {}).get("title"))
            if not has_kind or not has_source:
                missing_sources += 1
            threshold_audit.append({
                "metric": metric,
                "severity": lvl.get("severity"),
                "kind": lvl.get("kind"),
                "source_title": lvl.get("source", {}).get("title"),
                "valid": has_kind and has_source,
            })

    return {
        "indicators_count": len(TRACKED_INDICATORS),
        "groups_count": len(INDEPENDENCE_GROUPS),
        "all_indicators_grounded": all(a["grounded"] for a in indicator_audit),
        "threshold_levels_checked": len(threshold_audit),
        "missing_sources": missing_sources,
        "single_source_of_truth_verified": (missing_sources == 0 and all(a["grounded"] for a in indicator_audit)),
        "indicator_audit": indicator_audit,
    }
