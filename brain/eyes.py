"""Daily eye check: a screening aid for SANS (Spaceflight-Associated Neuro-ocular Syndrome), never a diagnosis.

What a tablet camera CAN follow day to day, against the person's own baseline:
- how open each eye is (eye aperture), and left/right symmetry;
- puffiness around the eyes and face (the microgravity fluid shift): brow-to-lid distance and cheek width,
  both relative to the distance between the pupils, so distance from the camera does not matter;
- redness of the white of the eye;
plus two self-tests that NASA uses for eye health: near vision (blurred near vision is the symptom crews most often
notice) and the Amsler grid (wavy, blurred or missing lines).

What it CANNOT do: SANS is diagnosed by imaging the back of the eye (fundoscopy, optical coherence tomography) and
eye pressure (tonometry), as NASA does in flight (MEDB 1.10, MR014S, NASA JSC 28913). A photo of the front of the
eye cannot show optic disc swelling or choroidal folds, so this check never claims to. A change here means: show
the flight surgeon, who can arrange the eye exam.

Eye photos stay on this device, encrypted (brain/vault.py), and can be deleted. Thresholds are illustrative
(team-chosen) until a clinician reviews them.
"""
from __future__ import annotations

import os
import statistics
import threading
import time
from pathlib import Path

DATA = Path(__file__).resolve().parent.parent / "data"
METRICS = {   # key: (label, change that is worth a look, in percent of the baseline)
    "aperture": ("how open your eyes are", 15.0),
    "brow_lid": ("puffiness above the eyes", 8.0),
    "cheek_width": ("puffiness of the face", 5.0),
    "redness": ("redness of the eyes", 20.0),
}
ASYMMETRY = 0.15           # left/right aperture differ by more than 15%
BASELINE_N = 3             # the first three checks make the baseline
KEEP = 60                  # checks kept per person
NASA = "On the station, eye health is followed with visual acuity, the Amsler grid, fundoscopy and OCT scans (MEDB 1.10, MR014S)."


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
            write_json(DATA / "eyes.json", self.data)   # eye photos and measurements: encrypted at rest

    def add(self, cid: str, body: dict) -> dict:
        m = body.get("metrics") or {}
        rec = {
            "t": self.clock(),
            "metrics": {k: _num(m.get(k)) for k in (*METRICS, "aperture_l", "aperture_r")},
            "near_blur": body.get("near_blur") if isinstance(body.get("near_blur"), bool) else None,
            "amsler_change": body.get("amsler_change") if isinstance(body.get("amsler_change"), bool) else None,
            "images": {s: str(v)[:200000] for s, v in (body.get("images") or {}).items()
                       if s in ("right", "left") and str(v).startswith("data:image/jpeg;base64,")},
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
        latest, base_recs = lst[-1], lst[:BASELINE_N]
        baseline = {}
        for k in METRICS:
            vals = [r["metrics"].get(k) for r in base_recs if r["metrics"].get(k) is not None]
            baseline[k] = statistics.median(vals) if vals else None
        changes, notes = {}, []
        building = len(lst) <= BASELINE_N
        for k, (label, limit) in METRICS.items():
            b, v = baseline.get(k), latest["metrics"].get(k)
            if b and v is not None:
                pct = round((v - b) / b * 100, 1)
                changes[k] = {"label": label, "pct": pct, "limit": limit, "flag": not building and abs(pct) > limit}
                if changes[k]["flag"]:
                    notes.append(f"{label} has changed by {abs(pct):.0f}% from your usual")
        al, ar = latest["metrics"].get("aperture_l"), latest["metrics"].get("aperture_r")
        asym = abs(al - ar) / ((al + ar) / 2) if al and ar else None
        if asym is not None and asym > ASYMMETRY:
            notes.append("your eyes look less even than usual")
        level = "watch" if notes else "ok"
        if latest.get("near_blur"):
            notes.insert(0, "close-up vision feels blurry")
            level = "watch"
        if latest.get("amsler_change"):
            notes.insert(0, "lines on the grid looked wavy or missing")
            level = "act"
        if level == "act":
            message = f"Tell the flight surgeon today: {notes[0]}. An eye exam can check the back of the eye."
        elif level == "watch":
            message = f"Worth showing the flight surgeon: {'; '.join(notes[:2])}. This check can't see the back of the eye; an eye exam can."
        elif building:
            message = f"Saved. {len(lst)} of {BASELINE_N} checks for your baseline; after that, each check is compared with it."
        else:
            message = "No change from your baseline today."
        first_imgs = next((r["images"] for r in lst if r.get("images")), {})
        return {
            "checks": len(lst), "building_baseline": building, "verdict": level, "message": message, "nasa": NASA,
            "changes": changes, "asymmetry": round(asym, 3) if asym is not None else None,
            "near_blur": latest.get("near_blur"), "amsler_change": latest.get("amsler_change"),
            "latest": {"t": latest["t"], "images": latest.get("images", {})},
            "baseline": {"t": lst[0]["t"], "images": first_imgs},
            "history": [{"t": r["t"], "aperture": r["metrics"].get("aperture"), "cheek_width": r["metrics"].get("cheek_width")} for r in lst[-14:]],
        }
