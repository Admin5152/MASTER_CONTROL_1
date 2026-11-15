"""Scripted demo scenarios (all output is SIM).

Each scenario is an asyncio task that patches state over time. A new scenario cancels
the one in progress. `status` tells the frontend what to say and which screen commands
to run, with a sequence number so each step runs once.
"""
from __future__ import annotations

import asyncio
import json
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
LINES = json.loads((ROOT / "app" / "assets" / "demo_lines.json").read_text(encoding="utf-8"))["lines"]
DONKI = ROOT / "shared" / "donki_sep_events.json"
NAMES = ["tired_crew", "calm_down", "cabin_dip", "solar_storm", "full_demo", "reset"]


def pick_donki_event() -> dict | None:
    """The real event replayed by solar_storm: first GOES >10 MeV SEP in the saved file."""
    try:
        raw = json.loads(DONKI.read_text(encoding="utf-8"))
        events = raw["events"] if isinstance(raw, dict) else raw
        for e in events:
            if any(">10 MeV" in (i.get("displayName") or "") and "GOES" in (i.get("displayName") or "")
                   for i in e.get("instruments", [])):
                return {"id": e["sepID"], "date": e["eventTime"][:10], "time": e["eventTime"]}
    except (OSError, ValueError, KeyError):
        pass
    return None


class Scenarios:
    def __init__(self, store, spaceweather=None):
        self.store = store
        self.sw = spaceweather
        self.task: asyncio.Task | None = None
        self.seq = 0
        self.status: dict = {"name": "", "running": False, "seq": 0, "step": "", "say": "", "line": "",
                             "commands": [], "crew_id": None, "label": "", "speed": 1.0}
        self.storm: dict | None = None      # flux overlay for /api/spaceweather while solar_storm runs
        self.ack = asyncio.Event()
        self.action_log: list[dict] = []    # (t, crew, action.type) while a scenario runs, for verification

    # ---- helpers ----
    def _emit(self, step: str, line: str = "", commands: list | None = None, crew_id: str | None = None, label: str = ""):
        self.seq += 1
        say = ""
        if line:
            cid = crew_id or self.status.get("crew_id") or next(iter(self.store.states))
            say = LINES[line].replace("{name}", self.store.states[cid]["display_name"])
        self.status.update({"seq": self.seq, "step": step, "say": say, "line": line,
                            "commands": commands or [], "label": label or self.status.get("label", "")})
        if crew_id:
            self.status["crew_id"] = crew_id

    def _log_actions(self):
        cid = self.status.get("crew_id")
        if cid:
            a = self.store.states[cid]["action"]["type"]
            if not self.action_log or self.action_log[-1]["type"] != a:
                self.action_log.append({"t": time.time(), "crew_id": cid, "type": a})

    async def _sleep(self, seconds: float):
        await asyncio.sleep(seconds / self.status["speed"])

    def _patch(self, cid: str, patch: dict):
        self.store.patch(cid, patch, source="sim")
        self._log_actions()

    def default_crew(self) -> str:
        return next(iter(self.store.states))

    def second_crew(self) -> str:
        ids = list(self.store.states)
        return ids[1] if len(ids) > 1 else ids[0]

    # ---- control ----
    def start(self, name: str, crew_id: str | None = None, speed: float = 1.0) -> dict:
        if name not in NAMES:
            raise KeyError(name)
        self.stop()
        if name == "reset":
            self.store.reset()
            self.storm = None
            self.seq += 1
            self.status.update({"name": "reset", "running": False, "seq": self.seq, "step": "reset", "say": "",
                                "line": "", "commands": [{"cmd": "close"}], "crew_id": None, "label": ""})
            return self.status
        self.ack = asyncio.Event()
        self.action_log = []
        self.status.update({"name": name, "running": True, "speed": max(0.1, float(speed)), "label": "SIM scenario",
                            "crew_id": crew_id})
        coro = getattr(self, f"_run_{name}")(crew_id)
        self.task = asyncio.get_event_loop().create_task(self._wrap(coro))
        return self.status

    async def _wrap(self, coro):
        try:
            await coro
        except asyncio.CancelledError:
            pass
        finally:
            self.status["running"] = False
            self.storm = None if not (self.storm and self.storm.get("keep")) else self.storm

    def stop(self):
        if self.task and not self.task.done():
            self.task.cancel()
        self.task = None
        self.status["running"] = False

    def acknowledge(self):
        self.ack.set()

    # ---- scenarios ----
    async def _run_tired_crew(self, crew_id=None):
        cid = crew_id or self.second_crew()
        self.status["crew_id"] = cid
        s = self.store.states[cid]
        b = s["baseline"]
        self._emit("tired_crew", "", [], cid, "SIM scenario: tired crew")
        # voice gets quieter and flatter over a few seconds, heart rate and fatigue rise
        steps = 4
        for i in range(1, steps + 1):
            f = i / steps
            self._patch(cid, {
                "voice": {"talk_time": round(b["talk_time"] * (1 - 0.45 * f), 1), "pitch": round(b["pitch"] * (1 - 0.15 * f), 1)},
                "vitals": {"heart_rate": round(b["heart_rate"] * (1 + 0.25 * f)), "source": "sim",
                           "sources": {"heart_rate": "sim", "breathing_rate": "sim", "spo2": "sim"}},
                "state": {"fatigue": round(0.2 + 0.6 * f, 2), "stress": round(0.2 + 0.3 * f, 2), "emotion": "tired",
                          "emotion_confidence": 0.6},
            })
            await self._sleep(1.0)
        self._emit("tired_crew_flagged", "tired", [], cid)

    async def _run_calm_down(self, crew_id=None, duration=40.0):
        cid = crew_id or self.status.get("crew_id") or self.default_crew()
        self.status["crew_id"] = cid
        s = self.store.states[cid]
        start = s["vitals"]["heart_rate"]
        base = s["baseline"]["heart_rate"]
        target = min(base, start * 0.9) - 2
        n = int(duration)
        for i in range(1, n + 1):
            hr = start + (target - start) * (i / n)
            self._patch(cid, {"vitals": {"heart_rate": round(hr), "source": "sim", "sources": {"heart_rate": "sim"}},
                              "state": {"stress": round(max(0.15, 0.5 - 0.35 * i / n), 2)}})
            await self._sleep(1.0)

    async def _run_cabin_dip(self, crew_id=None, wait_ack=120.0):
        self._emit("cabin_dip", "", [], crew_id, "SIM scenario: cabin oxygen dip")
        start, low = 20.9, 18.6
        spoken = False
        for i in range(1, 16):
            o2 = start + (low - start) * i / 15
            self.store.set_cabin(oxygen_pct=o2)
            self._log_actions()
            if not spoken and o2 < 19.5:
                self._emit("cabin_alert", "cabin", [], None)
                spoken = True
            await self._sleep(1.0)
        try:
            await asyncio.wait_for(self.ack.wait(), timeout=wait_ack / self.status["speed"])
        except asyncio.TimeoutError:
            pass
        self._emit("cabin_recover", "", [], None)
        for i in range(1, 6):
            self.store.set_cabin(oxygen_pct=low + (start - low) * i / 5)
            self._log_actions()
            await self._sleep(1.0)

    async def _run_solar_storm(self, crew_id=None):
        ev = pick_donki_event()
        if ev:
            label = f"SIM · replay of the {ev['date']} event (NASA DONKI); flux curve scripted"
        else:
            label = "SIM · scripted storm (DONKI replay unavailable)"
        self._emit("solar_storm", "", [{"cmd": "open_screen", "name": "radiation"}, {"cmd": "show_radiation", "on": True}],
                   crew_id, label)
        series: list[dict] = []
        self.storm = {"label": label, "series": series, "level": 0, "flux": 0.3, "event": ev}
        from brain.mission.radiation import flux_to_level, storm_dose_step
        th = self.store.thresholds
        # climb to S3 over 20 s, hold 10 s, decay over 20 s (one point per second)
        profile = [0.3 * (1500 / 0.3) ** (i / 20) for i in range(1, 21)] + [1500.0] * 10 + \
                  [1500 * (0.3 / 1500) ** (i / 20) for i in range(1, 21)]
        t0 = time.time()
        for i, flux in enumerate(profile):
            lvl = flux_to_level(flux)
            series.append({"t": i, "flux": round(flux, 3)})
            self.storm.update({"level": lvl, "flux": flux})
            for cid, s in self.store.states.items():
                if s["radiation"]["storm_level"] != lvl or s["radiation"]["source"] != "sim":
                    self.store.patch(cid, {"radiation": {"storm_level": lvl, "source": "sim"}}, source="sim")
                rec, av = storm_dose_step(lvl, 1.0, s["radiation"]["sheltered"], th)
                self.store.add_storm_dose_for(cid, rec, av)
            self._log_actions()
            await self._sleep(1.0)
        for cid in self.store.states:
            self.store.patch(cid, {"radiation": {"storm_level": 0, "source": "sim"}}, source="sim")
        self._emit("solar_storm_end", "", [], None, label)
        _ = t0

    async def _run_full_demo(self, crew_id=None):
        first = crew_id or self.default_crew()
        tired = self.second_crew() if self.second_crew() != first else first
        self.status["label"] = "SIM scenario: full demo"
        # 1. wake and greet
        self.status["crew_id"] = first
        self._log_actions()
        self._emit("1_greet", "greet", [{"cmd": "close"}], first)
        await self._sleep(5)
        # 2. let me see you: vision + full scan
        self._emit("2_scan", "scan", [{"cmd": "open_screen", "name": "vision"}, {"cmd": "start_scan"}], first)
        await self._sleep(12)
        self._emit("2_scan_done", "scan_ok", [], first)
        await self._sleep(4)
        # 3. tired teammate
        self.status["crew_id"] = tired
        self._emit("3_switch", "", [{"cmd": "close"}], tired)
        await self._run_tired_crew(tired)
        await self._sleep(8)
        # 4. Orb Calm
        self._emit("4_orb_calm", "offer_calm", [{"cmd": "open_screen", "name": "orb_calm"}], tired)
        await self._sleep(3)
        await self._run_calm_down(tired, duration=30.0)
        self._emit("4_calm_done", "calm_done", [{"cmd": "close"}], tired)
        await self._sleep(4)
        # 5. cabin dip, auto-recover after 8 s if nobody acknowledges
        await self._run_cabin_dip(None, wait_ack=8.0)
        await self._sleep(2)
        # 6. hardware slide
        self._emit("6_hardware", "hardware", [{"cmd": "open_screen", "name": "hardware"}], tired)
        await self._sleep(6)
        self._emit("done", "", [], tired)
