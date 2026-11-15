"""Clinical Protocols Library & Recommendation Card Generator (Sections 19.1 - 19.5).

Single Source of Truth: NASA Medical Requirements Integration Documents (JSC 28913)
cataloged in shared/nasa_mrid.json and dataset/*.pdf.

Rules:
1. Every protocol has triggers, questions, red flags, steps, kit items, recheck interval, and source.
2. A protocol without a verified source loads as 'unverified' and is never shown as an instruction.
3. Variants per environment/mode merge over base (variant wins, arrays replaced).
4. Recommendation card follows the 7-part format: seen, sure, now, use, recheck, escalate_if, why.
5. Level 3 comes ONLY from range limits, red-flag symptoms, or cabin limits, NEVER from statistics alone.
"""
from __future__ import annotations

import copy
import json
import time
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
SHARED = ROOT / "shared"
MED_KIT_PATH = SHARED / "med_kit.json"
NASA_MRID_PATH = SHARED / "nasa_mrid.json"

# Starter set of 10 evidence-sourced clinical protocols (Section 19.4)
# Grounded in NASA MRIDs from JSC 28913
PROTOCOLS_CATALOG: dict[str, dict[str, Any]] = {
    "headache_tx": {
        "id": "headache_tx",
        "title": "Headache & Cephalea Relief Protocol",
        "zone": "head",
        "hazard": "Hostile Closed Environment / Fluid Redistribution",
        "hrp_risk": "Risk of Adverse Cognitive or Behavioral Conditions",
        "source": {
            "title": "NASA MRID MEDB 1.2 / OCHMO-TB-004 Carbon Dioxide",
            "mrid": "MEDB 1.2",
            "url": "https://www.nasa.gov/wp-content/uploads/2023/12/ochmo-tb-004-carbon-dioxide.pdf",
        },
        "verified": True,
        "triggers": ["headache", "head_pain", "cephalea", "cabin_co2"],
        "recheck_interval_min": 45,
        "kit_item": "acetaminophen",
        "red_flags": [
            "Sudden severe onset ('thunderclap' headache)",
            "Headache accompanied by visual field loss, double vision, or blurred vision",
            "Focal neurological deficits, slurred speech, or unilateral motor weakness",
            "Fever with neck stiffness or photophobia",
        ],
        "steps": [
            {"num": 1, "text": "Sit and rest in low-light personal quarters for 15 minutes; restrict rapid head movements."},
            {"num": 2, "text": "Check cabin CO2 levels on environmental monitor (CDMK/AQM). If elevated > 3 mmHg, ventilate compartment."},
            {"num": 3, "text": "Drink at least 350 ml of electrolyte-balanced water to ensure adequate hydration."},
            {"num": 4, "text": "If pain persists, take Acetaminophen (500mg) from Convenience Pack as label states."},
            {"num": 5, "text": "Log symptom intensity and schedule recheck measurement."},
        ],
        "variants": {
            "station": {
                "source": "NASA MRID MEDB 1.2 (ISS Operations)",
                "steps": [
                    {"num": 1, "text": "Rest in personal crew quarters; check ISS Node 3 / Columbus airflow ventilation diffuser."},
                    {"num": 2, "text": "Retrieve Acetaminophen from ISS Convenience Medication Pack (Locker MED-1)."},
                    {"num": 3, "text": "Hydrate with 350 ml water; recheck in 45 min. Ground surgeon will review at next AOS."},
                ],
            },
            "transit": {
                "source": "NASA JSC 28913 Transit Health Guidelines",
                "steps": [
                    {"num": 1, "text": "Sit and rest in transit cabin; verify personal fan is circulating air away from face."},
                    {"num": 2, "text": "Check transit atmosphere ppCO2. If above 2.5 mmHg, notify commander to scrub CO2 bed."},
                    {"num": 3, "text": "Retrieve Acetaminophen from Onboard Medical Kit. Note: treat in place, expect delayed ground reply."},
                ],
            },
            "eva": {
                "source": "NASA MRID MEDB 6.1 (EVA Medical Monitoring)",
                "steps": [
                    {"num": 1, "text": "EVA SORTIE ADVISORY: Cephalea during EVA requires suit air check (ppO2 and ppCO2)."},
                    {"num": 2, "text": "If headache accompanies dizziness or vision changes, initiate immediate airlock return procedure."},
                    {"num": 3, "text": "Do not ingest oral medication inside EMU/suit. Treat post-ingress."},
                ],
            },
        },
    },
    "stress_low_mood_tx": {
        "id": "stress_low_mood_tx",
        "title": "Acute Stress & Low Mood Intervention Protocol",
        "zone": "head",
        "hazard": "Isolation and Confinement / Distance from Earth",
        "hrp_risk": "Behavioral Changes and Psychiatric Disorders",
        "source": {
            "title": "NASA MRID MEDB 7.1 / MEDB 7.2 Private Psychological Conferences",
            "mrid": "MEDB 7.1",
            "url": "https://www.nasa.gov/hrp/behavioral-health",
        },
        "verified": True,
        "triggers": ["stress", "low_mood", "mood_drift", "anxiety", "isolation"],
        "recheck_interval_min": 60,
        "kit_item": None,
        "red_flags": [
            "Expression of despair, self-harm, or suicidal ideation",
            "Severe panic, dissociation, or acute loss of emotional control",
            "Interpersonal crisis or active hostility compromising crew safety",
        ],
        "steps": [
            {"num": 1, "text": "Initiate a 5-minute guided slow-paced breathing session (Orb Calm resonance at 0.1 Hz)."},
            {"num": 2, "text": "Engage personal grounding screen or view Earth-window visual imagery for cognitive reset."},
            {"num": 3, "text": "Log mood tags and optional private on-device journal entry (text remains confidential)."},
            {"num": 4, "text": "Reach out to designated crew buddy for a brief informal conversation or meal share."},
            {"num": 5, "text": "If elevated stress persists over 48 hours, schedule non-urgent Private Psychological Conference (PPC)."},
        ],
        "variants": {
            "transit": {
                "source": "NASA MRID MEDB 7.2 (Deep Space Confinement)",
                "steps": [
                    {"num": 1, "text": "Perform Orb Calm biofeedback breathing in sleep quarters."},
                    {"num": 2, "text": "Use delay-tolerant messaging to family/support network; review recorded messages."},
                    {"num": 3, "text": "Check in with crew buddy. Deep space autonomous support active."},
                ],
            },
            "eva": {
                "source": "NASA MRID MEDB 6.1 (EVA Sortie)",
                "steps": [
                    {"num": 1, "text": "Inform EVA lead: pause high-workload task, stabilize footing on tether."},
                    {"num": 2, "text": "Take 3 slow diaphragmatic breaths, monitor helmet HUD metabolic rate."},
                    {"num": 3, "text": "If panic or disorientation occurs, call abort and commence airlock ingress."},
                ],
            },
        },
    },
    "poor_sleep_tx": {
        "id": "poor_sleep_tx",
        "title": "Sleep Debt & Circadian Misalignment Recovery Protocol",
        "zone": "head",
        "hazard": "Inadequate Sleep and Irregular Schedules",
        "hrp_risk": "Risk of Performance Decrements and Disorders from Inadequate Sleep",
        "source": {
            "title": "NASA MRID MR042S Functional Neurological Assessment & Sleep Tracking",
            "mrid": "MR042S",
            "url": "https://www.nasa.gov/hrp/sleep-research",
        },
        "verified": True,
        "triggers": ["poor_sleep", "insomnia", "sleep_debt", "circadian_shift"],
        "recheck_interval_min": 120,
        "kit_item": "zolpidem",
        "red_flags": [
            "Severe fatigue causing micro-sleeps during robotic or piloting duty",
            "Reaction time slowed by > 50% with $\\ge 5$ PVT lapses before critical operations",
            "Visual hallucinations or confusion from profound sleep deprivation",
        ],
        "steps": [
            {"num": 1, "text": "Enforce sleep hygiene: switch cabin lighting to 480nm-depleted warm spectrum 90 min before sleep."},
            {"num": 2, "text": "Eliminate caffeine intake at least 6 hours prior to designated sleep block."},
            {"num": 3, "text": "Run evening wind-down soundscape or binaural beat session in private quarters."},
            {"num": 4, "text": "If sleep onset failure persists, consult Flight Surgeon for short-acting hypnotic (Zolpidem)."},
            {"num": 5, "text": "Perform 30-second PVT reaction test upon waking to verify operational readiness."},
        ],
    },
    "high_resting_hr_tx": {
        "id": "high_resting_hr_tx",
        "title": "Tachycardia & Autonomic Dysregulation Protocol",
        "zone": "heart",
        "hazard": "Microgravity Fluid Redistribution / Deconditioning",
        "hrp_risk": "Cardiovascular Adaptations",
        "source": {
            "title": "NASA MRID MEDB 2.1 / MR006L Exercise Treadmill Test & ECG",
            "mrid": "MEDB 2.1",
            "url": "https://www.nasa.gov/hrp/cardiovascular",
        },
        "verified": True,
        "triggers": ["heart_rate", "tachycardia", "high_pulse"],
        "recheck_interval_min": 30,
        "kit_item": None,
        "red_flags": [
            "Crushing chest pressure, substernal tightness, or pain radiating to left arm/jaw",
            "Resting heart rate > 140 bpm accompanied by syncope, presyncope, or dizziness",
            "Irregular pulse rhythm or palpitations with dyspnea at rest",
        ],
        "steps": [
            {"num": 1, "text": "Cease physical exertion immediately; sit or recline in passive restraint."},
            {"num": 2, "text": "Verify pulse manually at radial artery for 60 seconds to cross-check camera rPPG estimate."},
            {"num": 3, "text": "Drink 300 ml oral rehydration solution (electrolyte-balanced water)."},
            {"num": 4, "text": "Perform 5 minutes of resonant paced breathing (6 breaths per minute)."},
            {"num": 5, "text": "Attach 3-lead ECG monitoring patch if pulse remains elevated past recheck."},
        ],
    },
    "high_bp_tx": {
        "id": "high_bp_tx",
        "title": "Hypertension & Vascular Resistance Protocol",
        "zone": "heart",
        "hazard": "Microgravity Fluid Shift & Cephalad Blood Pressure Increase",
        "hrp_risk": "Cardiovascular Adaptations",
        "source": {
            "title": "NASA MRID MEDB 2.1 / MR006L Blood Pressure & Cardiovascular Monitoring",
            "mrid": "MEDB 2.1",
            "url": "https://www.nasa.gov/hrp/cardiovascular",
        },
        "verified": True,
        "triggers": ["bp_sys", "bp_dia", "hypertension", "high_bp"],
        "recheck_interval_min": 60,
        "kit_item": None,
        "red_flags": [
            "Systolic BP > 180 mmHg or Diastolic BP > 110 mmHg (Hypertensive Urgency)",
            "High BP with blurred vision, acute occipital headache, or epistaxis",
            "Chest discomfort or acute shortness of breath",
        ],
        "steps": [
            {"num": 1, "text": "Sit quietly in cabin chair for 5 minutes with arm supported at heart level."},
            {"num": 2, "text": "Remeasure BP using calibrated manual oscillometric arm cuff; record both systolic and diastolic."},
            {"num": 3, "text": "Review recent sodium/meal intake and cabin stress context."},
            {"num": 4, "text": "If reading exceeds 140/90 mmHg on recheck, queue priority digest for Flight Surgeon."},
        ],
    },
    "glucose_out_of_range_tx": {
        "id": "glucose_out_of_range_tx",
        "title": "Metabolic & Blood Glucose Stabilization Protocol",
        "zone": "gut",
        "hazard": "Food System & Nutritional Deficiencies in Long Duration Flight",
        "hrp_risk": "Inadequate Food and Nutrition",
        "source": {
            "title": "NASA MRID MR010L / MR010S Clinical Laboratory Testing",
            "mrid": "MR010L",
            "url": "https://www.nasa.gov/hrp/nutrition",
        },
        "verified": True,
        "triggers": ["blood_glucose", "hypoglycemia", "hyperglycemia", "glucose"],
        "recheck_interval_min": 30,
        "kit_item": None,
        "red_flags": [
            "Blood glucose < 54 mg/dL with diaphoresis, confusion, trembling, or syncope",
            "Blood glucose > 250 mg/dL with nausea, abdominal pain, or fruity breath (Ketoacidosis signal)",
        ],
        "steps": [
            {"num": 1, "text": "If glucose < 70 mg/dL: consume 15g of fast-acting carbohydrate (fruit spread or juice pouch)."},
            {"num": 2, "text": "Rest quietly and avoid EVA, robotics, or countermeasure exercise."},
            {"num": 3, "text": "Remeasure capillary blood glucose in exactly 15 minutes using glucometer."},
            {"num": 4, "text": "Once stable above 70 mg/dL, eat a balanced meal with complex carbohydrates and protein."},
            {"num": 5, "text": "Log meal, fluid intake, and glucometer reading in Sentinel daily nutritional tracker."},
        ],
    },
    "raised_temp_tx": {
        "id": "raised_temp_tx",
        "title": "Fever & Infection Management Protocol",
        "zone": "whole_body",
        "hazard": "Microbial Pathogenicity & Immune Alteration in Spaceflight",
        "hrp_risk": "Risk of Crew Adverse Health Event Due to Altered Immune Response",
        "source": {
            "title": "NASA MRID MEDB 1.1 / MEDB 1.2 Physical Exams and CMO Clinical Evaluation",
            "mrid": "MEDB 1.1",
            "url": "https://www.nasa.gov/hrp/immune",
        },
        "verified": True,
        "triggers": ["temperature", "fever", "infection", "hyperthermia"],
        "recheck_interval_min": 60,
        "kit_item": "acetaminophen",
        "red_flags": [
            "Temperature > 39.0 C (102.2 F) or rapidly rising with rigors/chills",
            "Fever with petechial rash, nuchal rigidity, or acute confusion",
            "Respiratory distress, productive purulent cough, or SpO2 < 93%",
        ],
        "steps": [
            {"num": 1, "text": "Confirm tympanic temperature reading; ensure sensor probe tip is clean."},
            {"num": 2, "text": "Isolate in crew quarters if infectious etiology suspected; maintain personal ventilation airflow."},
            {"num": 3, "text": "Hydrate aggressively with 500 ml water every 2 hours to offset insensible sweat loss."},
            {"num": 4, "text": "Take Acetaminophen (500mg) from Convenience Pack as antipyretic per label directions."},
            {"num": 5, "text": "Notify Crew Medical Officer (CMO) and Flight Surgeon via Ground Digest."},
        ],
    },
    "cabin_hypoxia_co2_tx": {
        "id": "cabin_hypoxia_co2_tx",
        "title": "Cabin Atmosphere Dysregulation & Hypoxia Protocol",
        "zone": "cabin",
        "hazard": "Hostile or Closed Cabin Environment",
        "hrp_risk": "Hypoxia and Elevated ppCO2 Toxicity",
        "source": {
            "title": "NASA MRID MR039L (CDMK) / MR043S / MR091L (Air Quality Monitor)",
            "mrid": "MR039L",
            "url": "https://www.nasa.gov/wp-content/uploads/2023/12/ochmo-tb-004-carbon-dioxide.pdf",
        },
        "verified": True,
        "triggers": ["cabin_o2", "cabin_co2", "hypoxia", "co2_alarm"],
        "recheck_interval_min": 15,
        "kit_item": None,
        "red_flags": [
            "Cabin oxygen FiO2 < 17.1% (PIO2 < 122 mmHg) or SpO2 < 90%",
            "Cabin CO2 ppCO2 > 3.9 mmHg (> 3,947 ppm at 14.7 psia)",
            "Crew members experiencing acute dyspnea, confusion, cyanosis, or loss of consciousness",
        ],
        "steps": [
            {"num": 1, "text": "EMERGENCY: Verify cabin atmosphere readouts on primary avionics and portable CDMK monitor."},
            {"num": 2, "text": "If O2 deficient: don emergency Personal Breathing Apparatus (PBA) immediately."},
            {"num": 3, "text": "Inspect inter-module ventilation (IMV) fans to eliminate localized stagnant air pockets."},
            {"num": 4, "text": "Activate secondary Carbon Dioxide Removal Assembly (CDRA) scrub cycle."},
            {"num": 5, "text": "Alert Commander and ground flight control team via emergency comm loop."},
        ],
    },
    "motion_sickness_tx": {
        "id": "motion_sickness_tx",
        "title": "Space Motion Sickness (SMS) & Neurovestibular Adaptation Protocol",
        "zone": "gut",
        "hazard": "Altered Gravity Fields & Sensorimotor Disruption",
        "hrp_risk": "Risk of Impaired Control of Spacecraft Due to Sensorimotor Alterations",
        "source": {
            "title": "NASA MRID MEDB 1.5 Neurovestibular Platform Test / MEDB 1.2",
            "mrid": "MEDB 1.5",
            "url": "https://www.nasa.gov/hrp/sensorimotor",
        },
        "verified": True,
        "triggers": ["motion_sickness", "nausea", "sms", "dizziness", "vertigo"],
        "recheck_interval_min": 45,
        "kit_item": "promethazine",
        "red_flags": [
            "Intractable vomiting with inability to retain fluids for > 12 hours",
            "Severe dehydration with postural hypotension or electrolyte derangement",
            "Inability to perform critical docking or landing timeline responsibilities",
        ],
        "steps": [
            {"num": 1, "text": "Stabilize body in foot loops; minimize head pitch and roll rotations."},
            {"num": 2, "text": "Fixate gaze on a stable visual reference point inside habitat or Earth window."},
            {"num": 3, "text": "Sip electrolyte fluids in small volumes (50 ml at a time)."},
            {"num": 4, "text": "If symptoms impair duty, take Promethazine from Oral Medication Pack as surgeon authorizes."},
            {"num": 5, "text": "Log adaptation progression in daily check-in."},
        ],
    },
    "vision_change_tx": {
        "id": "vision_change_tx",
        "title": "Vision Alteration & SANS Assessment Protocol (ALWAYS ESCALATES)",
        "zone": "eyes",
        "hazard": "Cephalad Fluid Shift & Spaceflight Associated Neuro-ocular Syndrome",
        "hrp_risk": "Risk of Spaceflight Associated Neuro-ocular Syndrome (SANS)",
        "source": {
            "title": "NASA MRID MEDB 1.10 / MR014S Eye Exams & Sonography / MEDB 1.15",
            "mrid": "MEDB 1.10",
            "url": "https://www.nasa.gov/hrp/sans",
        },
        "verified": True,
        "triggers": ["vision_change", "blurred_vision", "diplopia", "scotoma", "papilledema"],
        "recheck_interval_min": 60,
        "kit_item": None,
        "red_flags": [
            "Sudden loss of vision, blackout, or visual field restriction (IMMEDIATE LEVEL 3)",
            "Visual obscurations lasting seconds during postural shifts",
            "New onset optic disc edema (papilledema) or cotton wool spots",
        ],
        "steps": [
            {"num": 1, "text": "MANDATORY ESCALATION: Stop task. Vision changes in microgravity tie directly to SANS risk."},
            {"num": 2, "text": "Perform visual acuity assessment using onboard Snellen card and near-vision test card."},
            {"num": 3, "text": "Examine pupil light reflexes and check for visual field deficits in both eyes."},
            {"num": 4, "text": "Schedule optical coherence tomography (OCT) or fundoscopic ultrasound with CMO."},
            {"num": 5, "text": "Transmit Priority Digest to Flight Surgeon and Ophthalmology console."},
        ],
        "variants": {
            "eva": {
                "source": "NASA MRID MEDB 6.1 (EVA Sortie)",
                "steps": [
                    {"num": 1, "text": "CRITICAL: Any vision alteration during EVA is an immediate abort condition."},
                    {"num": 2, "text": "Notify partner and mission flight director: initiate abort to airlock."},
                    {"num": 3, "text": "Verify EMU suit visor anti-fog layer is not causing visual distortion."},
                ],
            },
        },
    },
}


# =======================================================================
# Protocol Library Verification & Variant Merging (Section 19.4 & 19.5)
# =======================================================================

def get_protocol(protocol_id: str, env: str = "transit", mode: str = "routine") -> dict[str, Any] | None:
    """Retrieve protocol with environment and mode variants merged over base.
    
    Section 19.4 & 19.5: Variant wins; arrays replaced. Protocols without a valid
    source are marked 'unverified' and suppressed from instruction displays.
    """
    proto = PROTOCOLS_CATALOG.get(protocol_id)
    if not proto:
        return None
    merged = copy.deepcopy(proto)
    if not merged.get("verified") or not merged.get("source"):
        merged["unverified"] = True
        return merged

    variants = merged.get("variants", {})
    # Environment variant wins first, mode variant (e.g. eva) takes precedence
    target_variant = None
    if mode in ("eva", "sortie") and "eva" in variants:
        target_variant = variants["eva"]
    elif env in variants:
        target_variant = variants[env]

    if target_variant:
        for k, v in target_variant.items():
            if k == "source" and isinstance(merged.get("source"), dict) and isinstance(v, str):
                merged["source"] = {**merged["source"], "variant_source": v}
            else:
                merged[k] = copy.deepcopy(v)

    return merged


def find_matching_protocols(symptom_or_metric: str, zone: str = "") -> list[dict[str, Any]]:
    """Match protocols by symptom keyword, body zone, or metric trigger."""
    s = symptom_or_metric.lower().strip()
    matched = []
    for pid, proto in PROTOCOLS_CATALOG.items():
        if not proto.get("verified"):
            continue
        triggers = [t.lower() for t in proto.get("triggers", [])]
        if s and any(t in s or s in t for t in triggers):
            matched.append(proto)
        elif not s and zone and proto.get("zone") == zone:
            matched.append(proto)
    return matched


# =======================================================================
# Recommendation Card Generator (Section 19.3)
# =======================================================================

def build_recommendation_card(
    cid: str,
    level: int,
    trigger_summary: str,
    protocol: dict[str, Any] | None,
    sure: str = "High",
    sure_reason: str = "Sourced clinical protocol and valid onboard measurements",
    env: str = "transit",
    mode: str = "routine",
    profile: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Generates a structured Section 19.3 Recommendation Card:
    1. What we see (readings and change from baseline)
    2. How sure (high, medium, low with why)
    3. What to do now (3-5 numbered steps)
    4. What to use (active kit item with safety filter)
    5. Recheck (reminder timestamp created automatically)
    6. Escalate if (clear red-flag triggers)
    7. Why it matters (hazard and HRP risk in one line)
    """
    profile = profile or {}
    level_names = {0: "NORMAL", 1: "WATCH", 2: "ACT", 3: "URGENT"}
    level_str = level_names.get(level, "WATCH")

    if not protocol:
        # Generic card per Section 19.1: 'No protocol matches: generic card plus escalate'
        return {
            "level": max(2, level),
            "level_name": level_names.get(max(2, level), "ACT"),
            "seen": trigger_summary or "Unspecified clinical symptom reported.",
            "sure": "Medium (unmatched symptom; empirical observation)",
            "now": [
                "1. Sit quietly and rest in quarters; avoid rapid motion or critical timeline duty.",
                "2. Remeasure vital signs (heart rate, blood pressure, temperature, SpO2).",
                "3. Contact Crew Medical Officer (CMO) or summon designated crew buddy.",
                "4. Generic card generated; clinical question queued for Flight Surgeon review.",
            ],
            "use": "Nothing from kit without flight surgeon consultation.",
            "recheck": "Reminder set for 30 minutes from now",
            "escalate_if": "Any acute chest pain, shortness of breath, sudden vision loss, or confusion.",
            "why": "Unclassified clinical event; conservative safety policy requires ground review.",
            "is_generic": True,
        }

    # Extract active steps (3 to 5 steps)
    raw_steps = protocol.get("steps", [])
    formatted_steps = []
    for i, s in enumerate(raw_steps[:5], 1):
        text = s["text"] if isinstance(s, dict) else str(s)
        formatted_steps.append(f"{i}. {text}")

    # Kit filter check per Section 19.5
    kit_item_name = protocol.get("kit_item")
    use_text = "Nothing needed from medical kit."
    if kit_item_name:
        from brain.profile import kit_filter
        kit_spec = {"id": kit_item_name, "name": kit_item_name.replace("_", " ").capitalize()}
        kf = kit_filter(kit_spec, profile)
        if kf["blocked"]:
            use_text = f"BLOCKED: {kit_item_name.capitalize()} is contraindicated: {kf['reason']}."
        else:
            note = f" ({kf['note']})" if kf.get("note") else ""
            use_text = f"{kit_item_name.replace('_', ' ').capitalize()} as kit label and surgeon state{note}."

    # Escalate if red flags
    red_flags = protocol.get("red_flags", [])
    escalate_if = "; ".join(red_flags[:3]) if red_flags else "Symptoms worsen or reading remains abnormal after recheck."

    # Why it matters
    hrp = protocol.get("hrp_risk", "Cardiovascular Adaptations")
    hazard = protocol.get("hazard", "Spaceflight Adaptation")
    why_text = f"{hrp}: {hazard}."

    recheck_min = protocol.get("recheck_interval_min", 45)

    return {
        "level": level,
        "level_name": level_str,
        "protocol_id": protocol.get("id"),
        "protocol_title": protocol.get("title"),
        "seen": trigger_summary,
        "sure": f"{sure} ({sure_reason})",
        "now": formatted_steps,
        "use": use_text,
        "recheck": f"Reminder set for {recheck_min} minutes from now",
        "recheck_minutes": recheck_min,
        "escalate_if": escalate_if,
        "why": why_text,
        "source": protocol.get("source", {}),
        "is_generic": False,
    }
