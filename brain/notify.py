"""A notification inbox per crew member (Product Document 12.1 Escalate, 19.4, W14).

When someone needs help, the people they chose (their crew buddy, and the commander if they allow it) are told.
The notice waits in that person's inbox until they are at the screen: it is shown and spoken when they are chosen
or recognised, and they can clear it. A notice carries what a crewmate may know (who, that help is needed, and
what was asked of them), never the other person's readings or health background (section 28).
"""
from __future__ import annotations

import os
import threading
import time
import uuid
from pathlib import Path

DATA = Path(__file__).resolve().parent.parent / "data"
CAP = 60


class Notifications:
    def __init__(self, persist: bool | None = None):
        self.persist = (os.getenv("SENTINEL_NO_PERSIST") != "1") if persist is None else persist
        self.lock = threading.Lock()
        self.box: dict[str, list[dict]] = {}
        if self.persist:
            try:
                from brain.vault import read_json
                self.box = read_json(DATA / "notifications.json")
            except (OSError, ValueError):
                self.box = {}

    def _save(self) -> None:
        if self.persist:
            try:
                from brain.vault import write_json
                write_json(DATA / "notifications.json", self.box)
            except OSError:
                pass

    def add(self, to_cid: str, title: str, text: str, about_cid: str = "", about_name: str = "", level: int = 3, kind: str = "help") -> dict:
        n = {"id": f"ntf_{uuid.uuid4().hex[:10]}", "title": title[:120], "text": text[:400], "about": about_cid, "about_name": about_name,
             "level": int(level), "kind": kind, "t": time.time(), "seen": False}
        with self.lock:
            lst = self.box.setdefault(to_cid, [])
            # one open notice per person and kind: a repeat refreshes it instead of stacking
            lst[:] = [x for x in lst if not (x.get("about") == about_cid and x.get("kind") == kind and x.get("title") == n["title"])]
            lst.append(n)
            del lst[:-CAP]
            self._save()
        return n

    def list(self, cid: str, mark_seen: bool = False) -> dict:
        with self.lock:
            items = sorted(self.box.get(cid, []), key=lambda x: -x["t"])
            unread = sum(1 for x in items if not x.get("seen"))
            out = [dict(x) for x in items]
            if mark_seen and unread:
                for x in self.box.get(cid, []):
                    x["seen"] = True
                self._save()
        return {"crew_id": cid, "items": out, "unread": unread, "count": len(out)}

    def clear(self, cid: str, note_id: str | None = None) -> int:
        with self.lock:
            lst = self.box.get(cid, [])
            before = len(lst)
            lst[:] = [x for x in lst if note_id and x["id"] != note_id]
            self._save()
            return before - len(lst)
