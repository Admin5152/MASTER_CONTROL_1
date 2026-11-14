"""Slipstream multiplayer: in-memory race rooms on the laptop's server.

Crewmates on the same network join a room with a 4-letter code. Each client posts its own position about
ten times a second and gets everyone else's back; the host starts the race and every client counts down to
the same server time. Nothing is persisted: rooms vanish after 30 minutes idle, players after 8 s silent.
"""
from __future__ import annotations

import random
import string
import threading
import time

ROOM_TTL_S = 30 * 60
PLAYER_TTL_S = 8.0
MAX_PLAYERS = 6
COUNTDOWN_S = 4.0
COLORS = ["#6fd0ff", "#ff86d9", "#8fe37a", "#ffd84a", "#c9bcff", "#ff9a6b"]
_ALPHA = "ABCDEFGHJKLMNPQRSTUVWXYZ"   # no I or O: easy to read aloud


class RaceRooms:
    def __init__(self, clock=time.time):
        self.clock = clock
        self.rooms: dict[str, dict] = {}
        self.lock = threading.Lock()

    def _sweep(self) -> None:
        now = self.clock()
        for code in [c for c, r in self.rooms.items() if now - r["touched"] > ROOM_TTL_S]:
            del self.rooms[code]
        for r in self.rooms.values():
            for pid in [p for p, v in r["players"].items() if now - v["seen"] > PLAYER_TTL_S and r["status"] != "lobby"]:
                del r["players"][pid]

    def create(self, pid: str, name: str) -> dict:
        with self.lock:
            self._sweep()
            code = "".join(random.choice(_ALPHA) for _ in range(4))
            while code in self.rooms:
                code = "".join(random.choice(_ALPHA) for _ in range(4))
            self.rooms[code] = {"code": code, "host": pid, "status": "lobby", "start_at": None, "players": {}, "touched": self.clock()}
            self._join(code, pid, name)
            return self._view(code)

    def _join(self, code: str, pid: str, name: str) -> None:
        r = self.rooms[code]
        if pid not in r["players"]:
            if len(r["players"]) >= MAX_PLAYERS:
                raise ValueError("room is full")
            used = {p["color"] for p in r["players"].values()}
            color = next((c for c in COLORS if c not in used), COLORS[0])
            r["players"][pid] = {"id": pid, "name": (name or "Crew")[:16], "color": color, "dist": 0.0, "x": 0.0, "y": 0.0, "lap": 1, "finished": None, "seen": self.clock()}
        r["touched"] = self.clock()

    def join(self, code: str, pid: str, name: str) -> dict:
        code = code.strip().upper()
        with self.lock:
            self._sweep()
            if code not in self.rooms:
                raise KeyError("no such room")
            if self.rooms[code]["status"] == "racing" and pid not in self.rooms[code]["players"]:
                raise ValueError("race already started")
            self._join(code, pid, name)
            return self._view(code)

    def start(self, code: str, pid: str) -> dict:
        with self.lock:
            r = self.rooms.get(code)
            if not r:
                raise KeyError("no such room")
            if r["host"] != pid:
                raise PermissionError("only the host can start")
            r["status"] = "racing"
            r["start_at"] = self.clock() + COUNTDOWN_S
            for p in r["players"].values():
                p.update(dist=0.0, lap=1, finished=None)
            r["touched"] = self.clock()
            return self._view(code)

    def update(self, code: str, pid: str, state: dict) -> dict:
        with self.lock:
            me = self.rooms.get(code, {}).get("players", {}).get(pid)
            if me:
                me["seen"] = self.clock()     # the caller is alive: mark before sweeping
            self._sweep()
            r = self.rooms.get(code)
            if not r:
                raise KeyError("no such room")
            p = r["players"].get(pid)
            if not p:
                raise KeyError("not in this room")
            for k in ("dist", "x", "y"):
                if isinstance(state.get(k), (int, float)):
                    p[k] = float(state[k])
            if isinstance(state.get("lap"), int):
                p["lap"] = state["lap"]
            if isinstance(state.get("finished"), (int, float)) and p["finished"] is None:
                p["finished"] = float(state["finished"])
            p["seen"] = self.clock()
            r["touched"] = self.clock()
            if r["status"] == "racing" and r["players"] and all(v["finished"] is not None for v in r["players"].values()):
                r["status"] = "done"
            return self._view(code)

    def leave(self, code: str, pid: str) -> None:
        with self.lock:
            r = self.rooms.get(code)
            if r and pid in r["players"]:
                del r["players"][pid]
                if r["host"] == pid and r["players"]:
                    r["host"] = next(iter(r["players"]))
                if not r["players"]:
                    del self.rooms[code]

    def _view(self, code: str) -> dict:
        r = self.rooms[code]
        return {"code": code, "host": r["host"], "status": r["status"], "start_at": r["start_at"], "server_time": self.clock(),
                "players": [{k: v for k, v in p.items() if k != "seen"} for p in r["players"].values()]}
