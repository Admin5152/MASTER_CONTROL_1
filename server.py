"""Sentinel backend: FastAPI app serving /app (static) and /api/*.

Run one process only (state is in memory):
  python -m uvicorn server:app --host 0.0.0.0 --port 8443 --ssl-keyfile certs/key.pem --ssl-certfile certs/cert.pem
"""
from __future__ import annotations

import asyncio
import os
import socket
from contextlib import asynccontextmanager
from pathlib import Path

from dotenv import load_dotenv
from fastapi import Body, FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles

ROOT = Path(__file__).resolve().parent
load_dotenv(ROOT / ".env")

from brain import llm  # noqa: E402
from brain.contract import ContractError  # noqa: E402
from brain.radiation import SpaceWeather, storm_dose_step  # noqa: E402
from brain.store import Store  # noqa: E402
from systems import speaker  # noqa: E402
from systems.scenarios import NAMES as SCENARIO_NAMES, Scenarios  # noqa: E402

store = Store(persist=os.getenv("SENTINEL_NO_PERSIST") != "1", fresh=os.getenv("SENTINEL_FRESH") == "1")
spaceweather = SpaceWeather()
scenarios = Scenarios(store, spaceweather)
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
    src = "live_feed" if data["source"] == "live" else "model"
    for cid, s in store.states.items():
        r = s["radiation"]
        if r["storm_level"] != data["level"] or r["source"] != src:
            store.patch(cid, {"radiation": {"storm_level": int(data["level"]), "source": src}}, record=False)


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
    tasks.append(asyncio.create_task(storm_dose_loop()))
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
        "voiceprints": sorted(speaker.enrolled().keys()) if SPEAKER_OK else [],
        "spaceweather": sw["source"] if sw else "pending",
        "tablet_url": tablet_url(),
    }


@app.get("/api/crew")
def crew():
    return store.crew()


@app.get("/api/state/{cid}")
def get_state(cid: str):
    _need(cid)
    return store.get(cid)


@app.post("/api/state/{cid}/patch")
def patch_state(cid: str, patch: dict = Body(...)):
    _need(cid)
    return store.patch(cid, patch)


@app.get("/api/assessment/{cid}")
def assessment(cid: str):
    _need(cid)
    return store.assessment(cid)


@app.get("/api/aux/{cid}")
def aux(cid: str):
    """Everything the screen needs besides the contract object, in one poll."""
    _need(cid)
    return {"assessment": store.assessment(cid), "scenario": scenarios.status, "clock": store.mission_clock()}


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
    return {"ok": True}


@app.post("/api/chat")
def chat(body: dict = Body(...)):
    cid = body.get("crew_id")
    _need(cid)
    transcript = str(body.get("transcript", ""))[:500]
    return llm.chat(store.get(cid), transcript)


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


app.mount("/app", StaticFiles(directory=ROOT / "app", html=True), name="app")
app.mount("/shared", StaticFiles(directory=ROOT / "shared"), name="shared")
