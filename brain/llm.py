"""Spoken reply: LLM through any OpenAI-compatible endpoint, with a rules fallback.

The LLM only words the reply and may suggest screen commands. It never sets alerts
or `action`, and the backend validates every command it returns.
"""
from __future__ import annotations

import json
import os
import re
from typing import Any

import httpx

SCREENS = ["home", "vision", "health_log", "trends", "radiation", "cognitive", "orb_calm",
           "aurora_run", "greenhouse", "hardware", "crew"]
ZONES = ["head", "eyes", "heart", "lungs", "gut", "bones", "whole_body"]
METRICS = ["heart_rate", "breathing_rate", "spo2", "bp", "glucose", "temp", "sleep", "mood",
           "reaction", "talk_time", "pitch", "o2", "co2"]
MAX_COMMANDS = 3

SYSTEM_PROMPT = """You are Sentinel, the onboard crew-health companion on a long space mission.
You speak to one crew member. Your reply is read aloud.
Rules:
- Calm, concise, warm, never alarmist. At most two short sentences.
- Plain spoken English. No markdown, no lists, no emoji.
- Only cite numbers that appear in the STATE JSON. Never invent a number.
- Describe changes from the person's own baseline. Never diagnose; never say "you have" a condition.
  You may say something "may warrant a check with the flight surgeon".
- Any medicine mention must include "consult mission medical protocol before use".
- If action.type is not "none", say what Sentinel is doing about it (action.detail).
- You cannot raise alerts or change actions. You may navigate the screen.
Respond with JSON only: {"reply": "...", "commands": [...]}
Allowed commands (at most 3):
  {"cmd":"point_to","zone":ZONE}    ZONE in head, eyes, heart, lungs, gut, bones, whole_body
  {"cmd":"open_screen","name":NAME} NAME in home, vision, health_log, trends, radiation, cognitive, orb_calm, aurora_run, greenhouse, hardware, crew
  {"cmd":"show_chart","metric":M}   M in heart_rate, breathing_rate, spo2, bp, glucose, temp, sleep, mood, reaction, talk_time, pitch, o2, co2
  {"cmd":"start_scan"}
  {"cmd":"show_radiation","on":true|false}
  {"cmd":"close"}
"""


def validate_commands(cmds: Any) -> list[dict]:
    """Drop unknown commands, zones, screens and metrics; keep at most three."""
    out: list[dict] = []
    if not isinstance(cmds, list):
        return out
    for c in cmds:
        if not isinstance(c, dict):
            continue
        name = c.get("cmd")
        if name == "point_to" and c.get("zone") in ZONES:
            out.append({"cmd": "point_to", "zone": c["zone"]})
        elif name == "open_screen" and c.get("name") in SCREENS:
            out.append({"cmd": "open_screen", "name": c["name"]})
        elif name == "show_chart" and c.get("metric") in METRICS:
            out.append({"cmd": "show_chart", "metric": c["metric"]})
        elif name == "start_scan":
            out.append({"cmd": "start_scan"})
        elif name == "show_radiation":
            out.append({"cmd": "show_radiation", "on": bool(c.get("on", True))})
        elif name == "close":
            out.append({"cmd": "close"})
        if len(out) >= MAX_COMMANDS:
            break
    return out


def parse_llm_content(text: str) -> tuple[str, list[dict]]:
    """Parse the model's JSON. If it does not parse, the raw text is the reply."""
    raw = (text or "").strip()
    candidate = raw
    fence = re.search(r"\{.*\}", raw, re.S)
    if fence:
        candidate = fence.group(0)
    try:
        obj = json.loads(candidate)
        if not isinstance(obj, dict) or not isinstance(obj.get("reply"), str):
            raise ValueError
        return clean_reply(obj["reply"]), validate_commands(obj.get("commands", []))
    except (ValueError, TypeError):
        return clean_reply(raw), []


def clean_reply(text: str) -> str:
    text = re.sub(r"[*_#`>]+", "", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text


# ---------------- rules template bank ----------------

def _hr(state: dict) -> tuple[int | None, int | None]:
    hr = (state.get("vitals") or {}).get("heart_rate")
    base = (state.get("baseline") or {}).get("heart_rate")
    return (round(hr) if isinstance(hr, (int, float)) else None,
            round(base) if isinstance(base, (int, float)) else None)


def rules_reply(state: dict, transcript: str) -> tuple[str, list[dict]]:
    name = state.get("display_name", "")
    t = (transcript or "").lower()
    hr, base = _hr(state)
    action = state.get("action") or {}
    atype = action.get("type", "none")
    zone = action.get("zone", "")
    cabin = state.get("cabin") or {}
    rad = state.get("radiation") or {}
    cmds: list[dict] = []

    hr_line = ""
    if hr is not None and base:
        diff = hr - base
        if abs(diff) < 4:
            hr_line = f"Your heart rate is about {hr}, close to your usual {base}."
        elif diff > 0:
            hr_line = f"Your heart rate is about {hr}, {diff} above your usual {base}."
        else:
            hr_line = f"Your heart rate is about {hr}, {-diff} below your usual {base}."
    elif hr is not None:
        hr_line = f"Your heart rate is about {hr}."

    if "cabin" in t or "oxygen" in t or "air" in t:
        reply = f"Cabin oxygen is {cabin.get('oxygen_pct')} percent and carbon dioxide {cabin.get('co2_ppm')} ppm."
        if cabin.get("alert"):
            reply += " That is out of range and has been flagged to ground."
        return reply, cmds
    if "radiation" in t or "storm" in t or "dose" in t:
        reply = (f"Modelled dose so far is {round(rad.get('cumulative_msv', 0))} of {rad.get('career_limit_msv', 600)} millisieverts, "
                 f"and the storm level is S{rad.get('storm_level', 0)}.")
        return reply, [{"cmd": "open_screen", "name": "radiation"}]

    if atype == "none":
        reply = f"{hr_line} Everything else is within your usual range, {name}.".strip()
        return reply, cmds

    detail = action.get("detail", "")
    if zone in ZONES:
        cmds.append({"cmd": "point_to", "zone": zone})
    if atype == "offer_orb_calm":
        reply = f"{hr_line} Would you like a short Orb Calm breathing session?"
    elif atype == "offer_intervention":
        reply = f"{hr_line} {detail}"
    elif atype == "suggest_medicine":
        reply = f"{detail}"
        if "consult mission medical protocol" not in reply.lower():
            reply += " Consult mission medical protocol before use."
    elif atype == "gentle_checkin":
        reply = f"{hr_line} {(state.get('drift') or {}).get('note', '')} How are you feeling?"
    elif atype in ("flag_cabin", "flag_radiation", "flag_ground"):
        reply = f"{hr_line} {detail} This may warrant a check with the flight surgeon." if atype == "flag_ground" else f"{detail} {hr_line}"
    else:
        reply = hr_line or "I am here."
    return clean_reply(reply), validate_commands(cmds)


# ---------------- LLM call ----------------

def llm_config() -> dict:
    return {
        "base_url": os.getenv("LLM_BASE_URL", "https://api.groq.com/openai/v1").rstrip("/"),
        "model": os.getenv("LLM_MODEL", "llama-3.3-70b-versatile"),
        "key": os.getenv("LLM_API_KEY", "").strip(),
    }


def llm_available() -> bool:
    return bool(llm_config()["key"])


def call_llm(state: dict, transcript: str, timeout: float = 6.0, post=None) -> str:
    """Return the model's raw content. Raises on any failure (caller falls back)."""
    cfg = llm_config()
    if not cfg["key"]:
        raise RuntimeError("no key")
    body = {
        "model": cfg["model"],
        "temperature": 0.3,
        "max_tokens": 220,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": "STATE:\n" + json.dumps(state) + "\n\nCREW SAID:\n" + transcript},
        ],
    }
    headers = {"Authorization": f"Bearer {cfg['key']}"}
    if post is None:
        with httpx.Client(timeout=timeout) as c:
            r = c.post(f"{cfg['base_url']}/chat/completions", json=body, headers=headers)
    else:
        r = post(f"{cfg['base_url']}/chat/completions", body, headers)
    if r.status_code != 200:
        raise RuntimeError(f"http {r.status_code}")
    return r.json()["choices"][0]["message"]["content"]


def _state_numbers(obj: Any, out: set[str]) -> None:
    if isinstance(obj, dict):
        for v in obj.values():
            _state_numbers(v, out)
    elif isinstance(obj, list):
        for v in obj:
            _state_numbers(v, out)
    elif isinstance(obj, (int, float)) and not isinstance(obj, bool):
        f = float(obj)
        out.update({str(round(f)), f"{f:g}", f"{round(f, 1):g}", str(round(abs(f)))})


def numbers_ok(reply: str, state: dict, transcript: str = "") -> bool:
    """True if every number in the reply appears in the state (or the transcript)."""
    allowed: set[str] = set()
    _state_numbers(state, allowed)
    # differences between a reading and its baseline are allowed too
    v, b = state.get("vitals") or {}, state.get("baseline") or {}
    if isinstance(v.get("heart_rate"), (int, float)) and isinstance(b.get("heart_rate"), (int, float)):
        allowed.add(str(abs(round(v["heart_rate"]) - round(b["heart_rate"]))))
    for it in (state.get("drift") or {}).get("items", []):
        allowed.add(str(round(abs(it.get("delta_pct", 0)))))
    allowed.update(re.findall(r"\d+(?:\.\d+)?", transcript or ""))
    for n in re.findall(r"\d+(?:\.\d+)?", reply.replace(",", "")):
        if n in allowed or f"{float(n):g}" in allowed or float(n) <= 3:
            continue
        return False
    return True


def chat(state: dict, transcript: str, post=None) -> dict:
    try:
        content = call_llm(state, transcript, post=post)
        reply, cmds = parse_llm_content(content)
        if not reply:
            raise ValueError("empty reply")
        if not numbers_ok(reply, state, transcript):
            raise ValueError("reply cites a number that is not in the state")
        return {"reply": reply, "commands": cmds, "source": "llm"}
    except Exception:
        reply, cmds = rules_reply(state, transcript)
        return {"reply": reply, "commands": cmds, "source": "rules"}
