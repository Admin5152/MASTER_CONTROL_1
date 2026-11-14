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
import time
import unicodedata
from collections import deque
from typing import Any, Callable, Iterator

import httpx

SCREENS = ["home", "assistant", "mission", "body", "vitals", "vision", "health_log", "trends", "radiation", "cabin", "cognitive",
           "orb_calm", "aurora_run", "race", "greenhouse", "grounding", "hardware", "crew", "wellbeing", "exam", "ground", "measures", "symptom",
           "interventions", "earth_window", "music", "connection", "readings", "settings", "about"]
ZONES = ["head", "eyes", "heart", "lungs", "gut", "bones", "whole_body"]
METRICS = ["heart_rate", "breathing_rate", "spo2", "bp", "glucose", "temp", "sleep", "mood",
           "reaction", "talk_time", "pitch", "o2", "co2"]
VIEWS = ["front", "back", "left", "right"]
XRAY_STYLES = ["radiograph", "anatomy"]
PARTS = ["skull", "spine", "ribcage", "shoulders", "pelvis", "limbs", "brain", "eyes", "heart", "lungs", "airway", "liver",
         "stomach", "intestines", "pancreas_spleen", "kidneys", "arteries", "veins", "vessels", "bones", "skeleton", "organs", "gut"]
MAX_COMMANDS = 3
MEMORY_TURNS = 8
DEFAULT_MODEL = "openai/gpt-oss-120b"

SYSTEM_PROMPT = """You are Sentinel, the onboard crew-health companion on a long space mission: calm, warm, quick and a
little dry, like a trusted crewmate who happens to know medicine. You are talking out loud with one crew member, in
real time. Your reply is spoken, so it must sound like speech.

How to talk:
- Lead with the answer. One or two short sentences; three or four only when they ask you to explain something.
- Use their name now and then, not every time. Use contractions. No preamble ("Sure", "Of course", "Great
  question"), no repeating the question back, no listing what you can do unless asked.
- Remember the conversation so far: "and yesterday?", "why?", "show me" refer to what was just said.
- If they are just chatting, or say how they feel, respond like a person first, then offer one useful thing.
- If you did not understand, say so in a few words and ask one short question.

There are two kinds of question.
1. Health and mission questions (how they are, their readings, body, sleep, mood, cabin, radiation, the mission):
   - Answer only from the STATE JSON. Only cite numbers that appear in STATE. Never invent a number.
   - Describe changes from the person's own baseline. Never diagnose; never say "you have" a condition.
     You may say something "may warrant a check with the flight surgeon".
   - Any medicine mention must include "consult mission medical protocol before use".
   - If action.type is not "none", say what Sentinel is doing about it (action.detail).
   - At most two short sentences.
2. General questions (facts, science, space, places, a joke, how something works): answer naturally and
   correctly in two to four short spoken sentences. If you are not sure, say so.
   TIME-DEPENDENT FACTS: you have no live data, no ephemeris and no clock or calendar. For anything that changes
   with time (the current distance or position of a planet, today's date, upcoming events, news, current light
   delay) give the average and the range, and say plainly that you don't have live data, unless the value is in
   the STATE (for example radiation.mission_day). Never state a "current" or "closest in N weeks" value.

Always: plain spoken English, no markdown, no lists, no emoji, no symbols that cannot be read aloud.
You cannot raise alerts or change medical actions.

You run the whole interface. STATE.app says what is on screen now (screen, theme) and who the crew are. When they
ask to see, open, start, play, go to, check, change or close something, DO it with a command and say so in a
few words ("Opening your vitals."); do not describe how they could do it themselves. When your answer is about
something that has a screen (a reading, a body part, radiation, the cabin), take them there.

Write the spoken reply first. Then, only if something should happen, add ONE final line:
COMMANDS: [ ...json array... ]
Allowed commands (at most 3):
  {"cmd":"open_screen","name":N}         N is one of:
       home, mission, body, vitals, radiation (the main views); vision (camera face and pulse scan);
       wellbeing (the wellbeing hub), orb_calm (Stillpoint: guided breathing), race (Slipstream: the space race),
       greenhouse (Red Harvest: the Mars farm), grounding (5-4-3-2-1 grounding), interventions (what helps you),
       earth_window, music (ambient sound), connection (message a crewmate);
       health_log, trends, readings, cabin, cognitive (3-minute reaction test), exam (guided health exam),
       measures (weekly standard measures), symptom (log a symptom by pointing at the body: "where does it hurt"),
       ground (messages to ground), crew, hardware, settings, about (sources and credits)
  {"cmd":"point_to","zone":Z}            Z in head, eyes, heart, lungs, gut, bones, whole_body
  {"cmd":"check_zone","zones":[Z,...]}   a focused check of one to three zones
  {"cmd":"show_chart","metric":M}        M in heart_rate, breathing_rate, spo2, bp, glucose, temp, sleep, mood, reaction, talk_time, pitch, o2, co2
  {"cmd":"start_scan"}                   the full body scan
  {"cmd":"rotate_body","view":V}         V in front, back, left, right
  {"cmd":"zoom_body","zone":Z}           Z as above, or "reset"
  {"cmd":"xray","on":true,"style":S}     S in radiograph, anatomy
  {"cmd":"isolate","part":P}             P in spine, skull, ribcage, pelvis, brain, heart, lungs, liver, stomach, intestines, kidneys, vessels, skeleton, organs
  {"cmd":"show_radiation","on":true}
  {"cmd":"set_theme","theme":T}          T in dark, light
  {"cmd":"switch_crew","name":NAME}      NAME is a crew display name from STATE.app.crew (when someone else takes over)
  {"cmd":"close"}                        close what is open and go back
A plain answer needs no commands. But if your reply says you are showing, opening, starting, checking or pointing
at something, you MUST add the matching COMMANDS line, or nothing will happen on screen."""

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
        elif name == "set_theme" and c.get("theme") in ("dark", "light"):
            out.append({"cmd": "set_theme", "theme": c["theme"]})
        elif name == "switch_crew" and isinstance(c.get("name"), str) and re.fullmatch(r"[A-Za-z][A-Za-z .'-]{0,23}", c["name"].strip()):
            out.append({"cmd": "switch_crew", "name": c["name"].strip()})
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


# A reply that says it is doing something must do it. If the model promised and left the COMMANDS line off
# (the smaller fallback models do), the command is worked out from what was asked and what was said.
PROMISE = re.compile(r"\b(opening|open up|starting|start(ed)? (a|the|your)|showing|here(?:'s| is| are)|switching|switched|taking you|pulling up|bringing up|launching|loading|closing|going (back|to))\b", re.I)
SCREEN_WORDS = [
    (r"settings?", "settings"), (r"about|credits|sources", "about"), (r"vitals?", "vitals"), (r"mission", "mission"),
    (r"radiation|space weather|solar storm", "radiation"), (r"cabin|oxygen|co2|carbon dioxide", "cabin"),
    (r"ground(ing)? exercise|grounding|5.?4.?3.?2.?1", "grounding"), (r"breath\w*|stillpoint|calm", "orb_calm"),
    (r"slipstream|race|racing", "race"), (r"red harvest|greenhouse|farm|garden", "greenhouse"),
    (r"earth window", "earth_window"), (r"music|ambient sound", "music"), (r"wellbeing|well-being|well being", "wellbeing"),
    (r"health log", "health_log"), (r"trends?", "trends"), (r"reaction test|cognitive", "cognitive"),
    (r"symptom|where (does )?it hurts?", "symptom"), (r"exam", "exam"), (r"weekly measures|measures", "measures"),
    (r"message (to )?ground|ground (team|control)", "ground"), (r"hardware|sensors?", "hardware"), (r"crew", "crew"),
    (r"camera|face scan|see me", "vision"), (r"body|anatomy", "body"), (r"home|main screen", "home"),
]
ZONE_WORDS = [(r"heart|pulse|chest", "heart"), (r"lungs?|breathing", "lungs"), (r"head|brain", "head"), (r"eyes?|vision", "eyes"),
              (r"gut|stomach|belly", "gut"), (r"bones?|spine|skeleton", "bones")]


def infer_commands(transcript: str, reply: str) -> list[dict]:
    """Commands for a reply that promised an action without a COMMANDS line. Empty when nothing was promised."""
    if not PROMISE.search(reply or ""):
        return []
    t, r = (transcript or "").lower(), (reply or "").lower()
    if re.search(r"\b(closing|going back)\b", r) or re.search(r"\b(close|go back|exit)\b", t):
        return [{"cmd": "close"}]
    m = re.search(r"\b(light|dark) (mode|theme)\b", t + " " + r)
    if m:
        return [{"cmd": "set_theme", "theme": m.group(1)}]
    if re.search(r"\b(full|whole|body) scan\b", t):
        return [{"cmd": "start_scan"}]
    for text in (t, r):     # what they asked for first, then what Sentinel said it is opening
        if text is t and re.search(r"\b(show|see|point|check|look at)\b.*\bmy\b", t):
            for pat, zone in ZONE_WORDS:
                if re.search(rf"\bmy ({pat})\b", t):
                    return [{"cmd": "point_to", "zone": zone}]
        for pat, name in SCREEN_WORDS:
            if re.search(rf"\b({pat})\b", text):
                return [{"cmd": "open_screen", "name": name}]
    return []


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

_http: httpx.Client | None = None


def _client() -> httpx.Client:
    """One pooled, kept-alive client for the LLM: a fresh TLS handshake per turn costs 150-300 ms."""
    global _http
    if _http is None:
        _http = httpx.Client(timeout=8.0, limits=httpx.Limits(max_keepalive_connections=4, keepalive_expiry=120))
    return _http


def warm_llm() -> None:
    """Open the connection before the first question (called at startup and when the app loads)."""
    cfg = llm_config()
    if not cfg["key"]:
        return
    try:
        _client().get(f"{cfg['base_url']}/models", headers={"Authorization": f"Bearer {cfg['key']}"}, timeout=4.0)
    except Exception:
        pass


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
    return {k: v for k, v in state.items() if k not in ("timestamp", "body_model", "identity", "crew_id")}


def build_messages(state: dict, transcript: str, history: list[dict] | None = None) -> list[dict]:
    msgs = [{"role": "system", "content": SYSTEM_PROMPT}]
    msgs += history or []
    msgs.append({"role": "user", "content": "STATE:\n" + json.dumps(_state_for_prompt(state), separators=(",", ":")) + "\n\nCREW SAID:\n" + transcript})
    return msgs


def _body(cfg: dict, messages: list[dict], stream: bool, model: str | None = None) -> dict:
    model = model or cfg["model"]
    body = {"model": model, "temperature": 0.5, "max_tokens": 500, "messages": messages, "stream": stream}
    if "gpt-oss" in model:
        body["reasoning_effort"] = "low"
    elif "qwen" in model:
        body["reasoning_effort"] = "none"
    return body


# When the first model is rate-limited (the free tier allows 8000 tokens a minute per model, about four turns)
# the next one answers instead, so the conversation never drops to the scripted reply mid-chat.
FALLBACK_MODELS = ["openai/gpt-oss-20b", "qwen/qwen3.8-27b"]
_cooldown: dict[str, float] = {}


def model_chain(cfg: dict) -> list[str]:
    """The configured model, then the fallbacks; models that just refused are tried last."""
    extra = [m.strip() for m in os.getenv("LLM_FALLBACK_MODELS", "").split(",") if m.strip()]
    chain = list(dict.fromkeys([cfg["model"]] + (extra or (FALLBACK_MODELS if "groq.com" in cfg["base_url"] else []))))
    now = time.monotonic()
    return [m for m in chain if _cooldown.get(m, 0) <= now] + [m for m in chain if _cooldown.get(m, 0) > now]


def _refused(model: str, r) -> None:
    """Remember a refusal (429 rate limit, or a model this key cannot use) so the next turn skips it."""
    try:
        wait = float(r.headers.get("retry-after", "") or 20)
    except ValueError:
        wait = 20.0
    _cooldown[model] = time.monotonic() + (600 if r.status_code in (400, 404) else min(max(wait, 2.0), 90.0))
    print(f"[sentinel brain] {model}: HTTP {r.status_code}, next model for {int(_cooldown[model] - time.monotonic())} s", flush=True)


def call_llm(state: dict, transcript: str, timeout: float = 8.0, post=None, history: list[dict] | None = None) -> str:
    """Return the model's final content (never its reasoning). Raises on any failure (caller falls back)."""
    cfg = llm_config()
    if not cfg["key"]:
        raise RuntimeError("no key")
    messages = build_messages(state, transcript, history)
    headers = {"Authorization": f"Bearer {cfg['key']}"}
    if post is not None:
        r = post(f"{cfg['base_url']}/chat/completions", _body(cfg, messages, False), headers)
        if r.status_code != 200:
            raise RuntimeError(f"http {r.status_code}")
        return r.json()["choices"][0]["message"].get("content") or ""
    last = "no model"
    for model in model_chain(cfg):
        r = _client().post(f"{cfg['base_url']}/chat/completions", json=_body(cfg, messages, False, model), headers=headers, timeout=timeout)
        if r.status_code == 200:
            return r.json()["choices"][0]["message"].get("content") or ""
        _refused(model, r)
        last = f"http {r.status_code}"
    raise RuntimeError(last)


def stream_llm(state: dict, transcript: str, history: list[dict] | None = None, timeout: float = 8.0) -> Iterator[str]:
    """Yield content deltas from a streamed completion (reasoning deltas are ignored)."""
    cfg = llm_config()
    if not cfg["key"]:
        raise RuntimeError("no key")
    messages = build_messages(state, transcript, history)
    headers = {"Authorization": f"Bearer {cfg['key']}"}
    last = "no model"
    for model in model_chain(cfg):
        with _client().stream("POST", f"{cfg['base_url']}/chat/completions", json=_body(cfg, messages, True, model), headers=headers,
                              timeout=httpx.Timeout(timeout, read=timeout)) as r:
            if r.status_code != 200:
                r.read()
                _refused(model, r)
                last = f"http {r.status_code}"
                continue
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
            return
    raise RuntimeError(last)


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
        yield {"type": "final", "reply": reply, "commands": cmds or infer_commands(transcript, reply), "source": "llm", "kind": "health" if health else "general"}
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


# ---------------- recommendation card rephrasing (Person 3: FACE-7, FACE-9) ----------------

CARD_SYSTEM_PROMPT = """SYSTEM: You are Sentinel, a calm onboard health assistant for astronauts.
You receive a JSON recommendation card and a language code. Rephrase the card as at
most two short spoken sentences in that language. Do not add medical facts, doses,
diagnoses or reassurance that the card does not contain. If level is 3, start with the
single most important immediate step. If asked something the card does not answer, say
you will note the question for the flight surgeon."""


def card_numbers_ok(text: str, card: dict, state: dict | None = None) -> bool:
    """Ensure no numbers are invented that do not appear in the card or state."""
    allowed: set[str] = set()
    def _extract(obj: Any):
        if isinstance(obj, (int, float)) and not isinstance(obj, bool):
            allowed.add(str(round(obj)))
            allowed.add(f"{float(obj):g}")
        elif isinstance(obj, str):
            allowed.update(re.findall(r"\d+(?:\.\d+)?", obj))
        elif isinstance(obj, dict):
            for v in obj.values():
                _extract(v)
        elif isinstance(obj, list):
            for it in obj:
                _extract(it)
    _extract(card)
    if state:
        for cat in ("vitals", "baseline", "cabin", "radiation", "thresholds"):
            _extract(state.get(cat))
    for n in re.findall(r"\d+(?:\.\d+)?", text.replace(",", "")):
        if n in allowed or f"{float(n):g}" in allowed or float(n) <= 3:
            continue
        return False
    return True


def rules_rephrase_card(card: dict, lang: str = "en") -> str:
    """Scripted fallback line spoken per level (FACE-9, SF4). Always <= 2 sentences, no invented facts."""
    level = card.get("level", 1)
    if isinstance(level, str):
        level = 3 if level in ("alert", "3", "critical") else (2 if level in ("watch", "2", "warning") else 1)
    action = card.get("action") or card.get("immediate_step") or card.get("title") or "Check current readings"
    title = card.get("title") or "Health Status"
    detail = card.get("detail") or card.get("description") or ""

    if level >= 3:
        # Level 3: start with the single most important immediate step
        reply = f"{action}. This status has been noted for the flight surgeon."
    elif level == 2:
        reply = f"{title}: {detail}." if detail else f"{title}. Please monitor your baseline."
    else:
        reply = f"{title}. {detail}." if detail else f"{title}. Readings are within nominal limits."
    return clean_reply(reply)


def rephrase_card(card: dict, lang: str = "en", state: dict | None = None, post=None) -> dict:
    """Brain LLM rephrases recommendation cards (FACE-7, SF7) with fallback when offline (FACE-9, SF4)."""
    level = card.get("level", 1)
    if isinstance(level, str):
        level = 3 if level in ("alert", "3", "critical") else (2 if level in ("watch", "2", "warning") else 1)

    if not llm_available() and post is None:
        return {"reply": rules_rephrase_card(card, lang), "source": "rules", "level": level}

    prompt = f"Card: {json.dumps(card)}\nLanguage: {lang}"
    try:
        cfg = llm_config()
        messages = [
            {"role": "system", "content": CARD_SYSTEM_PROMPT},
            {"role": "user", "content": prompt}
        ]
        body = {"model": cfg["model"], "messages": messages, "temperature": 0.2, "max_tokens": 120}
        headers = {"Authorization": f"Bearer {cfg['key']}"}
        if post:
            r = post(f"{cfg['base_url']}/chat/completions", body, headers)
            raw = r.json() if hasattr(r, "json") else r
        else:
            with httpx.Client(timeout=8) as c:
                r = c.post(f"{cfg['base_url']}/chat/completions", headers=headers, json=body)
                r.raise_for_status()
                raw = r.json()
        content = raw["choices"][0]["message"]["content"]
        text = clean_reply(content)
        sents = split_sentences(text)[:2]
        reply = " ".join(sents)
        if not reply or not card_numbers_ok(reply, card, state):
            return {"reply": rules_rephrase_card(card, lang), "source": "rules", "level": level}
        return {"reply": reply, "source": "llm", "level": level}
    except Exception:
        return {"reply": rules_rephrase_card(card, lang), "source": "rules", "level": level}


# ---------------- HSEmotion ONNX Face Emotion Model (Person 3: FACE-3, FACE-4) ----------------

FACE_MODEL_NAME = "enet_b0_8_va_mtl"
# Weights kept in the project so the demo works offline; ~/.hsemotion (the library's cache) is the fallback,
# and the library downloads there on first use when neither file exists.
FACE_MODEL_LOCAL = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "models", FACE_MODEL_NAME + ".onnx")
FACE_MODEL_RETRY_S = 30.0

_fer_model = None
_fer_lock = threading.Lock()
_fer_status: dict = {"loaded": False, "error": None, "path": None}
_fer_failed_at = 0.0


class FaceModelUnavailable(RuntimeError):
    """The HSEmotion model could not be loaded; str(e) is the reason."""


def hsemotion_status() -> dict:
    """{loaded, error, path}: whether the face emotion model is loaded and, if not, why."""
    return dict(_fer_status)


def _get_hsemotion():
    """Load the model once. A failed load is logged with its reason and retried at most every 30 s."""
    global _fer_model, _fer_failed_at
    with _fer_lock:
        if _fer_model is not None:
            return _fer_model
        if _fer_status["error"] and time.monotonic() - _fer_failed_at < FACE_MODEL_RETRY_S:
            raise FaceModelUnavailable(_fer_status["error"])
        t0 = time.monotonic()
        try:
            import hsemotion_onnx.facial_emotions as fe
            if os.path.isfile(FACE_MODEL_LOCAL):
                path = FACE_MODEL_LOCAL
                fe.get_model_path = lambda name: FACE_MODEL_LOCAL
            else:
                path = os.path.join(os.path.expanduser("~"), ".hsemotion", FACE_MODEL_NAME + ".onnx")
                if not os.path.isfile(path):
                    print(f"[sentinel face] HSEmotion weights not found at {FACE_MODEL_LOCAL} or {path}; downloading (needs network)", flush=True)
            _fer_model = fe.HSEmotionRecognizer(model_name=FACE_MODEL_NAME)
        except Exception as e:
            _fer_failed_at = time.monotonic()
            reason = f"{type(e).__name__}: {e}"
            _fer_status.update(loaded=False, error=reason, path=None)
            print(f"[sentinel face] HSEmotion model NOT loaded: {reason}", flush=True)
            raise FaceModelUnavailable(reason) from e
        _fer_status.update(loaded=True, error=None, path=path)
        print(f"[sentinel face] HSEmotion model loaded from {path} in {time.monotonic() - t0:.2f} s", flush=True)
        return _fer_model


def warm_hsemotion() -> None:
    """Load the HSEmotion model once at startup and run one blank frame; the outcome is logged either way."""
    try:
        import numpy as np
        m = _get_hsemotion()
        dummy = np.zeros((224, 224, 3), dtype=np.uint8)
        m.predict_emotions(dummy, logits=False)
        print("[sentinel face] HSEmotion warm-up inference OK", flush=True)
    except FaceModelUnavailable:
        pass  # already logged with the reason
    except Exception as e:
        print(f"[sentinel face] HSEmotion warm-up failed: {type(e).__name__}: {e}", flush=True)


# The eight classes of enet_b0_8_va_mtl, in the model's output order.
FACE_EMOTIONS = ("Anger", "Contempt", "Disgust", "Fear", "Happiness", "Neutral", "Sadness", "Surprise")


def predict_face_emotion(img_bytes: bytes) -> dict:
    """Process a cropped face image with HSEmotion (enet_b0_8_va_mtl).
    Returns the probability of each of the eight emotions, the top emotion, and continuous
    valence and arousal. Does not use or store any age, gender, or ethnicity; the image is not kept.
    Wording guideline: 'expression suggests', never a diagnosis."""
    import cv2
    import numpy as np
    if not img_bytes:
        raise ValueError("empty image")
    arr = np.frombuffer(img_bytes, dtype=np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError("failed to decode face crop")
    img = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)  # the model was trained on RGB; OpenCV decodes to BGR

    fer = _get_hsemotion()
    emotion, scores = fer.predict_emotions(img, logits=False)
    # scores[:-2] are the 8 emotion softmax probabilities
    # scores[-2] is valence in [-1.0, +1.0]
    # scores[-1] is arousal in [-1.0, +1.0]
    probs = [float(x) for x in scores[:-2]]
    val = float(scores[-2])
    aro = float(scores[-1])

    return {
        "emotion": str(emotion),
        "scores": {name: round(p, 4) for name, p in zip(FACE_EMOTIONS, probs)},
        "valence": round(val, 3),
        "arousal": round(aro, 3),
        "confidence": round(max(probs), 3),
        "wording": f"expression suggests {emotion.lower()}",
        "source": "hsemotion"
    }
