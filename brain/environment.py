"""Environments (Product Document section 13): where the crew is, chosen by voice or picker, always confirmed.

- match(text): "we're in the transit cabin" -> transit; "on the moon base" -> base; "somewhere cold" -> a question
  listing the options (S12). No answer means no change; the page asks to confirm before anything switches (S11).
- changes(old, new): the banner of what a switch changes (S9): link, escalation, what is watched harder, settling in.
- card_note(env, situation): "same problem, different plan" (13.3): who to tell, how fast, whether a return exists.
- SETTLING_DAYS: after a switch, small personal-baseline changes read as "adjusting" (S16); ranges, cabin air,
  radiation and red-flag symptoms still alert.
"""
from __future__ import annotations

import re

ENVS = {
    "station": {"label": "space station", "profile": "iss", "link": "live",
                "watch": "heart and circulation, exercise, eyes, sleep", "escalation": "escalate early; ground can advise"},
    "transit": {"label": "deep-space transit", "profile": "mars_transit", "link": "about 12.7 min delay",
                "watch": "behaviour, sleep, teamwork, nutrition, cabin air", "escalation": "on board first; priority digest for level 2 and up"},
    "base": {"label": "planetary base", "profile": "mars_surface", "link": "delay depends on the world",
             "watch": "partial-gravity effects, injury, EVA, behaviour", "escalation": "as transit, plus EVA protocols"},
}
PROFILE_ENV = {"iss": "station", "mars_transit": "transit", "lunar": "base", "mars_surface": "base"}
SETTLING_DAYS = 3

PHRASES = [
    (r"\b(space station|the station|on station|in orbit|orbiting|iss)\b", "station"),
    (r"\b(spacecraft|space cabin|transit|in transit|transit cabin|on the way to mars|between worlds|cruise)\b", "transit"),
    (r"\b(moon base|lunar base|mars base|surface habitat|on the base|the habitat|on the moon|on mars|landed)\b", "base"),
]
WHERE = re.compile(r"\b(we re|we are|were now|i m|i am|we have|we ve|now) (now )?(in|on|at|aboard|arrived|landed|moved|somewhere)\b|\bswitch(ing)? (to|environment)\b|\benvironment\b")


def _norm(t: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9 ]+", " ", str(t or "").lower().replace("'", " ").replace("’", " "))).strip()


def match(text: str) -> dict | None:
    """{"env": id, "label"} for a clear place; {"ask": [...]} for a place Sentinel cannot map; None if not about place."""
    t = _norm(text)
    for pat, env in PHRASES:
        if re.search(pat, t) and (WHERE.search(t) or re.search(r"\b(switch|change|set)\b", t)):
            base = "lunar" if re.search(r"\b(moon|lunar)\b", t) else "mars_surface"
            return {"env": env, "label": ENVS[env]["label"], "profile": base if env == "base" else ENVS[env]["profile"]}
    if WHERE.search(t) and re.search(r"\b(somewhere|place|area|module|cold|hot|dark|new)\b", t):
        return {"ask": [e["label"] for e in ENVS.values()], "question": "Which applies: space station, deep-space transit, or a planetary base?"}
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
    },
    "air": {
        "station": "Follow the mission emergency procedure and tell ground.",
        "transit": "Say which compartment; more is done on board, so expect a delayed reply.",
        "base": "Also check the airlock and suit stores.",
    },
}


def card_note(profile: str, situation: str) -> str:
    return NOTES.get(situation, {}).get(PROFILE_ENV.get(profile, "station"), "")
