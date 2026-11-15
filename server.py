"""Sentinel backend: FastAPI app serving /app (static) and /api/*.

Run one process only (state is in memory):
  python -m uvicorn server:app --host 0.0.0.0 --port 8443 --ssl-keyfile certs/key.pem --ssl-certfile certs/cert.pem
"""
from __future__ import annotations

import asyncio
import mimetypes
import os
import socket
from contextlib import asynccontextmanager
from pathlib import Path

from dotenv import load_dotenv
from fastapi import Body, FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse, RedirectResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles

ROOT = Path(__file__).resolve().parent
load_dotenv(ROOT / ".env")
# Windows can map these to text/plain from the registry; browsers refuse module scripts then.
for _ext, _type in ((".js", "text/javascript"), (".mjs", "text/javascript"), (".wasm", "application/wasm"),
                    (".svg", "image/svg+xml"), (".json", "application/json"), (".css", "text/css"),
                    (".task", "application/octet-stream")):
    mimetypes.add_type(_type, _ext)

from brain import llm, speech  # noqa: E402
from brain.ground import Ground  # noqa: E402
from brain.suit import Suits, REGIONS as SUIT_REGIONS, region_from_text  # noqa: E402
from brain.ops import Ops, MODES as OPS_MODES  # noqa: E402
from brain import safety  # noqa: E402
from brain.profile import profiles  # noqa: E402
from brain.audit import Audit  # noqa: E402
from brain import environment as envmod  # noqa: E402
from brain.clinic import Clinic, CLINICAL_MODES, DAY_BLOCKS  # noqa: E402
from brain.crew_pulse import CrewPulse  # noqa: E402
from brain.eyes import EyeChecks  # noqa: E402
from brain.wellbeing import wellbeing, TOOLKIT, CLINICAL_SCALES  # noqa: E402
from brain.care import care  # noqa: E402
from brain.plan import plan  # noqa: E402
from brain.trends import trends  # noqa: E402
from brain.onboarding import onboarding  # noqa: E402
from brain import indicators as indmod  # noqa: E402
from brain.pipeline import pipeline  # noqa: E402
from brain.alerts import alerts  # noqa: E402
from brain.notify import Notifications  # noqa: E402
from brain.devices import Devices  # noqa: E402
from brain import protocols as protomod  # noqa: E402
from systems.skin import Skin  # noqa: E402
import json  # noqa: E402
import threading  # noqa: E402
from brain.contract import ContractError  # noqa: E402
from brain.radiation import SpaceWeather, storm_dose_step, feed_freshness  # noqa: E402
from brain.store import Store  # noqa: E402
from systems import speaker  # noqa: E402
from brain.race_rooms import RaceRooms  # noqa: E402
from systems.scenarios import NAMES as SCENARIO_NAMES, Scenarios  # noqa: E402

store = Store(persist=os.getenv("SENTINEL_NO_PERSIST") != "1", fresh=os.getenv("SENTINEL_FRESH") == "1")
notes = Notifications()
devices = Devices()
store.sensitivity = alerts.feedback_adjustments   # "not useful" feedback reaches the decision engine (19.5)
suits = Suits()
audit = Audit()
pulse = CrewPulse()
eyes = EyeChecks()
ops = Ops()
clinic = Clinic()
spaceweather = SpaceWeather()
scenarios = Scenarios(store, spaceweather)
ground = Ground(persist=os.getenv("SENTINEL_NO_PERSIST") != "1")
skin = Skin()
SPEAKER_OK = speaker.available()


def _lan_ip() -> str:
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("10.255.255.255", 1))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except OSError:
        return "127.0.0.1"


def tablet_url() -> str:
    return os.getenv("SENTINEL_TABLET_URL") or f"https://{_lan_ip()}:8443/app/"


def apply_spaceweather(data: dict) -> None:
    """Set each crew member's storm level from NOAA unless a storm scenario is driving it."""
    if scenarios.storm is not None:
        return
    store.apply_radiation_feed(data)


async def spaceweather_loop():
    loop = asyncio.get_running_loop()
    while True:
        try:
            data = await loop.run_in_executor(None, spaceweather.refresh)
            apply_spaceweather(data)
        except Exception:
            pass
        await asyncio.sleep(60)


async def storm_dose_loop():
    """While a real (live feed) storm is in progress, accrue storm dose in real time."""
    while True:
        await asyncio.sleep(1)
        if scenarios.storm is not None:
            continue
        for cid, s in list(store.states.items()):
            lvl = s["radiation"]["storm_level"]
            if lvl >= 1:
                rec, av = storm_dose_step(lvl, 1.0, s["radiation"]["sheltered"], store.thresholds, time_scale=1.0)
                store.add_storm_dose_for(cid, rec, av)


@asynccontextmanager
async def lifespan(app: FastAPI):
    tasks = []
    if os.getenv("SENTINEL_NO_NETWORK") != "1":
        tasks.append(asyncio.create_task(spaceweather_loop()))
    else:
        spaceweather.latest = spaceweather._cached_or_snapshot()
        apply_spaceweather(spaceweather.latest)
    tasks.append(asyncio.create_task(storm_dose_loop()))
    if os.getenv("SENTINEL_NO_WARM") != "1":
        # load Kokoro once in the background and warm it with one short sentence (fallback voice ready)
        threading.Thread(target=speech.warm_kokoro, daemon=True).start()
        threading.Thread(target=llm.warm_hsemotion, daemon=True).start()
        threading.Thread(target=llm.warm_llm, daemon=True).start()
        threading.Thread(target=speech.warm_speech, daemon=True).start()
    yield
    for t in tasks:
        t.cancel()
    scenarios.stop()


app = FastAPI(title="Sentinel", lifespan=lifespan)


def _need(cid: str) -> None:
    if not store.has(cid):
        raise HTTPException(404, f"unknown crew member {cid}")


@app.exception_handler(ContractError)
async def contract_error(_req: Request, exc: ContractError):
    return JSONResponse(status_code=422, content={"detail": str(exc), "path": exc.path})


@app.get("/")
def root():
    return RedirectResponse("/app/")


@app.get("/api/health")
def health():
    sw = spaceweather.latest
    return {
        "ok": True,
        "llm": llm.llm_available(),
        "llm_model": llm.llm_config()["model"] if llm.llm_available() else None,
        "speaker_id": SPEAKER_OK,
        "face_emotion": llm.hsemotion_status(),
        "tts": "elevenlabs" if speech.eleven_key() else "kokoro",
        "stt": "groq" if llm.llm_available() else "local",
        "voiceprints": sorted(speaker.enrolled().keys()) if SPEAKER_OK else [],
        "spaceweather": sw["source"] if sw else "pending",
        "tablet_url": tablet_url(),
    }


@app.get("/api/pin")
def pin(request: Request):
    """The pairing PIN, for this laptop only (shown in the demo panel)."""
    if (request.client.host if request.client else "") not in LOOPBACK:
        raise HTTPException(403, "shown on the laptop only")
    return {"pin": PAIR_PIN}


@app.get("/api/crew")
def crew():
    return store.crew()


@app.post("/api/crew")
def crew_add(body: dict = Body(...)):
    """Add a crew member. They start with a clean record and an empty profile, and every function works for them."""
    try:
        c = store.add_crew(str(body.get("display_name", "")), str(body.get("body_model", "male")))
    except ValueError as e:
        raise HTTPException(422, str(e))
    audit.record("brain", "crew.added", c["crew_id"], {"display_name": c["display_name"]})
    return c


@app.get("/api/crew/{cid}/card")
def crew_card(cid: str):
    """What the crew may see about a crewmate on the shared map: where they are (SIM), their radiation exposure and
    shelter state, and whether they need help. No readings, no health background (section 28)."""
    _need(cid)
    s = store.get(cid)
    r = s["radiation"]
    a = store.assessment(cid)["radiation"]
    act = s.get("action") or {}
    prof = profiles.get(cid)
    return {"crew_id": cid, "display_name": s["display_name"], "callsign": prof.get("callsign") or s["display_name"],
            "buddy": (prof.get("sharing") or {}).get("buddy") or "", "mode": ops.status(cid, s)["mode"], "environment": store.extras(cid)["environment"],
            "radiation": {"cumulative_msv": round(r["cumulative_msv"], 1), "career_limit_msv": r["career_limit_msv"], "dose_rate_usv_h": round(r.get("dose_rate_usv_h", 0.0), 2),
                          "storm_level": r["storm_level"], "sheltered": bool(r["sheltered"]), "shelter_advised": bool(r.get("shelter_status")),
                          "storm_received_msv": a["storm_received_msv"], "storm_avoided_msv": a["storm_avoided_msv"], "margin_days": a["margin_days"], "label": "SIM"},
            "needs_help": act.get("severity") == "alert", "label": "SIM"}


@app.get("/api/exercise/{cid}")
def exercise_plan(cid: str):
    """The exercise countermeasure made specific: device, minutes and how; today's sessions and total."""
    _need(cid)
    from brain.clinic import EXERCISE_PLAN
    day = int(store.mission_clock()["mission_day"])
    ex = store.internal.get(cid, {}).get("exercise") or {}
    sessions = [e for e in store.get_non_reading(cid, "exercise") if e.get("day") == day]
    return {**EXERCISE_PLAN, "total_today": ex.get("total", 0.0) if ex.get("day") == day else 0.0, "today": sessions,
            "post_exercise": store.extras(cid)["post_exercise"]}


@app.get("/api/state/{cid}")
def get_state(cid: str):
    _need(cid)
    return store.get(cid)


def _notify_contacts(cid: str, title: str, text: str, level: int = 3, kind: str = "help") -> dict:
    """Put a notice in the inbox of the crew buddy this person chose, and of the commander if they allow it.
    It waits there until that person is at the screen. Returns who was told."""
    crew = store.crew()
    by_name = {c["display_name"].lower(): c["crew_id"] for c in crew}
    prof = profiles.get(cid)
    who = safety.people(crew, cid)
    me = store.get(cid)["display_name"]
    buddy_name = (prof.get("sharing") or {}).get("buddy") or (prof.get("emergency") or {}).get("buddy") or who["buddy"]
    told = {}
    targets = [("buddy", buddy_name)]
    if level >= 3 and (prof.get("sharing") or {}).get("shareUrgentWithCommander", True):
        targets.append(("commander", who["commander"]))
    for role, name in targets:
        to = by_name.get(str(name).lower())
        if to and to != cid and to not in told.values():
            notes.add(to, title.format(name=me), text.format(name=me, role=role), about_cid=cid, about_name=me, level=level, kind=kind)
            told[role] = to
    if told:
        audit.record("brain", "notify.contacts", cid, {"told": sorted(told), "level": level, "kind": kind})
    return told


@app.get("/api/notifications/{cid}")
def notifications_get(cid: str, seen: bool = False):
    """This person's inbox: notices that a crewmate needs help, newest first."""
    _need(cid)
    return notes.list(cid, mark_seen=seen)


@app.post("/api/notifications/{cid}/clear")
def notifications_clear(cid: str, body: dict = Body(default={})):
    _need(cid)
    n = notes.clear(cid, body.get("id"))
    audit.record("brain", "notify.cleared", cid, {"count": n})
    return {"cleared": n, **notes.list(cid)}


_ALERT_LEVEL = {"info": 1, "watch": 2, "alert": 3}


def _sync_alert(cid: str, s: dict) -> dict | None:
    """The decision the store just made becomes an alert with a lifecycle (19.4): one per cause, cooled down,
    quiet hours respected, and with the readings, baseline, rule and source kept for "Why this?" (19.5)."""
    act = (s or {}).get("action") or {}
    t = act.get("type") or "none"
    if t == "none":
        return None
    zone = act.get("zone") or ""
    readings, base, src = {}, {}, ""
    for r in store.assessment(cid)["absolute"]:
        if r.get("severity") not in (None, "ok") and (not zone or r.get("zone") == zone) and isinstance(r.get("value"), (int, float)):
            readings[r["metric"]] = r["value"]
            src = src or (r.get("source") or {}).get("title", "")
    for d in (s.get("drift") or {}).get("items", []):
        v = s
        for part in d["metric"].split("."):
            v = v.get(part) if isinstance(v, dict) else None
        if isinstance(v, (int, float)) and not isinstance(v, bool):
            readings.setdefault(d["metric"], v)
            pct = d.get("delta_pct") or 0
            if pct and pct > -100:
                base[d["metric"]] = round(v / (1 + pct / 100.0), 1)
    a = alerts.create_alert(crew_id=cid, cause_id=f"{t}:{zone}", level=_ALERT_LEVEL.get(act.get("severity"), 1),
                            title=act.get("detail") or t.replace("_", " "), reason=act.get("detail") or "", rule_id=t,
                            readings=readings, baseline=base, source="decision engine",
                            mrid=src or "Your own baseline (median of your stored readings)",
                            quiet_hours=bool(ops.status(cid, s).get("urgent_only")))
    if a:
        alerts.present_alert(a["alert_id"])
        alerts.save()
        audit.record("brain", "alert.detected", cid, {"alert_id": a["alert_id"], "level": a["level"], "rule": t, "zone": zone})
    return a


EMOTIONS = {"neutral", "happy", "sad", "angry", "fear", "surprise", "disgust", "contempt", "tired", "stressed", "calm"}


@app.post("/api/scan/{cid}")
def scan_save(cid: str, body: dict = Body(...)):
    """Save the result of a finished scan (FR-1): the face scan's pulse, breathing and expression with their
    confidence, labelled LIVE estimate, or the body scan's flagged zones. The readings enter the same pipeline as
    any other (ranges, baseline, alerts); a low-confidence pulse is kept as an estimate and raises nothing alone."""
    _need(cid)
    kind = "body" if body.get("kind") == "body" else "face"
    out: dict = {"kind": kind, "seconds": max(0, min(120, int(body.get("seconds") or 0))), "samples": max(0, int(body.get("samples") or 0)), "saved": []}
    state = None
    if kind == "face":
        def num(k, lo, hi):
            v = body.get(k)
            return float(v) if isinstance(v, (int, float)) and not isinstance(v, bool) and lo <= v <= hi else None
        hr, br, conf = num("heart_rate", 20, 250), num("breathing_rate", 2, 80), num("confidence", 0, 1) or 0.0
        if hr is not None:
            store.set_context(cid, hr_confidence=conf)   # below 0.35 the pulse is an estimate: shown, never alarming (S5)
            state = store.ingest_reading(cid, {"metric": "heart_rate", "value": round(hr), "label": "LIVE estimate", "confidence": round(conf, 2), "source": "camera"})
            store.patch(cid, {"vitals": {"sources": {"heart_rate": "camera"}}}, record=False)
            out.update(heart_rate=round(hr), confidence=round(conf, 2)); out["saved"].append("heart_rate")
        if br is not None:
            state = store.ingest_reading(cid, {"metric": "breathing_rate", "value": round(br), "label": "LIVE estimate", "confidence": round(num("breathing_confidence", 0, 1) or conf, 2), "source": "camera"})
            store.patch(cid, {"vitals": {"sources": {"breathing_rate": "camera"}}}, record=False)
            out.update(breathing_rate=round(br)); out["saved"].append("breathing_rate")
        emo = str(body.get("emotion") or "").lower()
        if emo in EMOTIONS and (profiles.get(cid).get("wellbeingPlan") or {}).get("cameraMoodAnalysis", True):
            ec = num("emotion_confidence", 0, 1) or 0.0
            try:
                state = store.patch(cid, {"state": {"emotion": emo, "emotion_confidence": round(ec, 2)}}, source="camera")
                out.update(emotion=emo, emotion_confidence=round(ec, 2)); out["saved"].append("expression")
            except ContractError:
                pass
        out["label"] = "LIVE estimate"
    else:
        zones = [z for z in (body.get("zones_flagged") or []) if isinstance(z, str)][:8]
        asm = store.assessment(cid)
        out.update(zones=asm["zones"], zones_flagged=zones, label="LIVE")
    if kind == "face" and not out["saved"]:
        raise HTTPException(422, "no usable reading in this scan")
    rec = store.record_scan(cid, out)
    if state is not None:
        _sync_alert(cid, store.get(cid))
    audit.record("brain", "scan.recorded", cid, {"kind": kind, "saved": out["saved"], "confidence": out.get("confidence"), "flagged": out.get("zones_flagged")})
    return {"ok": True, "scan": rec, "action": (store.get(cid).get("action") or {})}


@app.get("/api/scans/{cid}")
def scans_list(cid: str):
    _need(cid)
    return {"crew_id": cid, "scans": list(reversed(store.get_non_reading(cid, "scan")))[:50]}


@app.post("/api/device/{cid}")
def device_ingest(cid: str, body: dict = Body(...)):
    """Readings from any device: {"device": "watch"|"chest_hub"|"suit"|"cabin"|"camera", "readings": [{"metric", "value",
    "confidence"}], "sim": false}. Each is checked against what that device may report, labelled LIVE (or SIM when a
    simulator sends it), and enters the same pipeline as a typed entry: ranges, baseline, alerts, the record."""
    _need(cid)
    try:
        r = devices.ingest(store, suits, cid, str(body.get("device", "")), body.get("readings"), sim=bool(body.get("sim", False)))
    except ValueError as e:
        raise HTTPException(422, str(e))
    s = store.get(cid)
    if r["accepted"]:
        _sync_alert(cid, s)
    st = suits.status(cid)
    if st.get("source") == "suit telemetry" and st.get("integrity") in ("watch", "breach") and st.get("incident") != getattr(device_ingest, "_told", {}).get(cid):
        device_ingest._told = {**getattr(device_ingest, "_told", {}), cid: st.get("incident")}   # once per incident
        ops.set_mode(cid, "eva")
        me = s["display_name"]
        for c in store.crew():
            if c["crew_id"] != cid:
                notes.add(c["crew_id"], f"{me}: suit pressure dropping", f"{me}'s suit reports {st['pressure_psi']} psi and falling. Be ready to help them back to the airlock.",
                          about_cid=cid, about_name=me, level=3, kind="suit")
    audit.record("brain", "device.readings", cid, {"device": r["device"], "label": r["label"], "accepted": [a["metric"] for a in r["accepted"]], "rejected": len(r["rejected"])})
    return {**r, "action": s.get("action") or {}, "suit": st}


@app.get("/api/devices/{cid}")
def devices_list(cid: str):
    """Every device Sentinel can take readings from: connected or not, last heard, what it last reported."""
    _need(cid)
    return devices.status(cid, suits.status(cid))


@app.get("/api/record/{cid}")
def saved_record(cid: str):
    """Everything stored for this person: per field the count, how many were entered or measured, the newest value."""
    _need(cid)
    return store.saved_record(cid)


@app.get("/api/baselines/{cid}")
def baselines_get(cid: str):
    """The personal baseline model: median, spread and calibration stage per indicator (19.2)."""
    _need(cid)
    return store.learn_baselines(cid)


@app.post("/api/baselines/{cid}/learn")
def baselines_learn(cid: str):
    """Re-fit "my normal" from the stored readings and use it. Surgeon-adjusted baselines are left alone."""
    _need(cid)
    skip = set((profiles.get(cid).get("baselines") or {}).keys())
    r = store.learn_baselines(cid, apply=True, skip=skip)
    audit.record("brain", "baseline.learned", cid, {"applied": sorted(r["applied"]), "indicators": len(r["indicators"])})
    return r


@app.post("/api/state/{cid}/patch")
def patch_state(cid: str, patch: dict = Body(...)):
    _need(cid)
    out = store.patch(cid, patch)
    if any(k in patch for k in ("manual", "vitals", "cognitive", "cabin")):
        _sync_alert(cid, out)
    act = (out or {}).get("action") or {}
    # the reading (fields only, never health background) and the recommendation the pipeline made
    audit.record("brain", "reading.patched", cid, {"fields": sorted(k + "." + j for k, v in patch.items() if isinstance(v, dict) for j in v)[:12],
                                                     "action": act.get("type"), "severity": act.get("severity"), "zone": act.get("zone")})
    return out


@app.post("/api/reading/{cid}")
def ingest_reading(cid: str, reading: dict = Body(...)):
    """Ingest a validated reading into store and decision pipeline (INT-1, INT-2, SI1, SI2).
    Requires label ('LIVE'|'MANUAL'|'SIM'|'DESIGNED') and confidence (0.0-1.0).
    """
    _need(cid)
    try:
        out = store.ingest_reading(cid, reading)
    except (ValueError, KeyError) as e:
        raise HTTPException(422, str(e))
    _sync_alert(cid, out)
    act = (out or {}).get("action") or {}
    metric = reading.get("metric") or reading.get("indicator") or reading.get("field") or "unknown"
    audit.record("brain", "reading.added", cid, {
        "metric": metric,
        "label": reading.get("label"),
        "confidence": reading.get("confidence"),
        "action": act.get("type"),
        "severity": act.get("severity"),
        "zone": act.get("zone"),
    })
    return {"ok": True, "state": out}


@app.post("/api/reading")
def ingest_reading_generic(body: dict = Body(...)):
    """Generic endpoint accepting crew_id in body."""
    cid = body.get("crew_id") or body.get("cid")
    if not cid:
        raise HTTPException(422, "crew_id is required")
    _need(cid)
    try:
        out = store.ingest_reading(cid, body)
    except (ValueError, KeyError) as e:
        raise HTTPException(422, str(e))
    _sync_alert(cid, out)
    act = (out or {}).get("action") or {}
    metric = body.get("metric") or body.get("indicator") or body.get("field") or "unknown"
    audit.record("brain", "reading.added", cid, {
        "metric": metric,
        "label": body.get("label"),
        "confidence": body.get("confidence"),
        "action": act.get("type"),
        "severity": act.get("severity"),
        "zone": act.get("zone"),
    })
    return {"ok": True, "state": out}


@app.get("/api/assessment/{cid}")
def assessment(cid: str):
    _need(cid)
    return store.assessment(cid)


@app.get("/api/aux/{cid}")
def aux(cid: str):
    """Everything the screen needs besides the contract object, in one poll."""
    _need(cid)
    clock = store.mission_clock()
    return {"assessment": store.assessment(cid), "scenario": scenarios.status, "clock": clock,
            "skin": skin.aux(cid, store.get(cid), int(clock.get("mission_day", 0))), "suit": suits.status(cid),
            "ops": ops.status(cid, store.get(cid)), "extras": store.extras(cid)}


@app.post("/api/ops/{cid}")
def ops_set(cid: str, body: dict = Body(default={})):
    """Mission mode {"mode": routine|eva|rest|contingency} and the SIM link {"blackout_min": n} (0 ends it)."""
    _need(cid)
    if "mode" in body:
        if body["mode"] not in OPS_MODES:
            raise HTTPException(400, f"mode must be one of {OPS_MODES}")
        ops.set_mode(cid, body["mode"])
        if body["mode"] != "eva" and suits.status(cid).get("mode") == "eva":
            suits.set_mode(cid, "iva")
    audit.record("brain", "ops.changed", cid, {k: body[k] for k in ("mode", "blackout_min") if k in body})
    if "blackout_min" in body:
        ops.blackout(float(body["blackout_min"]))
        if float(body["blackout_min"]) <= 0:
            ground.release()   # the link is back: held messages go now, urgent first
    return ops.status(cid, store.get(cid))


@app.get("/api/ops/{cid}/readiness")
def ops_readiness(cid: str):
    _need(cid)
    return ops.readiness(store.get(cid), suits.status(cid))


@app.get("/api/digest/{cid}")
def digest_preview(cid: str, note: str = ""):
    _need(cid)
    return ops.digest(cid, store.get(cid), store.assessment(cid), suits.status(cid), note[:200])


@app.post("/api/digest/{cid}")
def digest_send(cid: str, body: dict = Body(default={})):
    """Build the digest (section 21) and queue it for the flight surgeon; a blackout holds it until the link returns."""
    _need(cid)
    d = ops.digest(cid, store.get(cid), store.assessment(cid), suits.status(cid), str(body.get("note", ""))[:200])
    p = ground.send(cid, "digest", f"Digest: {d['priority']}", {"text": d["text"]}, d["priority"], ops.hold_until())
    audit.record("brain", "digest.queued", cid, {"priority": d["priority"], "status": p["status"]})
    return {**d, "packet": p}


@app.get("/api/profile/{cid}")
def profile_get(cid: str):
    """The personal health profile (section 14): viewable and exportable at any time."""
    _need(cid)
    return profiles.get(cid)


@app.patch("/api/profile/{cid}")
def profile_update(cid: str, body: dict = Body(...)):
    _need(cid)
    p = profiles.update(cid, body)
    audit.record("brain", "profile.updated", cid, {"sections": sorted(body)[:8], "completeness": p["completeness"]})   # sections only
    with store.lock:   # an allergy can change a kit card now
        store._recompute(cid)
    return p


@app.delete("/api/profile/{cid}")
def profile_delete(cid: str):
    _need(cid)
    audit.record("brain", "profile.deleted", cid)
    return profiles.delete(cid)


@app.get("/api/profile/{cid}/export")
def profile_export(cid: str, sensitive: bool = True):
    """Export the personal health profile (Section 14.4). Sensitive fields redacted if sensitive=False."""
    _need(cid)
    return profiles.export(cid, include_sensitive=sensitive)


@app.post("/api/profile/{cid}/preload")
def profile_preload(cid: str, body: dict = Body(...)):
    """Preload profile by flight surgeon or mission planner (Section 14.1)."""
    _need(cid)
    author = body.get("preloadedBy", "flight_surgeon")
    data = body.get("profile", body)
    p = profiles.preload(cid, data, preloaded_by=author)
    audit.record("brain", "profile.preloaded", cid, {"by": author})
    return p


@app.post("/api/profile/{cid}/confirm")
def profile_confirm(cid: str):
    """Astronaut confirms preloaded profile (Section 14.1)."""
    _need(cid)
    p = profiles.confirm(cid)
    audit.record("brain", "profile.confirmed", cid)
    return p


@app.post("/api/profile/{cid}/baseline")
def profile_baseline_adjust(cid: str, body: dict = Body(...)):
    """Surgeon adjusts personal baseline indicator (Section 14.4)."""
    _need(cid)
    ind = body.get("indicator")
    val = body.get("value")
    if not ind or val is None:
        raise HTTPException(400, "indicator and value are required")
    p = profiles.adjust_baseline(cid, ind, float(val), adjusted_by=body.get("adjustedBy", "flight_surgeon"), reason=body.get("reason", ""))
    audit.record("brain", "profile.baseline_adjusted", cid, {"indicator": ind, "value": val})
    return p


@app.post("/api/audit")
def audit_batch(body: dict = Body(...)):
    """The page's bus events, batched: [{"t", "event", "detail"}], plus counts of high-frequency telemetry."""
    cid = body.get("crew_id")
    for e in (body.get("events") or [])[:400]:
        audit.record("page", e.get("event", "?"), cid, e.get("detail"), e.get("t"))
    if body.get("counts"):
        audit.record("page", "telemetry.counts", cid, body["counts"])
    return {"ok": True}


@app.get("/api/audit")
def audit_list(limit: int = 200, crew_id: str | None = None, q: str = ""):
    return {"entries": audit.recent(min(limit, 1000), crew_id, q[:60])}


@app.get("/api/environment/match")
def environment_match(text: str = ""):
    """What a spoken place means: {"env"} to confirm, {"ask"} to clarify, or null (section 13.1)."""
    return {"match": envmod.match(text[:200])}


@app.post("/api/environment/{cid}")
def environment_set(cid: str, body: dict = Body(...)):
    """A CONFIRMED switch (the page asks first): reload, settle in, recompute; returns the banner of changes."""
    _need(cid)
    prof = body.get("profile") or envmod.ENVS.get(body.get("env", ""), {}).get("profile")
    if prof not in envmod.PROFILE_ENV:
        raise HTTPException(400, "unknown environment")
    r = store.set_environment(cid, prof)
    audit.record("brain", "environment.changed", cid, {"from": r["from"], "to": r["to"]})
    return r


@app.get("/api/environment/profiles")
def environment_profiles():
    """Environment profiles, wait tolerances, and modes (Section 13.2 & 13.4)."""
    return {
        "environments": {k: envmod.profile_config(k) for k in envmod.ENVS},
        "modes": envmod.MODES_SPEC,
    }


@app.get("/api/environment/profile/{name}")
def environment_profile_detail(name: str):
    """Specific environment profile config (Section 13.4)."""
    if name not in envmod.ENVS and name not in envmod.PROFILE_ENV:
        raise HTTPException(404, f"unknown environment profile {name}")
    return envmod.profile_config(name)


@app.post("/api/context/{cid}")
def context_set(cid: str, body: dict = Body(...)):
    """Reading context: {"activity": "post_exercise"|"none", "minutes"} and/or {"hr_confidence": 0-1} (S4, S5)."""
    _need(cid)
    return store.set_context(cid, body.get("activity"), float(body.get("minutes", 30)), body.get("hr_confidence"))


@app.get("/api/pulse")
def pulse_get(crew_id: str | None = None):
    return pulse.result(int(store.mission_clock()["mission_day"]) // 7, crew_id)


@app.post("/api/pulse/{cid}")
def pulse_answer(cid: str, body: dict = Body(...)):
    _need(cid)
    try:
        r = pulse.answer(int(store.mission_clock()["mission_day"]) // 7, cid, body)
    except ValueError as e:
        raise HTTPException(400, str(e))
    audit.record("brain", "pulse.answered", cid)   # that someone answered, never what
    return r


# ---- daily eye check (SANS screening aid; never a diagnosis: see brain/eyes.py) ----
@app.get("/api/eyes/{cid}")
def eyes_get(cid: str):
    _need(cid)
    return eyes.summary(cid)


@app.post("/api/eyes/{cid}")
def eyes_save(cid: str, body: dict = Body(...)):
    _need(cid)
    r = eyes.add(cid, body)
    audit.record("brain", "eyes.checked", cid, {"verdict": r["verdict"]})   # the verdict, never the photos
    return r


@app.delete("/api/eyes/{cid}")
def eyes_forget(cid: str):
    _need(cid)
    audit.record("brain", "eyes.forgotten", cid)
    return eyes.forget(cid)


@app.get("/api/clinic/{cid}")
def clinic_status(cid: str):
    """Clinical mode (12.1) and current day time block (12.2)."""
    _need(cid)
    s = store.get(cid)
    asmt = store.assessment(cid)
    ops_st = ops.status(cid, s)
    clock = store.mission_clock()
    hour = clock.get("hour", 8) + clock.get("minute", 0) / 60.0
    mode = clinic.get_clinical_mode(s, asmt, ops_st)
    block = clinic.current_block(hour)
    return {
        "crew_id": cid,
        "clinical_mode": mode,
        "clinical_mode_info": CLINICAL_MODES.get(mode, {}),
        "day_block": block,
        "ops": ops_st,
        "available_modes": CLINICAL_MODES,
        "day_blocks": DAY_BLOCKS,
    }


@app.post("/api/clinic/{cid}/block")
def clinic_execute_block(cid: str, body: dict = Body(...)):
    """Execute actions for clinical time blocks (wake, exercise, winddown, etc.)."""
    _need(cid)
    block_id = body.get("block")
    try:
        if block_id == "wake":
            res = clinic.execute_wake(store, cid, float(body.get("sleep_hours", 7.5)), int(body.get("mood", 3)))
            audit.record("brain", "clinic.wake_logged", cid, {"sleep_hours": body.get("sleep_hours"), "mood": body.get("mood")})
            return res
        elif block_id == "morning_checkin":
            res = clinic.execute_checkin(store, cid, body.get("vitals"), body.get("reaction_ms"), body.get("profile_answer"))
            audit.record("brain", "clinic.checkin_completed", cid, {"completeness": res.get("profile_completeness")})
            return res
        elif block_id == "exercise":
            res = clinic.execute_exercise(store, cid, float(body.get("minutes", 30)), str(body.get("activity", "workout")))
            audit.record("brain", "clinic.exercise_logged", cid, {"minutes": body.get("minutes"), "activity": body.get("activity")})
            return res
        elif block_id == "evening_winddown":
            mood = int(body["mood"]) if "mood" in body and body["mood"] is not None else None
            res = clinic.execute_winddown(store, cid, mood)
            audit.record("brain", "clinic.winddown_completed", cid, {"calm_recommended": res.get("calm_recommended")})
            return res
        elif block_id == "night_sleep":
            ops.set_mode(cid, "rest")
            audit.record("brain", "ops.changed", cid, {"mode": "rest", "reason": "night_sleep_block"})
            return {"ok": True, "block": "night_sleep", "mode": "rest", "note": "Rest mode active: DND on, routine reminders paused."}
        elif block_id == "eva_sortie":
            r = ops.readiness(store.get(cid), suits.status(cid))
            audit.record("brain", "clinic.eva_checked", cid, {"ready": r.get("ready")})
            return {"ok": True, "block": "eva_sortie", "readiness": r}
        else:
            raise HTTPException(400, f"unsupported block action {block_id}")
    except ValueError as e:
        raise HTTPException(422, str(e))


@app.get("/api/clinic/{cid}/weekly")
def clinic_weekly(cid: str):
    """Weekly review summary, adherence, and countermeasures for surgeon (12.2)."""
    _need(cid)
    return clinic.weekly_review(store, cid)


@app.post("/api/clinic/{cid}/checkin")
def clinic_checkin(cid: str, body: dict = Body(default={})):
    """Morning daily check-in (Section 12.2 & 14.1)."""
    _need(cid)
    res = clinic.execute_checkin(store, cid, body.get("vitals"), body.get("reaction_ms"), body.get("profile_answer"))
    audit.record("brain", "clinic.checkin_completed", cid, {"completeness": res.get("profile_completeness")})
    return res


@app.get("/api/clinic/protocol/{situation}")
def clinic_protocol(situation: str, env: str = "transit", mode: str = "routine"):
    """Protocol variants per environment and mode (Section 13.3 & 13.5)."""
    return envmod.get_protocol_variant(situation, env, mode)


@app.post("/api/safety/{cid}")
def safety_alert(cid: str, body: dict = Body(default={})):
    """W14 urgent wellbeing concern: alert the buddy and the commander (SIM) and queue an URGENT message for the
    flight surgeon or psychologist. Only the category travels, never the person's words."""
    _need(cid)
    cat = str(body.get("category", "severe_distress"))
    if cat not in safety.PATTERNS:
        raise HTTPException(400, "unknown category")
    who = safety.people(store.crew(), cid)
    prof = profiles.get(cid)
    buddy = (prof.get("sharing") or {}).get("buddy") or (prof.get("emergency") or {}).get("buddy")
    if buddy:
        who["buddy"] = buddy
    share_commander = (prof.get("sharing") or {}).get("shareUrgentWithCommander", True)
    if not share_commander:
        who["commander"] = "none (consent withheld)"
    name = store.get(cid).get("display_name", cid)
    p = ground.send(cid, "crisis", "Urgent wellbeing concern", {
        "text": f"URGENT wellbeing concern | crew: {name} | category: {cat.replace('_', ' ')} | buddy alerted: {who['buddy']} | "
                f"commander alerted: {who['commander']} | onboard: safety script and grounding screen. Please contact the crew."}, "URGENT", ops.hold_until())
    _notify_contacts(cid, "{name} needs you now", "{name} asked for support. Please go to them now and stay with them.", 3, "safety")   # the category never travels
    audit.record("brain", "safety.urgent_concern", cid, {"category": cat, "buddy_alerted": who["buddy"], "commander_alerted": who["commander"], "priority": "URGENT"})
    return {"category": cat, "label": "SIM", **who, "lines": [safety.LINES["first"], safety.LINES["then"].format(buddy=who["buddy"])], "packet": p}


@app.get("/api/wellbeing/toolkit")
def wellbeing_toolkit():
    """Support toolkit activities with mechanisms, triggers, and evidence (Section 15.5)."""
    return {"tools": TOOLKIT, "default_order": list(TOOLKIT.keys())}


@app.get("/api/wellbeing/scales")
def wellbeing_scales():
    """Clinician-approved brief psychological screening scales (Section 15.3 & FR-50)."""
    return {"scales": CLINICAL_SCALES}


@app.get("/api/wellbeing/team/cohesion")
def wellbeing_team_cohesion():
    """Team communication balance and cohesion note (Section 15.7, Inadequate Teamwork risk)."""
    states = {c["crew_id"]: store.get(c["crew_id"]) for c in store.crew()}
    return wellbeing.evaluate_team_cohesion(states)


@app.get("/api/wellbeing/{cid}")
def wellbeing_get(cid: str):
    """Four-dimensional mental wellbeing assessment (Section 15.2 & 15.4)."""
    _need(cid)
    s = store.get(cid)
    drift = s.get("drift") or {}
    prof = profiles.get(cid)
    return wellbeing.evaluate(cid, s, drift, profile=prof)


@app.post("/api/wellbeing/{cid}/session")
def wellbeing_record_session(cid: str, body: dict = Body(...)):
    """Record intervention session before/after scores for closed-loop learning (Section 15.6, FR-45)."""
    _need(cid)
    tid = str(body.get("tool_id", ""))
    pre_s = float(body.get("pre_stress", 0.0))
    post_s = float(body.get("post_stress", 0.0))
    pre_m = float(body["pre_mood"]) if "pre_mood" in body and body["pre_mood"] is not None else None
    post_m = float(body["post_mood"]) if "post_mood" in body and body["post_mood"] is not None else None
    sess = wellbeing.record_session(cid, tid, pre_s, post_s, pre_mood=pre_m, post_mood=post_m)
    audit.record("brain", "wellbeing.session_recorded", cid, {"tool": tid, "delta_stress": sess["delta_stress"], "effective": sess["effective"]})
    return sess


@app.get("/api/wellbeing/{cid}/ranking")
def wellbeing_tool_ranking(cid: str):
    """Personalized tool ranking based on empirical closed-loop efficacy (Section 15.6, FR-45)."""
    _need(cid)
    prof = profiles.get(cid)
    return {"ranked_tools": wellbeing.get_ranked_tools(cid, profile=prof)}


@app.post("/api/wellbeing/{cid}/spike")
def wellbeing_stress_spike(cid: str, body: dict = Body(default={})):
    """W13 Stress spike: Ask strength (1 to 5), offer Orb Calm or breathing, recheck in minutes."""
    _need(cid)
    strength = int(body.get("strength", 3))
    chosen_tool = str(body.get("tool", "orb_calm"))
    res = wellbeing.handle_stress_spike(cid, strength, chosen_tool=chosen_tool)
    audit.record("brain", "wellbeing.stress_spike", cid, {"strength": strength, "tool": chosen_tool})
    return res


@app.get("/api/wellbeing/{cid}/journal")
def wellbeing_journal_list(cid: str):
    """List on-device private journal entries (Section 15.5 & 15.7, FR-47)."""
    _need(cid)
    return {"entries": wellbeing.list_journal_entries(cid)}


@app.post("/api/wellbeing/{cid}/journal")
def wellbeing_journal_add(cid: str, body: dict = Body(...)):
    """Create encrypted on-device private journal entry (Section 15.5 & 15.7, FR-47)."""
    _need(cid)
    try:
        entry = wellbeing.add_journal_entry(
            cid,
            text=str(body.get("text", "")),
            tags=body.get("tags"),
            mood=body.get("mood"),
        )
    except ValueError as e:
        raise HTTPException(400, str(e))
    audit.record("brain", "wellbeing.journal_logged", cid, {"tags": entry.get("tags")})  # note text is NEVER audited
    return entry


@app.delete("/api/wellbeing/{cid}/journal/{entry_id}")
def wellbeing_journal_delete(cid: str, entry_id: str):
    """Delete an on-device private journal entry (Section 15.7)."""
    _need(cid)
    deleted = wellbeing.delete_journal_entry(cid, entry_id)
    if not deleted:
        raise HTTPException(404, f"journal entry {entry_id} not found")
    audit.record("brain", "wellbeing.journal_deleted", cid, {"entry_id": entry_id})
    return {"ok": True, "deleted": entry_id}


# ---- Section 16.1 Screen 2: Indicator Detail ----
@app.get("/api/indicator/{cid}/{metric}")
def indicator_detail_get(cid: str, metric: str):
    """Detailed view for one physiological reading with clinical facts, trends, and estimates (Section 16.1)."""
    _need(cid)
    return store.indicator_detail(cid, metric)


# ---- Section 16.1 Screens 4, 5, 6: Care (Triage, Protocol Runner, Care Log) ----
@app.get("/api/care/triage/questions")
def care_triage_questions(zone: str = "head"):
    """Structured triage questions per body zone (Section 16.1)."""
    return {"zone": zone, "questions": care.get_triage_questions(zone)}


@app.post("/api/care/triage/{cid}")
def care_triage_evaluate(cid: str, body: dict = Body(...)):
    """Evaluate triage inputs, check for red flags, and determine protocol (Section 16.1)."""
    _need(cid)
    zone = str(body.get("zone", "head"))
    answers = body.get("answers", {})
    symptom = str(body.get("symptom", ""))
    prof = profiles.get(cid)
    sev = body.get("severity")
    sev = int(sev) if isinstance(sev, (int, float)) and not isinstance(sev, bool) and 0 <= sev <= 10 else None
    res = care.evaluate_triage(cid, zone, answers, symptom_name=symptom, profile=prof, severity=sev)
    audit.record("brain", "care.triage_completed", cid, {"zone": zone, "urgency": res["urgency"], "red_flags": res["red_flags"]})
    if body.get("log", False):
        # the page's triage flow: keep the outcome in the care log; urgent goes to ground now (W4, 19.2)
        care._append_log(cid, {"type": "triage", "zone": zone, "symptom": symptom, "severity": sev, "urgency": res["urgency"],
                               "protocol": res["protocol_title"], "outcome": "Urgent: escalated" if res["urgency"] >= 3 else "Recommendation shown"})
        try:
            store.record_non_reading(cid, "symptom", {"zone": zone, "type": symptom or "unspecified", "severity": sev if sev is not None else 0,
                                                       "onset": str(body.get("onset", "now")), "duration": str(body.get("duration", ""))})
        except (ValueError, TypeError, KeyError):
            pass
        if res["urgency"] >= 3:
            s = store.get(cid)
            d = ops.digest(cid, s, store.assessment(cid), suits.status(cid), f"Triage: {symptom or zone}, urgent")
            res["packet"] = ground.send(cid, "digest", "Digest: URGENT (triage)", {"text": d["text"]}, "URGENT", ops.hold_until())
            res["alerted"] = safety.people(store.crew(), cid)
            _notify_contacts(cid, "{name} needs help now", "{name} reported an urgent symptom. Go to them, and follow the mission's emergency procedure. A priority digest has gone to the flight surgeon.", 3, "urgent")
            audit.record("brain", "digest.queued", cid, {"priority": "URGENT", "reason": "triage"})
    return res


@app.post("/api/care/protocol/start")
def care_protocol_start(body: dict = Body(...)):
    """Start step-by-step clinical protocol runner with timers and checklist (Section 16.1)."""
    cid = str(body.get("crew_id", ""))
    _need(cid)
    proto_id = str(body.get("protocol_id", "headache_tx"))
    try:
        run = care.start_protocol(cid, proto_id, context=body.get("context"))
    except KeyError as e:
        raise HTTPException(404, str(e))
    audit.record("brain", "care.protocol_started", cid, {"run_id": run["run_id"], "protocol": run["title"]})
    # the alert this answers moves to "acting" (19.4): the newest open one for this person
    open_alerts = sorted(alerts.open_for(cid), key=lambda a: a.get("created_at", 0))
    if open_alerts:
        alerts.start_acting(open_alerts[-1]["alert_id"], run["run_id"])
        alerts.save()
        run["alert_id"] = open_alerts[-1]["alert_id"]
    return run


def _alert_for_run(run_id: str) -> dict | None:
    return next((a for a in alerts.alerts.values() if a.get("protocol_run_id") == run_id and a.get("state") in ("acting", "rechecking")), None)


@app.post("/api/care/protocol/{run_id}/step")
def care_protocol_step(run_id: str, body: dict = Body(...)):
    """Advance or check off step in active protocol run (Section 16.1)."""
    step_num = int(body.get("step_num", 1))
    done = bool(body.get("done", True))
    try:
        run = care.update_step(run_id, step_num, done=done)
    except KeyError as e:
        raise HTTPException(404, str(e))
    audit.record("brain", "care.protocol_step", run["crew_id"], {"run_id": run_id, "step_num": step_num, "done": done})
    return run


@app.post("/api/care/protocol/{run_id}/pause")
def care_protocol_pause(run_id: str):
    """Pause active protocol run."""
    try:
        run = care.pause_protocol(run_id)
    except KeyError as e:
        raise HTTPException(404, str(e))
    audit.record("brain", "care.protocol_paused", run["crew_id"], {"run_id": run_id})
    return run


@app.post("/api/care/protocol/{run_id}/resume")
def care_protocol_resume(run_id: str):
    """Resume paused protocol run."""
    try:
        run = care.resume_protocol(run_id)
    except KeyError as e:
        raise HTTPException(404, str(e))
    audit.record("brain", "care.protocol_resumed", run["crew_id"], {"run_id": run_id})
    return run


@app.post("/api/care/protocol/{run_id}/escalate")
def care_protocol_escalate(run_id: str, body: dict = Body(default={})):
    """Escalate protocol run to flight surgeon."""
    try:
        run = care.escalate_protocol(run_id, note=str(body.get("note", "")))
    except KeyError as e:
        raise HTTPException(404, str(e))
    audit.record("brain", "care.protocol_escalated", run["crew_id"], {"run_id": run_id, "note": run.get("escalation_note")})
    a = _alert_for_run(run_id)
    if a:
        alerts.escalate_alert(a["alert_id"], note=run.get("escalation_note") or "Not resolving after the protocol steps")
        alerts.save()
    # not resolving: the digest goes to the flight surgeon now (19.4 Escalated), with what was done
    cid = run["crew_id"]
    done = sum(1 for s in run["steps"] if s["done"])
    d = ops.digest(cid, store.get(cid), store.assessment(cid), suits.status(cid), f"{run['title']}: {done} of {len(run['steps'])} steps done, no improvement. {run.get('escalation_note') or ''}"[:200])
    run["packet"] = ground.send(cid, "digest", f"Digest: ACT ({run['title']})", {"text": d["text"]}, "URGENT" if d["priority"] == "URGENT" else "ACT", ops.hold_until())
    audit.record("brain", "digest.queued", cid, {"priority": run["packet"].get("priority"), "reason": "protocol not resolving"})
    _notify_contacts(cid, "{name} could use a check-in", "{name} went through the care steps without relief, and it has gone to the flight surgeon. Look in on them when you can.", 2, "escalated")
    return run


@app.post("/api/care/protocol/{run_id}/complete")
def care_protocol_complete(run_id: str, body: dict = Body(default={})):
    """Complete protocol run and record outcome in Care Log."""
    outcome = str(body.get("outcome", "Resolved nominal"))
    try:
        run = care.complete_protocol(run_id, outcome=outcome)
    except KeyError as e:
        raise HTTPException(404, str(e))
    audit.record("brain", "care.protocol_completed", run["crew_id"], {"run_id": run_id, "outcome": outcome})
    a = _alert_for_run(run_id)
    if a:
        alerts.resolve_alert(a["alert_id"], outcome=outcome)
        alerts.save()
    return run


@app.get("/api/care/protocol/{run_id}")
def care_protocol_get(run_id: str):
    """Get active protocol run status."""
    try:
        return care.get_protocol_run(run_id)
    except KeyError as e:
        raise HTTPException(404, str(e))


@app.get("/api/care/log/{cid}")
def care_log_get(cid: str):
    """Care history log for past symptoms, protocols, and kit usage (Section 16.1)."""
    _need(cid)
    return care.get_care_log(cid)


# ---- Section 16.1 Screen 8: Plan (Reminders, Schedules, Conflicts) ----
@app.get("/api/plan/{cid}")
def plan_get(cid: str):
    """Today's reminders list, schedule template, and schedule conflict detection (Section 16.1)."""
    _need(cid)
    prof = profiles.get(cid)
    clock = store.mission_clock()
    return plan.get_plan(cid, profile=prof, current_hour=clock.get("hour", 8) + clock.get("minute", 0) / 60.0,
                         day=int(clock.get("mission_day", 0)))


@app.post("/api/plan/{cid}/snooze")
def plan_snooze(cid: str, body: dict = Body(...)):
    """Snooze a reminder by N minutes (Section 16.1)."""
    _need(cid)
    rem_id = str(body.get("reminder_id", ""))
    mins = int(body.get("minutes", 15))
    try:
        rem = plan.snooze_reminder(cid, rem_id, minutes=mins, day=int(store.mission_clock().get("mission_day", 0)))
    except ValueError as e:
        raise HTTPException(400, str(e))
    audit.record("brain", "plan.reminder_snoozed", cid, {"reminder_id": rem_id, "minutes": mins, "count": rem.get("snooze_count")})
    return rem


@app.post("/api/plan/{cid}/complete")
def plan_complete(cid: str, body: dict = Body(...)):
    """Mark a reminder done (Section 16.1)."""
    _need(cid)
    rem_id = str(body.get("reminder_id", ""))
    rem = plan.complete_reminder(cid, rem_id, day=int(store.mission_clock().get("mission_day", 0)))
    audit.record("brain", "plan.reminder_completed", cid, {"reminder_id": rem_id})
    return rem


@app.post("/api/plan/{cid}/reminder")
def plan_add_reminder(cid: str, body: dict = Body(...)):
    """Add a custom reminder (Section 16.1 & 25.1)."""
    _need(cid)
    title = str(body.get("title", ""))
    time_str = str(body.get("time", "12:00"))
    rem_type = str(body.get("type", "measurement"))
    rem = plan.add_reminder(cid, title, time_str, rem_type=rem_type, linked=body.get("linked"))
    audit.record("brain", "plan.reminder_added", cid, {"id": rem["id"], "title": title})
    return rem


# ---- Section 20: Reminders & Scheduling Algorithm ----
@app.post("/api/plan/{cid}/expand-7days")
def plan_expand_7days(cid: str, body: dict = Body(default={})):
    """Step 1: On profile load, expand the schedule template into reminders for the next seven days."""
    _need(cid)
    prof = profiles.get(cid)
    start_day = int(body.get("start_day") or store.mission_clock().get("mission_day", 120))
    rems = plan.expand_schedule_7days(cid, profile=prof, start_day=start_day)
    audit.record("brain", "plan.schedule_expanded", cid, {"count": len(rems), "start_day": start_day})
    return {"crew_id": cid, "count": len(rems), "reminders": rems}


@app.post("/api/plan/{cid}/tick")
def plan_tick(cid: str, body: dict = Body(default={})):
    """Steps 2 & 3: One-minute tick moves due reminders to 'due' and respects sleep and EVA blocks."""
    _need(cid)
    current_hour = body.get("current_hour")
    if current_hour is None:
        clock = store.mission_clock()
        current_hour = clock.get("hour", 8) + clock.get("minute", 0) / 60.0
    current_mode = ops.status(cid, store.get(cid))["mode"]
    prof = profiles.get(cid)
    sleep_block = (prof.get("mission") or {}).get("sleepBlock", "22:00-06:00")
    res = plan.tick_one_minute(cid, float(current_hour), mode=current_mode, sleep_block=sleep_block)
    return res


@app.post("/api/plan/{cid}/miss")
def plan_handle_miss(cid: str, body: dict = Body(...)):
    """Steps 4 & 5: Handle missed reminder, soft prompt re-presentation, and consecutive miss digest alert."""
    _need(cid)
    rem_id = str(body.get("reminder_id", ""))
    miss_min = int(body.get("miss_after_min", 15))
    retry_min = int(body.get("retry_min", 10))
    try:
        res = plan.handle_miss(cid, rem_id, miss_after_min=miss_min, retry_min=retry_min)
        if res.get("state") == "missed":   # the second miss: counted (a wellbeing signal, never a judgment), three add a digest line
            n = int((store.get(cid).get("engagement") or {}).get("missed_checkins", 0)) + 1
            store.patch(cid, {"engagement": {"missed_checkins": n}}, record=False)
            res.update(missed_checkins_count=n, consecutive_alert=n >= 3,
                       digest_note="Three scheduled check-ins were not completed." if n >= 3 else "")
        audit.record("brain", "plan.reminder_missed", cid, {"reminder_id": rem_id, "consecutive_alert": res.get("consecutive_alert")})
        return res
    except KeyError as e:
        raise HTTPException(404, str(e))


@app.post("/api/plan/{cid}/recheck")
def plan_create_recheck(cid: str, body: dict = Body(...)):
    """Step 6: Accepting a recommendation creates a recheck reminder at now plus recheckAfterMin."""
    _need(cid)
    protocol_title = str(body.get("protocol_title", "Clinical Protocol"))
    interval_min = int(body.get("recheck_after_min", 45))
    clock = store.mission_clock()
    current_hour = clock.get("hour", 8) + clock.get("minute", 0) / 60.0
    rem = plan.create_recheck_reminder(cid, protocol_title, recheck_after_min=interval_min, current_hour_dec=current_hour)
    audit.record("brain", "plan.recheck_created", cid, {"protocol": protocol_title, "interval_min": interval_min})
    return rem


# ---- Section 16.1 Screen 7: Trends & Correlation ----
@app.get("/api/trends/{cid}")
def trends_get(cid: str, days: int = 7):
    """Multi-indicator trends, sleep vs reaction correlation, and data sufficiency flag (Section 16.1)."""
    _need(cid)
    return trends.get_trends(cid, store, days=days)


# ---- Section 16.1 Screen 13: Onboarding First Run ----
@app.get("/api/onboarding/{cid}")
def onboarding_status_get(cid: str):
    """Onboarding first run status, checklist, and resumable step (Section 16.1)."""
    _need(cid)
    return onboarding.get_status(cid)


@app.post("/api/onboarding/{cid}/step")
def onboarding_step_complete(cid: str, body: dict = Body(...)):
    """Advance resumable onboarding step (Section 16.1)."""
    _need(cid)
    step_id = str(body.get("step_id", ""))
    res = onboarding.complete_step(cid, step_id, metadata=body.get("metadata"))
    audit.record("brain", "onboarding.step_completed", cid, {"step_id": step_id})
    return res


@app.post("/api/suit/{cid}")
def suit_action(cid: str, body: dict = Body(default={})):
    """SIM suit telemetry: {"action": "eva" | "iva" | "leak" | "seal", "region": ..., "size": "slow" | "leak" | "major"}."""
    _need(cid)
    a = str(body.get("action", ""))
    audit.record("brain", f"suit.{a or 'unknown'}", cid, {"region": body.get("region"), "size": body.get("size")})
    if a in ("eva", "iva"):
        ops.set_mode(cid, "eva" if a == "eva" else "routine")   # the EVA overlay: reminders pause, suit watched
        st = suits.set_mode(cid, a)
        if a == "eva":
            st["readiness"] = ops.readiness(store.get(cid), st)
        return st
    if a == "leak":
        region = body.get("region") or region_from_text(str(body.get("text", "")))
        if region not in SUIT_REGIONS:
            raise HTTPException(400, f"unknown suit region {region}")
        st = suits.leak(cid, region, str(body.get("size", "leak")))
        # the whole crew is told: each finds it in their inbox, shown and spoken when they are at the screen
        me = store.get(cid)["display_name"]
        for c in store.crew():
            if c["crew_id"] != cid:
                notes.add(c["crew_id"], f"{me}: suit pressure dropping", f"{me}'s suit is losing pressure at the {st.get('region_label') or region} during the EVA. Be ready to help them back to the airlock.",
                          about_cid=cid, about_name=me, level=3, kind="suit")
        audit.record("brain", "notify.crew", cid, {"kind": "suit", "told": len(store.crew()) - 1})
        return st
    if a == "seal":
        return suits.seal(cid)
    raise HTTPException(400, "action must be eva, iva, leak or seal")


@app.post("/api/skin/{cid}")
def skin_toggle(cid: str, body: dict = Body(...)):
    """Switch the Sentinel Skin SIM data source on or off for one crew member (demo only)."""
    _need(cid)
    skin.set(cid, bool(body.get("on", True)))
    return skin.aux(cid, store.get(cid), int(store.mission_clock().get("mission_day", 0)))


@app.get("/api/history/{cid}")
def history(cid: str, field: str):
    _need(cid)
    return {"field": field, "points": store.history_for(cid, field)}


@app.post("/api/log/{cid}")
def log_event(cid: str, body: dict = Body(...)):
    _need(cid)
    try:
        store.log(cid, body.get("field", ""), float(body.get("value")), body.get("source", "user"))
    except (ValueError, TypeError) as e:
        raise HTTPException(422, str(e))
    audit.record("brain", "reading.logged", cid, {"field": body.get("field"), "source": body.get("source", "user")})
    return {"ok": True}


@app.post("/api/chat")
def chat(body: dict = Body(...)):
    cid = body.get("crew_id")
    _need(cid)
    transcript = llm.normalize(str(body.get("transcript", ""))[:500])
    state = dict(store.get(cid))
    state["suit"] = suits.status(cid)
    state["devices"] = devices.summary(cid, state["suit"])
    return llm.chat(state, transcript, crew_id=cid)


def _app_context(ctx) -> dict:
    """What is on screen and who the crew are, for the brain (strings only, bounded)."""
    ctx = ctx if isinstance(ctx, dict) else {}
    out = {k: str(ctx[k])[:40] for k in ("screen", "view", "theme") if isinstance(ctx.get(k), str)}
    out["crew"] = [c["display_name"] for c in store.crew()] if hasattr(store, "crew") else []
    return out


@app.post("/api/warm")
def warm():
    """The app calls this when it loads so the first spoken turn does not pay for cold connections."""
    threading.Thread(target=llm.warm_llm, daemon=True).start()
    threading.Thread(target=speech.warm_speech, daemon=True).start()
    return {"ok": True}


# ---- Section 17: What We Track & NASA MRID Single Source of Truth ----
@app.get("/api/indicators")
def indicators_catalog():
    """Tracked indicators catalog (Section 17: What We Track).
    All 22 indicators with independence groups, HRP risks, worse-when directions,
    and NASA MRID single source of truth citations.
    """
    return {
        "count": len(indmod.TRACKED_INDICATORS),
        "indicators": indmod.TRACKED_INDICATORS,
        "groups": indmod.INDEPENDENCE_GROUPS,
    }


@app.get("/api/indicators/groups")
def indicators_groups():
    """The 15 independence groups used for the Section 17 Group Rule."""
    mapping: dict[str, list[str]] = {}
    for ind_id, ind in indmod.TRACKED_INDICATORS.items():
        mapping.setdefault(ind["group"], []).append(ind_id)
    return {
        "groups": indmod.INDEPENDENCE_GROUPS,
        "group_to_indicators": mapping,
    }


@app.get("/api/indicators/{indicator_id}")
def indicator_get(indicator_id: str):
    """Single indicator definition with NASA MRID single source of truth evidence."""
    ind_id = indmod.resolve_indicator_id(indicator_id)
    if not ind_id or ind_id not in indmod.TRACKED_INDICATORS:
        raise HTTPException(404, f"indicator {indicator_id} not found")
    data = dict(indmod.TRACKED_INDICATORS[ind_id])
    data["mrid_evidence"] = indmod.get_indicator_mrid_evidence(ind_id)
    return data


@app.post("/api/pattern/evaluate")
def pattern_evaluate(body: dict = Body(...)):
    """Evaluate Layer 4 pattern across signals per Section 17 Group Rule:
    'Two indicators in the same group count as one signal. Two or more independent
    signal groups moving the wrong way inside one window raise a pattern flag.'
    """
    drifts = body.get("drift_items", [])
    absolutes = body.get("absolute_items", [])
    return indmod.evaluate_pattern_layer(drifts, absolutes)


@app.get("/api/dataset/mrid")
def dataset_mrid_list():
    """Authoritative NASA JSC 28913 MRID dataset single source of truth (68 documents)."""
    docs = indmod.load_mrid_database()
    return {"count": len(docs), "documents": docs}


@app.get("/api/dataset/mrid/{mrid_id}")
def dataset_mrid_get(mrid_id: str):
    """Retrieve specific NASA MRID document by ID from dataset single source of truth."""
    docs = indmod.load_mrid_database()
    doc = next((d for d in docs if d.get("id") == mrid_id or mrid_id.lower() in d.get("id", "").lower()), None)
    if not doc:
        raise HTTPException(404, f"NASA MRID document {mrid_id} not found in single source of truth")
    return doc


@app.get("/api/dataset/verify")
def dataset_verify():
    """Verify that every tracked indicator is grounded in NASA MRIDs and all thresholds
    have kind and source citations with zero invented limits (Section 17).
    """
    return indmod.verify_single_source_of_truth()


@app.post("/api/records/{cid}/{record_type}")
def records_add(cid: str, record_type: str, body: dict = Body(...)):
    """Add a non-reading record (Section 17): symptoms, protocol runs, kit usage,
    alert feedback, schedule context, data-quality scores, mood tags, journal entries,
    crew pulse, audit log.
    """
    _need(cid)
    try:
        rec = store.record_non_reading(cid, record_type, body)
        audit.record("brain", f"record.{record_type}", cid, {"type": record_type})
        return {"ok": True, "record_type": record_type, "record": rec}
    except (ValueError, TypeError) as e:
        raise HTTPException(422, str(e))


@app.get("/api/records/{cid}")
def records_get_all(cid: str):
    """Get all non-reading records for a crew member."""
    _need(cid)
    return {"crew_id": cid, "records": store.get_non_reading(cid)}


@app.get("/api/records/{cid}/{record_type}")
def records_get_type(cid: str, record_type: str):
    """Get non-reading records of a specific type."""
    _need(cid)
    return {"crew_id": cid, "record_type": record_type, "records": store.get_non_reading(cid, record_type)}


# ---- Sections 18 & 19: The 9-Stage Pipeline, 5 Layers, and Alert Lifecycle ----
@app.post("/api/pipeline/process")
def pipeline_process(body: dict = Body(...)):
    """Execute the full 9-stage Sentinel clinical intelligence pipeline (Section 19.1)."""
    cid = str(body.get("crew_id", "james"))
    _need(cid)
    raw = body.get("reading", body)
    prof = profiles.get(cid)

    # 1. Ingest
    try:
        ingested = pipeline.ingest(raw)
    except ValueError as e:
        raise HTTPException(400, f"Ingest failed: {e}")

    # 2. Validate
    last_pts = store.history_for(cid, ingested["metric"])
    last_reading = last_pts[-1] if last_pts else None
    validated = pipeline.validate(ingested, last_reading)
    if not validated["valid"]:
        return {"ok": False, "stage": "validation_failed", "validation": validated}

    # 3. Normalize
    normalized = pipeline.normalize(validated)

    # 4. Store
    stored = pipeline.store_reading(cid, normalized, store=store)

    # 5. Derive
    history = store.history_for(cid, normalized["metric"])
    derived = pipeline.derive(cid, history)

    # 6. Assess (5 layers, cheapest first)
    spec = store.thresholds.get("absolute", {}).get(normalized["metric"])
    asmt = pipeline.assess(
        cid=cid,
        current_value=normalized["value"],
        metric=normalized["metric"],
        derived=derived,
        absolute_thresholds=spec,
        context=raw.get("context", {}),
        confidence=normalized.get("confidence", 1.0),
    )

    # 7. Decide
    env_str = ops.status(cid, store.get(cid))["env"]
    mode_str = ops.status(cid, store.get(cid))["mode"]
    decision = pipeline.decide(
        cid=cid,
        level=asmt["level"],
        symptom=raw.get("symptom", normalized["metric"]),
        zone=raw.get("zone", "whole_body"),
        reasons=asmt["reasons"],
        profile=prof,
        env=env_str,
        mode=mode_str,
    )

    # 8. Present
    quiet = store._quiet(cid) if hasattr(store, "_quiet") else False
    presentation = pipeline.present(decision, quiet_hours=quiet)

    # Manage alert lifecycle
    alt = None
    if asmt["level"] >= 1:
        alt = alerts.create_alert(
            crew_id=cid,
            cause_id=normalized["metric"],
            level=asmt["level"],
            title=decision["recommendation_card"]["protocol_title"] or f"Alert for {normalized['metric']}",
            reason="; ".join(asmt["reasons"]),
            rule_id=f"rule_{normalized['metric']}",
            readings={normalized["metric"]: normalized["value"]},
            baseline={normalized["metric"]: derived.get("median")},
            source=normalized["source"],
            mrid="NASA JSC 28913",
            quiet_hours=quiet,
        )

    return {
        "ok": True,
        "crew_id": cid,
        "normalized": normalized,
        "derived": derived,
        "assessment": asmt,
        "decision": decision,
        "presentation": presentation,
        "alert": alt,
    }


@app.post("/api/pipeline/validate")
def pipeline_validate(body: dict = Body(...)):
    """Validate a reading for sanity and plausible change (Section 19.1 Stage 2)."""
    raw = body.get("reading", body)
    try:
        ingested = pipeline.ingest(raw)
        validated = pipeline.validate(ingested, body.get("last_reading"))
        return validated
    except ValueError as e:
        raise HTTPException(422, str(e))


@app.post("/api/pipeline/assess")
def pipeline_assess(body: dict = Body(...)):
    """Evaluate 5 layers anomaly assessment on a metric (Section 19.2)."""
    cid = str(body.get("crew_id", "james"))
    _need(cid)
    metric = str(body.get("metric", "vitals.heart_rate"))
    val = float(body.get("value", 80.0))
    derived = body.get("derived") or pipeline.derive(cid, store.history_for(cid, metric))
    spec = store.thresholds.get("absolute", {}).get(metric)
    asmt = pipeline.assess(
        cid=cid,
        current_value=val,
        metric=metric,
        derived=derived,
        absolute_thresholds=spec,
        context=body.get("context", {}),
        confidence=float(body.get("confidence", 1.0)),
    )
    return asmt


# ---- Alert Lifecycle & Fatigue Controls (Sections 19.4 & 19.5) ----
@app.get("/api/alerts/{cid}")
def alerts_list(cid: str):
    """List active and historic alerts for a crew member."""
    _need(cid)
    crew_alerts = [a for a in alerts.alerts.values() if a.get("crew_id") == cid]
    return {"crew_id": cid, "alerts": crew_alerts}


@app.post("/api/alerts/{cid}/tick")
def alerts_tick(cid: str):
    """Unanswered alerts: which to present again (louder), and which expired. A missed urgent alert alerts the buddy."""
    _need(cid)
    r = alerts.tick(cid)
    if r["represent"] or r["expired"]:
        alerts.save()
    for a in r["expired"]:
        who = safety.people(store.crew(), cid)
        a["buddy"] = who["buddy"] if a.get("level", 1) >= 3 else None
        if a.get("level", 1) >= 3:
            _notify_contacts(cid, "{name} has not answered an urgent alert", "{name} did not respond to an urgent alert on Sentinel. Please check on them now.", 3, "unanswered")
        audit.record("brain", "alert.expired", cid, {"alert_id": a["alert_id"], "level": a.get("level"), "buddy_alerted": a["buddy"]})
    for a in r["represent"]:
        audit.record("brain", "alert.represented", cid, {"alert_id": a["alert_id"], "count": a.get("represent_count")})
    return r


@app.post("/api/alerts/{cid}/acknowledge-open")
def alerts_ack_open(cid: str, body: dict = Body(default={})):
    """The banner's Acknowledge: every open alert at or above a level is marked seen."""
    _need(cid)
    lvl = int(body.get("min_level", 3))
    done = [alerts.acknowledge_alert(a["alert_id"], reason="Acknowledged on the banner")["alert_id"]
            for a in alerts.open_for(cid) if a.get("level", 1) >= lvl and a.get("state") != "acknowledged"]
    if done:
        alerts.save()
        audit.record("brain", "alert.acknowledged", cid, {"count": len(done), "via": "banner"})
    return {"acknowledged": done}


@app.post("/api/alerts/{alert_id}/acknowledge")
def alert_acknowledge(alert_id: str, body: dict = Body(default={})):
    """Acknowledge alert when user has seen it (Section 19.4)."""
    reason = str(body.get("reason", "Accepted steps"))
    try:
        alt = alerts.acknowledge_alert(alert_id, reason=reason)
        alerts.save()
        audit.record("brain", "alert.acknowledged", alt["crew_id"], {"alert_id": alert_id, "reason": reason})
        return alt
    except KeyError as e:
        raise HTTPException(404, str(e))


@app.post("/api/alerts/{alert_id}/snooze")
def alert_snooze(alert_id: str, body: dict = Body(default={})):
    """Snooze alert with reason and limit check (Section 19.5). Urgent level 3 alerts blocked."""
    mins = int(body.get("minutes", 15))
    reason = str(body.get("reason", ""))
    try:
        alt = alerts.snooze_alert(alert_id, minutes=mins, reason=reason)
        alerts.save()
        audit.record("brain", "alert.snoozed", alt["crew_id"], {"alert_id": alert_id, "minutes": mins, "reason": reason})
        return alt
    except KeyError as e:
        raise HTTPException(404, str(e))
    except ValueError as e:
        raise HTTPException(400, str(e))


@app.get("/api/alerts/{alert_id}/explain")
def alert_explain(alert_id: str):
    """'Why this?' plain-words explainability breakdown citing readings, baseline, and NASA MRID (Section 19.5)."""
    try:
        return alerts.explain_alert(alert_id)
    except KeyError as e:
        raise HTTPException(404, str(e))


@app.post("/api/alerts/{alert_id}/feedback")
def alert_feedback(alert_id: str, body: dict = Body(...)):
    """Record 'useful' or 'not useful' feedback to adapt rule sensitivity within bounds (Section 19.5)."""
    useful = bool(body.get("useful", True))
    reason = str(body.get("reason", ""))
    try:
        res = alerts.record_feedback(alert_id, useful=useful, reason=reason)
        alerts.save()
        with store.lock:   # the new sensitivity applies from now on
            for c in list(store.states):
                store._recompute(c)
        audit.record("brain", "alert.feedback", None, {"alert_id": alert_id, "useful": useful, "reason": reason})
        return res
    except KeyError as e:
        raise HTTPException(404, str(e))


# ---- Protocol Library & Recommendation Cards (Sections 19.3, 19.4, 19.5) ----
@app.get("/api/protocols")
def protocols_list(env: str = "transit", mode: str = "routine"):
    """List all 10 clinical protocols with NASA MRID grounding and verification status (Section 19.4)."""
    out = []
    for pid in protomod.PROTOCOLS_CATALOG:
        proto = protomod.get_protocol(pid, env=env, mode=mode)
        if proto:
            out.append(proto)
    return {"count": len(out), "protocols": out}


@app.get("/api/protocols/{protocol_id}")
def protocol_get_one(protocol_id: str, env: str = "transit", mode: str = "routine"):
    """Get single clinical protocol with environment and mode variants (Section 19.4 & 19.5)."""
    proto = protomod.get_protocol(protocol_id, env=env, mode=mode)
    if not proto:
        raise HTTPException(404, f"Protocol {protocol_id} not found")
    return proto


@app.post("/api/care/recommendation")
def care_recommendation_generate(body: dict = Body(...)):
    """Generate structured Section 19.3 Recommendation Card (seen, sure, now, use, recheck, escalate_if, why)."""
    cid = str(body.get("crew_id", "james"))
    _need(cid)
    level = int(body.get("level", 1))
    proto_id = body.get("protocol_id")
    proto = protomod.get_protocol(proto_id) if proto_id else None
    prof = profiles.get(cid)
    card = protomod.build_recommendation_card(
        cid=cid,
        level=level,
        trigger_summary=str(body.get("trigger_summary", "Clinical observation")),
        protocol=proto,
        sure=str(body.get("sure", "High")),
        sure_reason=str(body.get("sure_reason", "Sourced clinical protocol match")),
        env=str(body.get("env", "transit")),
        mode=str(body.get("mode", "routine")),
        profile=prof,
    )
    return card



@app.post("/api/chat/stream")
def chat_stream(body: dict = Body(...)):
    """NDJSON: one {"type":"sentence"} line per complete sentence as the LLM writes it, then {"type":"final"}."""
    cid = body.get("crew_id")
    _need(cid)
    transcript = llm.normalize(str(body.get("transcript", ""))[:500])
    state = dict(store.get(cid))
    state["app"] = _app_context(body.get("context"))
    state["suit"] = suits.status(cid)
    state["ops"] = ops.status(cid, state)
    state["devices"] = devices.summary(cid, state["suit"])   # what is connected now and what each last reported

    def gen():
        for ev in llm.chat_stream(state, transcript, crew_id=cid):
            yield json.dumps(ev) + chr(10)
    return StreamingResponse(gen(), media_type="application/x-ndjson", headers={"Cache-Control": "no-store", "X-Accel-Buffering": "no"})


@app.post("/api/chat/forget")
def chat_forget(body: dict = Body(default={})):
    llm.forget(body.get("crew_id"))
    return {"ok": True}


@app.post("/api/card/rephrase")
def card_rephrase(body: dict = Body(...)):
    """Rephrase a recommendation card (FACE-7, FACE-9, SF4, SF7)."""
    card = body.get("card") or {}
    lang = str(body.get("lang") or "en")
    cid = body.get("crew_id")
    state = store.get(cid) if cid and cid in store.states else None
    return llm.rephrase_card(card, lang=lang, state=state)



@app.post("/api/face/emotion")
async def face_emotion(request: Request):
    """Cropped face image bytes -> {emotion, scores (8 emotions), valence, arousal, confidence, wording} (FACE-3, FACE-4)."""
    data = await request.body()
    if not data:
        raise HTTPException(400, "empty image")
    if len(data) > 2_000_000:
        raise HTTPException(413, "face crop larger than 2 MB")
    loop = asyncio.get_running_loop()
    try:
        return await loop.run_in_executor(None, lambda: llm.predict_face_emotion(data))
    except ValueError as e:
        raise HTTPException(400, str(e))
    except llm.FaceModelUnavailable as e:
        raise HTTPException(503, f"expression model unavailable: {e}")
    except Exception as e:
        print(f"[sentinel face] /api/face/emotion failed: {type(e).__name__}: {e}", flush=True)
        raise HTTPException(500, f"expression inference failed: {type(e).__name__}")


@app.post("/api/stt")
async def stt(request: Request, prefer: str = "auto"):
    """16 kHz WAV of one utterance -> {text, source: "groq" | "local"}."""
    wav = await request.body()
    if len(wav) < 1000:
        raise HTTPException(400, "audio too short")
    if len(wav) > 16000 * 2 * 20 + 1000:
        raise HTTPException(413, "utterance longer than 20 s")
    loop = asyncio.get_running_loop()
    try:
        out = await loop.run_in_executor(None, lambda: speech.stt(wav, prefer))
    except Exception as e:
        raise HTTPException(503, f"speech recognition unavailable: {type(e).__name__}")
    print(f"[sentinel heard] ({out.get('source')}) {out.get('text', '')!r}", flush=True)
    return out


@app.post("/api/tts")
async def tts(body: dict = Body(...)):
    """{text, voice?, engine?} -> audio (mp3 from ElevenLabs or wav from Kokoro), cached on disk."""
    text = str(body.get("text", ""))
    voice = str(body.get("voice") or speech.DEFAULT_VOICE)
    engine = str(body.get("engine") or "auto")
    loop = asyncio.get_running_loop()
    try:
        r = await loop.run_in_executor(None, lambda: speech.tts(text, voice, engine))
    except ValueError:
        raise HTTPException(400, "empty text")
    except Exception:
        raise HTTPException(503, "no speech engine available: use the browser voice")
    return Response(r["audio"], media_type=r["mime"], headers={"X-TTS-Source": r["source"], "X-TTS-Cached": str(r["cached"]).lower(), "Cache-Control": "no-store"})


@app.post("/api/ground/{cid}")
def ground_send(cid: str, body: dict = Body(...)):
    """Queue a packet for ground (SIM transport: store-and-forward with the one-way delay)."""
    _need(cid)
    try:
        return ground.send(cid, str(body.get("kind", "note")), str(body.get("title", "")), body.get("body") or {})
    except ValueError as e:
        raise HTTPException(422, str(e))


@app.get("/api/ground")
def ground_list(crew_id: str | None = None):
    return {"one_way_min": round(ground.one_way_s / 60, 1), "transport": "SIM", "packets": ground.list(crew_id)}


# ---- Section 21: Ground Handoff, Queue States & Delay Simulator ----
@app.get("/api/ground/{cid}/delay-simulator")
def ground_delay_simulator(cid: str):
    """Delay simulator split-screen view (Section 21).
    Left: 'what ground sees' (stale status and countdown)
    Right: 'what Sentinel did just now' (tagged onboard or escalated)
    """
    _need(cid)
    return ground.delay_simulator_view(cid, store=store)


@app.post("/api/ground/{packet_id}/acknowledge")
def ground_acknowledge(packet_id: str):
    """Acknowledge ground packet (Section 21 queue state: acknowledged)."""
    try:
        pkt = ground.acknowledge_packet(packet_id)
        audit.record("brain", "ground.packet_acknowledged", pkt.get("crew_id"), {"packet_id": packet_id})
        return pkt
    except KeyError as e:
        raise HTTPException(404, str(e))


@app.post("/api/ground/{packet_id}/reply")
def ground_reply(packet_id: str, body: dict = Body(...)):
    """Ground reply appears as a Ground card with instructions (Section 21)."""
    instructions = body.get("instructions", ["Confirm vitals and continue standard protocol."])
    author = str(body.get("author", "Flight Surgeon"))
    try:
        pkt = ground.receive_reply(packet_id, instructions=instructions, author=author)
        audit.record("brain", "ground.reply_received", pkt.get("crew_id"), {"packet_id": packet_id, "author": author})
        return pkt
    except KeyError as e:
        raise HTTPException(404, str(e))


@app.post("/api/ground/{packet_id}/confirm-step")
def ground_confirm_step(packet_id: str, body: dict = Body(...)):
    """Astronaut confirms each step on the Ground card before it is logged (Section 21)."""
    step_num = int(body.get("step_num", 1))
    try:
        reply = ground.confirm_reply_step(packet_id, step_num)
        audit.record("brain", "ground.reply_step_confirmed", None, {"packet_id": packet_id, "step_num": step_num})
        return reply
    except KeyError as e:
        raise HTTPException(404, str(e))


# ---- Section 19.5: Kit Filter (filterKit(kitItems, profile)) ----
@app.post("/api/kit/filter")
def kit_filter_endpoint(body: dict = Body(...)):
    """Evaluate filterKit(kitItems, profile) per Section 19.5.
    Returns allowed items, blocked items with reasons, and notes.
    """
    cid = body.get("crew_id")
    prof = profiles.get(cid) if cid and store.has(cid) else (body.get("profile") or {})
    kit_items = body.get("items")
    if kit_items is None:
        try:
            kit_data = json.loads((ROOT / "shared" / "med_kit.json").read_text(encoding="utf-8"))
            kit_items = kit_data.get("items", [])
        except Exception:
            kit_items = []
    from brain.profile import filter_kit_items
    return filter_kit_items(kit_items, prof)


@app.get("/api/voices")
def voices():
    return speech.voices()


@app.post("/api/identify")
async def identify(request: Request):
    if not SPEAKER_OK:
        return {"crew_id": None, "confidence": 0.0, "source": "unavailable"}
    data = await request.body()
    loop = asyncio.get_running_loop()
    try:
        return await loop.run_in_executor(None, speaker.identify, data)
    except Exception as e:
        return {"crew_id": None, "confidence": 0.0, "source": "error", "reason": str(e)}


@app.post("/api/enrol/{cid}")
async def enrol(cid: str, request: Request):
    _need(cid)
    if not SPEAKER_OK:
        raise HTTPException(503, "speaker ID is not installed; use the manual crew selector")
    data = await request.body()
    loop = asyncio.get_running_loop()
    try:
        return await loop.run_in_executor(None, speaker.enrol, cid, data)
    except Exception as e:
        raise HTTPException(422, f"could not enrol: {e}")


@app.post("/api/cabin")
def cabin(body: dict = Body(...)):
    if body.get("acknowledge"):
        scenarios.acknowledge()
        if not scenarios.status.get("running"):
            store.set_cabin(oxygen_pct=20.9, co2_ppm=600)
        return {"ok": True, "acknowledged": True}
    o2 = body.get("oxygen_pct")
    co2 = body.get("co2_ppm")
    for v in (o2, co2):
        if v is not None and not isinstance(v, (int, float)):
            raise HTTPException(422, "oxygen_pct and co2_ppm must be numbers")
    if o2 is not None and not 0 <= o2 <= 100:
        raise HTTPException(422, "oxygen_pct must be 0-100")
    if co2 is not None and not 0 <= co2 <= 100000:
        raise HTTPException(422, "co2_ppm out of range")
    store.set_cabin(o2, co2)
    first = next(iter(store.states))
    return store.get(first)["cabin"]


@app.post("/api/scenario/{name}")
async def scenario(name: str, speed: float = 1.0, crew_id: str | None = None):
    if name not in SCENARIO_NAMES:
        raise HTTPException(404, f"unknown scenario {name}; one of {SCENARIO_NAMES}")
    if crew_id:
        _need(crew_id)
    if name == "reset":   # a clean, calm demo: every crew member at their own baseline, nothing left switched on
        global ops, suits
        ops, suits = Ops(), Suits()
        ground.clear()   # no leftover digests in "Messages to ground"
        audit.record("brain", "demo.reset", None)
    return scenarios.start(name, crew_id, speed)


@app.get("/api/scenario")
def scenario_status():
    return {**scenarios.status, "action_log": scenarios.action_log}


@app.get("/api/spaceweather")
async def get_spaceweather():
    data = spaceweather.latest
    if data is None:
        loop = asyncio.get_running_loop()
        data = await loop.run_in_executor(None, spaceweather.get)
    out = {k: v for k, v in data.items()}
    out.update(feed_freshness(data))
    if scenarios.storm is not None:
        out["scenario"] = scenarios.storm
    return out


@app.get("/api/clock")
def clock():
    return store.mission_clock()


@app.post("/api/clock")
def advance_clock(body: dict = Body(...)):
    hours = body.get("advance_hours", 0)
    if not isinstance(hours, (int, float)) or not 0 <= hours <= 24 * 30:
        raise HTTPException(422, "advance_hours must be 0-720")
    return store.advance_clock(hours)


race_rooms = RaceRooms()


def _room_call(fn, *args):
    try:
        return fn(*args)
    except KeyError as e:
        raise HTTPException(404, str(e).strip("'"))
    except PermissionError as e:
        raise HTTPException(403, str(e))
    except ValueError as e:
        raise HTTPException(409, str(e))


@app.post("/api/race/room")
def race_create(body: dict = Body(...)):
    """Slipstream multiplayer: create a room; the creator is the host."""
    return _room_call(race_rooms.create, str(body.get("id", ""))[:40], str(body.get("name", "")))


@app.post("/api/race/room/{code}/join")
def race_join(code: str, body: dict = Body(...)):
    return _room_call(race_rooms.join, code, str(body.get("id", ""))[:40], str(body.get("name", "")))


@app.post("/api/race/room/{code}/start")
def race_start(code: str, body: dict = Body(...)):
    return _room_call(race_rooms.start, code.upper(), str(body.get("id", ""))[:40])


@app.post("/api/race/room/{code}/state")
def race_state(code: str, body: dict = Body(...)):
    """Post my position, get everyone's (about ten times a second)."""
    return _room_call(race_rooms.update, code.upper(), str(body.get("id", ""))[:40], body)


@app.post("/api/race/room/{code}/leave")
def race_leave(code: str, body: dict = Body(...)):
    race_rooms.leave(code.upper(), str(body.get("id", ""))[:40])
    return {"ok": True}


# Pairing (critique: the API was open to the whole network). A device other than this laptop must pair once with
# the 6-digit PIN shown on the laptop (demo panel and the console); the pairing is a cookie, valid until restart.
import secrets as _secrets  # noqa: E402
PAIR_PIN = os.getenv("SENTINEL_PIN") or f"{_secrets.randbelow(10**6):06d}"
PAIR_TOKEN = _secrets.token_urlsafe(24)
LOOPBACK = {"127.0.0.1", "::1", "localhost", "testclient"}
OPEN = ("/api/health", "/api/pair")
print(f"[sentinel] tablet pairing PIN: {PAIR_PIN}", flush=True)


@app.post("/api/pair")
def pair(request: Request, body: dict = Body(...)):
    if str(body.get("pin", "")).strip() != PAIR_PIN:
        audit.record("brain", "pair.refused", None, {"from": request.client.host if request.client else "?"})
        raise HTTPException(401, "wrong PIN")
    r = JSONResponse({"ok": True})
    r.set_cookie("sentinel_pair", PAIR_TOKEN, httponly=True, secure=request.url.scheme == "https", samesite="strict", max_age=12 * 3600)
    audit.record("brain", "pair.accepted", None, {"from": request.client.host if request.client else "?"})
    return r


@app.middleware("http")
async def require_pairing(request, call_next):
    host = request.client.host if request.client else ""
    path = request.url.path
    if path.startswith("/api") and not path.startswith(OPEN) and host not in LOOPBACK and request.cookies.get("sentinel_pair") != PAIR_TOKEN:
        return JSONResponse({"detail": "pair this device: enter the PIN shown on the Sentinel laptop", "pair": True}, status_code=401)
    return await call_next(request)


@app.middleware("http")
async def revalidate_static(request, call_next):
    """Code and styles change often during the build: browsers must re-check them (cheap 304s), never run stale ones."""
    resp = await call_next(request)
    path = request.url.path
    if (path.startswith("/app") or path.startswith("/shared")) and path.rsplit(".", 1)[-1] in ("html", "js", "css", "json") or path.endswith("/"):
        resp.headers["Cache-Control"] = "no-cache"
    return resp


app.mount("/app", StaticFiles(directory=ROOT / "app", html=True), name="app")
app.mount("/shared", StaticFiles(directory=ROOT / "shared"), name="shared")


@app.get("/api/radiation/events")
async def radiation_events():
    with store.lock:
        return {"events": list(store.radiation_events)}
