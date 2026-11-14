"""Crew pulse (Product Document 15.7, FR-49, S19): two quick weekly questions per crew member, opt-in.

Results are shown at team level only, only when at least three people have answered that week, and never with
names: individual answers are not returned by any endpoint. It maps to NASA's "Inadequate Teamwork" risk.
"""
from __future__ import annotations

import json
import os
import threading
from pathlib import Path

DATA = Path(__file__).resolve().parent.parent / "data"
MIN_RESPONSES = 3
QUESTIONS = {
    "together": "This week, how well did the crew work together? (1 poor to 5 very well)",
    "heard": "This week, how heard did you feel by the crew? (1 not at all to 5 completely)",
}


class CrewPulse:
    def __init__(self, persist: bool | None = None):
        self.persist = (os.getenv("SENTINEL_NO_PERSIST") != "1") if persist is None else persist
        self.lock = threading.Lock()
        self.weeks: dict[str, dict[str, dict]] = {}
        if self.persist:
            try:
                from brain.vault import read_json
                self.weeks = read_json(DATA / "crew_pulse.json")
            except (OSError, ValueError):
                self.weeks = {}

    def answer(self, week: int, cid: str, answers: dict) -> dict:
        clean = {k: int(v) for k, v in answers.items() if k in QUESTIONS and str(v).isdigit() and 1 <= int(v) <= 5}
        if len(clean) != len(QUESTIONS):
            raise ValueError("answer both questions with 1 to 5")
        with self.lock:
            self.weeks.setdefault(str(week), {})[cid] = clean   # one answer per person per week; a new one replaces it
            if self.persist:
                from brain.vault import write_json
                write_json(DATA / "crew_pulse.json", self.weeks)
        return self.result(week, cid)

    def result(self, week: int, cid: str | None = None) -> dict:
        with self.lock:
            w = dict(self.weeks.get(str(week), {}))
        n = len(w)
        out = {"week": week, "questions": QUESTIONS, "responses": n, "answered": bool(cid and cid in w), "min_responses": MIN_RESPONSES}
        if n < MIN_RESPONSES:
            out.update({"shown": False, "note": f"Team results appear once {MIN_RESPONSES} people have answered ({n} so far). No names, ever."})
            return out
        avg = {k: round(sum(a[k] for a in w.values()) / n, 1) for k in QUESTIONS}
        out.update({"shown": True, "team": avg, "note": "Team average only; no individual answers are shown."})
        return out
