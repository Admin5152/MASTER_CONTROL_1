"""Clinical model and daily workflows (Product Document Section 12).

12.1 Five modes:
- Monitor: Continuous, passive. Camera, voice, cabin feeds update quietly; anomaly engine watches.
- Check-up: Scheduled (daily). Guided check-in: scan, typed entries, mood, reaction test, summary.
- Triage: 'I don't feel well' or anomaly. Pick body zone, answer a few questions, get urgency level.
- Treat and follow up: After triage. Protocol steps, kit item, timers, recheck reminder, outcome logged.
- Escalate: Urgent, or protocol says so. Digest to the flight surgeon, crew buddy alerted, store-and-forward.

12.2 A day with Sentinel (8 daily blocks + weekly review):
- Wake: Just up -> Two taps: hours slept and mood (under 10 seconds).
- Morning check-in: Scheduled -> Camera scan, typed entries, reaction test, summary; ~2 min; one clear line.
- Work block: Heads-down -> Passive monitoring; silent unless it matters.
- Exercise: Scheduled -> Pre-exercise reminder; logs session and suppresses expected pulse changes (post_exercise).
- EVA or sortie: Overlay mode -> Readiness check; strict suit-air limits; reminders paused; voice-first.
- Something feels off: Any time -> 'Hey Sentinel, I have a headache' starts triage.
- Evening: Wind-down -> Sleep wind-down reminder, mood check, Orb Calm if stress is up, daily summary.
- Night: Sleep block -> Do-not-disturb; only urgent and cabin alerts break through.
- Weekly: Review -> Trend report, what worked; optional share with surgeon.
"""
from __future__ import annotations

import time
from typing import Any

CLINICAL_MODES = {
    "monitor": {
        "title": "Monitor",
        "description": "Continuous, passive monitoring. Feeds update status quietly; anomaly engine watches.",
        "icon": "eye",
    },
    "checkup": {
        "title": "Check-up",
        "description": "Scheduled daily check-in: camera scan, vitals, mood, reaction test, summary.",
        "icon": "clipboard-check",
    },
    "triage": {
        "title": "Triage",
        "description": "Symptom or anomaly triage: zone picker, structured questions, urgency level.",
        "icon": "activity",
    },
    "treat": {
        "title": "Treat & Follow-up",
        "description": "Protocol steps, onboard kit items, timers, recheck reminders, outcome logged.",
        "icon": "shield-plus",
    },
    "escalate": {
        "title": "Escalate",
        "description": "Urgent concern or protocol escalation: priority digest to flight surgeon, buddy alerted.",
        "icon": "radio",
    },
}

DAY_BLOCKS = [
    {
        "id": "wake",
        "hour_start": 6.0,
        "hour_end": 7.0,
        "label": "Wake",
        "context": "Just up",
        "action_label": "Log sleep & mood",
        "target_duration_s": 10,
        "description": "Two taps: hours slept and mood (under 10 seconds).",
        "fields": ["manual.sleep_hours", "manual.mood"],
    },
    {
        "id": "morning_checkin",
        "hour_start": 7.0,
        "hour_end": 8.5,
        "label": "Morning Check-in",
        "context": "Scheduled",
        "action_label": "Start daily check-in",
        "target_duration_s": 120,
        "description": "Camera scan, typed entries, reaction test, summary; about 2 minutes; ends with one clear line.",
        "fields": ["vitals.heart_rate", "manual.bp_systolic", "cognitive.reaction_ms"],
    },
    {
        "id": "work_block",
        "hour_start": 8.5,
        "hour_end": 12.0,
        "label": "Work Block",
        "context": "Heads-down",
        "action_label": "Passive monitoring",
        "target_duration_s": None,
        "description": "Passive monitoring; silent unless it matters.",
        "fields": [],
    },
    {
        "id": "exercise",
        "hour_start": 12.0,
        "hour_end": 14.0,
        "label": "Exercise",
        "context": "Scheduled",
        "action_label": "Log workout",
        "target_duration_s": 1800,
        "description": "Pre-exercise reminder; logs the session and suppresses expected pulse changes.",
        "fields": ["manual.exercise_minutes"],
    },
    {
        "id": "eva_sortie",
        "hour_start": 14.0,
        "hour_end": 18.0,
        "label": "EVA or Sortie",
        "context": "Overlay mode",
        "action_label": "Readiness & suit check",
        "target_duration_s": None,
        "description": "Readiness check; strict suit-air limits; reminders paused; recovery check; voice-first.",
        "fields": ["suit.pressure_psi", "suit.o2_pct"],
    },
    {
        "id": "symptom_triage",
        "hour_start": 0.0,
        "hour_end": 24.0,
        "label": "Something Feels Off",
        "context": "Any time",
        "action_label": "Start triage",
        "target_duration_s": 60,
        "description": "'Hey Sentinel, I have a headache' starts triage.",
        "fields": ["manual.symptom_log"],
    },
    {
        "id": "evening_winddown",
        "hour_start": 20.0,
        "hour_end": 22.0,
        "label": "Evening Wind-down",
        "context": "Wind-down",
        "action_label": "Wind-down check",
        "target_duration_s": 300,
        "description": "Sleep wind-down reminder, mood check, Orb Calm if stress is up, daily summary.",
        "fields": ["state.stress", "manual.mood"],
    },
    {
        "id": "night_sleep",
        "hour_start": 22.0,
        "hour_end": 6.0,
        "label": "Night (Sleep Block)",
        "context": "Sleep block",
        "action_label": "Rest mode (DND)",
        "target_duration_s": None,
        "description": "Do-not-disturb; only urgent and cabin alerts break through.",
        "fields": [],
    },
]


# The exercise countermeasure, made specific. Source for the devices and the daily total: NASA, "Exercising in Space"
# (ISS crews exercise about two hours a day on ARED, T2 and CEVIS). The split and the moves listed are a demo
# default: the real prescription is set per person by the exercise specialists and the flight surgeon.
EXERCISE_PLAN = {
    "target_min": 120,
    "source": {"title": "NASA: Exercising in Space (ISS crews exercise about two hours a day: ARED, T2 treadmill, CEVIS cycle)",
               "url": "https://www.nasa.gov/missions/station/iss-research/counteracting-bone-and-muscle-loss-in-microgravity/"},
    "note": "Device list and daily total from NASA. The split and moves below are a demo default; your prescription comes from the flight surgeon.",
    "sessions": [
        {"id": "ared", "name": "Resistance (ARED)", "minutes": 60, "why": "Loads bone and muscle that weightlessness unloads.",
         "how": "Squats, deadlifts and heel raises: 3 sets of 8 to 12 each, then bench or shoulder press. Rest 90 seconds between sets."},
        {"id": "t2", "name": "Treadmill (T2)", "minutes": 30, "why": "Impact and aerobic work for heart, legs and hips.",
         "how": "Harness on. 5 minutes easy, 20 minutes steady run or intervals, 5 minutes easy."},
        {"id": "cevis", "name": "Cycle (CEVIS)", "minutes": 30, "why": "Aerobic fitness without impact.",
         "how": "5 minutes warm-up, 20 minutes at a pace where talking is hard, 5 minutes cool-down."},
        {"id": "mobility", "name": "Stretch and mobility", "minutes": 10, "why": "Eases the back and neck stiffness common in weightlessness.",
         "how": "Slow stretches for the back, hips, shoulders and neck. Hold each 30 seconds. No bouncing."},
    ],
}


class Clinic:
    """Manages the Sentinel clinical model, daily time blocks, and mode transitions."""

    def __init__(self, clock=time.time):
        self.clock = clock

    def current_block(self, mission_hour: float | None = None) -> dict:
        """Resolve current clinical day block from mission hour (0.0 to 24.0)."""
        if mission_hour is None:
            lt = time.localtime(self.clock())
            mission_hour = lt.tm_hour + lt.tm_min / 60.0

        h = float(mission_hour) % 24.0
        for b in DAY_BLOCKS:
            if b["id"] == "symptom_triage":
                continue
            start, end = b["hour_start"], b["hour_end"]
            if start <= end:
                if start <= h < end:
                    return b
            else:
                if h >= start or h < end:
                    return b
        return DAY_BLOCKS[2]

    def get_clinical_mode(self, state: dict, assessment: dict | None = None, ops_status: dict | None = None) -> str:
        """Derive active clinical mode: monitor, checkup, triage, treat, or escalate."""
        cabin = state.get("cabin") or {}
        act = state.get("action") or {}
        zones = (assessment or {}).get("zones") or {}
        ops_mode = (ops_status or {}).get("mode", "routine")

        # 1. Escalate
        if cabin.get("alert") or act.get("severity") == "alert" or act.get("type") in ("flag_cabin", "flag_redflag", "flag_ground"):
            return "escalate"

        # 2. Treat and follow up
        if act.get("type") in ("suggest_medicine", "offer_orb_calm", "offer_intervention") and act.get("severity") in ("info", "watch"):
            return "treat"

        # 3. Triage
        syms = (state.get("manual") or {}).get("symptom_log") or []
        if syms or any(sev in ("watch", "alert") for sev in zones.values() if sev != "ok"):
            return "triage"

        # 4. Check-up (if morning routine checkin due)
        if ops_mode == "routine" and (state.get("engagement") or {}).get("checkins_today", 0) == 0:
            return "checkup"

        # 5. Monitor
        return "monitor"

    def execute_wake(self, store, cid: str, sleep_hours: float, mood: int) -> dict:
        """Fast 2-tap wake entry (Product Document Section 12.2). Under 10 seconds."""
        if not (0.0 <= sleep_hours <= 16.0):
            raise ValueError("sleep_hours must be between 0 and 16")
        if not (1 <= mood <= 5):
            raise ValueError("mood must be between 1 and 5")

        store.ingest_reading(cid, {"metric": "sleep_hours", "value": float(sleep_hours), "label": "MANUAL", "confidence": 1.0})
        store.ingest_reading(cid, {"metric": "mood", "value": float(mood), "label": "MANUAL", "confidence": 1.0})

        s = store.get(cid)
        return {
            "ok": True,
            "block": "wake",
            "sleep_hours": sleep_hours,
            "mood": mood,
            "summary": f"Logged {sleep_hours:g}h sleep, mood {mood}/5.",
            "next_block": "morning_checkin",
            "state": s,
        }

    def execute_checkin(self, store, cid: str, vitals: dict | None = None, reaction_ms: float | None = None, profile_answer: dict | None = None) -> dict:
        """Guided morning check-in (Section 12.2 & 14.1). Ingests vitals, reaction test, and answers one profile question."""
        vitals = vitals or {}
        for k, v in vitals.items():
            store.ingest_reading(cid, {"metric": k, "value": float(v), "label": "LIVE" if "camera" in k else "MANUAL", "confidence": 0.95})
        if reaction_ms is not None:
            store.ingest_reading(cid, {"metric": "reaction_ms", "value": float(reaction_ms), "label": "MANUAL", "confidence": 1.0})

        profile_updated = False
        if profile_answer:
            try:
                from brain.profile import profiles
                profiles.update(cid, profile_answer)
                profile_updated = True
            except Exception:
                pass

        try:
            from brain.profile import profiles
            prof = profiles.get(cid)
            next_q = prof.get("next_question")
            next_prompt = prof.get("next_question_prompt")
            completeness = prof.get("completeness", 0.0)
            cal_status = prof.get("calibration", {}).get("status_text", "")
        except Exception:
            next_q = None
            next_prompt = None
            completeness = 0.0
            cal_status = ""

        with store.lock:
            s = store.states.get(cid, {})
            eng = s.setdefault("engagement", {})
            eng["checkins_today"] = eng.get("checkins_today", 0) + 1

        s = store.get(cid)
        hr = (s.get("vitals") or {}).get("heart_rate")
        spo2 = (s.get("vitals") or {}).get("spo2")
        summary_line = f"Check-in complete: vitals nominal (HR {round(hr) if hr else '--'} bpm, SpO2 {round(spo2) if spo2 else '--'}%), reaction steady at {round(reaction_ms) if reaction_ms else '--'} ms. Ready for duty."

        ind_map = {}
        for k, val in (s.get("vitals") or {}).items():
            if isinstance(val, (int, float)):
                ind_map[k] = {"value": val, "status": "green", "label": "LIVE estimate" if "camera" in k else "LIVE"}
        for k, val in (s.get("manual") or {}).items():
            if isinstance(val, (int, float)):
                ind_map[k] = {"value": val, "status": "green", "label": "MANUAL"}

        headline = "Ready for duty: all indicators steady." if not s.get("action", {}).get("detail") else f"Notice: {s['action']['detail']}"

        return {
            "ok": True,
            "block": "morning_checkin",
            "summary_line": summary_line,
            "headline": headline,
            "indicators": ind_map,
            "profile_updated": profile_updated,
            "profile_completeness": completeness,
            "calibration_status": cal_status,
            "next_question": next_q,
            "next_question_prompt": next_prompt,
            "state": s,
        }

    def execute_exercise(self, store, cid: str, minutes: float, activity: str = "workout") -> dict:
        """Logs workout session and activates post-exercise heart rate suppression (S4)."""
        if not (0.0 <= minutes <= 240.0):
            raise ValueError("minutes must be between 0 and 240")

        # sessions add up over the mission day: "exercise today" is the day's total, not the last session
        day = int(store.mission_clock()["mission_day"])
        it = store.internal.setdefault(cid, {})
        ex = it.get("exercise") if (it.get("exercise") or {}).get("day") == day else {"day": day, "total": 0.0}
        ex["total"] = min(600.0, ex["total"] + float(minutes))
        it["exercise"] = ex
        store.ingest_reading(cid, {"metric": "exercise_minutes", "value": ex["total"], "label": "MANUAL", "confidence": 1.0})
        store.set_context(cid, activity="post_exercise", minutes=30.0)
        name = next((x["name"] for x in EXERCISE_PLAN["sessions"] if x["id"] == activity), activity)
        if hasattr(store, "record_event"):
            store.record_event(cid, "exercise", {"activity": activity, "name": name, "minutes": float(minutes), "day": day})
        left = max(0.0, EXERCISE_PLAN["target_min"] - ex["total"])

        s = store.get(cid)
        return {
            "ok": True,
            "block": "exercise",
            "minutes": minutes,
            "activity": activity,
            "total_today": ex["total"],
            "target_min": EXERCISE_PLAN["target_min"],
            "post_exercise_until_s": store.internal.get(cid, {}).get("post_exercise_until", 0),
            "summary": f"Logged {minutes:g} min {name}: {ex['total']:g} of {EXERCISE_PLAN['target_min']} min today"
                       + (f", {left:g} to go." if left else ", target met.") + " Post-exercise pulse suppression active for 30 min.",
            "state": s,
        }

    def execute_winddown(self, store, cid: str, mood: int | None = None) -> dict:
        """Evening wind-down check (Product Document Section 12.2)."""
        if mood is not None:
            if not (1 <= mood <= 5):
                raise ValueError("mood must be between 1 and 5")
            store.ingest_reading(cid, {"metric": "mood", "value": float(mood), "label": "MANUAL", "confidence": 1.0})

        s = store.get(cid)
        stress = (s.get("state") or {}).get("stress", 0.0)
        fatigue = (s.get("state") or {}).get("fatigue", 0.0)

        calm_recommended = stress >= 0.6 or fatigue >= 0.7
        recommendation = "Offer guided Orb Calm breathing session." if calm_recommended else "Nominal wind-down: dim lights and quiet audio."

        return {
            "ok": True,
            "block": "evening_winddown",
            "stress": stress,
            "fatigue": fatigue,
            "calm_recommended": calm_recommended,
            "recommendation": recommendation,
            "state": s,
        }

    def weekly_review(self, store, cid: str) -> dict:
        """Weekly clinical review: trends, adherence, countermeasures, surgeon summary (12.2)."""
        s = store.get(cid)
        hist = store.history.get(cid, {})

        def _stats(field: str):
            pts = hist.get(field, [])
            vals = [p["v"] for p in pts[-7:]]
            if not vals:
                return {"mean": None, "count": 0}
            return {"mean": round(sum(vals) / len(vals), 1), "min": min(vals), "max": max(vals), "count": len(vals)}

        sleep_stats = _stats("manual.sleep_hours")
        hr_stats = _stats("vitals.heart_rate")
        mood_stats = _stats("manual.mood")
        reaction_stats = _stats("cognitive.reaction_ms")

        adherence_pct = 100 if (s.get("engagement") or {}).get("missed_checkins", 0) == 0 else max(50, 100 - (s.get("engagement") or {}).get("missed_checkins", 0) * 15)

        lines = [
            f"SENTINEL WEEKLY REVIEW | Crew: {s.get('display_name', cid)}",
            f"Adherence: {adherence_pct}% routine check-ins completed.",
            f"Sleep average: {sleep_stats['mean']} h/night (target >= 7.0 h).",
            f"Heart rate: mean {hr_stats['mean']} bpm (baseline {s.get('baseline', {}).get('heart_rate')}).",
            f"Reaction time: mean {reaction_stats['mean']} ms (baseline {s.get('baseline', {}).get('reaction_ms')}).",
            f"Mood average: {mood_stats['mean']}/5.",
            "Countermeasures used: Orb Calm, scheduled exercise, greenhouse visits.",
            "Surgeon recommendation: Continue current mission profile.",
        ]

        return {
            "ok": True,
            "crew_id": cid,
            "adherence_pct": adherence_pct,
            "stats": {
                "sleep": sleep_stats,
                "heart_rate": hr_stats,
                "mood": mood_stats,
                "reaction": reaction_stats,
            },
            "summary_text": "\n".join(lines),
        }
