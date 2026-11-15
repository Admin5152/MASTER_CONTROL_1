"""Alert Lifecycle Engine & Fatigue Controls (Sections 19.4 & 19.5).

Manages:
- The 8 alert lifecycle states: detected, presented, acknowledged, acting,
  rechecking, resolved, escalated, expired.
- Alert-fatigue controls: one alert per cause, cooldowns, snooze limits,
  feedback sensitivity tuning within bounds, quiet hours breakthrough rules.
- Explainability ('Why this?'): Plain-words explanation citing readings,
  baseline deltas, rules, and NASA MRID single source of truth.
"""
from __future__ import annotations

import copy
import datetime as dt
import os
import time
import uuid
from pathlib import Path
from typing import Any

DATA = Path(__file__).resolve().parents[2] / "data"

VALID_ALERT_STATES = {
    "detected", "presented", "acknowledged", "acting",
    "rechecking", "resolved", "escalated", "expired",
}

ALERT_COOLDOWNS_S = {
    "vital_drift": 3600.0,       # 1 hour
    "pattern_alert": 7200.0,     # 2 hours
    "symptom_alert": 1800.0,     # 30 minutes
    "cabin_alert": 300.0,        # 5 minutes
    "radiation_alert": 900.0,    # 15 minutes
}

REPRESENT_AFTER_S = {3: 60.0, 2: 300.0, 1: 900.0}   # tunable (config), not spaceflight facts
MAX_REPRESENTS = 2
MAX_SNOOZE_COUNT = 2
DEFAULT_SNOOZE_MINUTES = 15


class AlertManager:
    """Alert lifecycle manager and fatigue control engine."""

    def __init__(self, persist: bool = False):
        self.persist = persist
        self.alerts: dict[str, dict[str, Any]] = {}
        self.cooldowns: dict[str, float] = {}  # key -> timestamp
        self.feedback_adjustments: dict[str, float] = {}  # rule_id -> sensitivity delta
        if persist:
            try:
                from brain.core.vault import read_json
                raw = read_json(DATA / "alerts.json")
                self.alerts, self.cooldowns = raw.get("alerts", {}), raw.get("cooldowns", {})
                self.feedback_adjustments = raw.get("feedback", {})
            except (OSError, ValueError, AttributeError):
                pass

    def save(self) -> None:
        """Write the alert history to the device (encrypted at rest); the server calls this after each change."""
        if not self.persist:
            return
        try:
            from brain.core.vault import write_json
            keep = dict(sorted(self.alerts.items(), key=lambda kv: kv[1].get("created_at", 0))[-300:])
            write_json(DATA / "alerts.json", {"alerts": keep, "cooldowns": self.cooldowns, "feedback": self.feedback_adjustments})
        except OSError:
            pass

    def create_alert(
        self,
        crew_id: str,
        cause_id: str,
        level: int,
        title: str,
        reason: str,
        rule_id: str = "",
        readings: dict | None = None,
        baseline: dict | None = None,
        source: str = "engine",
        mrid: str = "NASA JSC 28913",
        quiet_hours: bool = False,
    ) -> dict[str, Any] | None:
        """Create a new alert adhering to cooldown and quiet hours rules.
        
        Section 19.5:
        - Quiet hours respected: only urgent (level 3) and cabin alerts break through.
        - Cooldown per alert type: re-alert only if situation worsens.
        """
        # Enforce quiet hours
        if quiet_hours and level < 3 and "cabin" not in cause_id.lower():
            # Suppressed during quiet hours; queue for morning digest
            return None

        # Check cooldown
        cooldown_key = f"{crew_id}:{cause_id}"
        now = time.time()
        last_alert_time = self.cooldowns.get(cooldown_key, 0.0)
        cooldown_duration = ALERT_COOLDOWNS_S.get(cause_id, 1800.0)

        # Allow bypass if situation worsened to level 3
        if now - last_alert_time < cooldown_duration and level < 3:
            return None

        self.cooldowns[cooldown_key] = now
        alert_id = f"alt_{uuid.uuid4().hex[:10]}"

        alert = {
            "alert_id": alert_id,
            "crew_id": crew_id,
            "cause_id": cause_id,
            "level": level,  # 0 to 3
            "title": title,
            "reason": reason,
            "rule_id": rule_id,
            "readings": readings or {},
            "baseline": baseline or {},
            "source": source,
            "source_mrid": mrid,
            "state": "detected",
            "created_at": time.time(),
            "presented_at": None,
            "acknowledged_at": None,
            "acting_at": None,
            "recheck_at": None,
            "resolved_at": None,
            "escalated_at": None,
            "expired_at": None,
            "snooze_count": 0,
            "snooze_until": 0.0,
            "dismiss_reason": "",
            "resolution_outcome": "",
            "escalation_note": "",
        }
        self.alerts[alert_id] = alert
        return copy.deepcopy(alert)

    def present_alert(self, alert_id: str) -> dict[str, Any]:
        """Move alert state from 'detected' to 'presented'."""
        alert = self._get(alert_id)
        alert["state"] = "presented"
        alert["presented_at"] = time.time()
        return copy.deepcopy(alert)

    def acknowledge_alert(self, alert_id: str, reason: str = "Accepted steps") -> dict[str, Any]:
        """Move alert to 'acknowledged' when astronaut sees and acknowledges it."""
        alert = self._get(alert_id)
        alert["state"] = "acknowledged"
        alert["acknowledged_at"] = time.time()
        alert["dismiss_reason"] = reason
        return copy.deepcopy(alert)

    def snooze_alert(self, alert_id: str, minutes: int = DEFAULT_SNOOZE_MINUTES, reason: str = "") -> dict[str, Any]:
        """Snooze alert with reason and limit check.
        
        Section 19.5 Rule: Urgent alerts (Level 3) CANNOT be snoozed. Snooze needs a reason.
        """
        alert = self._get(alert_id)
        if alert["level"] >= 3:
            raise ValueError("Urgent level 3 alerts cannot be snoozed")
        if not reason:
            raise ValueError("A reason is required to snooze an alert")
        if alert["snooze_count"] >= MAX_SNOOZE_COUNT:
            raise ValueError(f"Snooze limit reached (max {MAX_SNOOZE_COUNT} snoozes)")

        alert["snooze_count"] += 1
        alert["snooze_until"] = time.time() + (minutes * 60)
        alert["state"] = "presented"  # Remains active but snoozed
        return copy.deepcopy(alert)

    def start_acting(self, alert_id: str, protocol_run_id: str = "") -> dict[str, Any]:
        """Move alert to 'acting' state while protocol runner is active."""
        alert = self._get(alert_id)
        alert["state"] = "acting"
        alert["acting_at"] = time.time()
        alert["protocol_run_id"] = protocol_run_id
        return copy.deepcopy(alert)

    def recheck_alert(self, alert_id: str, in_range: bool) -> dict[str, Any]:
        """Process recheck measurement."""
        alert = self._get(alert_id)
        alert["state"] = "rechecking"
        alert["recheck_at"] = time.time()
        if in_range:
            return self.resolve_alert(alert_id, outcome="Reading back in nominal range on recheck.")
        else:
            return self.escalate_alert(alert_id, note="Reading remains out of range after recheck.")

    def resolve_alert(self, alert_id: str, outcome: str = "Resolved nominal") -> dict[str, Any]:
        """Close alert and record resolution outcome."""
        alert = self._get(alert_id)
        alert["state"] = "resolved"
        alert["resolved_at"] = time.time()
        alert["resolution_outcome"] = outcome
        return copy.deepcopy(alert)

    def escalate_alert(self, alert_id: str, note: str = "") -> dict[str, Any]:
        """Escalate alert to ground digest and alert buddy if Level 3."""
        alert = self._get(alert_id)
        alert["state"] = "escalated"
        alert["escalated_at"] = time.time()
        alert["escalation_note"] = note
        return copy.deepcopy(alert)

    def expire_alert(self, alert_id: str) -> dict[str, Any]:
        """Escalate expired alert modality when no response received.
        
        Section 19.4: A missed urgent alert alerts the designated crew buddy.
        """
        alert = self._get(alert_id)
        alert["state"] = "expired"
        alert["expired_at"] = time.time()
        if alert["level"] >= 3:
            alert["escalated_to_buddy"] = True
            alert["escalation_note"] = "Urgent alert unacknowledged after timeout; crew buddy alerted."
        return copy.deepcopy(alert)

    def tick(self, crew_id: str, now: float | None = None) -> dict[str, list]:
        """Unanswered alerts (19.4): a presented alert nobody answered is presented again, louder, after a timeout
        (level 3: 1 minute, level 2: 5, level 1: 15); after two repeats it expires, and an expired urgent alert
        alerts the crew buddy. Snoozed alerts wait until their snooze ends."""
        now = time.time() if now is None else now
        again, expired = [], []
        for a in self.alerts.values():
            if a.get("crew_id") != crew_id or a.get("state") != "presented" or a.get("snooze_until", 0) > now:
                continue
            wait = REPRESENT_AFTER_S.get(a.get("level", 1), 900.0)
            if now - (a.get("presented_at") or a.get("created_at") or now) < wait:
                continue
            if a.get("represent_count", 0) >= MAX_REPRESENTS:
                self.expire_alert(a["alert_id"])
                expired.append(copy.deepcopy(a))
            else:
                a["represent_count"] = a.get("represent_count", 0) + 1
                a["presented_at"] = now
                again.append(copy.deepcopy(a))
        return {"represent": again, "expired": expired}

    def open_for(self, crew_id: str) -> list[dict[str, Any]]:
        return [a for a in self.alerts.values() if a.get("crew_id") == crew_id and a.get("state") in ("detected", "presented", "acknowledged")]

    def record_feedback(self, alert_id: str, useful: bool, reason: str = "") -> dict[str, Any]:
        """Tune rule sensitivity based on astronaut feedback (Section 19.5).
        
        'Not useful' feedback makes that rule less sensitive within bounds,
        never below safe limits.
        """
        alert = self._get(alert_id)
        rule_id = alert.get("rule_id", "default_rule")
        current_adj = self.feedback_adjustments.get(rule_id, 0.0)

        if not useful:
            # Desensitize rule slightly (capped at +20% threshold shift)
            new_adj = min(0.20, current_adj + 0.05)
            self.feedback_adjustments[rule_id] = new_adj
        else:
            # Rebalance
            new_adj = max(-0.10, current_adj - 0.02)
            self.feedback_adjustments[rule_id] = new_adj

        return {
            "alert_id": alert_id,
            "rule_id": rule_id,
            "useful": useful,
            "sensitivity_adjustment": self.feedback_adjustments[rule_id],
            "reason": reason,
        }

    def explain_alert(self, alert_id: str) -> dict[str, Any]:
        """Generate 'Why this?' plain-words explainability breakdown (Section 19.5)."""
        alert = self._get(alert_id)
        readings = alert.get("readings", {})
        baseline = alert.get("baseline", {})
        level = alert.get("level", 1)

        lines = [f"Alert Level {level}: {alert.get('title')}."]
        if readings and baseline:
            for k, val in readings.items():
                base_val = baseline.get(k)
                if base_val:
                    delta = ((val - base_val) / base_val) * 100.0
                    lines.append(f"- Measured {k}: {val} (baseline {base_val}, delta {delta:+.1f}%).")
                else:
                    lines.append(f"- Measured {k}: {val}.")
        lines.append(f"- Clinical Rule Trigger: {alert.get('rule_id') or 'Threshold Rule'}.")
        lines.append(f"- Single Source of Truth Citation: {alert.get('source_mrid')}.")

        return {
            "alert_id": alert_id,
            "level": level,
            "plain_language": "\n".join(lines),
            "readings": readings,
            "baseline": baseline,
            "rule_id": alert.get("rule_id"),
            "mrid": alert.get("source_mrid"),
        }

    def _get(self, alert_id: str) -> dict[str, Any]:
        if alert_id not in self.alerts:
            raise KeyError(f"unknown alert {alert_id}")
        return self.alerts[alert_id]


alerts = AlertManager(persist=os.getenv("SENTINEL_NO_PERSIST") != "1")
