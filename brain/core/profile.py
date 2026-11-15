"""Personal health profile (Product Document section 14, schema 25.5; FR-38, FR-39, FR-42).

It grows over time, nothing is forced, and a completeness meter shows what is empty. What it changes:
- an allergy or a past reaction blocks the matching kit item, with the reason (FR-39, AC-17);
- a regular medicine adds "check the label and your surgeon" to kit suggestions;
- missing health background shows "profile incomplete, check the label" (Sentinel does not guess, AC-18);
- the wellbeing plan (early signs, what helps, who to talk to) and the buddy feed the support and urgent flows;
- surgeon-adjusted baselines allow alerts to use the corrected "normal".

Stays on the device (data/profiles.json). Health background never goes into a digest unless an include flag is set.
"""
from __future__ import annotations

import copy
import json
import os
import re
import threading
import time
from pathlib import Path

DATA = Path(__file__).resolve().parents[2] / "data"

DEFAULT = {
    "callsign": "",
    "language": "en",
    "units": "metric",
    "preferences": {
        "voice": "calm",
        "gloveMode": False,
        "reminderTimes": {"checkin": "08:00", "winddown": "21:30"},
    },
    "mission": {
        "environmentId": "",
        "mode": "routine",
        "dutySchedule": "",
        "sleepBlock": "22:00-06:00",
        "evaRoster": False,
        "mission_day": 0,
    },
    "health": {
        "allergies": [],
        "conditions": [],
        "regularMedicines": [],
        "pastKitReactions": [],
        "updatedBy": "astronaut",
        "sensitive": True,
        "includeInDigest": False,
    },
    "baselines": {},
    "wellbeingPlan": {
        "earlySigns": [],
        "whatHelps": [],
        "whoToTalkTo": "",
        "cameraMoodAnalysis": True,
        "homeMessages": False,
    },
    "sharing": {
        "buddy": "",
        "shareUrgentWithCommander": True,
        "shareTrendsWithSurgeon": "on_request",
        "crewPulse": False,
    },
    "emergency": {
        "buddy": "",
        "commander": "",
        "orderOfContact": ["buddy", "commander", "ground"],
    },
    "onboarding": {
        "stage": "day_0",
        "preloaded": False,
        "preloadedBy": "",
        "confirmed": False,
        "confirmedAt": 0.0,
    },
}

# What counts toward completeness: (path, label shown when empty).
# Health is "answered" even when the answer is "none" (recorded as ["none"]),
# because an unanswered question is not "no allergies" (AC-18).
FIELDS = [
    ("callsign", "Name or callsign"),
    ("preferences.reminderTimes", "Reminder times"),
    ("mission.dutySchedule", "Duty and sleep schedule"),
    ("health.allergies", "Allergies"),
    ("health.conditions", "Ongoing conditions"),
    ("health.regularMedicines", "Regular medicines"),
    ("health.pastKitReactions", "Past reactions to kit items"),
    ("wellbeingPlan.earlySigns", "My early signs"),
    ("wellbeingPlan.whatHelps", "What helps me"),
    ("wellbeingPlan.whoToTalkTo", "Who I would talk to"),
    ("sharing.buddy", "Crew buddy"),
]

QUESTION_PROMPTS = {
    "Name or callsign": "What name or callsign would you prefer Sentinel to use?",
    "Reminder times": "What times work best for your daily check-in and evening wind-down?",
    "Duty and sleep schedule": "What is your current duty and sleep schedule?",
    "Allergies": "Do you have any allergies to medications, foods, or materials?",
    "Ongoing conditions": "Do you have any ongoing health conditions Sentinel should know about?",
    "Regular medicines": "Are you taking any regular medications or supplements?",
    "Past reactions to kit items": "Have you had past reactions or sensitivities to any medical kit items?",
    "My early signs": "What are your personal early warning signs when stress or fatigue builds up?",
    "What helps me": "What tools or activities help you reset best (e.g. breathing, music, exercise)?",
    "Who I would talk to": "Who on the crew or ground would you prefer to talk to when you need support?",
    "Crew buddy": "Who is your designated crew buddy for urgent check-ins?",
}


def _get(d: dict, path: str):
    for k in path.split("."):
        d = d.get(k) if isinstance(d, dict) else None
    return d


def _merge(base: dict, patch: dict) -> dict:
    for k, v in (patch or {}).items():
        if k not in base:
            continue   # only known fields: the schema is the contract
        if k == "baselines" and isinstance(v, dict):
            base.setdefault("baselines", {})
            for bk, bv in v.items():
                if isinstance(bv, dict):
                    base["baselines"][str(bk)[:40]] = {
                        str(sk)[:40]: (float(sv) if isinstance(sv, (int, float)) else str(sv)[:80])
                        for sk, sv in bv.items()
                    }
                elif isinstance(bv, (int, float)):
                    base["baselines"][str(bk)[:40]] = float(bv)
                else:
                    base["baselines"][str(bk)[:40]] = str(bv).strip()[:80]
            continue
        if isinstance(base[k], dict) and isinstance(v, dict):
            _merge(base[k], v)
        elif isinstance(base[k], list):
            base[k] = [str(x).strip()[:80] for x in (v if isinstance(v, list) else [v]) if str(x).strip()][:20]
        elif isinstance(base[k], bool):
            base[k] = bool(v)
        else:
            base[k] = str(v).strip()[:120] if v is not None else ""

    # keep sharing.buddy and emergency.buddy in sync
    if "emergency" in base and isinstance(base["emergency"], dict):
        if base.get("sharing", {}).get("buddy") and not base["emergency"].get("buddy"):
            base["emergency"]["buddy"] = base["sharing"]["buddy"]
        elif base["emergency"].get("buddy") and not base.get("sharing", {}).get("buddy"):
            base.setdefault("sharing", {})["buddy"] = base["emergency"]["buddy"]

    return base


def is_in_sleep_block(sleep_block_str: str, current_hour: float) -> bool:
    """Check if current_hour (0.0 to 24.0) falls within sleep_block_str ('22:00-06:00'). Section 14.4."""
    try:
        parts = str(sleep_block_str).split("-")
        if len(parts) != 2:
            return False
        sh, sm = [float(x) for x in parts[0].strip().split(":")]
        eh, em = [float(x) for x in parts[1].strip().split(":")]
        start = sh + sm / 60.0
        end = eh + em / 60.0
        if start < end:
            return start <= current_hour < end
        else:  # wraps over midnight (e.g. 22:00 to 06:00)
            return current_hour >= start or current_hour < end
    except Exception:
        return False


def get_reminder_schedule(prof: dict) -> dict:
    """Extract configured reminder times and sleep boundaries (Section 14.4)."""
    pref = prof.get("preferences") or {}
    mission = prof.get("mission") or {}
    return {
        "checkin_time": (pref.get("reminderTimes") or {}).get("checkin", "08:00"),
        "winddown_time": (pref.get("reminderTimes") or {}).get("winddown", "21:30"),
        "sleep_block": mission.get("sleepBlock", "22:00-06:00"),
        "duty_schedule": mission.get("dutySchedule", ""),
    }


def calibration_info(prof: dict, mission_day: int | None = None, total_days: int = 7) -> dict:
    """Stage and calibration indicator (Section 14.3).

    1. Day 0: Onboarding (~3 min)
    2. Days 1 to 3: Health background, reminder times, wellbeing plan
    3. Days 3 to 7: Baselines calibrate ('Calibrating (n of N)')
    4. Day > 7: Established baselines ('Calibrated')
    """
    if mission_day is None:
        try:
            from brain.core.store import store
            clock = store.mission_clock()
            mission_day = int(clock.get("mission_day", 0))
        except Exception:
            mission_day = int(prof.get("mission", {}).get("mission_day", 0))

    mission_day = max(0, int(mission_day))
    if mission_day <= 0:
        stage = "day_0"
        stage_label = "Day 0 Onboarding"
        status_text = "Onboarding (Day 0)"
        calibrating = False
        calibrated = False
    elif 1 <= mission_day < 3:
        stage = "days_1_3"
        stage_label = "Days 1 to 3 (Health Background & Wellbeing)"
        status_text = f"Early mission (Day {mission_day})"
        calibrating = False
        calibrated = False
    elif 3 <= mission_day <= total_days:
        stage = "calibrating"
        stage_label = "Days 3 to 7 (Baselines Calibrating)"
        status_text = f"Calibrating ({mission_day} of {total_days})"
        calibrating = True
        calibrated = False
    else:
        stage = "established"
        stage_label = "Established Baselines"
        status_text = "Calibrated"
        calibrating = False
        calibrated = True

    return {
        "stage": stage,
        "stage_label": stage_label,
        "mission_day": mission_day,
        "total_calibration_days": total_days,
        "status_text": status_text,
        "calibrating": calibrating,
        "calibrated": calibrated,
    }


def completeness(prof: dict, mission_day: int | None = None) -> dict:
    """Completeness score (0.0 to 1.0), missing items, and the next check-in question (Section 14.1 & 14.3)."""
    missing = [label for path, label in FIELDS if not _get(prof, path)]
    done = len(FIELDS) - len(missing)

    # Next question selected based on priority
    cal = calibration_info(prof, mission_day)
    stage = cal["stage"]
    if stage == "day_0":
        # prioritize callsign and buddy in Day 0
        preferred = ["Name or callsign", "Crew buddy"]
    elif stage == "days_1_3":
        # prioritize health background and wellbeing
        preferred = ["Allergies", "Regular medicines", "Ongoing conditions", "What helps me", "My early signs"]
    else:
        preferred = []

    next_q = None
    for p in preferred:
        if p in missing:
            next_q = p
            break
    if not next_q and missing:
        next_q = missing[0]

    return {
        "completeness": round(done / len(FIELDS), 2),
        "missing": missing,
        "next_question": next_q,
        "next_question_prompt": QUESTION_PROMPTS.get(next_q) if next_q else None,
        "completed_count": done,
        "total_count": len(FIELDS),
    }


def _words(s: str) -> set[str]:
    return set(re.findall(r"[a-z]{4,}", s.lower()))


def kit_filter(item: dict | None, prof: dict) -> dict:
    """Section 14.4 & AC-17, AC-18:
    - An allergy or past reaction blocks the matching kit item, with the reason (AC-17).
    - A regular medicine adds a 'check the label and your surgeon' note.
    - Missing health background shows 'profile incomplete, check the label' (AC-18).
    Returns {"blocked", "reason", "note"}.
    """
    if not item:
        return {"blocked": False, "reason": "", "note": ""}
    h = prof.get("health") or {}
    item_class = str(item.get("class", "") or "")
    item_tags = " ".join(str(t) for t in (item.get("tags") or []))
    name = f"{item.get('id', '')} {item.get('name', '')} {item_class} {item_tags}"
    nw = _words(name)
    for a in (h.get("allergies") or []) + (h.get("pastKitReactions") or []):
        if a.lower() != "none" and (_words(a) & nw or a.lower() in name.lower()):
            return {
                "blocked": True,
                "reason": f"Blocked: your profile lists {a} (allergy or past reaction matching class/tags/item). Ask the crew medical officer for an alternative.",
                "note": "",
            }
    meds = [m for m in (h.get("regularMedicines") or []) if m.lower() != "none"]
    if meds:
        return {
            "blocked": False,
            "reason": "",
            "note": f"You take {', '.join(meds)}: check the label and your surgeon before using this.",
        }
    if not h.get("allergies") or not h.get("regularMedicines"):
        return {
            "blocked": False,
            "reason": "",
            "note": "Profile incomplete, check the label for allergies and interactions.",
        }
    return {"blocked": False, "reason": "", "note": ""}


def filter_kit_items(kit_items: list[dict], prof: dict) -> dict:
    """Section 19.5 filterKit(kitItems, profile):
    Returns allowed items, blocked items with reasons, and notes.
    Suggests only items that exist in the active kit.
    """
    allowed = []
    blocked = []
    notes = []
    for item in (kit_items or []):
        kf = kit_filter(item, prof)
        if kf["blocked"]:
            blocked.append({"item": item, "reason": kf["reason"]})
        else:
            allowed.append(item)
            if kf.get("note"):
                notes.append({"item_id": item.get("id"), "note": kf["note"]})
    return {"allowed": allowed, "blocked": blocked, "notes": notes}


filterKit = filter_kit_items


class Profiles:
    def __init__(self, persist: bool | None = None):
        self.persist = (os.getenv("SENTINEL_NO_PERSIST") != "1") if persist is None else persist
        self.lock = threading.Lock()
        self.p: dict[str, dict] = {}
        if self.persist:
            try:
                from brain.core.vault import read_json
                self.p = read_json(DATA / "profiles.json")
            except (OSError, ValueError):
                self.p = {}

    def _save(self) -> None:
        if self.persist:
            from brain.core.vault import write_json
            write_json(DATA / "profiles.json", self.p)   # allergies and medicines: encrypted at rest

    def _seed(self, cid: str) -> dict:
        """The demo profile preloaded for a roster crew member (shared/mock_profiles.json): used until the person
        saves or deletes their own. Off in the test suite (SENTINEL_NO_SEED_PROFILES=1)."""
        if os.getenv("SENTINEL_NO_SEED_PROFILES") == "1" or (self.p.get(cid) or {}).get("_cleared"):
            return {}
        if not hasattr(self, "_seeds"):
            try:
                self._seeds = json.loads((Path(__file__).resolve().parents[2] / "shared" / "mock_profiles.json").read_text(encoding="utf-8"))
            except (OSError, ValueError):
                self._seeds = {}
        return copy.deepcopy(self._seeds.get(cid) or {})

    def get(self, cid: str, mission_day: int | None = None) -> dict:
        with self.lock:
            prof = _merge(_merge(copy.deepcopy(DEFAULT), self._seed(cid)), {k: v for k, v in self.p.get(cid, {}).items() if k != "_cleared"})
        prof["crewId"] = cid
        prof.update(completeness(prof, mission_day=mission_day))
        prof["calibration"] = calibration_info(prof, mission_day=mission_day)
        return prof

    def update(self, cid: str, patch: dict) -> dict:
        with self.lock:
            cur = _merge(_merge(copy.deepcopy(DEFAULT), self._seed(cid)), {k: v for k, v in self.p.get(cid, {}).items() if k != "_cleared"})
            self.p[cid] = _merge(cur, patch)
            self._save()
        return self.get(cid)

    def preload(self, cid: str, data: dict, preloaded_by: str = "flight_surgeon") -> dict:
        """Section 14.1: Preload by flight surgeon or mission planner."""
        with self.lock:
            cur = _merge(copy.deepcopy(DEFAULT), self.p.get(cid, {}))
            merged = _merge(cur, data)
            merged.setdefault("onboarding", {})
            merged["onboarding"]["preloaded"] = True
            merged["onboarding"]["preloadedBy"] = preloaded_by
            merged["onboarding"]["confirmed"] = False
            self.p[cid] = merged
            self._save()
        return self.get(cid)

    def confirm(self, cid: str, confirmed_by: str = "astronaut") -> dict:
        """Section 14.1: Astronaut confirms and accepts preloaded profile."""
        with self.lock:
            cur = _merge(copy.deepcopy(DEFAULT), self.p.get(cid, {}))
            cur.setdefault("onboarding", {})
            cur["onboarding"]["confirmed"] = True
            cur["onboarding"]["confirmedAt"] = time.time()
            self.p[cid] = cur
            self._save()
        return self.get(cid)

    def adjust_baseline(self, cid: str, indicator: str, value: float, adjusted_by: str = "flight_surgeon", reason: str = "", store=None) -> dict:
        """Section 14.4: Flight surgeon adjusts personal baseline; alerts use corrected normal."""
        with self.lock:
            cur = _merge(copy.deepcopy(DEFAULT), self.p.get(cid, {}))
            baselines = cur.setdefault("baselines", {})
            baselines[str(indicator)] = {
                "value": float(value),
                "adjustedBy": adjusted_by,
                "reason": reason,
                "adjustedAt": time.time(),
            }
            self.p[cid] = cur
            self._save()

        # Sync to store so runtime anomaly and drift detectors immediately use the corrected normal
        try:
            if store is None:
                from brain.core.store import store as s_inst
                store = s_inst
            with store.lock:
                if cid in store.states:
                    s = store.states[cid]
                    if indicator == "reaction_ms":
                        s.setdefault("cognitive", {})["baseline_ms"] = float(value)
                    elif indicator in ("heart_rate", "talk_time", "pitch"):
                        s.setdefault("baseline", {})[indicator] = float(value)
                    store._recompute(cid)
        except Exception:
            pass

        return self.get(cid)

    def export(self, cid: str, include_sensitive: bool = True) -> dict:
        """Section 14.4: View and export profile anytime; strips sensitive items if include_sensitive=False."""
        prof = copy.deepcopy(self.get(cid))
        if not include_sensitive:
            prof["health"] = {
                "allergies": ["[REDACTED]"] if prof["health"].get("allergies") else [],
                "conditions": ["[REDACTED]"] if prof["health"].get("conditions") else [],
                "regularMedicines": ["[REDACTED]"] if prof["health"].get("regularMedicines") else [],
                "pastKitReactions": ["[REDACTED]"] if prof["health"].get("pastKitReactions") else [],
                "sensitive": True,
                "includeInDigest": False,
            }
        return {
            "format": "sentinel_profile_export_v1",
            "crew_id": cid,
            "export_timestamp": time.time(),
            "profile": prof,
        }

    def delete(self, cid: str) -> dict:
        """Section 14.4: Astronaut can delete profile at any time."""
        with self.lock:
            self.p[cid] = {"_cleared": True}   # deleted means empty, not "back to the preloaded demo values"
            self._save()
        return self.get(cid)


profiles = Profiles()
