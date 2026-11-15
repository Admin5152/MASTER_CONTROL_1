"""Audit log (INT-3, NFR-6, SI6): every bus event and every reading, flag, recommendation and action, on the device.

Entries are appended to data/audit.jsonl (one JSON object per line), kept to the newest MAX lines. High-frequency
telemetry (the microphone and voice level meters) arrives as counts per batch from the page, so every event appears
without flooding the log. Privacy: entries carry kinds, fields and categories, never health background, raw audio,
images or what someone said in the urgent wellbeing flow.
"""
from __future__ import annotations

import json
import os
import threading
import time
from pathlib import Path

DATA = Path(__file__).resolve().parents[2] / "data"
MAX = 5000
_SAFE = (str, int, float, bool, type(None))


def _clean(v, depth=0):
    """Keep small scalars and short structures; drop anything large or nested deep."""
    if isinstance(v, _SAFE):
        return v[:160] if isinstance(v, str) else v
    if depth > 1:
        return "…"
    if isinstance(v, dict):
        return {str(k)[:40]: _clean(x, depth + 1) for k, x in list(v.items())[:12]}
    if isinstance(v, (list, tuple)):
        return [_clean(x, depth + 1) for x in list(v)[:8]]
    return str(type(v).__name__)


class Audit:
    def __init__(self, persist: bool | None = None, clock=time.time):
        self.persist = (os.getenv("SENTINEL_NO_PERSIST") != "1") if persist is None else persist
        self.clock, self.lock, self.mem = clock, threading.Lock(), []
        self.path = DATA / "audit.jsonl"

    def record(self, source: str, name: str, crew_id: str | None = None, detail=None, t: float | None = None) -> dict:
        e = {"t": round(t or self.clock(), 3), "src": source, "event": str(name)[:60], "crew": crew_id, "detail": _clean(detail)}
        with self.lock:
            self.mem.append(e)
            self.mem = self.mem[-MAX:]
            if self.persist:
                DATA.mkdir(exist_ok=True)
                with self.path.open("a", encoding="utf-8") as f:
                    f.write(json.dumps(e) + "\n")
                if self.path.stat().st_size > MAX * 400:   # keep the newest MAX lines
                    lines = self.path.read_text(encoding="utf-8").splitlines()[-MAX:]
                    self.path.write_text("\n".join(lines) + "\n", encoding="utf-8")
        return e

    def recent(self, limit: int = 200, crew_id: str | None = None, contains: str = "") -> list[dict]:
        with self.lock:
            rows = list(self.mem)
        if self.persist and not rows and self.path.exists():
            rows = [json.loads(l) for l in self.path.read_text(encoding="utf-8").splitlines()[-MAX:] if l.strip()]
            with self.lock:
                self.mem = rows
        c = contains.lower()
        rows = [r for r in rows if (crew_id in (None, r.get("crew"))) and (not c or c in json.dumps(r).lower())]
        return rows[-limit:][::-1]
