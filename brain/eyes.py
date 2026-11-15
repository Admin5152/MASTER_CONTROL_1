"""Daily eye check: how the eyes move, blink and open, and how the person sees, against their own baseline.

What a tablet camera and the face mesh can measure meaningfully, day to day:
- blinking: blinks a minute and the share of incomplete blinks. Dry, tired eyes are common in the dry cabin air of
  a spacecraft; blinking changes with them;
- eyelid opening, and left/right evenness: drooping lids with fatigue; one lid suddenly lower is worth a look;
- eye tracking: following a moving dot, how closely the irises follow it (correlation) and how late (lag).
  Tiredness, and the body adapting its balance in weightlessness, both affect it;
plus two self-tests NASA uses for eye health: near vision (blurred close-up vision is the change crews notice
first with SANS) and the Amsler grid.

What it does not do: see inside the eye. SANS (Spaceflight-Associated Neuro-ocular Syndrome) needs an eye exam
(fundoscopy, OCT, eye pressure; MEDB 1.10, MR014S, NASA JSC 28913). A change here means "show the flight surgeon".
A close-up of the eye area with the face mesh drawn on it is kept with each check, on this device, encrypted.
Thresholds are illustrative (team-chosen) until a clinician reviews them.
"""
from __future__ import annotations

import os
import statistics
import threading
import time
from pathlib import Path

DATA = Path(__file__).resolve().parent.parent / "data"
METRICS = {   # key: (label, unit, change from the baseline worth a look, in percent)
    "blink_rate": ("blinks a minute", "/min", 50.0),
    "aperture": ("how open your eyes are", "", 15.0),
    "pursuit": ("how smoothly your eyes follow", "", 20.0),
}
BASELINE_N = 3
KEEP = 60
NASA = "NASA's eye exams in flight include near vision and the Amsler grid (MEDB 1.10, MR014S); the back of the eye needs an eye exam."


def _num(x):
    try:
        v = float(x)
        return v if v == v and abs(v) < 1e6 else None
    except (TypeError, ValueError):
        return None


class EyeChecks:
    def __init__(self, persist: bool | None = None, clock=time.time):
        self.persist = (os.getenv("SENTINEL_NO_PERSIST") != "1") if persist is None else persist
        self.clock = clock
        self.lock = threading.Lock()
        self.data: dict[str, list[dict]] = {}
        if self.persist:
            try:
                from brain.vault import read_json
                self.data = read_json(DATA / "eyes.json")
            except (OSError, ValueError):
                self.data = {}

    def _save(self) -> None:
        if self.persist:
            from brain.vault import write_json
            write_json(DATA / "eyes.json", self.data)   # encrypted at rest

    def add(self, cid: str, body: dict) -> dict:
        m = body.get("metrics") or {}
        snap = str(body.get("snapshot") or "")
        rec = {
            "t": self.clock(),
            "metrics": {k: _num(m.get(k)) for k in ("blink_rate", "incomplete", "aperture", "asymmetry", "pursuit", "lag_ms")},
            "near_blur": body.get("near_blur") if isinstance(body.get("near_blur"), bool) else None,
            "amsler_change": body.get("amsler_change") if isinstance(body.get("amsler_change"), bool) else None,
            "snapshot": snap[:300000] if snap.startswith("data:image/jpeg;base64,") else "",
        }
        with self.lock:
            lst = self.data.setdefault(cid, [])
            lst.append(rec)
            del lst[:-KEEP]
            self._save()
        return self.summary(cid)

    def forget(self, cid: str) -> dict:
        with self.lock:
            self.data.pop(cid, None)
            self._save()
        return self.summary(cid)

    def summary(self, cid: str) -> dict:
        with self.lock:
            lst = [dict(r) for r in self.data.get(cid, [])]
        if not lst:
            return {"checks": 0, "verdict": "none", "message": "No eye check yet. The first three make your baseline.", "nasa": NASA}
        latest, base = lst[-1], lst[:BASELINE_N]
        building = len(lst) <= BASELINE_N
        lm = latest["metrics"]

        def baseline(k):
            vals = [r["metrics"].get(k) for r in base if r["metrics"].get(k) is not None]
            return statistics.median(vals) if vals else None

        changes, notes, level = {}, [], "ok"
        for k, (label, unit, limit) in METRICS.items():
            b, v = baseline(k), lm.get(k)
            if b and v is not None:
                pct = round((v - b) / b * 100, 1)
                flag = not building and abs(pct) > limit
                changes[k] = {"label": label, "value": round(v, 2), "unit": unit, "pct": pct, "flag": flag}
                if flag:
                    notes.append({
                        "blink_rate": "you're blinking much more than usual, a common sign of dry or tired eyes" if pct > 0 else "you're blinking much less than usual, which can dry the eyes",
                        "aperture": "your eyelids are lower than usual, as they are with tiredness" if pct < 0 else "your eyes are open wider than usual",
                        "pursuit": "your eyes followed the dot less smoothly than usual" if pct < 0 else "",
                    }[k])
        notes = [n for n in notes if n]
        if lm.get("incomplete") is not None and lm["incomplete"] > 0.4:
            notes.append("many of your blinks are incomplete, which dries the eye")
        b_asym, asym = baseline("asymmetry"), lm.get("asymmetry")
        if not building and asym is not None and asym > 0.15 and asym > (b_asym or 0) + 0.08:
            notes.append("one eyelid is lower than the other")
        if notes:
            level = "watch"
        if latest.get("near_blur"):
            notes.insert(0, "close-up reading looks blurry, the change crews notice first with eye changes in space")
            level = "watch"
        if latest.get("amsler_change"):
            notes.insert(0, "lines on the grid looked wavy or missing")
            level = "act"
        if level == "act":
            message = f"Tell the flight surgeon today: {notes[0]}. An eye exam can check the back of the eye."
        elif level == "watch":
            message = f"Worth showing the flight surgeon: {notes[0]}." + (" Lubricating drops and a break from screens often help dry eyes." if "dry" in notes[0] else "")
        elif building:
            message = f"Saved. {len(lst)} of {BASELINE_N} checks for your baseline; after that, each check is compared with it."
        else:
            message = "Your eyes look and work as usual today."
        first_snap = next((r["snapshot"] for r in lst if r.get("snapshot")), "")
        return {
            "checks": len(lst), "building_baseline": building, "verdict": level, "message": message, "notes": notes, "nasa": NASA,
            "changes": changes, "incomplete": lm.get("incomplete"), "asymmetry": asym, "lag_ms": lm.get("lag_ms"),
            "near_blur": latest.get("near_blur"), "amsler_change": latest.get("amsler_change"),
            "latest": {"t": latest["t"], "snapshot": latest.get("snapshot", "")},
            "baseline": {"t": lst[0]["t"], "snapshot": first_snap},
            "history": [{"t": r["t"], **{k: r["metrics"].get(k) for k in METRICS}} for r in lst[-14:]],
        }
