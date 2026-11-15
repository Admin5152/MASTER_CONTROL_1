"""Onboarding Subsystem (Product Document Section 16.1 Screen 13).

Covers:
- Onboarding screen: Consent, baseline calibration, kit confirmation, voice enrolment.
- Special states: Resumable onboarding session.
"""
from __future__ import annotations

import copy
import json
import os
import threading
import time
from pathlib import Path

DATA = Path(__file__).resolve().parents[2] / "data"

STEPS = [
    {"id": "consent", "title": "Consent & Sensitive Health Data Agreement", "required": True},
    {"id": "kit_confirm", "title": "Onboard Medical Kit Confirmation", "required": True},
    {"id": "voice_enroll", "title": "Acoustic Speaker Voice Enrolment", "required": False},
    {"id": "baseline_calib", "title": "Initial Baseline Physiological Calibration", "required": True},
]


class OnboardingEngine:
    """Tracks initial onboarding progression and resumable state (Section 16.1)."""

    def __init__(self, persist: bool | None = None):
        self.persist = (os.getenv("SENTINEL_NO_PERSIST") != "1") if persist is None else persist
        self.lock = threading.Lock()
        self.status_map: dict[str, dict] = {}
        if self.persist:
            try:
                from brain.core.vault import read_json
                self.status_map = read_json(DATA / "onboarding_status.json")
            except (OSError, ValueError):
                self.status_map = {}

    def _save(self) -> None:
        if self.persist:
            from brain.core.vault import write_json
            write_json(DATA / "onboarding_status.json", self.status_map)

    def get_status(self, cid: str) -> dict:
        """Returns onboarding progress and current resumable step."""
        with self.lock:
            cur = self.status_map.get(cid, {})

        completed_steps = cur.get("completed_steps", [])
        next_step = next((s["id"] for s in STEPS if s["id"] not in completed_steps), None)
        all_done = next_step is None

        return {
            "crew_id": cid,
            "steps": STEPS,
            "completed_steps": completed_steps,
            "resumable_step": next_step or "completed",
            "completed": all_done,
            "special_state": "completed" if all_done else "resumable",
            "consent_signed": "consent" in completed_steps,
            "kit_confirmed": "kit_confirm" in completed_steps,
            "voice_enrolled": "voice_enroll" in completed_steps,
            "baseline_calibrated": "baseline_calib" in completed_steps,
        }

    def complete_step(self, cid: str, step_id: str, metadata: dict | None = None) -> dict:
        """Marks a step complete and advances resumable state."""
        with self.lock:
            cur = self.status_map.setdefault(cid, {"completed_steps": []})
            if step_id not in cur["completed_steps"]:
                cur["completed_steps"].append(step_id)
            cur.setdefault("step_metadata", {})[step_id] = metadata or {"completed_at": time.time()}
            self._save()
        return self.get_status(cid)


onboarding = OnboardingEngine()
