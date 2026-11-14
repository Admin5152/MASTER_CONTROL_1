"""Sentinel Skin SIM data source (brief section 7 item 7b). The wearable is DESIGNED; in a demo this module
feeds simulated module readings so zone checks show what it would add. Every reading is badged
"SIM · Sentinel Skin" by the front end and can never be confused with live webcam data.

Readings per zone (simulated, deterministic from the crew member's state and the mission day):
  heart  ejection fraction from the ultrasound patch (heart chamber motion); heart rate drives the echo loop
  lungs  B-lines per scan zone (lung surface)
  eyes   optic nerve sheath diameter (ONSD), drifting slowly up over the mission, against a 5.0 mm line
  gut    inferior vena cava diameter (fluid shift)
Reference lines are demo_placeholder unless a source is given; none of this is a diagnosis.
"""
from __future__ import annotations

import math

ECHO = {"title": "ASE/EACVI chamber quantification guidelines (2015)", "url": "https://www.asecho.org/wp-content/uploads/2015/01/ChamberQuantification2015.pdf"}
SANS = {"title": "npj Microgravity 2022: ocular changes in spaceflight (SANS) and the need for portable tools", "url": "https://www.nature.com/articles/s41526-022-00228-1.pdf"}
DEMO = {"title": "Sentinel demo setting", "url": ""}


def _r(field, label, value, unit, levels, kind, source, change=""):
    sev = "ok"
    rank = {"ok": 0, "watch": 2, "alert": 3}
    for lv in levels:
        if ("above" in lv and value > lv["above"]) or ("below" in lv and value < lv["below"]):
            if rank[lv["severity"]] > rank[sev]:
                sev = lv["severity"]
    return {"field": field, "label": label, "value": value, "unit": unit, "severity": sev, "levels": levels,
            "kind": kind, "source": source, "change": change}


def readings(state: dict, mission_day: int) -> dict:
    """The simulated module readings for one crew member."""
    hr = (state.get("vitals") or {}).get("heart_rate") or 70
    seed = sum(ord(c) for c in state.get("crew_id", "x"))
    wob = math.sin(seed * 0.7)
    ef = round(60 + 3 * wob, 0)
    blines = 1 if wob < 0.5 else 2
    # ONSD drifts up slowly over a long mission (SANS); 4.6 mm before flight is a plausible SIM start
    onsd_base = 4.6 + 0.1 * wob
    onsd = round(onsd_base + 0.0025 * max(0, mission_day), 2)
    ivc = round(1.9 + 0.15 * wob, 2)
    return {
        "on": True,
        "heart_rate": hr,
        "zones": {
            "heart": [_r("skin.ejection_fraction", "Ejection fraction (patch)", ef, "%", [{"severity": "watch", "below": 52}, {"severity": "alert", "below": 40}],
                         "clinical_reference", ECHO, "Heart chamber motion from the ultrasound patch")],
            "lungs": [_r("skin.b_lines", "B-lines per zone (patch)", blines, "", [{"severity": "watch", "above": 2}], "demo_placeholder", DEMO,
                         "Lung surface from the ultrasound patch")],
            "eyes": [_r("skin.onsd_mm", "Optic nerve sheath diameter", onsd, "mm", [{"severity": "watch", "above": 5.0}, {"severity": "alert", "above": 5.7}],
                        "demo_placeholder", SANS, f"{round((onsd - onsd_base) / onsd_base * 100)}% above your pre-flight {onsd_base:.1f} mm; reference line 5.0 mm")],
            "gut": [_r("skin.ivc_cm", "Inferior vena cava (patch)", ivc, "cm", [{"severity": "watch", "below": 1.0}, {"severity": "watch", "above": 2.5}],
                       "demo_placeholder", DEMO, "Fluid shift from the abdominal patch")],
        },
    }


class Skin:
    """Which crew members have the Sentinel Skin SIM source switched on (in memory; demo only)."""

    def __init__(self):
        self.on: set[str] = set()

    def set(self, crew_id: str, on: bool) -> None:
        (self.on.add if on else self.on.discard)(crew_id)

    def aux(self, crew_id: str, state: dict, mission_day: int) -> dict:
        return readings(state, mission_day) if crew_id in self.on else {"on": False}
