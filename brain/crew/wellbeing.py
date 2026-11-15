"""Mental Wellbeing Engine (Product Document Section 15, FR-40 to FR-50, S14, S15, S18, S19).

Four Dimensions (15.2):
- Mood: Self-rating, valence/arousal (camera model with opt-in toggle; fallback to self-report), mood tags.
- Energy: Sleep hours/quality, energy rating, cognitive reaction time vs baseline.
- Stress: Stress rating, resting pulse trend, arousal, stress-spike detection.
- Connection: Connection self-rating, talk-time share, time alone, missed check-ins.

No single wellbeing score: four dimensions are harder to misread and to game (15.2).

Wellbeing Levels (15.4):
- Level 0 (Steady): Near usual -> "You're steady."
- Level 1 (Check-in): 1 dim drifting -> "Your energy has been lower than usual. Want a short reset?" (offers 1 tool).
- Level 2 (Support plan): 2+ dims drifting -> "A few things have shifted this week. Here are three that have helped before." (top 3 tools).
- Level 3 (Urgent concern): Self-harm, harm to others, severe panic reported -> Safety script (W14, never from statistics alone).

Closed-Loop Learning (15.6, FR-45):
- Measures stress/mood before and after each intervention.
- Dynamically ranks tools per person based on empirical delta improvement, starting from profile "whatHelps".

Support Toolkit (15.5):
- 10 evidence-based activities (Orb Calm, Paced breathing, Grounding, Window to Earth, Sound, Journal, Wind-down, Connection nudge, Home messages, Greenhouse).

On-Device Private Journal (FR-47):
- Encrypted on device with authenticated AES, never leaves device.
"""
from __future__ import annotations

import copy
import json
import os
import threading
import time
from pathlib import Path

DATA = Path(__file__).resolve().parents[2] / "data"

# Section 15.5 Support Toolkit Catalogue
TOOLKIT = {
    "orb_calm": {
        "id": "orb_calm",
        "title": "Orb Calm (Stillpoint)",
        "mechanism": "HRV biofeedback with cyclic sighing (Balban 2023, Lehrer 2014); real-time pulse settling from red to blue.",
        "trigger": "Stress up, pulse elevated",
        "category": "breathing_biofeedback",
        "label": "LIVE",
        "default_duration_s": 180,
    },
    "paced_breathing": {
        "id": "paced_breathing",
        "title": "Paced Breathing",
        "mechanism": "Guided slow respiration ring at resonance frequency (5.5-6 breaths/min) exercising baroreflex (Zaccaro 2018).",
        "trigger": "Any stress or tension",
        "category": "breathing",
        "label": "LIVE",
        "default_duration_s": 120,
    },
    "grounding": {
        "id": "grounding",
        "title": "Grounding Exercise",
        "mechanism": "5-4-3-2-1 sensory orientation exercise reducing acute autonomic arousal and cognitive panic loops.",
        "trigger": "Anxiety, panic signs, acute distress",
        "category": "cognitive_reset",
        "label": "LIVE",
        "default_duration_s": 120,
    },
    "earth_window": {
        "id": "earth_window",
        "title": "Window to Earth",
        "mechanism": "Attention Restoration Theory (Kaplan 1995); natural Earth views with ambient soundscapes to relieve cognitive fatigue.",
        "trigger": "Low mood, homesickness, mental fatigue",
        "category": "sensory_restoration",
        "label": "LIVE",
        "default_duration_s": 300,
    },
    "sound_music": {
        "id": "sound_music",
        "title": "Sound and Music",
        "mechanism": "Auditory neuromodulation using pink noise, natural water sounds, and pre-selected calming acoustics.",
        "trigger": "Stress, pre-sleep rumination",
        "category": "auditory",
        "label": "LIVE",
        "default_duration_s": 600,
    },
    "private_journal": {
        "id": "private_journal",
        "title": "Private Reflective Journal",
        "mechanism": "Expressive writing facilitating emotional processing; strictly encrypted on device (FR-47).",
        "trigger": "Low mood, difficult shift, processing events",
        "category": "expressive_writing",
        "label": "LIVE",
        "default_duration_s": 300,
    },
    "sleep_winddown": {
        "id": "sleep_winddown",
        "title": "Sleep Wind-down",
        "mechanism": "Circadian light dimming and guided cognitive decrescendo easing sleep onset latency.",
        "trigger": "Poor sleep pattern, evening schedule",
        "category": "sleep_hygiene",
        "label": "LIVE",
        "default_duration_s": 420,
    },
    "connection_nudge": {
        "id": "connection_nudge",
        "title": "Crew Connection Nudge",
        "mechanism": "Mitigates NASA Inadequate Teamwork risk by prompting a low-friction social interaction or meal share.",
        "trigger": "Connection dropping, high isolation time",
        "category": "social",
        "label": "LIVE",
        "default_duration_s": 180,
    },
    "home_messages": {
        "id": "home_messages",
        "title": "Messages from Home",
        "mechanism": "Asynchronous voice and video recordings from family and friends to buffer long-duration mission isolation.",
        "trigger": "Low mood, milestone days, holiday solitude",
        "category": "social_support",
        "label": "DESIGNED",
        "default_duration_s": 300,
    },
    "greenhouse": {
        "id": "greenhouse",
        "title": "Plant & Garden Care (Red Harvest)",
        "mechanism": "NASA Veggie research (2025): hands-on plant tending reduces confinement stress and provides biophilic contact.",
        "trigger": "Monotony, sensory deprivation, isolation",
        "category": "biophilic",
        "label": "DESIGNED",
        "default_duration_s": 240,
    },
}

DEFAULT_TOOL_ORDER = ["orb_calm", "paced_breathing", "grounding", "earth_window", "greenhouse", "race", "sound_music", "private_journal"]

CLINICAL_SCALES = {
    "phq2": {
        "name": "PHQ-2 (Brief Depression Screener)",
        "items": [
            "Little interest or pleasure in doing things",
            "Feeling down, depressed, or hopeless",
        ],
        "scale": "0=Not at all, 1=Several days, 2=More than half the days, 3=Nearly every day",
        "cutoff": 3,
    },
    "gad2": {
        "name": "GAD-2 (Brief Anxiety Screener)",
        "items": [
            "Feeling nervous, anxious, or on edge",
            "Not being able to stop or control worrying",
        ],
        "scale": "0=Not at all, 1=Several days, 2=More than half the days, 3=Nearly every day",
        "cutoff": 3,
    },
    "nasa_weekly_reflection": {
        "name": "NASA Weekly Spaceflight Wellbeing Reflection",
        "items": [
            "How rested did you feel upon waking over the past 7 days?",
            "How manageable was your mission workload this week?",
            "How cohesive and supported did you feel within your crew team?",
        ],
        "scale": "1 (Very poor) to 5 (Excellent)",
    },
}


class WellbeingEngine:
    """Evaluates 4 dimensions, tracks closed-loop intervention efficacy, and manages private journal."""

    def __init__(self, persist: bool | None = None):
        self.persist = (os.getenv("SENTINEL_NO_PERSIST") != "1") if persist is None else persist
        self.lock = threading.Lock()
        self.sessions: dict[str, list[dict]] = {}
        self.journals: dict[str, list[dict]] = {}
        if self.persist:
            try:
                from brain.core.vault import read_json
                self.sessions = read_json(DATA / "wellbeing_sessions.json")
            except (OSError, ValueError):
                self.sessions = {}
            try:
                from brain.core.vault import read_json
                self.journals = read_json(DATA / "journal.json")
            except (OSError, ValueError):
                self.journals = {}

    def _save(self) -> None:
        if self.persist:
            from brain.core.vault import write_json
            write_json(DATA / "wellbeing_sessions.json", self.sessions)
            write_json(DATA / "journal.json", self.journals)

    # ---- 15.2 Four Dimensions Assessment ----
    def evaluate(self, cid: str, state: dict, drift: dict | None = None, profile: dict | None = None) -> dict:
        """Evaluates Mood, Energy, Stress, Connection without a single composite score (Section 15.2)."""
        drift = drift or {}
        profile = profile or {}
        wellbeing_plan = profile.get("wellbeingPlan") or {}
        camera_opt_in = wellbeing_plan.get("cameraMoodAnalysis", True)

        manual = state.get("manual") or {}
        st = state.get("state") or {}
        vitals = state.get("vitals") or {}
        cog = state.get("cognitive") or {}

        # 1. Mood Dimension
        mood_val = manual.get("mood")
        mood_tags = manual.get("mood_tags") or []
        valence = st.get("valence") if camera_opt_in else None
        arousal = st.get("arousal") if camera_opt_in else None

        mood_drift = False
        if isinstance(mood_val, (int, float)) and mood_val <= 2:
            mood_drift = True
        elif camera_opt_in and isinstance(valence, (int, float)) and valence <= -0.5:
            mood_drift = True
        elif any(t in ("anxious", "irritable", "lonely", "exhausted") for t in mood_tags):
            mood_drift = True

        mood_dim = {
            "status": "lower_than_usual" if mood_drift else "steady",
            "self_rating": mood_val,
            "tags": mood_tags,
            "camera_used": bool(camera_opt_in and valence is not None),
            "camera_opt_in": camera_opt_in,
            "drifting": mood_drift,
        }

        # 2. Energy Dimension
        sleep_h = manual.get("sleep_hours")
        sleep_q = manual.get("sleep_quality")
        fatigue = st.get("fatigue") or 0.0
        reaction_ms = cog.get("last_ms") or cog.get("reaction_ms")
        reaction_base = cog.get("baseline_ms")

        energy_drift = False
        if isinstance(sleep_h, (int, float)) and sleep_h < 6.0:
            energy_drift = True
        elif fatigue >= 0.6:
            energy_drift = True
        elif reaction_ms and reaction_base and reaction_ms > reaction_base * 1.2:
            energy_drift = True
        energy_self = manual.get("energy_self")
        if isinstance(energy_self, (int, float)) and energy_self <= 2:
            energy_drift = True

        readiness_note = "Readiness steady; rest nominal."
        if energy_drift:
            readiness_note = "Sleep debt or reaction lag noted; pace high-focus tasks."

        energy_dim = {
            "status": "lower_than_usual" if energy_drift else "steady",
            "sleep_hours": sleep_h,
            "sleep_quality": sleep_q,
            "self_rating": energy_self,
            "fatigue_index": round(fatigue, 2),
            "readiness_note": readiness_note,
            "drifting": energy_drift,
        }

        # 3. Stress Dimension
        stress_val = manual.get("stress") or st.get("stress") or 0.0
        hr = vitals.get("heart_rate")
        hr_base = (state.get("baseline") or {}).get("heart_rate")
        hr_jump = bool(hr and hr_base and (hr - hr_base) / hr_base * 100 >= 20.0)

        stress_drift = False
        if isinstance(stress_val, (int, float)) and stress_val >= 0.6:
            stress_drift = True
        elif hr_jump:
            stress_drift = True
        stress_self = manual.get("stress_self")
        if isinstance(stress_self, (int, float)) and stress_self >= 4:
            stress_drift = True

        stress_dim = {
            "status": "elevated" if stress_drift else "steady",
            "stress_index": round(stress_val, 2) if isinstance(stress_val, (int, float)) else None,
            "self_rating": stress_self,
            "stress_spike": bool(hr_jump or (isinstance(stress_val, (int, float)) and stress_val >= 0.8)),
            "drifting": stress_drift,
        }

        # 4. Connection Dimension
        talk_item = next((i for i in drift.get("items", []) if i.get("metric") == "voice.talk_time"), None)
        talk_delta = talk_item.get("delta_pct", 0) if talk_item else 0.0
        missed = (state.get("engagement") or {}).get("missed_checkins", 0)

        connection_drift = False
        if talk_delta <= -40.0:
            connection_drift = True
        elif missed >= 2:
            connection_drift = True
        connection_self = manual.get("connection_self")
        if isinstance(connection_self, (int, float)) and connection_self <= 2:
            connection_drift = True

        connection_prompt = "Notice: quieter than usual. Want to invite a crewmate for coffee?" if connection_drift else "Crew connection steady."

        connection_dim = {
            "status": "lower_than_usual" if connection_drift else "steady",
            "talk_time_delta_pct": round(talk_delta, 1),
            "missed_checkins": missed,
            "self_rating": connection_self,
            "prompt": connection_prompt,
            "drifting": connection_drift,
        }

        # 15.4 Wellbeing Levels
        dims_map = {
            "mood": 1 if mood_drift else 0,
            "energy": 1 if energy_drift else 0,
            "stress": 1 if stress_drift else 0,
            "connection": 1 if connection_drift else 0,
        }
        drifting_count = sum(dims_map.values())

        if drifting_count == 0:
            level = 0
            wording = "You're steady."
        elif drifting_count == 1:
            level = 1
            if energy_drift:
                wording = "Your energy has been lower than usual. Want a short reset?"
            elif stress_drift:
                wording = "Stress index is higher than usual. Want to take a quiet pause?"
            elif mood_drift:
                wording = "Your mood has been lower than usual today. Want to try a short reset?"
            else:
                wording = "You've been quieter than your usual. Want to reach out to a crewmate?"
        else:
            level = 2
            wording = "A few things have shifted this week. Here are three that have helped before."

        # Adaptive ranking: personal "what helps me" + empirical closed loop
        ranked = self.get_ranked_tools(cid, profile=profile)

        tools_to_offer = []
        if level == 1:
            tools_to_offer = ranked[:1]
        elif level >= 2:
            tools_to_offer = ranked[:3]

        # W12: Persistent drift checks
        drift_items = (drift or {}).get("items") or (state.get("drift", {}).get("items") or [])
        has_drift = any(item.get("severity") in ("watch", "alert") for item in drift_items) or drifting_count >= 2
        persistent_days = state.get("engagement", {}).get("drift_days", 0)
        persistent_drift = bool(has_drift and (persistent_days >= 3 or state.get("drift", {}).get("persistent")))
        psychologist_consult_offered = persistent_drift and level >= 2

        return {
            "crew_id": cid,
            "level": level,
            "wording": wording,
            "dims": dims_map,
            "details": {
                "mood": mood_dim,
                "energy": energy_dim,
                "stress": stress_dim,
                "connection": connection_dim,
            },
            "tools": tools_to_offer,
            "ranked_toolkit": ranked,
            "persistent_drift": persistent_drift,
            "psychologist_consult_offered": psychologist_consult_offered,
        }

    # ---- 15.6 Closed-Loop Learning (FR-45) ----
    def record_session(self, cid: str, tool_id: str, pre_stress: float, post_stress: float, pre_mood: float | None = None, post_mood: float | None = None) -> dict:
        """Records an intervention session before-and-after scores to personalize tool ranking (FR-45)."""
        delta_stress = float(pre_stress) - float(post_stress)   # positive means stress reduced
        delta_mood = (float(post_mood) - float(pre_mood)) if pre_mood is not None and post_mood is not None else 0.0

        session = {
            "session_id": f"sess_{int(time.time() * 1000)}",
            "tool_id": tool_id,
            "timestamp": time.time(),
            "pre_stress": float(pre_stress),
            "post_stress": float(post_stress),
            "delta_stress": round(delta_stress, 2),
            "pre_mood": float(pre_mood) if pre_mood is not None else None,
            "post_mood": float(post_mood) if post_mood is not None else None,
            "delta_mood": round(delta_mood, 2),
            "effective": delta_stress > 0 or delta_mood > 0,
        }

        with self.lock:
            self.sessions.setdefault(cid, []).append(session)
            self._save()

        return session

    def handle_stress_spike(self, cid: str, strength: int, chosen_tool: str = "orb_calm") -> dict:
        """W13 Stress spike: Ask strength (1 to 5), offer Orb Calm or breathing, recheck in minutes."""
        strength = max(1, min(5, int(strength)))
        tools = ["orb_calm", "paced_breathing", "grounding"]
        return {
            "crew_id": cid,
            "reported_strength": strength,
            "offered_tools": tools,
            "selected_tool": chosen_tool,
            "tool_details": TOOLKIT.get(chosen_tool, TOOLKIT["orb_calm"]),
            "recheck_in_minutes": 5 if strength <= 3 else 10,
            "action": "start_biofeedback_session",
        }

    def get_ranked_tools(self, cid: str, profile: dict | None = None) -> list[str]:
        """Ranks tools per person by what worked, starting from astronaut's 'what helps me' list (Section 15.6)."""
        profile = profile or {}
        user_helps = list((profile.get("wellbeingPlan") or {}).get("whatHelps") or [])

        with self.lock:
            history = list(self.sessions.get(cid, []))

        if not history:
            # Cold start: prioritize astronaut's preferred list, then default catalogue
            return list(dict.fromkeys(user_helps + DEFAULT_TOOL_ORDER))

        # Calculate empirical efficacy score per tool
        # Score = mean stress delta + (mean mood delta * 0.5)
        stats: dict[str, list[float]] = {}
        for s in history:
            tid = s.get("tool_id")
            if not tid:
                continue
            delta = s.get("delta_stress", 0.0) + (s.get("delta_mood", 0.0) * 0.5)
            stats.setdefault(tid, []).append(delta)

        avg_scores = {tid: sum(deltas) / len(deltas) for tid, deltas in stats.items()}

        # Sort tools: highest empirical delta first
        # Give tools on the user's "whatHelps" list a mild +0.25 prior boost
        def _score(tid: str) -> float:
            base = avg_scores.get(tid, 0.0)
            if tid in user_helps:
                base += 0.25
            return base

        available_tools = list(dict.fromkeys(list(avg_scores.keys()) + user_helps + DEFAULT_TOOL_ORDER))
        available_tools.sort(key=_score, reverse=True)
        return available_tools

    # ---- 15.7 Private On-Device Journal (FR-47) ----
    def add_journal_entry(self, cid: str, text: str, tags: list[str] | None = None, mood: int | None = None) -> dict:
        """Stores an encrypted private journal note on device (Section 15.5 & 15.7, FR-47)."""
        clean_text = str(text or "").strip()
        if not clean_text:
            raise ValueError("journal entry cannot be empty")

        entry = {
            "id": f"j_{int(time.time() * 1000)}",
            "timestamp": time.time(),
            "text": clean_text,
            "tags": [str(t).strip()[:30] for t in (tags or [])][:10],
            "mood": int(mood) if mood is not None and 1 <= int(mood) <= 5 else None,
            "device_only": True,
        }

        with self.lock:
            self.journals.setdefault(cid, []).append(entry)
            self._save()

        return entry

    def list_journal_entries(self, cid: str) -> list[dict]:
        """Lists on-device journal entries for astronaut."""
        with self.lock:
            return copy.deepcopy(self.journals.get(cid, []))

    def delete_journal_entry(self, cid: str, entry_id: str) -> bool:
        """Deletes an astronaut's private journal entry."""
        with self.lock:
            entries = self.journals.get(cid, [])
            filtered = [e for e in entries if e.get("id") != entry_id]
            if len(filtered) != len(entries):
                self.journals[cid] = filtered
                self._save()
                return True
        return False

    # ---- Team Cohesion Note (Section 15.7, Inadequate Teamwork risk) ----
    @staticmethod
    def evaluate_team_cohesion(crew_states: dict[str, dict]) -> dict:
        """Evaluates voice distribution across crew and produces a supportive cohesion note."""
        talk_times = {}
        for cid, s in crew_states.items():
            name = s.get("display_name", cid)
            tt = (s.get("voice") or {}).get("talk_time", 0.0)
            talk_times[name] = tt

        total = sum(talk_times.values())
        if total <= 0:
            return {
                "cohesion_status": "insufficient_data",
                "note": "Team communication monitoring active. Awaiting voice activity.",
                "distribution": {},
            }

        shares = {name: round(t / total * 100, 1) for name, t in talk_times.items()}
        # Identify if anyone has under 10% share in a team > 2
        quiet_members = [name for name, pct in shares.items() if pct < 12.0 and len(shares) >= 3]

        if quiet_members:
            note = f"Communication distribution is shifting. {', '.join(quiet_members)} had quieter participation today. Consider a casual team check-in."
            status = "imbalanced"
        else:
            note = "Team communication distribution is balanced across active members."
            status = "balanced"

        return {
            "cohesion_status": status,
            "note": note,
            "distribution": shares,
        }


wellbeing = WellbeingEngine()
