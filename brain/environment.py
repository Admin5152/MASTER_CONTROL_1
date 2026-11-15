"""Environments (Product Document section 13): where the crew is, chosen by voice or picker, always confirmed.

- match(text): "we're in the transit cabin" -> transit; "on the moon base" -> base; "somewhere cold" -> a question
  listing the options (S12). No answer means no change; the page asks to confirm before anything switches (S11).
- changes(old, new): the banner of what a switch changes (S9): link, escalation, what is watched harder, settling in.
- card_note(env, situation): "same problem, different plan" (13.3): who to tell, how fast, whether a return exists.
- SETTLING_DAYS: after a switch, small personal-baseline changes read as "adjusting" (S16); ranges, cabin air,
  radiation and red-flag symptoms still alert.
"""
from __future__ import annotations

import json
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parent.parent

ENVS = {
    "station": {
        "label": "space station",
        "profile": "iss",
        "link": "live",
        "in_plain_words": "Orbiting station with regular contact",
        "watch": "heart and circulation, exercise, eyes, sleep",
        "help_and_how_fast": "Ground reachable most of the time; a return vehicle is docked",
        "escalation": "escalate early; ground can advise",
        "wait_tolerance_min": 15.0,
        "return_option": "docked_vehicle",
    },
    "transit": {
        "label": "deep-space transit",
        "profile": "mars_transit",
        "link": "about 12.7 min delay",
        "in_plain_words": "Spacecraft cabin between worlds",
        "watch": "behaviour, sleep, teamwork, nutrition, cabin air",
        "help_and_how_fast": "Delayed reply; no quick return",
        "escalation": "on board first; priority digest for level 2 and up",
        "wait_tolerance_min": 180.0,
        "return_option": "none",
    },
    "base": {
        "label": "planetary base",
        "profile": "mars_surface",
        "link": "delay depends on the world",
        "in_plain_words": "Surface habitat on the Moon or Mars",
        "watch": "partial-gravity effects, injury, EVA, behaviour",
        "help_and_how_fast": "Delay depends on the world; limited return",
        "escalation": "as transit, plus EVA protocols",
        "wait_tolerance_min": 180.0,
        "return_option": "limited",
    },
    "critical": {
        "label": "launch, landing, docking",
        "profile": "critical",
        "link": "mission control live",
        "in_plain_words": "Short critical phases",
        "watch": "motion, stress, rapid checks",
        "help_and_how_fast": "Mission procedures lead",
        "escalation": "mission procedures lead (DESIGNED only)",
        "wait_tolerance_min": 0.0,
        "return_option": "abort_mode",
    },
}

MODES_SPEC = {
    "routine": {
        "id": "routine",
        "label": "Routine",
        "changes": "Normal ranges, full reminders",
        "reminders_paused": False,
        "urgent_only": False,
    },
    "eva": {
        "id": "eva",
        "label": "EVA or sortie",
        "changes": "Strict suit-air limits; routine reminders paused; readiness and recovery checks; short protocols; abort advice",
        "reminders_paused": True,
        "urgent_only": False,
    },
    "rest": {
        "id": "rest",
        "label": "Rest",
        "changes": "Quiet hours; only urgent and cabin alerts break through; sleep tracking",
        "reminders_paused": True,
        "urgent_only": True,
    },
    "contingency": {
        "id": "contingency",
        "label": "Contingency",
        "changes": "Emergency or drill: minimal screen, mission emergency procedures first, crew alerted, priority digest",
        "reminders_paused": True,
        "urgent_only": True,
    },
}

PROFILE_ENV = {"iss": "station", "mars_transit": "transit", "lunar": "base", "mars_surface": "base", "critical": "critical"}
SETTLING_DAYS = 3


def wait_tolerance_min(profile: str) -> float:
    """Return how long a problem can safely wait for ground help (Section 13.2).
    - Station (iss): 15 min (ground reachable, docked vehicle)
    - Transit (mars_transit): 180 min (delayed round-trip, autonomous care)
    - Lunar base (lunar): 60 min
    - Mars base (mars_surface): 180 min
    - Critical (launch/docking): 0 min
    """
    if profile == "iss":
        return 15.0
    elif profile == "lunar":
        return 60.0
    elif profile in ("mars_transit", "mars_surface"):
        return 180.0
    elif profile in ("critical", "launch"):
        return 0.0
    return 180.0


def profile_config(env_or_profile_id: str) -> dict:
    """Return full Section 13.4 environment profile JSON configuration, loaded from shared/environments/."""
    env = PROFILE_ENV.get(env_or_profile_id, env_or_profile_id if env_or_profile_id in ENVS else "transit")
    cfg_file = ROOT / "shared" / "environments" / f"{env}.json"
    if cfg_file.exists():
        try:
            return json.loads(cfg_file.read_text(encoding="utf-8"))
        except Exception:
            pass
    meta = ENVS.get(env, ENVS["transit"])
    one_way_s = 0.3 if env == "station" else 762.0 if env == "transit" else 1.3
    return {
        "id": env,
        "label": meta["label"].capitalize(),
        "in_plain_words": meta.get("in_plain_words", ""),
        "comms": {
            "mode": "live" if env == "station" else "delayed",
            "one_way_delay_s": one_way_s,
        },
        "return_option": meta.get("return_option", "none"),
        "resupply": "frequent" if env == "station" else "none",
        "kit_id": f"kit_{env}_v1",
        "indicator_weights": {
            "sleep_hours": 1.0,
            "mood": 1.2 if env == "transit" else 1.0,
            "heart_rate": 1.0,
        },
        "threshold_overrides": {},
        "escalation_policy": {
            "act": "escalate_to_ground" if env == "station" else "queue_digest",
            "urgent": "send_now_and_alert_commander",
            "wait_tolerance_min": meta.get("wait_tolerance_min", 180.0),
            "default_escalation": meta.get("escalation", ""),
        },
        "watches_harder": meta.get("watch", ""),
        "schedule_template": f"{env}_day_v1",
        "hazard_focus": ["microgravity", "radiation"] if env == "station" else ["isolation_confinement", "distance", "radiation"],
    }

PHRASES = [
    (r"\b(space station|the station|on station|in orbit|orbiting|iss)\b", "station"),
    (r"\b(spacecraft|space cabin|transit|in transit|transit cabin|on the way to mars|between worlds|cruise)\b", "transit"),
    (r"\b(moon base|lunar base|mars base|surface habitat|on the base|the habitat|on the moon|on mars|landed)\b", "base"),
]
MODE_PHRASES = [
    (r"\b(going outside|eva|spacewalk|space walk|taking the rover out|rover sortie|sortie)\b", "eva", "EVA or sortie"),
    (r"\b(going to sleep|rest time|sleep time|bedtime|rest mode|sleep mode|time for bed)\b", "rest", "rest"),
]
WHERE = re.compile(r"\b(we re|we are|were now|i m|i am|we have|we ve|now) (now )?(in|on|at|aboard|arrived|landed|moved|somewhere)\b|\bswitch(ing)? (to|environment|mode)\b|\benvironment\b|\bmode\b")


def _norm(t: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9 ]+", " ", str(t or "").lower().replace("'", " ").replace("’", " "))).strip()


def match(text: str) -> dict | None:
    """{"env": id, "label"} for environment; {"mode": id, "label"} for operational mode;
    {"ask": [...]} for ambiguous phrases; None if not about location or mode.
    Follows Product Document Section 13.1.
    """
    t = _norm(text)
    if not t:
        return None

    # 1. Mode phrases: "going outside", "EVA", "spacewalk", "taking the rover out", "going to sleep", "rest time"
    for pat, mode, label in MODE_PHRASES:
        if re.search(pat, t):
            action_desc = "Suit-air limits active, routine reminders paused." if mode == "eva" else "Quiet hours, only urgent and cabin alerts break through."
            return {
                "type": "mode",
                "mode": mode,
                "label": label,
                "confirmation": f"Switching to {label} mode: {action_desc} Confirm?",
            }

    # 2. Environment phrases: station, transit, planetary base
    for pat, env in PHRASES:
        if re.search(pat, t):
            base = "lunar" if re.search(r"\b(moon|lunar)\b", t) else "mars_surface"
            lbl = ENVS[env]["label"]
            return {
                "type": "env",
                "env": env,
                "label": lbl,
                "profile": base if env == "base" else ENVS[env]["profile"],
                "confirmation": f"Switching to {lbl}. Ranges, kit, reminders and what I advise will update. Confirm?",
            }

    # 3. Ambiguous location or mode query
    if WHERE.search(t) or re.search(r"\b(where are we|what environment|what mode|somewhere|place|area|module|cold|hot|dark|new)\b", t):
        return {
            "ask": ["space station", "deep-space transit", "planetary base", "EVA or sortie", "rest mode"],
            "question": "Which applies: space station, deep-space transit, planetary base, EVA or sortie, or rest mode?",
        }
    return None


def changes(old_profile: str, new_profile: str) -> list[str]:
    o, n = ENVS[PROFILE_ENV.get(old_profile, "station")], ENVS[PROFILE_ENV.get(new_profile, "station")]
    out = []
    if o["link"] != n["link"]:
        out.append(f"Link to ground: {o['link']} → {n['link']}")
    if o["escalation"] != n["escalation"]:
        out.append(f"Escalation: {n['escalation']}")
    out.append(f"Watching harder: {n['watch']}")
    out.append(f"Settling in for {SETTLING_DAYS} days: small changes from your usual show as adjusting; air and safety limits still alert")
    return out


NOTES = {
    "severe": {
        "station": "Alert a crewmate and contact ground now; a return vehicle is docked and ground decides.",
        "transit": "Alert a crewmate and the commander, run the onboard protocol, priority digest; no quick return, so treat in place and expect a delayed reply.",
        "base": "As in transit: alert the crew, onboard protocol, priority digest; move to the medical area if it is safe.",
        "eva": "Stop work, call the crew, start the return to airlock or base per EVA procedure; treat after return.",
    },
    "air": {
        "station": "Follow the mission emergency procedure and tell ground.",
        "transit": "Say which compartment; more is done on board, so expect a delayed reply.",
        "base": "Also check the airlock and suit stores.",
        "eva": "Read suit values first; strict limits; abort advice read out.",
    },
    "sleep": {
        "station": "Wind-down reminders; raise at next ground contact.",
        "transit": "Light and schedule suggestions; closer tracking; weekly digest.",
        "base": "As transit, with day-length and workload context.",
        "eva": "Fatigue check before EVA; flag to the commander before risky tasks.",
    },
    "mood": {
        "station": "Calm tools, talk to a crewmate; ground psychological support can be scheduled.",
        "transit": "Calm tools, 'what helps me' plan, more frequent check-ins; digest if it persists.",
        "base": "As transit, plus connection nudges.",
        "eva": "Short pause and breathing, tell the crew lead, recheck after return.",
    },
}

SITUATIONS_PROTOCOL = {
    "severe": {
        "title": "Severe Symptom Protocol (Level 3)",
        "guidance": "Who to tell, how fast to escalate, whether a return is possible.",
        "variants": {
            "station": {
                "escalation": NOTES["severe"]["station"],
                "actions": ["Alert crewmate", "Immediate ground video link", "Docked return vehicle status check"],
                "return_option": "docked_vehicle",
            },
            "transit": {
                "escalation": NOTES["severe"]["transit"],
                "actions": ["Alert commander and crewmate", "Deploy onboard medical kit", "Dispatch priority ground digest", "Treat in place"],
                "return_option": "none",
            },
            "base": {
                "escalation": NOTES["severe"]["base"],
                "actions": ["Alert habitat medical officer", "Transfer to medical area", "Dispatch priority ground digest"],
                "return_option": "limited",
            },
            "eva": {
                "escalation": NOTES["severe"]["eva"],
                "actions": ["Terminate EVA", "Call partner & IV lead", "Begin airlock ingress", "Doff suit before treatment"],
                "abort_advised": True,
            },
        },
    },
    "air": {
        "title": "Cabin Atmosphere / Air Alarm Protocol",
        "guidance": "Emergency steps for hypoxic or hypercapnic air quality breaches.",
        "variants": {
            "station": {
                "escalation": NOTES["air"]["station"],
                "actions": ["Alarm and spoken steps", "Follow station emergency drill", "Ground notified automatically"],
            },
            "transit": {
                "escalation": NOTES["air"]["transit"],
                "actions": ["Identify breach compartment", "All crew don emergency masks", "Isolate compartment", "Self-reliant air scrubbing"],
            },
            "base": {
                "escalation": NOTES["air"]["base"],
                "actions": ["Identify breach module", "Check airlock and suit stores", "Inspect ECLSS life-support scrubbers"],
            },
            "eva": {
                "escalation": NOTES["air"]["eva"],
                "actions": ["Read suit telemetry (o2_pct, pressure_psi)", "Purge O2 if contamination suspected", "Ingress airlock immediately"],
                "abort_advised": True,
            },
        },
    },
    "sleep": {
        "title": "Poor-Sleep Pattern Countermeasure Protocol",
        "guidance": "Mitigation for cumulative circadian desynchrony and sleep loss.",
        "variants": {
            "station": {
                "escalation": NOTES["sleep"]["station"],
                "actions": ["Wind-down reminders", "Review with surgeon at next pass"],
            },
            "transit": {
                "escalation": NOTES["sleep"]["transit"],
                "actions": ["Dynamic lighting shift", "Sound wind-down routine", "Include in weekly digest"],
            },
            "base": {
                "escalation": NOTES["sleep"]["base"],
                "actions": ["Surface day-night cycle adjustment", "Workload rescheduling"],
            },
            "eva": {
                "escalation": NOTES["sleep"]["eva"],
                "actions": ["Pre-EVA fatigue gate check", "Hold EVA if sleep < 6h"],
            },
        },
    },
    "mood": {
        "title": "Low Mood and Stress Countermeasure Protocol",
        "guidance": "Behavioral countermeasures tailored to isolation and communication delay.",
        "variants": {
            "station": {
                "escalation": NOTES["mood"]["station"],
                "actions": ["Paced breathing / Orb Calm", "Schedule private surgeon or psychological consult"],
            },
            "transit": {
                "escalation": NOTES["mood"]["transit"],
                "actions": ["Orb Calm biofeedback", "Top-3 tools from 'what helps me' plan", "Crew connection nudge", "Digest if persisting"],
            },
            "base": {
                "escalation": NOTES["mood"]["base"],
                "actions": ["Greenhouse visit", "Earth window break", "Crew cohesion check"],
            },
            "eva": {
                "escalation": NOTES["mood"]["eva"],
                "actions": ["Pause work for 2 minutes", "Paced breathing in suit", "Advise crew lead"],
            },
        },
    },
}


def card_note(profile: str, situation: str, mode: str = "routine") -> str:
    """Return situational procedural guidance for clinical cards (Section 13.3).
    When mode is 'eva', returns the Sortie (EVA) advice; otherwise maps to environment.
    """
    sit = NOTES.get(situation, {})
    if mode == "eva":
        return sit.get("eva", "")
    return sit.get(PROFILE_ENV.get(profile, "station"), "")


def get_protocol_variant(situation: str, profile_or_env: str = "transit", mode: str = "routine") -> dict:
    """Return complete protocol variant object for a situation (Section 13.3)."""
    proto = SITUATIONS_PROTOCOL.get(situation)
    if not proto:
        return {"error": f"unknown situation {situation}"}
    env = PROFILE_ENV.get(profile_or_env, profile_or_env if profile_or_env in ENVS else "transit")
    v_key = "eva" if mode == "eva" else env
    variant = proto["variants"].get(v_key, proto["variants"].get(env, {}))
    return {
        "situation": situation,
        "title": proto["title"],
        "guidance": proto["guidance"],
        "environment": env,
        "mode": mode,
        "variant": variant,
        "escalation_note": card_note(profile_or_env, situation, mode=mode),
    }
