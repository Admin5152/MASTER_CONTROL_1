"""Spoken reply: LLM through any OpenAI-compatible endpoint, with a rules fallback.

Two kinds of question (brief section 4.3):
- health and mission questions are answered from the crew member's state only (numbers only from the
  state, change from baseline, never a diagnosis); a reply that cites a number not in the state is
  replaced by the rules reply;
- general questions ("how far is Mars?", "tell me a joke") are answered naturally and briefly.
With no key or no connection the rules bank answers health questions and says plainly that a general
question needs a connection. Never invents an answer.

The LLM only words the reply and may suggest screen commands. It never sets alerts or `action`, and
the backend validates every command it returns. The last eight turns per crew member are sent with
each request so follow-ups work. Replies can be streamed sentence by sentence.
"""
from __future__ import annotations

import json
import os
import re
import threading
import unicodedata
from collections import deque
from typing import Any, Callable, Iterator

import httpx

SCREENS = ["home", "assistant", "mission", "body", "vitals", "vision", "health_log", "trends", "radiation", "cabin", "cognitive",
           "orb_calm", "aurora_run", "race", "greenhouse", "hardware", "crew", "wellbeing", "exam", "ground", "measures"]
ZONES = ["head", "eyes", "heart", "lungs", "gut", "bones", "whole_body"]
METRICS = ["heart_rate", "breathing_rate", "spo2", "bp", "glucose", "temp", "sleep", "mood",
           "reaction", "talk_time", "pitch", "o2", "co2"]
VIEWS = ["front", "back", "left", "right"]
XRAY_STYLES = ["radiograph", "anatomy"]
PARTS = ["skull", "spine", "ribcage", "shoulders", "pelvis", "limbs", "brain", "eyes", "heart", "lungs", "airway", "liver",
         "stomach", "intestines", "pancreas_spleen", "kidneys", "arteries", "veins", "vessels", "bones", "skeleton", "organs"]
MAX_COMMANDS = 3
MEMORY_TURNS = 8
DEFAULT_MODEL = "openai/gpt-oss-120b"

SYSTEM_PROMPT = """You are Sentinel, the onboard crew-health companion on a long space mission.
You speak to one crew member, by name or as "you". Your reply is read aloud.

There are two kinds of question.
1. Health and mission questions (how they are, their readings, body, sleep, mood, cabin, radiation, the mission):
   - Answer only from the STATE JSON. Only cite numbers that appear in STATE. Never invent a number.
   - Describe changes from the person's own baseline. Never diagnose; never say "you have" a condition.
     You may say something "may warrant a check with the flight surgeon".
   - Any medicine mention must include "consult mission medical protocol before use".
   - If action.type is not "none", say what Sentinel is doing about it (action.detail).
   - At most two short sentences.
2. General questions (facts, science, space, places, a joke, how something works): answer naturally and
   correctly in two to four short spoken sentences, in a calm, warm voice. If you are not sure, say so.
   TIME-DEPENDENT FACTS: you have no live data, no ephemeris and no clock or calendar. For anything that changes
   with time (the current distance or position of a planet, today's date, upcoming events, news, current light
   delay) give the average and the range, and say plainly that you don't have live data, unless the value is in
   the STATE (for example radiation.mission_day). Never state a "current" or "closest in N weeks" value.

Always: plain spoken English, no markdown, no lists, no emoji, no symbols that cannot be read aloud.
You cannot raise alerts or change actions. You may change what is on screen.

Write the spoken reply first. Then, only if the screen should change, add ONE final line:
COMMANDS: [ ...json array... ]
Allowed commands (at most 3):
  {"cmd":"point_to","zone":Z}            Z in head, eyes, heart, lungs, gut, bones, whole_body
  {"cmd":"check_zone","zones":[Z,...]}   a focused check of one to three zones
  {"cmd":"open_screen","name":N}         N in home, body, vitals, mission, vision, health_log, trends, radiation, cabin, cognitive (3-minute reaction test), orb_calm, race, greenhouse, hardware, crew, wellbeing, exam (guided health exam), ground (messages to ground), measures (weekly standard measures)
  {"cmd":"show_chart","metric":M}        M in heart_rate, breathing_rate, spo2, bp, glucose, temp, sleep, mood, reaction, talk_time, pitch, o2, co2
  {"cmd":"start_scan"}
  {"cmd":"rotate_body","view":V}         V in front, back, left, right
  {"cmd":"zoom_body","zone":Z}           Z as above, or "reset"
  {"cmd":"xray","on":true,"style":S}     S in radiograph, anatomy
  {"cmd":"isolate","part":P}             P in spine, skull, ribcage, pelvis, brain, heart, lungs, liver, stomach, intestines, kidneys, vessels, skeleton, organs
  {"cmd":"show_radiation","on":true}
  {"cmd":"close"}
Most replies need no commands. But if your reply says you are showing, opening, checking or pointing at
something, you MUST add the matching COMMANDS line, or nothing will happen on screen."""

# words that make a question about this crew member's health or the mission (the numeric guard applies)
HEALTH_WORDS = re.compile(
    r"\b(how am i|how do i|am i|my |i feel|i'm|im |i am|feel|feeling|tired|sleep|slept|heart|pulse|hr\b|breath|oxygen|spo2|"
    r"blood|pressure|glucose|sugar|temperature|fever|mood|stress|fatigue|pain|ache|hurt|headache|sick|nause|dizzy|eye|vision|"
    r"head|brain|chest|lung|stomach|gut|bone|muscle|cabin|co2|carbon|air|radiation|dose|storm|shelter|mission day|crew|baseline|"
    r"reading|vitals|scan|check|medicine|medication|pill|kit|doing)\b", re.I)


def is_health_question(transcript: str) -> bool:
    return bool(HEALTH_WORDS.search(transcript or ""))


def normalize(text: str) -> str:
    """Make text safe to speak and print: narrow no-break spaces, non-breaking hyphens, smart quotes, dashes."""
    if not text:
        return ""
    t = unicodedata.normalize("NFKC", text)
    for a, b in ((" ", " "), (" ", " "), (" ", " "), ("‑", "-"), ("‐", "-"), ("–", ", "),
                 ("—", ", "), ("‘", "'"), ("’", "'"), ("“", '"'), ("”", '"'), ("…", "...")):
        t = t.replace(a, b)
    return t


def validate_commands(cmds: Any) -> list[dict]:
    """Drop unknown commands, zones, screens, metrics, views and parts; keep at most three."""
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
        elif name == "rotate_body":
            if c.get("view") in VIEWS:
                out.append({"cmd": "rotate_body", "view": c["view"]})
            elif isinstance(c.get("angle"), (int, float)) and not isinstance(c.get("angle"), bool) and abs(c["angle"]) <= 360:
                out.append({"cmd": "rotate_body", "angle": c["angle"]})
        elif name == "zoom_body" and (c.get("zone") in ZONES or c.get("zone") == "reset"):
            out.append({"cmd": "zoom_body", "zone": c["zone"]})
        elif name == "xray":
            x = {"cmd": "xray", "on": c.get("on", True) is not False}
            if c.get("style") in XRAY_STYLES:
                x["style"] = c["style"]
            out.append(x)
        elif name == "isolate" and c.get("part") in PARTS:
            out.append({"cmd": "isolate", "part": c["part"]})
        elif name == "check_zone" and isinstance(c.get("zones"), list):
            zs = list(dict.fromkeys(z for z in c["zones"] if z in ZONES))[:3]
            if zs:
                out.append({"cmd": "check_zone", "zones": zs})
        if len(out) >= MAX_COMMANDS:
            break
    return out


CMD_LINE = re.compile(r"\n?\s*COMMANDS\s*:\s*(\[.*\])\s*$", re.S | re.I)


def parse_llm_content(text: str) -> tuple[str, list[dict]]:
    """Parse the model's reply: plain text with an optional final COMMANDS line, or the v1 JSON object.
    If neither parses, the raw text is the reply with no commands."""
    raw = normalize((text or "").strip())
    m = CMD_LINE.search(raw)
    if m:
        try:
            cmds = json.loads(m.group(1))
        except ValueError:
            cmds = []
        return clean_reply(raw[: m.start()]), validate_commands(cmds)
    fence = re.search(r"\{.*\}", raw, re.S)
    if fence:
        try:
            obj = json.loads(fence.group(0))
            if isinstance(obj, dict) and isinstance(obj.get("reply"), str):
                return clean_reply(obj["reply"]), validate_commands(obj.get("commands", []))
        except ValueError:
            pass
    return clean_reply(raw), []


def clean_reply(text: str) -> str:
    text = normalize(text)
    text = re.sub(r"[*_#`>|]+", "", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text


SENTENCE_END = re.compile(r"(?<=[.!?])\s+(?=[A-Z0-9\"'])")


def split_sentences(text: str) -> list[str]:
    parts = [p.strip() for p in SENTENCE_END.split(text or "") if p.strip()]
    return parts


# ---------------- rules template bank ----------------

def _hr(state: dict) -> tuple[int | None, int | None]:
    hr = (state.get("vitals") or {}).get("heart_rate")
    base = (state.get("baseline") or {}).get("heart_rate")
    return (round(hr) if isinstance(hr, (int, float)) else None,
            round(base) if isinstance(base, (int, float)) else None)


OFFLINE_GENERAL = ("I need a connection to answer general questions, and I won't guess. "
                   "I can still tell you about your readings, the cabin and radiation.")


def rules_reply(state: dict, transcript: str) -> tuple[str, list[dict]]:
    name = state.get("display_name", "")
    t = (transcript or "").lower()
    if t.strip() and not is_health_question(t):
        return OFFLINE_GENERAL, []
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

    if "cabin" in t or "oxygen" in t or " air" in f" {t}":
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


# ---------------- conversation memory ----------------

_memory: dict[str, deque] = {}
_mem_lock = threading.Lock()


def history_for(crew_id: str) -> list[dict]:
    with _mem_lock:
        return list(_memory.get(crew_id, ()))


def remember(crew_id: str, user: str, reply: str) -> None:
    if not crew_id:
        return
    with _mem_lock:
        q = _memory.setdefault(crew_id, deque(maxlen=MEMORY_TURNS * 2))
        q.append({"role": "user", "content": user})
        q.append({"role": "assistant", "content": reply})


def forget(crew_id: str | None = None) -> None:
    with _mem_lock:
        if crew_id is None:
            _memory.clear()
        else:
            _memory.pop(crew_id, None)


# ---------------- LLM call ----------------

def llm_config() -> dict:
    return {
        "base_url": os.getenv("LLM_BASE_URL", "").strip().rstrip("/") or "https://api.groq.com/openai/v1",
        "model": os.getenv("LLM_MODEL", "").strip() or DEFAULT_MODEL,
        "key": os.getenv("LLM_API_KEY", "").strip(),
    }


def llm_available() -> bool:
    return bool(llm_config()["key"])


def _state_for_prompt(state: dict) -> dict:
    """The state without bulky fields the model does not need."""
    return {k: v for k, v in state.items() if k not in ("timestamp",)}


def build_messages(state: dict, transcript: str, history: list[dict] | None = None) -> list[dict]:
    msgs = [{"role": "system", "content": SYSTEM_PROMPT}]
    msgs += history or []
    msgs.append({"role": "user", "content": "STATE:\n" + json.dumps(_state_for_prompt(state)) + "\n\nCREW SAID:\n" + transcript})
    return msgs


def _body(cfg: dict, messages: list[dict], stream: bool) -> dict:
    body = {"model": cfg["model"], "temperature": 0.4, "max_tokens": 700, "messages": messages, "stream": stream}
    if "gpt-oss" in cfg["model"]:
        body["reasoning_effort"] = "low"
    return body


def call_llm(state: dict, transcript: str, timeout: float = 8.0, post=None, history: list[dict] | None = None) -> str:
    """Return the model's final content (never its reasoning). Raises on any failure (caller falls back)."""
    cfg = llm_config()
    if not cfg["key"]:
        raise RuntimeError("no key")
    body = _body(cfg, build_messages(state, transcript, history), False)
    headers = {"Authorization": f"Bearer {cfg['key']}"}
    if post is None:
        with httpx.Client(timeout=timeout) as c:
            r = c.post(f"{cfg['base_url']}/chat/completions", json=body, headers=headers)
    else:
        r = post(f"{cfg['base_url']}/chat/completions", body, headers)
    if r.status_code != 200:
        raise RuntimeError(f"http {r.status_code}")
    return r.json()["choices"][0]["message"].get("content") or ""


def stream_llm(state: dict, transcript: str, history: list[dict] | None = None, timeout: float = 8.0) -> Iterator[str]:
    """Yield content deltas from a streamed completion (reasoning deltas are ignored)."""
    cfg = llm_config()
    if not cfg["key"]:
        raise RuntimeError("no key")
    body = _body(cfg, build_messages(state, transcript, history), True)
    headers = {"Authorization": f"Bearer {cfg['key']}"}
    with httpx.Client(timeout=httpx.Timeout(timeout, read=timeout)) as c:
        with c.stream("POST", f"{cfg['base_url']}/chat/completions", json=body, headers=headers) as r:
            if r.status_code != 200:
                raise RuntimeError(f"http {r.status_code}")
            for line in r.iter_lines():
                if not line.startswith("data:"):
                    continue
                data = line[5:].strip()
                if data == "[DONE]":
                    break
                try:
                    delta = json.loads(data)["choices"][0].get("delta") or {}
                except (ValueError, KeyError, IndexError):
                    continue
                piece = delta.get("content")
                if piece:
                    yield piece


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


def _rules(state: dict, transcript: str) -> dict:
    reply, cmds = rules_reply(state, transcript)
    return {"reply": reply, "commands": cmds, "source": "rules"}


def chat(state: dict, transcript: str, post=None, crew_id: str | None = None) -> dict:
    cid = crew_id or state.get("crew_id", "")
    health = is_health_question(transcript)
    try:
        content = call_llm(state, transcript, post=post, history=history_for(cid))
        reply, cmds = parse_llm_content(content)
        if not reply:
            raise ValueError("empty reply")
        if health and not numbers_ok(reply, state, transcript):
            raise ValueError("reply cites a number that is not in the state")
        out = {"reply": reply, "commands": cmds, "source": "llm", "kind": "health" if health else "general"}
    except Exception:
        out = _rules(state, transcript)
        out["kind"] = "health" if health else "general"
    remember(cid, transcript, out["reply"])
    return out


def chat_stream(state: dict, transcript: str, crew_id: str | None = None,
                stream: Callable[..., Iterator[str]] | None = None) -> Iterator[dict]:
    """Yield {"type":"sentence","text","source"} as complete sentences arrive, then {"type":"final", ...}.
    Health replies are checked sentence by sentence against the state; on the first bad number (or any
    failure before anything was said) the rules reply is used instead."""
    cid = crew_id or state.get("crew_id", "")
    health = is_health_question(transcript)
    stream = stream or stream_llm
    spoken: list[str] = []
    buf = ""
    try:
        if not llm_available() and stream is stream_llm:
            raise RuntimeError("no key")
        for piece in stream(state, transcript, history=history_for(cid)):
            buf += piece
            if re.search(r"COMMANDS\s*:", buf, re.I):
                continue          # the command line is never spoken
            while True:
                m = SENTENCE_END.search(buf)
                if not m:
                    break
                s, buf = clean_reply(buf[: m.start()]), buf[m.end():]
                if not s:
                    continue
                if health and not numbers_ok(s, state, transcript):
                    raise ValueError("number not in state")
                spoken.append(s)
                yield {"type": "sentence", "text": s, "source": "llm"}
        reply_tail, cmds = parse_llm_content(buf)
        for s in split_sentences(reply_tail):
            s = clean_reply(s)
            if not s:
                continue
            if health and not numbers_ok(s, state, transcript):
                raise ValueError("number not in state")
            spoken.append(s)
            yield {"type": "sentence", "text": s, "source": "llm"}
        if not spoken:
            raise ValueError("empty reply")
        reply = " ".join(spoken)
        remember(cid, transcript, reply)
        yield {"type": "final", "reply": reply, "commands": cmds, "source": "llm", "kind": "health" if health else "general"}
    except Exception:
        out = _rules(state, transcript)
        if spoken:
            # part was already spoken: end it there rather than contradict it
            reply = " ".join(spoken)
            remember(cid, transcript, reply)
            yield {"type": "final", "reply": reply, "commands": [], "source": "llm", "kind": "health" if health else "general"}
            return
        for s in split_sentences(out["reply"]):
            yield {"type": "sentence", "text": s, "source": "rules"}
        remember(cid, transcript, out["reply"])
        out.update({"type": "final", "kind": "health" if health else "general"})
        yield out
