"""Store-and-forward link to ground (brief section 10 item 4). The transport is SIM: nothing leaves the laptop.

A packet (a guided-exam summary, a flag, a note) is queued with the time it was sent and the one-way light
delay. Its status follows the clock: "queued" -> "in transit" -> "delivered" once the delay has passed ->
"awaiting reply". This is how a crew on a Mars transit works with ground support (NASA EIMO ConOps,
NTRS 20240001402): findings are packaged on board and reviewed later, never waited on live.
"""
from __future__ import annotations

import copy
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
            return {
                **p,
                "status": "queued (no link)",
                "queue_state": "queued",
                "eta_s": depart - now + p["one_way_s"],
                "reply_earliest_s": depart - now + 2 * p["one_way_s"],
            }
        el = now - depart
        if p.get("reply"):
            st = "replied"
            q_state = "replied"
        elif p.get("acknowledged"):
            st = "acknowledged"
            q_state = "acknowledged"
        elif el < 2:
            st = "queued"
            q_state = "queued"
        elif el < p["one_way_s"]:
            st = "in transit"
            q_state = "sent"
        elif el < p["one_way_s"] + 300:
            st = "delivered"
            q_state = "sent"
        else:
            st = "awaiting reply"
            q_state = "sent"

        # Reply age calculation if reply exists
        reply_card = p.get("reply")
        if reply_card:
            reply_card["reply_age_min"] = round((now - reply_card.get("received_at", now)) / 60.0, 1)

        return {
            **p,
            "status": st,
            "queue_state": q_state,
            "eta_s": max(0.0, p["one_way_s"] - el),
            "reply_earliest_s": max(0.0, 2 * p["one_way_s"] - el),
        }

    def acknowledge_packet(self, packet_id: str) -> dict:
        """Move packet to acknowledged state (Section 21)."""
        with self.lock:
            p = next((x for x in self.packets if x["id"] == packet_id), None)
            if not p:
                raise KeyError(f"unknown packet {packet_id}")
            p["acknowledged"] = True
            p["acknowledged_at"] = self.clock()
            self._save()
            return self.status(p)

    def receive_reply(self, packet_id: str, instructions: list[str], author: str = "Flight Surgeon") -> dict:
        """Ground reply appears as a Ground card with instructions (Section 21).
        
        The astronaut confirms each step before it is logged. Card shows age of reply
        and when the question was sent so stale advice is visible.
        """
        now = self.clock()
        with self.lock:
            p = next((x for x in self.packets if x["id"] == packet_id), None)
            if not p:
                raise KeyError(f"unknown packet {packet_id}")

            steps = [{"step_num": idx, "text": text, "confirmed": False} for idx, text in enumerate(instructions, 1)]
            p["reply"] = {
                "id": f"rep_{uuid.uuid4().hex[:8]}",
                "author": author,
                "received_at": now,
                "sent_at": p["sent"],
                "reply_age_min": round((now - now) / 60.0, 1),
                "is_stale": False,
                "instructions": steps,
                "all_confirmed": False,
            }
            p["queue_state"] = "replied"
            self._save()
            return self.status(p)

    def confirm_reply_step(self, packet_id: str, step_num: int) -> dict:
        """Astronaut confirms each step in Ground card before it is logged (Section 21)."""
        with self.lock:
            p = next((x for x in self.packets if x["id"] == packet_id), None)
            if not p or not p.get("reply"):
                raise KeyError(f"no reply found for packet {packet_id}")

            reply = p["reply"]
            for s in reply["instructions"]:
                if s["step_num"] == step_num:
                    s["confirmed"] = True

            reply["all_confirmed"] = all(s["confirmed"] for s in reply["instructions"])
            self._save()
            return copy.deepcopy(reply)

    def delay_simulator_view(self, crew_id: str, store=None) -> dict:
        """Delay simulator (demo): split screen view (Section 21).
        
        Left: 'what ground sees' (stale status and countdown)
        Right: 'what Sentinel did just now' (tagged onboard or escalated)
        """
        now = self.clock()
        with self.lock:
            crew_pkts = [p for p in self.packets if p.get("crew_id") == crew_id]
            last_delivered = next((p for p in reversed(crew_pkts) if (now - p.get("depart", p["sent"])) >= p["one_way_s"]), None)

        ground_view = {
            "delay_min": round(self.one_way_s / 60.0, 1),
            "link_status": "delayed",
            "last_received": last_delivered.get("title") if last_delivered else "Nominal status digest",
            "last_received_time": last_delivered.get("sent") if last_delivered else now - self.one_way_s,
            "stale_by_min": round((now - (last_delivered.get("sent") if last_delivered else now - self.one_way_s)) / 60.0, 1),
            "countdown_s": max(0.0, round(self.one_way_s - (now - (crew_pkts[-1].get("depart", now) if crew_pkts else now)))),
        }

        # Onboard actions
        actions = []
        if store and store.has(crew_id):
            s = store.get(crew_id)
            act = s.get("action") or {}
            if act.get("type") and act.get("type") != "none":
                actions.append({
                    "type": act.get("type"),
                    "detail": act.get("detail"),
                    "tag": "escalated" if act.get("severity") in ("watch", "alert") else "onboard",
                    "time": time.strftime("%H:%M"),
                })
        if not actions:
            actions.append({
                "type": "monitoring",
                "detail": "Onboard clinical autonomous surveillance active; nominal telemetry.",
                "tag": "onboard",
                "time": time.strftime("%H:%M"),
            })

        return {
            "crew_id": crew_id,
            "ground_view": ground_view,
            "onboard_view": {"recent_actions": actions},
        }

    @staticmethod
    def sanitize_digest(digest_body: dict, consent: dict) -> dict:
        """Privacy rule (Section 21): Digest carries only what is relevant;
        health background is included only if astronaut or surgeon chooses.
        """
        sanitized = copy.deepcopy(digest_body)
        include_bg = consent.get("includeHealthBackground", False)
        if not include_bg:
            sanitized.pop("health_background", None)
            sanitized.pop("medical_history", None)
            sanitized.pop("regular_medicines", None)
        return sanitized

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
