"""Store-and-forward link to ground (brief section 10 item 4). The transport is SIM: nothing leaves the laptop.

A packet (a guided-exam summary, a flag, a note) is queued with the time it was sent and the one-way light
delay. Its status follows the clock: "queued" -> "in transit" -> "delivered" once the delay has passed ->
"awaiting reply". This is how a crew on a Mars transit works with ground support (NASA EIMO ConOps,
NTRS 20240001402): findings are packaged on board and reviewed later, never waited on live.
"""
from __future__ import annotations

import json
import threading
import time
import uuid
from pathlib import Path

DATA = Path(__file__).resolve().parent.parent / "data"
ONE_WAY_MIN = 12.7          # SIM: a value inside NASA's 4-24 minute Earth-Mars range (shown as SIM)
KINDS = ("exam", "flag", "note", "measures", "digest", "crisis")


class Ground:
    def __init__(self, persist: bool = True, one_way_min: float = ONE_WAY_MIN, clock=time.time):
        self.persist, self.one_way_s, self.clock = persist, one_way_min * 60.0, clock
        self.lock = threading.Lock()
        self.packets: list[dict] = []
        if persist:
            try:
                from brain.vault import read_json
                self.packets = read_json(DATA / "ground.json")
            except (OSError, ValueError):
                self.packets = []

    def _save(self) -> None:
        if not self.persist:
            return
        from brain.vault import write_json
        write_json(DATA / "ground.json", self.packets[-200:])   # encrypted at rest

    def clear(self) -> None:
        """Empty the queue (the demo reset: a clean start, no leftover digests)."""
        with self.lock:
            self.packets = []
            self._save()

    def status(self, p: dict, now: float | None = None) -> dict:
        now = self.clock() if now is None else now
        depart = p.get("depart", p["sent"])
        if now < depart:   # held: no link (blackout); urgent items go first when it returns
            return {**p, "status": "queued (no link)", "eta_s": depart - now + p["one_way_s"], "reply_earliest_s": depart - now + 2 * p["one_way_s"]}
        el = now - depart
        if el < 2:
            st = "queued"
        elif el < p["one_way_s"]:
            st = "in transit"
        elif el < p["one_way_s"] + 300:
            st = "delivered"
        else:
            st = "awaiting reply"
        return {**p, "status": st, "eta_s": max(0.0, p["one_way_s"] - el), "reply_earliest_s": max(0.0, 2 * p["one_way_s"] - el)}

    def send(self, crew_id: str, kind: str, title: str, body: dict, priority: str = "ROUTINE", hold_until: float | None = None) -> dict:
        if kind not in KINDS:
            raise ValueError(f"kind must be one of {KINDS}")
        p = {"id": uuid.uuid4().hex[:10], "crew_id": crew_id, "kind": kind, "title": str(title)[:120], "body": body,
             "sent": self.clock(), "one_way_s": self.one_way_s, "transport": "SIM", "priority": priority}
        if hold_until:
            # urgent first: a held URGENT packet leaves the moment the link returns, others a few seconds later
            p["depart"] = hold_until + (0 if priority in ("URGENT", "ACT") else 5)
        with self.lock:
            self.packets.append(p)
            self._save()
        return self.status(p)

    def release(self) -> int:
        """The link is back: every held packet leaves now, urgent and act first, the rest a few seconds later."""
        now, n = self.clock(), 0
        with self.lock:
            for p in self.packets:
                if p.get("depart", 0) > now:
                    p["depart"] = now + (0 if p.get("priority") in ("URGENT", "ACT") else 5); n += 1
            if n:
                self._save()
        return n

    def list(self, crew_id: str | None = None) -> list[dict]:
        now = self.clock()
        with self.lock:
            return [self.status(p, now) for p in reversed(self.packets) if crew_id in (None, p["crew_id"])]
