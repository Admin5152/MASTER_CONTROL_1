"""Suit integrity (SIM): the EVA suit's own telemetry, and leak detection from it.

A real suit reports its pressure, oxygen flow and CO2 through the spacecraft link (SpaceWear's chest hub "modular
ports" in the design). Here the telemetry is simulated: in the cabin the suit is stowed; on an EVA it holds its
operating pressure until a leak is injected (demo panel, or "simulate a suit leak in the left glove"). Sentinel
watches two signs a leak gives: pressure falling, and oxygen flow rising as the regulator tries to make it up.

Everything here is SIM. The operating pressure is NASA's published figure for the US spacesuit (EMU, 4.3 psi);
the watch and breach lines are placeholders chosen for the demo, not flight rules, and the steps defer to the
mission's own EVA procedures.
"""
from __future__ import annotations

import math
import threading
import time

NOMINAL_PSI = 4.3            # NASA: the EMU operates at 4.3 psi (29.6 kPa) of pure oxygen
O2_FLOW_NOMINAL = 0.05       # lb/hr, metabolic make-up flow at rest (illustrative)
CO2_NOMINAL_MMHG = 2.0
WATCH_RATE = 0.05            # psi/min falling: demo_placeholder
BREACH_RATE = 0.2            # psi/min falling: demo_placeholder
BREACH_PSI = 3.9             # below this the suit is treated as breached: demo_placeholder

# suit regions, as the body twin draws them; the zone is the health zone the region sits in
REGIONS = {
    "helmet": {"label": "helmet", "zone": "head"},
    "torso": {"label": "upper torso", "zone": "lungs"},
    "backpack": {"label": "life-support backpack", "zone": "whole_body"},
    "left_arm": {"label": "left arm", "zone": "bones"}, "right_arm": {"label": "right arm", "zone": "bones"},
    "left_glove": {"label": "left glove", "zone": "bones"}, "right_glove": {"label": "right glove", "zone": "bones"},
    "left_leg": {"label": "left leg", "zone": "bones"}, "right_leg": {"label": "right leg", "zone": "bones"},
    "left_boot": {"label": "left boot", "zone": "bones"}, "right_boot": {"label": "right boot", "zone": "bones"},
}
SIZES = {"slow": 0.12, "leak": 0.5, "major": 2.0}   # psi per minute

STEPS = [
    "Stop work and tell your EVA partner and the crew inside.",
    "Check the {label} for a cut, a torn seam or a loose seal.",
    "If pressure keeps falling, open the purge valve as your cue card says.",
    "Head back to the airlock now; your partner comes with you.",
]


class Suits:
    """Per-crew suit state. Time-based: the reading is computed when asked, so no thread is needed."""

    def __init__(self):
        self.lock = threading.Lock()
        self.s: dict[str, dict] = {}

    def _get(self, cid: str) -> dict:
        return self.s.setdefault(cid, {"mode": "iva", "eva_started": None, "leak": None, "incident": 0})

    def set_mode(self, cid: str, mode: str) -> dict:
        with self.lock:
            st = self._get(cid)
            st["mode"] = "eva" if mode == "eva" else "iva"
            st["eva_started"] = time.time() if st["mode"] == "eva" else None
            if st["mode"] == "iva":
                st["leak"] = None
        return self.status(cid)

    def leak(self, cid: str, region: str = "left_glove", size: str = "leak") -> dict:
        if region not in REGIONS:
            raise ValueError(f"unknown suit region {region}; one of {sorted(REGIONS)}")
        with self.lock:
            st = self._get(cid)
            if st["mode"] != "eva":
                st["mode"], st["eva_started"] = "eva", time.time()
            st["incident"] += 1
            st["leak"] = {"region": region, "rate": SIZES.get(size, SIZES["leak"]), "t0": time.time(), "id": st["incident"]}
        return self.status(cid)

    def seal(self, cid: str) -> dict:
        with self.lock:
            self._get(cid)["leak"] = None
        return self.status(cid)

    def status(self, cid: str, now: float | None = None) -> dict:
        now = now or time.time()
        with self.lock:
            st = dict(self._get(cid))
        if st["mode"] != "eva":
            return {"mode": "iva", "integrity": "stowed", "label": "SIM", "note": "Suit stowed: no EVA in progress."}
        lk = st["leak"]
        mins = (now - lk["t0"]) / 60 if lk else 0.0
        # pressure falls at the leak rate; the regulator slows the fall as it feeds more oxygen
        drop = lk["rate"] * mins * (1 - 0.35 * (1 - math.exp(-mins))) if lk else 0.0
        psi = max(0.0, NOMINAL_PSI - drop)
        rate = lk["rate"] * (1 - 0.35 * (1 - math.exp(-mins))) if lk and psi > 0 else 0.0
        o2 = O2_FLOW_NOMINAL + (lk["rate"] * 0.9 if lk else 0.0)
        co2 = CO2_NOMINAL_MMHG + (0.6 * min(mins, 5) if lk else 0.0)
        if lk and (rate >= BREACH_RATE or psi < BREACH_PSI):
            integrity = "breach"
        elif lk and rate >= WATCH_RATE:
            integrity = "watch"
        else:
            integrity = "ok"
        out = {
            "mode": "eva", "integrity": integrity, "label": "SIM",
            "pressure_psi": round(psi, 2), "pressure_rate_psi_min": round(-rate, 2), "nominal_psi": NOMINAL_PSI,
            "o2_flow_lb_hr": round(o2, 2), "co2_mmhg": round(co2, 1),
            "eva_minutes": round((now - (st["eva_started"] or now)) / 60, 1),
        }
        if lk:
            r = REGIONS[lk["region"]]
            out.update({"region": lk["region"], "region_label": r["label"], "zone": r["zone"], "incident": lk["id"],
                        "steps": [s.format(label=r["label"]) for s in STEPS] if integrity != "ok" else []})
        return out


def region_from_text(text: str) -> str:
    """'a leak in my left glove' -> 'left_glove'; defaults to the left glove (the most common EVA glove issue)."""
    t = text.lower()
    side = "right" if "right" in t else "left"
    for word, region in (("helmet", "helmet"), ("visor", "helmet"), ("head", "helmet"), ("backpack", "backpack"), ("pack", "backpack"),
                         ("chest", "torso"), ("torso", "torso"), ("body", "torso"), ("glove", f"{side}_glove"), ("hand", f"{side}_glove"),
                         ("arm", f"{side}_arm"), ("sleeve", f"{side}_arm"), ("boot", f"{side}_boot"), ("foot", f"{side}_boot"),
                         ("leg", f"{side}_leg"), ("knee", f"{side}_leg")):
        if word in t:
            return region
    return "left_glove"
