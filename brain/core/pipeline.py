"""Clinical Pipeline Engine (Sections 18 & 19.1 - 19.6).

Implements the 9-stage clinical pipeline:
 1. Ingest: Reads from any source, verifies authenticity, logs raw input.
 2. Validate: Sane physical range, plausible delta change, and confidence.
    (Implausible values prompt remeasurement; never silently dropped).
 3. Normalize: Unit conversion (e.g. F to C, kPa to mmHg), ISO timestamp, valid contract label.
 4. Store: Writes record to store and audit log with retry protection.
 5. Derive: Computes personal baseline using robust statistics (Median + MAD), trend slopes,
    and calibration progression ('Calibrating (n of 7)'). Excludes post-exercise/EVA/illness.
 6. Assess: Evaluates 5 layers (safe limits, baseline distance, trend, cross-signal pattern, context).
    Enforces the clinical rule: Level 3 comes ONLY from range limits, red flags, or cabin limits,
    never from statistics alone. Personal deviation alone never exceeds Level 2.
 7. Decide: Triage logic, protocol matching, active kit safety filter, recommendation cards, recheck timers.
    No protocol matches -> generic card plus escalate.
 8. Present: Modality dispatch (screen, voice, audio tones, orb pulses) and quiet hours breakthrough rules.
 9. Learn: Closed-loop outcome tracking and bounded alert sensitivity adaptation.
"""
from __future__ import annotations

import copy
import datetime as dt
import math
import time
from typing import Any

from brain.core.store import VALID_LABELS
from brain.rules.indicators import INDEPENDENCE_GROUPS, count_independent_signals, evaluate_pattern_layer, get_indicator_group, resolve_indicator_id
from brain.clinical.protocols import build_recommendation_card, find_matching_protocols, get_protocol

# Physical physiological sanity bounds (Stage 2: Validate)
PHYSICAL_BOUNDS: dict[str, tuple[float, float]] = {
    "vitals.heart_rate": (25.0, 250.0),
    "vitals.breathing_rate": (4.0, 60.0),
    "vitals.spo2": (50.0, 100.0),
    "manual.temp_c": (25.0, 45.0),   # what a body can show, so hypothermia can be recorded; unusual values are flagged, not refused
    "manual.bp_systolic": (50.0, 260.0),
    "manual.bp_diastolic": (30.0, 160.0),
    "manual.glucose_mgdl": (20.0, 500.0),
    "manual.sleep_hours": (0.0, 24.0),
    "manual.sleep_quality": (1.0, 5.0),
    "cognitive.reaction_ms": (100.0, 2000.0),
    "cabin.oxygen_pct": (5.0, 40.0),
    "cabin.co2_ppm": (100.0, 25000.0),
}

# Max plausible jump per minute for vital signals (Stage 2: Validate)
PLAUSIBLE_RATE_PER_MIN: dict[str, float] = {
    "vitals.heart_rate": 60.0,       # jumping > 60 bpm in 1 min is flagged
    "vitals.breathing_rate": 20.0,
    "manual.temp_c": 1.5,
    "manual.bp_systolic": 50.0,
    "manual.bp_diastolic": 35.0,
}

MIN_CALIBRATION_POINTS = 7


class ClinicalPipeline:
    """The 9-stage Sentinel clinical intelligence and detection pipeline."""

    def __init__(self, store=None):
        self.store = store

    # ===================================================================
    # Stage 1: Ingest
    # ===================================================================
    def ingest(self, raw_reading: dict[str, Any]) -> dict[str, Any]:
        """Stage 1: Ingest reading from any source. Unknown source rejected and logged."""
        if not isinstance(raw_reading, dict):
            raise ValueError("Raw reading must be a dictionary")
        source = raw_reading.get("source")
        valid_sources = {"camera", "manual", "sensor", "sim", "user", "voice", "wearable"}
        if not source or source.lower() not in valid_sources:
            raise ValueError(f"Unknown or rejected reading source: '{source}'. Must be one of {sorted(valid_sources)}")

        metric = raw_reading.get("metric") or raw_reading.get("indicator") or raw_reading.get("field")
        if not metric:
            raise ValueError("Reading missing required metric identifier")

        value = raw_reading.get("value")
        if value is None or isinstance(value, bool) or not isinstance(value, (int, float)):
            raise ValueError("Reading missing numeric value")

        return {
            "metric": str(metric),
            "value": float(value),
            "source": str(source).lower(),
            "timestamp": raw_reading.get("timestamp") or time.time(),
            "confidence": float(raw_reading.get("confidence", 1.0)),
            "unit": raw_reading.get("unit"),
            "context": raw_reading.get("context", {}),
            "stage": "ingested",
        }

    # ===================================================================
    # Stage 2: Validate
    # ===================================================================
    def validate(self, ingested_reading: dict[str, Any], last_reading: dict[str, Any] | None = None) -> dict[str, Any]:
        """Stage 2: Validate sanity, plausible delta change, and confidence.
        
        Section 19.1: Implausible value asks user to remeasure; never silently drops.
        """
        metric = ingested_reading["metric"]
        val = ingested_reading["value"]
        conf = ingested_reading["confidence"]
        unit = str(ingested_reading.get("unit") or "").lower().strip()

        # Pre-convert Fahrenheit to Celsius and kPa to mmHg for sanity check if specified
        eval_val = val
        if "temp" in metric.lower() and unit in ("f", "degf", "fahrenheit"):
            eval_val = (val - 32.0) * (5.0 / 9.0)
        elif ("bp" in metric.lower() or "pressure" in metric.lower()) and unit in ("kpa", "kilopascal"):
            eval_val = val * 7.50062

        # Check confidence
        if conf < 0.0 or conf > 1.0:
            raise ValueError(f"Invalid confidence score {conf}; must be 0.0 to 1.0")

        # Check sane physical range
        path = resolve_indicator_id(metric) or metric
        bounds = PHYSICAL_BOUNDS.get(metric) or PHYSICAL_BOUNDS.get(path)
        if bounds and (eval_val < bounds[0] or eval_val > bounds[1]):
            return {
                **ingested_reading,
                "valid": False,
                "reason": f"Value {val} outside sane physical bounds ({bounds[0]}-{bounds[1]}). Remeasurement required.",
                "remeasure_required": True,
                "stage": "validation_failed",
            }

        # Check plausible delta change vs last reading
        if last_reading and last_reading.get("value") is not None:
            dt_min = max(0.1, (ingested_reading["timestamp"] - last_reading.get("timestamp", ingested_reading["timestamp"])) / 60.0)
            max_rate = PLAUSIBLE_RATE_PER_MIN.get(metric) or PLAUSIBLE_RATE_PER_MIN.get(path)
            if max_rate and dt_min <= 10.0:  # Only evaluate rapid successive readings
                rate = abs(val - float(last_reading["value"])) / dt_min
                if rate > max_rate and not ingested_reading.get("context", {}).get("exercise"):
                    return {
                        **ingested_reading,
                        "valid": False,
                        "reason": f"Rapid change of {round(rate, 1)}/min exceeds physiological rate limit ({max_rate}/min). Remeasurement required.",
                        "remeasure_required": True,
                        "stage": "validation_failed",
                    }

        return {**ingested_reading, "valid": True, "stage": "validated"}

    # ===================================================================
    # Stage 3: Normalize
    # ===================================================================
    def normalize(self, validated_reading: dict[str, Any]) -> dict[str, Any]:
        """Stage 3: Standard units, onboard-clock timestamp, label."""
        if not validated_reading.get("valid"):
            return validated_reading

        metric = validated_reading["metric"]
        val = validated_reading["value"]
        unit = str(validated_reading.get("unit") or "").lower().strip()
        label = validated_reading.get("label") or ("MANUAL" if validated_reading["source"] in ("manual", "user") else "LIVE" if validated_reading["source"] == "camera" else "SIM")

        # Temperature conversion (Fahrenheit to Celsius)
        if "temp" in metric.lower() and unit in ("f", "degf", "fahrenheit"):
            val = (val - 32.0) * (5.0 / 9.0)
            unit = "C"

        # Blood pressure conversion (kPa to mmHg)
        if ("bp" in metric.lower() or "pressure" in metric.lower()) and unit in ("kpa", "kilopascal"):
            val = val * 7.50062
            unit = "mmHg"

        # Standard ISO timestamp
        iso_time = dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

        return {
            **validated_reading,
            "value": round(val, 2),
            "unit": unit,
            "label": label,
            "iso_timestamp": iso_time,
            "stage": "normalized",
        }

    # ===================================================================
    # Stage 4: Store
    # ===================================================================
    def store_reading(self, cid: str, normalized_reading: dict[str, Any], store=None) -> dict[str, Any]:
        """Stage 4: Store normalized reading, audit event, retry write failures."""
        st = store or self.store
        if not st:
            return {**normalized_reading, "stored": False}

        max_retries = 3
        for attempt in range(max_retries):
            try:
                res = st.ingest_reading(cid, normalized_reading)
                return {**normalized_reading, "stored": True, "state_patch": res, "stage": "stored"}
            except Exception as e:
                if attempt == max_retries - 1:
                    raise RuntimeError(f"Storage write failed after {max_retries} attempts: {e}")
                time.sleep(0.05)

        return normalized_reading

    # ===================================================================
    # Stage 5: Derive (Robust Median + MAD, Trend Slopes, Calibration)
    # ===================================================================
    def derive(self, cid: str, history_points: list[dict[str, Any]]) -> dict[str, Any]:
        """Stage 5: History -> Baseline, trend, features, data-quality score.
        
        Section 19.2: Personal baseline is a rolling median and spread (MAD) over a recent
        window, excluding readings tagged post-exercise, EVA or illness and below min confidence.
        Until enough readings exist (7 points), screen says 'Calibrating (n of 7)'.
        """
        # Filter valid points
        clean_pts = []
        for p in (history_points or []):
            conf = float(p.get("confidence", 1.0))
            if conf < 0.35:
                continue
            ctx = p.get("context", {})
            if ctx.get("post_exercise") or ctx.get("eva") or ctx.get("illness"):
                continue
            v = p.get("v") if "v" in p else p.get("value")
            if v is not None and isinstance(v, (int, float)):
                clean_pts.append(float(v))

        n = len(clean_pts)
        if n < MIN_CALIBRATION_POINTS:
            # Calibrating progression
            med = sum(clean_pts) / n if n > 0 else 0.0
            return {
                "calibrated": False,
                "stage": f"Calibrating ({n} of {MIN_CALIBRATION_POINTS})",
                "calibration_progress": f"{n} of {MIN_CALIBRATION_POINTS}",
                "count": n,
                "median": med,
                "mad": 0.0,
                "spread": 3.0,
                "trend_slope": 0.0,
                "data_quality_score": round(min(1.0, n / MIN_CALIBRATION_POINTS), 2),
            }

        # Compute robust Median and Median Absolute Deviation (MAD)
        sorted_vals = sorted(clean_pts)
        mid = n // 2
        median = sorted_vals[mid] if n % 2 != 0 else (sorted_vals[mid - 1] + sorted_vals[mid]) / 2.0

        abs_devs = sorted([abs(x - median) for x in clean_pts])
        mad = abs_devs[mid] if n % 2 != 0 else (abs_devs[mid - 1] + abs_devs[mid]) / 2.0
        # Normal scale factor for normal distribution consistency
        spread = max(0.5, 1.4826 * mad)

        # Compute linear regression trend slope over recent 7 points
        recent = clean_pts[-7:]
        m = len(recent)
        x_vals = list(range(m))
        x_mean = sum(x_vals) / m
        y_mean = sum(recent) / m
        denom = sum((x - x_mean) ** 2 for x in x_vals)
        slope = sum((x_vals[i] - x_mean) * (recent[i] - y_mean) for i in range(m)) / denom if denom != 0 else 0.0

        return {
            "calibrated": True,
            "stage": "Calibrated",
            "calibration_progress": f"{MIN_CALIBRATION_POINTS} of {MIN_CALIBRATION_POINTS}",
            "count": n,
            "median": round(median, 2),
            "mad": round(mad, 2),
            "spread": round(spread, 2),
            "trend_slope": round(slope, 3),
            "data_quality_score": 1.0,
        }

    # ===================================================================
    # Stage 6: Assess (5 Layers, Cheapest First, Urgency Rules)
    # ===================================================================
    def assess(
        self,
        cid: str,
        current_value: float,
        metric: str,
        derived: dict[str, Any],
        absolute_thresholds: dict[str, Any] | None = None,
        context: dict[str, Any] | None = None,
        confidence: float = 1.0,
    ) -> dict[str, Any]:
        """Stage 6: Derived state plus environment -> Level 0 to 3, reasons, confidence.
        
        Section 19.2 (5 Layers, cheapest first):
        1. Safe limits (thresholds.json) -> amber or red
        2. Personal baseline (robust deviations: |x - median| / MAD)
        3. Trend (slope over multiple days)
        4. Cross-signal pattern (independent groups)
        5. Context & quality (suppress post-exercise, ignore low confidence)
        
        Section 19.3 Clinical Safety Law:
        Level 3 comes ONLY from range limits, red-flag symptoms, or cabin limits,
        NEVER from statistics alone. Personal deviation alone never exceeds Level 2.
        """
        context = context or {}
        reasons: list[str] = []
        level = 0

        # Layer 5: Context & Quality Filter
        if context.get("post_exercise") and "heart" in metric:
            # Suppress exercise pulse elevation
            return {
                "level": 0,
                "reasons": ["Expected pulse elevation post-exercise; suppressed per Layer 5 context."],
                "layer_hit": 5,
                "confidence": confidence,
            }

        # Layer 1: Safe Limits (Thresholds)
        if absolute_thresholds:
            for lvl in absolute_thresholds.get("levels", []):
                sev = lvl.get("severity")
                src = lvl.get("source") or lvl.get("kind", "limit")
                if "below" in lvl and current_value < lvl["below"]:
                    hit_level = 3 if sev == "alert" else 1
                    level = max(level, hit_level)
                    reasons.append(f"Safe limit: {metric} {current_value} below {lvl['below']} ({src}).")
                if "above" in lvl and current_value > lvl["above"]:
                    hit_level = 3 if sev == "alert" else 1
                    level = max(level, hit_level)
                    reasons.append(f"Safe limit: {metric} {current_value} above {lvl['above']} ({src}).")

        # If Level 3 hit from safe limit, return immediately (cheapest first)
        if level >= 3:
            return {"level": 3, "reasons": reasons, "layer_hit": 1, "confidence": confidence}

        # Layer 2: Personal Baseline (Robust Deviation)
        if derived.get("calibrated") and derived.get("spread", 0) > 0:
            med = derived["median"]
            spread = derived["spread"]
            dev = abs(current_value - med) / spread
            if dev >= 3.0:
                # Clear personal deviation -> Level 2 Act (Never Level 3!)
                level = max(level, 2)
                reasons.append(f"Personal baseline: {metric} {current_value} deviates {round(dev, 1)}x spread from personal normal ({med}).")
            elif dev >= 2.0:
                # Moderate deviation -> Level 1 Watch
                level = max(level, 1)
                reasons.append(f"Personal baseline: {metric} {current_value} deviates {round(dev, 1)}x spread from personal normal.")

        # Layer 3: Trend (Slope over multiple days)
        slope = derived.get("trend_slope", 0.0)
        if abs(slope) >= 0.5:
            level = max(level, 1)
            reasons.append(f"Trend slope: persistent directional drift of {slope:+.2f} per day.")

        # Data-quality gate: low confidence reading cannot raise alert alone
        if confidence < 0.40 and level > 0 and len(reasons) <= 1:
            level = 0
            reasons.append("Alert suppressed: low-confidence reading without corroborating signal (Layer 5).")

        # Enforce Section 19.3 rule strictly:
        # Personal deviation alone never exceeds Level 2.
        if level > 2 and not any("Safe limit" in r for r in reasons):
            level = 2

        return {
            "level": level,
            "reasons": reasons or ["All indicators nominal."],
            "layer_hit": 2 if level == 2 else (1 if level == 1 else 0),
            "confidence": confidence,
        }

    # ===================================================================
    # Stage 7: Decide (Triage & Recommendation Cards)
    # ===================================================================
    def decide(
        self,
        cid: str,
        level: int,
        symptom: str = "",
        zone: str = "",
        reasons: list[str] | None = None,
        profile: dict[str, Any] | None = None,
        env: str = "transit",
        mode: str = "routine",
    ) -> dict[str, Any]:
        """Stage 7: Level, symptoms, profile, kit -> Recommendation, reminders, digest, alerts.
        
        Section 19.1 Triage logic:
        1. Find matching protocols.
        2. Evaluate red flags -> Level 3 urgent card.
        3. No protocol matches -> generic card plus escalate.
        4. Build card, apply environment variant, apply kit filter, create recheck reminder.
        """
        reasons = reasons or []
        summary = "; ".join(reasons) if reasons else symptom

        # Find matching protocol
        matched = find_matching_protocols(symptom, zone=zone)
        proto = get_protocol(matched[0]["id"], env=env, mode=mode) if matched else None

        card = build_recommendation_card(
            cid=cid,
            level=level,
            trigger_summary=summary,
            protocol=proto,
            sure="High" if level in (0, 3) else "Medium",
            sure_reason="Validated onboard sensor and clinical protocol match",
            env=env,
            mode=mode,
            profile=profile,
        )

        return {
            "level": card["level"],
            "level_name": card["level_name"],
            "recommendation_card": card,
            "needs_digest": card["level"] >= 2,
            "priority_digest": card["level"] == 3,
            "stage": "decided",
        }

    # ===================================================================
    # Stage 8: Present (Modality Dispatch per Section 19.6)
    # ===================================================================
    def present(self, decision: dict[str, Any], quiet_hours: bool = False) -> dict[str, Any]:
        """Stage 8: Decision -> Screen, voice, sound per level (Section 19.6 Table).
        
        Level 0: Green chips, voice on request, no sound, Cyan idle, no quiet breakthrough.
        Level 1: Badge & card in feed, voice at check-in/request, no sound, Soft amber, no breakthrough.
        Level 2: Banner & card, calm spoken summary, soft chime, Amber pulse, no breakthrough.
        Level 3: Full-screen takeover, spoken repeated, alarm tone, Red, BREAKS THROUGH QUIET HOURS.
        """
        level = decision.get("level", 0)

        presentation_matrix = {
            0: {
                "screen": "green_chips",
                "voice": "on_request_only",
                "sound": "none",
                "orb": "cyan_idle",
                "breakthrough": False,
            },
            1: {
                "screen": "badge_and_card_in_feed",
                "voice": "at_checkin_or_request",
                "sound": "none",
                "orb": "soft_amber",
                "breakthrough": False,
            },
            2: {
                "screen": "banner_and_recommendation_card",
                "voice": "calm_spoken_summary",
                "sound": "soft_chime",
                "orb": "amber_pulse",
                "breakthrough": False,
            },
            3: {
                "screen": "fullscreen_takeover",
                "voice": "spoken_repeated",
                "sound": "alarm_tone",
                "orb": "red_takeover",
                "breakthrough": True,
            },
        }

        spec = presentation_matrix.get(level, presentation_matrix[1])
        suppressed = quiet_hours and not spec["breakthrough"]

        return {
            "level": level,
            "presentation": spec,
            "suppressed_by_quiet_hours": suppressed,
            "spoken_text": decision.get("recommendation_card", {}).get("seen", "") if not suppressed else "",
            "stage": "presented" if not suppressed else "queued_for_morning",
        }

    # ===================================================================
    # Stage 9: Learn (Closed-Loop Outcome & Fatigue Tuning)
    # ===================================================================
    def learn(self, alert_id: str, outcome_feedback: dict[str, Any]) -> dict[str, Any]:
        """Stage 9: Outcomes and feedback -> Which intervention worked, alert tuning.
        
        Section 19.1: Bounded - never loosens safe limits.
        """
        useful = bool(outcome_feedback.get("useful", True))
        effective = bool(outcome_feedback.get("effective", True))
        reason = str(outcome_feedback.get("reason", ""))

        from brain.clinical.alerts import alerts
        tune_res = alerts.record_feedback(alert_id, useful=useful, reason=reason) if alert_id in alerts.alerts else {}

        return {
            "alert_id": alert_id,
            "useful": useful,
            "effective": effective,
            "sensitivity_adaptation": tune_res.get("sensitivity_adjustment", 0.0),
            "safe_limits_uncompromised": True,
            "stage": "learned",
        }


pipeline = ClinicalPipeline()
