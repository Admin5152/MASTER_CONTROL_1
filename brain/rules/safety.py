"""Urgent wellbeing concern (Product Document W14, FR-44): a fixed safety script, never generated text.

Trigger: the astronaut says they want to hurt themselves or others, or reports severe distress or panic. Then
Sentinel stays calm and brief, asks them to contact a crewmate or the commander now, alerts the buddy and the
commander, sends a priority message for the flight surgeon or psychologist, and keeps a grounding screen open. It
never argues, minimises or counsels, and the language model is never asked.

The phrase list is a DRAFT for the hackathon. Section 15.7: all wellbeing wording and the urgent-phrase list must be
reviewed by a qualified clinician or psychologist before real use.
"""
from __future__ import annotations

import re

# category -> patterns (lower-case, punctuation removed). Draft list: clinician review required before real use.
PATTERNS = {
    "self_harm": [
        r"\b(kill|hurt|harm|cut) (myself|my self)\b", r"\bend (my|it all|my life)\b", r"\b(want|wanna|going) to die\b",
        r"\bdon t want to (live|be alive|be here|wake up)\b", r"\bdo not want to (live|be alive|be here)\b",
        r"\bsuicid", r"\bbetter off dead\b", r"\bno reason to live\b", r"\btake my (own )?life\b", r"\bnot worth living\b",
    ],
    "harm_others": [
        r"\b(kill|hurt|harm|attack) (him|her|them|someone|somebody|my crewmate|the crew|everyone)\b",
        r"\bwant to hurt (people|someone|somebody)\b",
    ],
    "severe_distress": [
        r"\bpanic attack\b", r"\bi m panicking\b", r"\bi am panicking\b", r"\bi can t (cope|take it|go on|do this) any ?more\b",
        r"\bi can t go on\b", r"\b(having|have) a breakdown\b", r"\bi m losing it\b", r"\bi can t stop shaking\b",
    ],
}
_COMPILED = {k: [re.compile(p) for p in v] for k, v in PATTERNS.items()}

# the only words Sentinel says in this flow (section 15.4 row 3 and W14); fixed, short, calm
LINES = {
    "first": "I'm here. Please call a crewmate now. I'm letting them know.",
    "then": "You're not alone. {buddy} and the commander are being told, and a priority message is going to the flight surgeon. Stay with me; let's breathe together.",
}


def _norm(text: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9 ]+", " ", str(text or "").lower().replace("'", " ").replace("’", " "))).strip()


def concern(text: str) -> str | None:
    """The concern category in what was said, or None. Self-harm and harm to others outrank distress."""
    t = _norm(text)
    for cat in ("self_harm", "harm_others", "severe_distress"):
        if any(p.search(t) for p in _COMPILED[cat]):
            return cat
    return None


def people(crew: list[dict], cid: str) -> dict:
    """Who to bring in (SIM): the commander is the first crew member who is not this person; the buddy the next one."""
    others = [c for c in crew if c.get("crew_id") != cid]
    commander = others[0] if others else None
    buddy = others[1] if len(others) > 1 else commander
    return {"commander": commander.get("display_name") if commander else "the commander",
            "buddy": buddy.get("display_name") if buddy else "your crewmate"}
