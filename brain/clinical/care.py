"""Clinical Care Subsystem: Triage, Protocol Runner, and Care Log (Product Document Section 16.1).

Covers:
- Care: triage (work out urgency, zone picker, red flag jumps to urgent card)
- Care: protocol runner (step by step, tick boxes, timers, kit items with location, pause/complete/escalate)
- Care: log (history of symptoms, protocols, kit used, outcomes; informative empty state)
"""
from __future__ import annotations

import copy
import json
import os
import threading
import time
import uuid
from pathlib import Path

DATA = Path(__file__).resolve().parents[2] / "data"
SHARED = Path(__file__).resolve().parents[2] / "shared"

RED_FLAGS = [
    "sudden_severe_chest_pain",
    "shortness_of_breath_at_rest",
    "loss_of_consciousness",
    "sudden_vision_loss",
    "uncontrolled_bleeding",
    "severe_neurological_deficit",
]

TRIAGE_QUESTIONS = {
    "head": [
        {"id": "sudden_severe", "text": "Did the pain start suddenly with worst-ever intensity?", "red_flag": True},
        {"id": "vision_changes", "text": "Are you experiencing double vision or blind spots?", "red_flag": True},
        {"id": "nausea_sensitivity", "text": "Is there nausea or sensitivity to cabin light?", "red_flag": False},
        {"id": "throbbing", "text": "Is the headache a dull ache or throbbing?", "red_flag": False},
    ],
    "chest": [
        {"id": "sudden_severe_chest_pain", "text": "Is there crushing chest pressure or pain radiating to arm/jaw?", "red_flag": True},
        {"id": "shortness_of_breath_at_rest", "text": "Are you short of breath while resting?", "red_flag": True},
        {"id": "palpitations", "text": "Do you feel irregular fluttering or racing heartbeat?", "red_flag": False},
    ],
    "gut": [
        {"id": "severe_rebound_pain", "text": "Is there sharp, localized lower abdominal tenderness on touch?", "red_flag": True},
        {"id": "blood_in_stool", "text": "Is there blood in stool or vomit?", "red_flag": True},
        {"id": "motion_nausea", "text": "Is nausea associated with head movements or visual shifts (space adaptation)?", "red_flag": False},
        {"id": "cramping", "text": "Is there mild to moderate cramping or loose stool?", "red_flag": False},
    ],
    "lungs": [
        {"id": "acute_stridor", "text": "Is there choking, stridor, or severe gasping?", "red_flag": True},
        {"id": "inhalation_pain", "text": "Does it hurt sharply when you take a deep breath?", "red_flag": False},
        {"id": "congestion", "text": "Is there nasal congestion, post-nasal drip, or mild cough?", "red_flag": False},
    ],
    "eyes": [
        {"id": "sudden_vision_loss", "text": "Has vision dimmed or gone completely dark in either eye?", "red_flag": True},
        {"id": "foreign_body", "text": "Was there known dust or debris exposure in the eye?", "red_flag": False},
        {"id": "dry_irritation", "text": "Are eyes stinging, dry, or irritated from cabin airflow?", "red_flag": False},
    ],
    "bones": [
        {"id": "deformity_bone", "text": "Is there visible bone deformity, inability to bear weight, or numbness?", "red_flag": True},
        {"id": "muscle_strain", "text": "Is it generalized soreness following exercise or EVA work?", "red_flag": False},
    ],
    "skin": [
        {"id": "rapid_rash_breathing", "text": "Is the rash spreading rapidly with facial swelling or throat tightness?", "red_flag": True},
        {"id": "dry_itch", "text": "Is there localized dry skin, irritation, or contact itching?", "red_flag": False},
    ],
    "whole_body": [
        {"id": "high_fever_chills", "text": "Is there high fever with confusion or shaking chills?", "red_flag": True},
        {"id": "space_adaptation", "text": "General disorientation, heavy head, or stomach awareness in microgravity?", "red_flag": False},
    ],
}

DEFAULT_PROTOCOLS = {
    "headache_tx": {
        "id": "headache_tx",
        "title": "Headache & Cephalea Relief Protocol",
        "zone": "head",
        "kit_item": "acetaminophen",
        "steps": [
            {"step_num": 1, "text": "Confirm no red-flag neurological signs (steady speech, normal vision).", "required": True},
            {"step_num": 2, "text": "Retrieve Acetaminophen from Convenience Medication Pack (location: Locker MED-1).", "required": True},
            {"step_num": 3, "text": "Verify dosage on label and check for allergy contraindications.", "required": True},
            {"step_num": 4, "text": "Take with at least 250 ml of potable water to ensure adequate hydration.", "required": True},
            {"step_num": 5, "text": "Dim cabin lighting in personal quarters and rest eyes for 20 minutes.", "required": False, "timer_s": 1200},
            {"step_num": 6, "text": "Recheck symptom intensity. If persisting or worsening, escalate to CMO/surgeon.", "required": True},
        ],
    },
    "space_motion_sickness_tx": {
        "id": "space_motion_sickness_tx",
        "title": "Space Motion Sickness (SMS) Adaptation Protocol",
        "zone": "gut",
        "kit_item": "promethazine",
        "steps": [
            {"step_num": 1, "text": "Anchor body with foot restraints; minimize rapid head rotations in pitch and yaw.", "required": True},
            {"step_num": 2, "text": "Locate Promethazine in Oral Medication Pack (location: Locker MED-2).", "required": True},
            {"step_num": 3, "text": "Verify profile safety filter and check surgeon authorization notes.", "required": True},
            {"step_num": 4, "text": "Take medication with small sips of water. Avoid full stomach distension.", "required": True},
            {"step_num": 5, "text": "Fixate gaze on a stable visual reference point or window Earth horizon.", "required": False, "timer_s": 900},
            {"step_num": 6, "text": "Log adaptation progress and note any excessive sedation.", "required": True},
        ],
    },
    "eye_irritation_tx": {
        "id": "eye_irritation_tx",
        "title": "Foreign Particle & Dry Eye Irrigation Protocol",
        "zone": "eyes",
        "kit_item": "artificial_tears",
        "steps": [
            {"step_num": 1, "text": "Do not rub the eye. Restrict microgravity debris dispersion near face.", "required": True},
            {"step_num": 2, "text": "Retrieve Artificial Tears / Saline Eye Wash from Topical & Eye Pack (MED-3).", "required": True},
            {"step_num": 3, "text": "Tilt head over absorbent wipe and gently instill drops into the conjunctival sac.", "required": True},
            {"step_num": 4, "text": "Blink gently and allow fluid to absorb into wipe. Avoid touching dropper tip.", "required": True},
            {"step_num": 5, "text": "Recheck visual acuity with onboard Snellen card. If vision altered, notify surgeon.", "required": True},
        ],
    },
    "stomach_upset_tx": {
        "id": "stomach_upset_tx",
        "title": "Stomach Upset: Supportive Care",
        "zone": "gut",
        "kit_item": None,
        # General supportive care, no medicine chosen by Sentinel. A demo default: not yet reviewed by a clinician.
        "demo_default": True,
        "source": {"title": "Demo default: general supportive care, clinician to confirm"},
        "red_flags": ["Sharp pain in one spot, or pain that keeps getting worse", "Blood in stool or vomit", "Fever with the pain", "Cannot keep fluids down"],
        "steps": [
            {"step_num": 1, "text": "Stop what you are doing and rest, secured, with nothing tight around your waist.", "required": True, "timer_s": 600},
            {"step_num": 2, "text": "Sip water slowly: a few mouthfuls every few minutes. No solid food for now.", "required": True},
            {"step_num": 3, "text": "Note what you last ate and drank, and when, in the health log.", "required": False},
            {"step_num": 4, "text": "If you feel sick or have loose stools, find the matching item in the medical kit and follow its label. Check your allergies first.", "required": False},
            {"step_num": 5, "text": "Rest for another 20 minutes, then eat something plain if you feel able.", "required": True, "timer_s": 1200},
        ],
    },
    # ---- every body area gets steps (hands, arms, legs, feet, back, neck, chest, airway, skin, whole body).
    # These are general first-aid and supportive care, with no medicine chosen by Sentinel. They are demo defaults:
    # not from a NASA source and not yet reviewed by a clinician, and the screen says so.
    "muscle_joint_tx": {
        "id": "muscle_joint_tx", "title": "Muscle, Joint or Limb Pain: Supportive Care", "zone": "bones", "kit_item": None,
        "demo_default": True,
        "source": {"title": "Demo default: general first-aid and supportive care, clinician to confirm"},
        "red_flags": ["Numbness, tingling or weakness that is new or spreading", "A limb that looks out of shape or will not move", "Severe swelling, or skin that is cold or pale"],
        "steps": [
            {"step_num": 1, "text": "Stop the task and rest the part that hurts. Secure yourself so it is not carrying load.", "required": True},
            {"step_num": 2, "text": "Check it against the other side: swelling, colour, warmth, and how far it moves.", "required": True},
            {"step_num": 3, "text": "Hold a cold pack wrapped in cloth on it for 15 minutes.", "required": True, "timer_s": 900},
            {"step_num": 4, "text": "Support it with an elastic wrap or brace from the kit: snug, never tight. Fingers and toes must stay warm and pink.", "required": False},
            {"step_num": 5, "text": "Move it gently through the range that is comfortable. Stop if the pain sharpens.", "required": True},
            {"step_num": 6, "text": "Rest it for 20 minutes before going back to work.", "required": True, "timer_s": 1200},
        ],
    },
    "chest_discomfort_tx": {
        "id": "chest_discomfort_tx", "title": "Chest Discomfort: Rest, Measure, Tell the Crew", "zone": "heart", "kit_item": None,
        "demo_default": True,
        "source": {"title": "Demo default: general first-aid and supportive care, clinician to confirm"},
        "red_flags": ["Crushing pressure, or pain spreading to the arm or jaw", "Short of breath at rest", "Fainting, or a cold sweat"],
        "steps": [
            {"step_num": 1, "text": "Stop what you are doing, sit and rest, and tell a crewmate now so you are not alone.", "required": True},
            {"step_num": 2, "text": "Record your pulse, blood pressure and oxygen saturation in the health log.", "required": True},
            {"step_num": 3, "text": "Breathe slowly: in for 4, out for 6, for five minutes.", "required": True, "timer_s": 300},
            {"step_num": 4, "text": "Record pulse and blood pressure again and compare with the first reading.", "required": True},
        ],
    },
    "airway_cold_tx": {
        "id": "airway_cold_tx", "title": "Cough, Throat, Nose or Ear: Supportive Care", "zone": "lungs", "kit_item": None,
        "demo_default": True,
        "source": {"title": "Demo default: general first-aid and supportive care, clinician to confirm"},
        "red_flags": ["Struggling to breathe, or noisy breathing", "Coughing up blood", "High fever with the cough"],
        "steps": [
            {"step_num": 1, "text": "Check the cabin air reading (oxygen and CO2) on the Cabin screen.", "required": True},
            {"step_num": 2, "text": "Sip warm water slowly and rest your voice.", "required": True},
            {"step_num": 3, "text": "If your nose is blocked, use the saline spray from the kit as its label states.", "required": False},
            {"step_num": 4, "text": "Record your temperature in the health log.", "required": True},
            {"step_num": 5, "text": "Rest for 20 minutes away from fans blowing at your face.", "required": True, "timer_s": 1200},
        ],
    },
    "skin_care_tx": {
        "id": "skin_care_tx", "title": "Skin: Rash, Cut or Scrape Care", "zone": "whole_body", "kit_item": None,
        "demo_default": True,
        "source": {"title": "Demo default: general first-aid and supportive care, clinician to confirm"},
        "red_flags": ["A rash spreading fast, with a swollen face or tight throat", "Bleeding that does not stop with pressure", "Spreading redness, warmth or pus"],
        "steps": [
            {"step_num": 1, "text": "Clean your hands, then clean the area with a wipe from the kit.", "required": True},
            {"step_num": 2, "text": "For a cut or scrape: press with a clean pad until bleeding stops, then cover it with a dressing.", "required": False},
            {"step_num": 3, "text": "For a rash: leave it uncovered and do not scratch. Note anything new you touched, ate or used.", "required": False},
            {"step_num": 4, "text": "Photograph the area so the change can be followed.", "required": True},
            {"step_num": 5, "text": "Check it again in 30 minutes: bigger, the same, or settling?", "required": True, "timer_s": 1800},
        ],
    },
    "general_unwell_tx": {
        "id": "general_unwell_tx", "title": "Feeling Unwell: Rest and Measure", "zone": "whole_body", "kit_item": None,
        "demo_default": True,
        "source": {"title": "Demo default: general first-aid and supportive care, clinician to confirm"},
        "red_flags": ["High fever with confusion or shaking chills", "Fainting", "Getting worse quickly"],
        "steps": [
            {"step_num": 1, "text": "Stop work and rest, secured, somewhere quiet.", "required": True},
            {"step_num": 2, "text": "Record your temperature and pulse in the health log.", "required": True},
            {"step_num": 3, "text": "Drink a glass of water slowly.", "required": True},
            {"step_num": 4, "text": "Eat something plain if you have not eaten in the last few hours.", "required": False},
            {"step_num": 5, "text": "Rest for 30 minutes.", "required": True, "timer_s": 1800},
        ],
    },
    "severe_symptom_tx": {
        "id": "severe_symptom_tx",
        "title": "Emergency Severe Symptom & Level 3 Protocol",
        "zone": "whole_body",
        "kit_item": None,
        "steps": [
            {"step_num": 1, "text": "IMMEDIATE: Halt current activity and summon designated crew buddy immediately.", "required": True},
            {"step_num": 2, "text": "Alert Commander and deploy habitat emergency medical station.", "required": True},
            {"step_num": 3, "text": "Dispatch automated Priority Ground Digest to Flight Surgeon console.", "required": True},
            {"step_num": 4, "text": "Connect continuous SpO2, ECG, and non-invasive blood pressure monitors.", "required": True},
            {"step_num": 5, "text": "Establish direct voice link or prepare for store-and-forward clinical guidance.", "required": True},
        ],
    },
}

try:
    from brain.clinical.protocols import PROTOCOLS_CATALOG
    for pid, p in PROTOCOLS_CATALOG.items():
        if pid not in DEFAULT_PROTOCOLS:
            DEFAULT_PROTOCOLS[pid] = {
                "id": p["id"],
                "title": p["title"],
                "zone": p.get("zone", "whole_body"),
                "kit_item": p.get("kit_item"),
                "steps": [
                    {"step_num": s.get("num", idx), "text": s["text"], "required": True}
                    for idx, s in enumerate(p.get("steps", []), 1)
                ],
            }
except ImportError:
    pass


# What a crew member says they feel -> the protocol that covers it. Symptom words first, so a stomach ache is never
# given the motion-sickness plan and blurred vision is never treated as eye irritation. No match: the generic card.
SYMPTOM_PROTOCOLS = [
    (("blur", "vision", "double", "blind", "cant see", "can't see", "sight"), "vision_change_tx", None),
    (("headache", "head pain", "migraine"), "headache_tx", "acetaminophen"),
    (("nausea", "motion sick", "vomit", "queasy", "dizz", "seasick"), "space_motion_sickness_tx", "promethazine"),
    (("dry eye", "eye irritation", "itchy eye", "gritty", "sore eye"), "eye_irritation_tx", "artificial_tears"),
    (("stomach", "belly", "tummy", "abdom", "cramp", "diarrh", "indigestion", "heartburn", "upset"), "stomach_upset_tx", None),
    (("racing heart", "palpitation", "heart rate", "pounding", "fast pulse"), "high_resting_hr_tx", None),
    (("fever", "chills", "temperature", "feel hot", "feverish"), "raised_temp_tx", None),
    (("cant sleep", "can't sleep", "insomnia", "poor sleep", "very tired", "exhaust", "fatigue"), "poor_sleep_tx", None),
    (("stress", "anxious", "anxiety", "low mood", "overwhelm", "lonely"), "stress_low_mood_tx", None),
    (("short of breath", "breathless", "hard to breathe", "air feels"), "cabin_hypoxia_co2_tx", None),
    (("chest",), "chest_discomfort_tx", None),
    (("cough", "throat", "congest", "stuffy", "runny", "sneez", "ear pain", "earache", "ear ache", "blocked nose"), "airway_cold_tx", None),
    (("rash", "cut", "scrape", "itch", "skin", "allerg", "blister", "burn", "bruise", "wound"), "skin_care_tx", None),
    (("muscle", "joint", "sprain", "strain", "swell", "swollen", "numb", "tingl", "stiff", "back", "neck", "hand", "wrist", "finger", "thumb",
      "arm", "elbow", "shoulder", "leg", "knee", "ankle", "foot", "feet", "toe", "hip", "thigh", "calf"), "muscle_joint_tx", None),
    (("unwell", "weak", "run down", "off colour", "not right", "ill", "sick"), "general_unwell_tx", None),
]
# a symptom that should never sit at "watch": at least level 2, whatever strength was given
AT_LEAST_ACT = ("numb", "tingl", "chest", "swell", "swollen")


class CareEngine:
    """Manages Triage, Protocol Execution, and Care Logging (Section 16.1)."""

    def __init__(self, persist: bool | None = None):
        self.persist = (os.getenv("SENTINEL_NO_PERSIST") != "1") if persist is None else persist
        self.lock = threading.Lock()
        self.runs: dict[str, dict] = {}
        self.logs: dict[str, list[dict]] = {}
        if self.persist:
            try:
                from brain.core.vault import read_json
                self.runs = read_json(DATA / "care_runs.json")
            except (OSError, ValueError):
                self.runs = {}
            try:
                from brain.core.vault import read_json
                self.logs = read_json(DATA / "care_logs.json")
            except (OSError, ValueError):
                self.logs = {}

    def _save(self) -> None:
        if self.persist:
            from brain.core.vault import write_json
            write_json(DATA / "care_runs.json", self.runs)
            write_json(DATA / "care_logs.json", self.logs)

    # ---- 1. Triage (Care: triage) ----
    @staticmethod
    def protocol_title(protocol_id: str) -> str:
        if protocol_id in DEFAULT_PROTOCOLS:
            return DEFAULT_PROTOCOLS[protocol_id]["title"]
        from brain.clinical.protocols import get_protocol
        return (get_protocol(protocol_id) or {}).get("title", protocol_id)

    def get_triage_questions(self, zone: str = "head") -> list[dict]:
        """Returns structured triage questions for a given body zone."""
        return copy.deepcopy(TRIAGE_QUESTIONS.get(zone, TRIAGE_QUESTIONS["whole_body"]))

    def evaluate_triage(self, cid: str, zone: str, answers: dict[str, bool], symptom_name: str = "", profile: dict | None = None,
                        severity: int | None = None) -> dict:
        """Evaluates triage answers, flags red-flag symptoms, and maps to medical protocols."""
        profile = profile or {}
        # Check red flags
        triggered_red_flags = [q_id for q_id, val in answers.items() if val and any(
            q["id"] == q_id and q.get("red_flag") for q in TRIAGE_QUESTIONS.get(zone, [])
        )]

        if triggered_red_flags:
            urgency = 3
            urgency_label = "urgent_concern"
            protocol_id = "severe_symptom_tx"
            detail = "Red-flag symptom detected during triage. Immediate crew notification and priority escalation."
            kit_item_id = None
        else:
            urgency = 1
            urgency_label = "mild_to_moderate"
            if isinstance(severity, (int, float)) and not isinstance(severity, bool):
                # demo default, tunable, clinician to confirm (Product Document 19.1)
                urgency = 3 if severity >= 7 else 2 if severity >= 4 else 1
                urgency_label = {1: "mild_to_moderate", 2: "act", 3: "severe_symptom"}[urgency]
            symptom_lower = symptom_name.lower().strip()
            protocol_id, kit_item_id = None, None
            for words, pid, kit in SYMPTOM_PROTOCOLS:
                if any(w in symptom_lower for w in words):
                    protocol_id, kit_item_id = pid, kit
                    break
            if protocol_id is None and not symptom_lower:   # only a zone was given: the zone's usual protocol
                protocol_id, kit_item_id = {"head": ("headache_tx", "acetaminophen"), "gut": ("space_motion_sickness_tx", "promethazine"),
                                            "eyes": ("eye_irritation_tx", "artificial_tears")}.get(zone, (None, None))
            if protocol_id == "vision_change_tx":   # always escalate: ties to the SANS risk (19.4)
                urgency, urgency_label = 3, "vision_change"
            elif urgency < 2 and any(w in symptom_lower for w in AT_LEAST_ACT):
                urgency, urgency_label = 2, "act"
            if protocol_id is None and not symptom_lower:
                protocol_id = {"bones": "muscle_joint_tx", "chest": "chest_discomfort_tx", "heart": "chest_discomfort_tx", "lungs": "airway_cold_tx",
                               "skin": "skin_care_tx", "whole_body": "general_unwell_tx"}.get(zone)
            if protocol_id is not None and protocol_id not in DEFAULT_PROTOCOLS:
                from brain.clinical.protocols import get_protocol as _lib
                if not (_lib(protocol_id) or {}).get("verified"):
                    protocol_id, kit_item_id = None, None   # an unsourced protocol is never shown as an instruction
            if protocol_id is None:
                urgency = max(urgency, 2)
                urgency_label = "no_protocol_match" if urgency == 2 else urgency_label
                detail = "We could not match this to a protocol. Contact the flight surgeon; rest and note any change until you hear back."
            else:
                detail = f"Triage complete for {zone}. Recommended protocol: {self.protocol_title(protocol_id)}."

        # Medical kit item & safety filter
        kit_info = None
        if kit_item_id:
            from brain.core.profile import kit_filter
            # Load med kit item details
            try:
                med_kit = json.loads((SHARED / "med_kit.json").read_text(encoding="utf-8"))
                item = next((it for it in med_kit.get("items", []) if it["id"] == kit_item_id), None)
            except Exception:
                item = {"id": kit_item_id, "name": kit_item_id.capitalize(), "pack": "Medical Kit"}

            safety_check = kit_filter(item, profile)
            kit_info = {
                "item": item,
                "safety": safety_check,
            }

        # Build Section 19.3 Recommendation Card
        from brain.clinical.protocols import build_recommendation_card, get_protocol, PROTOCOLS_CATALOG
        matched_proto = (get_protocol(protocol_id) or PROTOCOLS_CATALOG.get(protocol_id)) if protocol_id else None
        if protocol_id and not matched_proto and protocol_id in DEFAULT_PROTOCOLS:
            # an onboard step list that is not in the sourced library yet: the card shows its own steps and says where they come from
            dp = DEFAULT_PROTOCOLS[protocol_id]
            matched_proto = {"id": protocol_id, "title": dp["title"], "zone": dp.get("zone"), "kit_item": dp.get("kit_item"),
                             "steps": [{"num": s["step_num"], "text": s["text"]} for s in dp["steps"]][:5], "red_flags": dp.get("red_flags", []),
                             "recheck_interval_min": 45, "hrp_risk": "Inadequate Food and Nutrition" if dp.get("zone") == "gut" else "General status",
                             "hazard": "Hostile closed environment", "verified": not dp.get("demo_default", False),
                             "source": dp.get("source") or {"title": "Onboard protocol list (demo default, clinician to confirm)"}}
        card = build_recommendation_card(
            cid=cid,
            level=urgency,
            trigger_summary=detail,
            protocol=matched_proto,
            profile=profile,
        )

        return {
            "crew_id": cid,
            "zone": zone,
            "symptom": symptom_name,
            "urgency": urgency,
            "urgency_label": urgency_label,
            "red_flags": triggered_red_flags,
            "severity": severity,
            "protocol_id": protocol_id,
            "protocol_title": self.protocol_title(protocol_id) if protocol_id else "No matching protocol",
            "detail": detail,
            "kit": kit_info,
            "recommendation_card": card,
        }

    # ---- 2. Protocol Runner (Care: protocol runner) ----
    def start_protocol(self, cid: str, protocol_id: str, context: dict | None = None) -> dict:
        """Starts a step-by-step protocol run with timers and checklists."""
        proto = DEFAULT_PROTOCOLS.get(protocol_id)
        if proto is None:
            # a sourced protocol from the library can be run too; an unknown id is refused, never swapped for another
            from brain.clinical.protocols import get_protocol
            lib = get_protocol(protocol_id)
            if not lib or not lib.get("verified"):
                raise KeyError(f"unknown protocol {protocol_id}")
            proto = {"title": lib["title"], "zone": lib.get("zone", "whole_body"), "kit_item": lib.get("kit_item"),
                     "steps": [{"step_num": s.get("num", i), "text": s["text"], "required": True} for i, s in enumerate(lib.get("steps", []), 1)]}
        run_id = f"run_{uuid.uuid4().hex[:10]}"

        steps = []
        for s in proto["steps"]:
            s_num = s.get("step_num") or s.get("num") or 1
            steps.append({
                "step_num": s_num,
                "text": s["text"],
                "required": s.get("required", True),
                "done": False,
                "timer_s": s.get("timer_s"),
            })

        run = {
            "run_id": run_id,
            "crew_id": cid,
            "protocol_id": protocol_id,
            "title": proto["title"],
            "zone": proto.get("zone", "whole_body"),
            "kit_item": proto.get("kit_item"),
            "demo_default": bool(proto.get("demo_default")),
            "state": "running",   # running, paused, escalated, completed
            "started_at": time.time(),
            "updated_at": time.time(),
            "current_step": 1,
            "steps": steps,
            "timer": {"active": False, "remaining_s": 0},
            "context": context or {},
        }

        with self.lock:
            self.runs[run_id] = run
            self._save()

        return run

    def update_step(self, run_id: str, step_num: int, done: bool = True) -> dict:
        """Checks off a step and advances progress."""
        with self.lock:
            run = self.runs.get(run_id)
            if not run:
                raise KeyError(f"unknown protocol run {run_id}")

            for s in run["steps"]:
                if s["step_num"] == step_num:
                    s["done"] = bool(done)
                    if s.get("timer_s") and done is False:
                        run["timer"] = {"active": True, "remaining_s": s["timer_s"], "started_at": time.time()}

            run["current_step"] = min(len(run["steps"]), step_num + 1 if done else step_num)
            run["updated_at"] = time.time()
            self._save()
            return copy.deepcopy(run)

    def pause_protocol(self, run_id: str) -> dict:
        """Pauses active protocol run."""
        with self.lock:
            run = self.runs.get(run_id)
            if not run:
                raise KeyError(f"unknown protocol run {run_id}")
            run["state"] = "paused"
            run["updated_at"] = time.time()
            self._save()
            return copy.deepcopy(run)

    def resume_protocol(self, run_id: str) -> dict:
        """Resumes paused protocol run."""
        with self.lock:
            run = self.runs.get(run_id)
            if not run:
                raise KeyError(f"unknown protocol run {run_id}")
            run["state"] = "running"
            run["updated_at"] = time.time()
            self._save()
            return copy.deepcopy(run)

    def escalate_protocol(self, run_id: str, note: str = "") -> dict:
        """Escalates protocol run to flight surgeon."""
        with self.lock:
            run = self.runs.get(run_id)
            if not run:
                raise KeyError(f"unknown protocol run {run_id}")
            run["state"] = "escalated"
            run["escalated_at"] = time.time()
            run["escalation_note"] = note or "Escalated by crew protocol runner."
            run["updated_at"] = time.time()
            self._save()

            # Record event in Care Log
            self._append_log(run["crew_id"], {
                "type": "protocol_escalated",
                "run_id": run_id,
                "protocol": run["title"],
                "outcome": f"Escalated to Flight Surgeon: {note}",
            })

            return copy.deepcopy(run)

    def complete_protocol(self, run_id: str, outcome: str = "Resolved nominal") -> dict:
        """Marks protocol complete and logs outcome in Care Log."""
        with self.lock:
            run = self.runs.get(run_id)
            if not run:
                raise KeyError(f"unknown protocol run {run_id}")
            run["state"] = "completed"
            run["completed_at"] = time.time()
            run["outcome"] = outcome
            run["updated_at"] = time.time()
            self._save()

            # Append to permanent Care Log
            self._append_log(run["crew_id"], {
                "type": "protocol_completed",
                "run_id": run_id,
                "protocol": run["title"],
                "kit_item": run.get("kit_item"),
                "outcome": outcome,
                "steps_completed": sum(1 for s in run["steps"] if s["done"]),
                "total_steps": len(run["steps"]),
            })

            return copy.deepcopy(run)

    def get_protocol_run(self, run_id: str) -> dict:
        """Returns run status."""
        with self.lock:
            run = self.runs.get(run_id)
            if not run:
                raise KeyError(f"unknown protocol run {run_id}")
            return copy.deepcopy(run)

    # ---- 3. Care Log (Care: log) ----
    def _append_log(self, cid: str, entry: dict) -> None:
        entry["id"] = f"log_{int(time.time() * 1000)}"
        entry["timestamp"] = time.time()
        self.logs.setdefault(cid, []).insert(0, entry)
        self._save()

    def get_care_log(self, cid: str) -> dict:
        """Returns past clinical history or informative empty state."""
        with self.lock:
            entries = copy.deepcopy(self.logs.get(cid, []))

        if not entries:
            return {
                "crew_id": cid,
                "entries": [],
                "count": 0,
                "empty": True,
                "placeholder": "No clinical care events logged yet. Completed symptom triages, guided protocol runs, and medical kit usages will appear here.",
            }

        return {
            "crew_id": cid,
            "entries": entries,
            "count": len(entries),
            "empty": False,
        }


care = CareEngine()
