"""Decision layer: a pure, ordered rules function that sets `action`.

Priority, highest first:
 1. cabin alert                          -> flag_cabin (and flagged to ground)
 2. radiation storm >= S2, not sheltered -> flag_radiation
 3. any alert-severity vital             -> flag_ground + zone
 4. reported symptom with a kit match    -> suggest_medicine
 5. high stress or HR well above baseline-> offer_orb_calm (breathing)
 6. fatigue / low mood / poor sleep / boredom -> offer_intervention
 7. mild drift                           -> gentle_checkin
 8. otherwise                            -> none
The LLM never touches this.
"""
from __future__ import annotations

import re

from .contract import get_path
from .medicine import suggest
from .thresholds import SEV_RANK

VITAL_METRICS = {
    "vitals.heart_rate", "vitals.breathing_rate", "vitals.spo2",
    "manual.temp_c", "manual.bp_systolic", "manual.bp_diastolic", "manual.glucose_mgdl",
}
ZONE_ORDER = ["head", "eyes", "heart", "lungs", "gut", "bones", "whole_body", "cabin"]

HR_CALM_PCT = 15.0   # demo_placeholder: same as the heart-rate drift line
STRESS_CALM = 0.6    # demo_placeholder (thresholds.absolute.state.stress)
FATIGUE_REST = 0.6   # demo_placeholder
LOW_MOOD = 2         # mood 1-2 on the 1-5 scale
POOR_SLEEP_H = 6.0   # demo_placeholder, below the CDC 7 h line


def _act(type_, detail="", zone="", severity="none", intervention=""):
    return {"type": type_, "detail": detail, "zone": zone, "severity": severity, "intervention": intervention}


def _worst_zone(items: list[dict]) -> tuple[str, str]:
    best = ("", "none")
    for it in items:
        sev = it.get("severity", "ok")
        if not it.get("zone"):
            continue
        if SEV_RANK.get(sev, 0) > SEV_RANK.get(best[1], 0):
            best = (it["zone"], sev)
    return best


def decide(state: dict, absolute: list[dict], drift: dict, kit: dict, flag_storm_level: int = 2) -> dict:
    name = state.get("display_name", "")
    cabin = state.get("cabin", {})
    rad = state.get("radiation", {})

    # 1. cabin
    cabin_hits = [r for r in absolute if r["zone"] == "cabin" and r["severity"] == "alert"]
    if cabin.get("alert") or cabin_hits:
        parts = [f"{r['label']} {round(r['value'], 1):g}{'%' if r['unit'] == '%' else ' ' + r['unit']}" for r in cabin_hits]
        detail = ("; ".join(parts) or "Cabin atmosphere out of range") + ". Flagged to ground."
        return _act("flag_cabin", f"{detail} Crew alerted.", "cabin", "alert")   # S6: the crew is told, not only ground

    # 2. radiation storm
    level = int(rad.get("storm_level") or 0)
    if level >= flag_storm_level and not rad.get("sheltered"):
        return _act("flag_radiation", f"Solar radiation storm S{level}. Move to the shelter area and log the time.",
                    "whole_body", "alert")

    # 2b. red-flag symptoms (section 19.3: level 3 may come from red-flag symptoms). DRAFT list for clinician review.
    log = [e for e in (get_path(state, "manual.symptom_log") or []) if isinstance(e, dict) and e.get("type")]
    types = " ".join(str(e.get("type", "")).lower() for e in log)
    zones_hit = {e.get("zone") for e in log}
    red = None
    if "head" in zones_hit and ("eyes" in zones_hit or "vision" in types or "blurred" in types or "double" in types):
        red = ("head", "A head symptom with a change in vision")
    elif re.search(r"chest pain|chest pressure|crushing", types):
        red = ("heart", "Chest pain")
    elif re.search(r"can.?t breathe|short(ness)? of breath|breathless", types):
        red = ("lungs", "Trouble breathing")
    elif re.search(r"faint|passed out|blacked out|confus|slurred|weakness on one side", types):
        red = ("head", "Fainting, confusion or one-sided weakness")
    elif any(int(e.get("severity") or 0) >= 3 and e.get("onset") == "now" for e in log):
        e = next(e for e in log if int(e.get("severity") or 0) >= 3)
        red = (e.get("zone") or "whole_body", f"A severe {e.get('type')}")
    if red:
        return _act("flag_redflag", f"{red[1]} is a red-flag symptom. Stop, alert a crewmate and follow the medical procedure; a priority digest goes to the flight surgeon.",
                    red[0], "alert")

    # 3. alert-severity vital
    vital_alerts = [r for r in absolute if r["metric"] in VITAL_METRICS and r["severity"] == "alert"]
    if vital_alerts:
        r = vital_alerts[0]
        return _act("flag_ground", f"{r['label']} {r['value']} {r['unit']} is past the alert line. Flagged to ground.",
                    r["zone"], "alert")

    # 4. symptom with a kit match
    for s in (get_path(state, "manual.symptoms") or []):
        m = suggest(s, kit)
        if m["matched"]:
            from brain.profile import kit_filter, profiles   # section 14.4: allergies block, regular medicines add a note
            f = kit_filter(m["item"], profiles.get(state.get("crew_id", "")))
            if f["blocked"]:
                return _act("suggest_medicine", f"{s.capitalize()}: {f['reason']}", m["zone"] or "whole_body", "watch")
            return _act("suggest_medicine", f"{m['text']} {f['note']}".strip(), m["zone"] or "whole_body", "info")

    items = drift.get("items", [])
    zone, sev = _worst_zone(items + [r for r in absolute if r["severity"] in ("watch", "alert")])

    # 5. stress or heart rate well above baseline
    hr = get_path(state, "vitals.heart_rate")
    base = get_path(state, "baseline.heart_rate")
    stress = get_path(state, "state.stress") or 0
    hr_up = bool(hr and base and (hr - base) / base * 100 >= HR_CALM_PCT)
    if stress >= STRESS_CALM or hr_up:
        why = f"Heart rate {round(hr)} against a usual {round(base)}" if hr_up else "Stress index raised"
        return _act("offer_orb_calm", f"{why}. Offer a guided breathing session.", zone or "heart",
                    sev if sev != "none" else "watch", "breathing")

    # 6. fatigue / low mood / poor sleep / boredom: each picks a different intervention
    mood = get_path(state, "manual.mood")
    fatigue = get_path(state, "state.fatigue") or 0
    sleep = get_path(state, "manual.sleep_hours")
    emotion = (get_path(state, "state.emotion") or "").lower()
    if isinstance(mood, (int, float)) and mood <= LOW_MOOD:
        return _act("offer_intervention", "Mood is low today. A message to a crewmate may help.", "head", "watch", "connection")
    if fatigue >= FATIGUE_REST:
        return _act("offer_intervention", "Fatigue index raised. A quiet Earth-window break may help.", zone or "eyes", "watch", "earth_window")
    if isinstance(sleep, (int, float)) and sleep < POOR_SLEEP_H:
        return _act("offer_intervention", f"Slept {sleep} hours. A wind-down sound session may help tonight.", "head", "watch", "music")
    if emotion in ("bored", "boredom", "flat"):
        return _act("offer_intervention", "Signs of monotony. A short Aurora Run session may help.", "head", "info", "aurora_run")

    # 7. mild drift
    if drift.get("flag") or sev in ("watch", "alert"):
        return _act("gentle_checkin", drift.get("note") or "A reading has moved from its usual range.", zone, "info")

    return _act("none")
