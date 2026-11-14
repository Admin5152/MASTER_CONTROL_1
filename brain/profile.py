"""Personal health profile (Product Document section 14, schema 25.5; FR-38, FR-39, FR-42).

It grows over time, nothing is forced, and a completeness meter shows what is empty. What it changes:
- an allergy or a past reaction blocks the matching kit item, with the reason (FR-39);
- a regular medicine adds "check the label and your surgeon" to kit suggestions;
- missing health background shows "profile incomplete, check the label" (Sentinel does not guess);
- the wellbeing plan (early signs, what helps, who to talk to) and the buddy feed the support and urgent flows.

Stays on the device (data/profiles.json). Health background never goes into a digest unless an include flag is set.
"""
from __future__ import annotations

import copy
import json
import os
import re
import threading
from pathlib import Path

DATA = Path(__file__).resolve().parent.parent / "data"

DEFAULT = {
    "callsign": "", "language": "en", "units": "metric",
    "preferences": {"voice": "calm", "gloveMode": False, "reminderTimes": {"checkin": "08:00", "winddown": "21:30"}},
    "mission": {"environmentId": "", "mode": "routine", "dutySchedule": "", "evaRoster": False},
    "health": {"allergies": [], "conditions": [], "regularMedicines": [], "pastKitReactions": [], "updatedBy": "astronaut", "sensitive": True,
               "includeInDigest": False},
    "wellbeingPlan": {"earlySigns": [], "whatHelps": [], "whoToTalkTo": "", "cameraMoodAnalysis": True, "homeMessages": False},
    "sharing": {"buddy": "", "shareUrgentWithCommander": True, "shareTrendsWithSurgeon": "on_request", "crewPulse": False},
}

# what counts toward completeness: (path, label shown when empty); health is "answered" even when the answer is
# "none" (an explicit empty answer is recorded as ["none"]), because an unanswered allergy question is not "no allergies"
FIELDS = [
    ("callsign", "Name or callsign"), ("preferences.reminderTimes", "Reminder times"),
    ("mission.dutySchedule", "Duty and sleep schedule"),
    ("health.allergies", "Allergies"), ("health.conditions", "Ongoing conditions"), ("health.regularMedicines", "Regular medicines"),
    ("health.pastKitReactions", "Past reactions to kit items"),
    ("wellbeingPlan.earlySigns", "My early signs"), ("wellbeingPlan.whatHelps", "What helps me"),
    ("wellbeingPlan.whoToTalkTo", "Who I would talk to"), ("sharing.buddy", "Crew buddy"),
]


def _get(d: dict, path: str):
    for k in path.split("."):
        d = d.get(k) if isinstance(d, dict) else None
    return d


def _merge(base: dict, patch: dict) -> dict:
    for k, v in (patch or {}).items():
        if k not in base:
            continue   # only known fields: the schema is the contract
        if isinstance(base[k], dict) and isinstance(v, dict):
            _merge(base[k], v)
        elif isinstance(base[k], list):
            base[k] = [str(x).strip()[:80] for x in (v if isinstance(v, list) else [v]) if str(x).strip()][:20]
        elif isinstance(base[k], bool):
            base[k] = bool(v)
        else:
            base[k] = str(v).strip()[:120] if v is not None else ""
    return base


class Profiles:
    def __init__(self, persist: bool | None = None):
        self.persist = (os.getenv("SENTINEL_NO_PERSIST") != "1") if persist is None else persist
        self.lock = threading.Lock()
        self.p: dict[str, dict] = {}
        if self.persist:
            try:
                self.p = json.loads((DATA / "profiles.json").read_text(encoding="utf-8"))
            except (OSError, ValueError):
                self.p = {}

    def _save(self) -> None:
        if self.persist:
            DATA.mkdir(exist_ok=True)
            tmp = DATA / "profiles.json.tmp"
            tmp.write_text(json.dumps(self.p, indent=1), encoding="utf-8")
            tmp.replace(DATA / "profiles.json")

    def get(self, cid: str) -> dict:
        with self.lock:
            prof = _merge(copy.deepcopy(DEFAULT), self.p.get(cid, {}))
        prof["crewId"] = cid
        prof.update(completeness(prof))
        return prof

    def update(self, cid: str, patch: dict) -> dict:
        with self.lock:
            cur = _merge(copy.deepcopy(DEFAULT), self.p.get(cid, {}))
            self.p[cid] = _merge(cur, patch)
            self._save()
        return self.get(cid)

    def delete(self, cid: str) -> dict:
        with self.lock:
            self.p.pop(cid, None)
            self._save()
        return self.get(cid)


def completeness(prof: dict) -> dict:
    missing = [label for path, label in FIELDS if not _get(prof, path)]
    done = len(FIELDS) - len(missing)
    return {"completeness": round(done / len(FIELDS), 2), "missing": missing, "next_question": missing[0] if missing else None}


def _words(s: str) -> set[str]:
    return set(re.findall(r"[a-z]{4,}", s.lower()))


def kit_filter(item: dict | None, prof: dict) -> dict:
    """Section 14.4: block an item the person is allergic to or reacted to; note a possible clash with a regular
    medicine; say so when the health background is empty. Returns {"blocked", "reason", "note"}."""
    if not item:
        return {"blocked": False, "reason": "", "note": ""}
    h = prof.get("health") or {}
    name = f"{item.get('id', '')} {item.get('name', '')}"
    nw = _words(name)
    for a in (h.get("allergies") or []) + (h.get("pastKitReactions") or []):
        if a.lower() != "none" and (_words(a) & nw or a.lower() in name.lower()):
            return {"blocked": True, "reason": f"Blocked: your profile lists {a} (allergy or past reaction). Ask the crew medical officer for an alternative.", "note": ""}
    meds = [m for m in (h.get("regularMedicines") or []) if m.lower() != "none"]
    if meds:
        return {"blocked": False, "reason": "", "note": f"You take {', '.join(meds)}: check the label and your surgeon before using this."}
    if not h.get("allergies") or not h.get("regularMedicines"):
        return {"blocked": False, "reason": "", "note": "Profile incomplete: check the label for allergies and interactions."}
    return {"blocked": False, "reason": "", "note": ""}


profiles = Profiles()
