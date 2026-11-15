"""One door for every device (Product Document FR-1, FR-6, FR-7; architecture section 24: "inputs create readings").

The camera, the microphone, the SpaceWear watch, chest hub and patch, the EVA suit and the cabin sensors all hand
their readings to Sentinel the same way: `ingest(device, readings)`. Each reading is checked against what that
device is allowed to report, labelled honestly (LIVE from a real sensor, SIM when a simulator or a demo sends
it), and passed to the same store and decision pipeline as a typed entry. Nothing downstream needs to know which
device it came from, which is what lets a real suit or a real watch replace the simulator without other changes.

What is real in this build: the camera and the microphone. The watch, chest hub, patch, suit link and cabin
sensors are designs or simulators; this module is the interface they would use, and a simulator can exercise it.
"""
from __future__ import annotations

import threading
import time

# metric -> (lowest, highest) a device may report; outside this the reading is rejected as a sensor fault
LIMITS = {
    "heart_rate": (20, 250), "breathing_rate": (2, 80), "spo2": (50, 100), "temperature": (25, 45),
    "exercise_minutes": (0, 600), "sleep_hours": (0, 24),
    "suit_pressure_psi": (0, 6), "suit_o2_flow_lb_hr": (0, 5), "suit_co2_mmhg": (0, 40),
    "cabin_o2": (0, 100), "cabin_co2": (0, 50000),
}

DEVICES = {
    "camera": {"name": "Camera (face scan)", "build": "LIVE", "worn": False, "metrics": ["heart_rate", "breathing_rate"],
               "feeds": "Pulse and breathing estimates, expression. Saved by the 15-second scan.", "transport": "Browser camera on the device"},
    "microphone": {"name": "Microphone", "build": "LIVE", "worn": False, "metrics": [],
                   "feeds": "Speech, talk time, voice pitch, speaker recognition.", "transport": "Browser microphone on the device"},
    "watch": {"name": "SpaceWear watch", "build": "DESIGNED", "worn": True, "metrics": ["heart_rate", "spo2", "temperature", "exercise_minutes", "sleep_hours"],
              "feeds": "Continuous pulse, oxygen saturation, skin temperature, movement and sleep.", "transport": "Short-range radio to the chest hub, then the vehicle network"},
    "chest_hub": {"name": "SpaceWear chest hub", "build": "DESIGNED", "worn": True, "metrics": ["heart_rate", "breathing_rate", "temperature"],
                  "feeds": "ECG-grade pulse, breathing rate; the bridge for the watch, the patch and the suit.", "transport": "Vehicle network; modular ports to the suit"},
    "patch": {"name": "Sentinel Skin ultrasound patch", "build": "DESIGNED", "worn": True, "metrics": [],
              "feeds": "Heart motion, lung surface, optic nerve sheath, fluid shift (shown as SIM on the body screen).", "transport": "Through the chest hub"},
    "suit": {"name": "EVA suit", "build": "SIM", "worn": True, "metrics": ["heart_rate", "suit_pressure_psi", "suit_o2_flow_lb_hr", "suit_co2_mmhg"],
             "feeds": "Suit pressure, oxygen flow, CO2, and the wearer's pulse during an EVA.", "transport": "Suit telemetry through the vehicle link"},
    "cabin": {"name": "Cabin air sensors", "build": "SIM", "worn": False, "metrics": ["cabin_o2", "cabin_co2"],
              "feeds": "Oxygen and carbon dioxide for the whole crew.", "transport": "Vehicle environmental control system"},
}
FRESH_S = 90.0   # a device heard from within this long counts as connected


class Devices:
    def __init__(self, clock=time.time):
        self.lock = threading.Lock()
        self.clock = clock
        self.seen: dict[str, dict[str, dict]] = {}   # crew -> device -> {t, sim, readings, count}

    def ingest(self, store, suits, cid: str, device: str, readings: list, sim: bool = False) -> dict:
        """Check and pass on one batch from one device. Returns what was accepted, what was refused and why."""
        spec = DEVICES.get(device)
        if spec is None:
            raise ValueError(f"unknown device {device}; one of {sorted(DEVICES)}")
        if not isinstance(readings, list) or not readings:
            raise ValueError("readings must be a non-empty list of {metric, value, confidence}")
        label, source = ("SIM", "sim") if sim else ("LIVE", "camera" if device == "camera" else "sensor")
        accepted, rejected, suit_tm, cabin = [], [], {}, {}
        for r in readings[:24]:
            metric, value = (r or {}).get("metric"), (r or {}).get("value")
            if metric not in spec["metrics"]:
                rejected.append({"metric": metric, "why": f"{spec['name']} does not report this"})
                continue
            if not isinstance(value, (int, float)) or isinstance(value, bool):
                rejected.append({"metric": metric, "why": "not a number"})
                continue
            lo, hi = LIMITS[metric]
            if not lo <= value <= hi:
                rejected.append({"metric": metric, "why": f"{value} is outside {lo} to {hi}: treated as a sensor fault, ask for a remeasure"})
                continue
            conf = r.get("confidence", 0.9 if device != "camera" else 0.6)
            conf = float(conf) if isinstance(conf, (int, float)) and not isinstance(conf, bool) and 0 <= conf <= 1 else 0.9
            if metric.startswith("suit_"):
                suit_tm[metric] = float(value)
            elif metric.startswith("cabin_"):
                cabin[metric] = float(value)
            else:
                if metric == "heart_rate":
                    store.set_context(cid, hr_confidence=conf)   # a weak signal is an estimate: shown, never alarming alone
                store.ingest_reading(cid, {"metric": metric, "value": float(value), "label": label, "confidence": round(conf, 2), "source": source})
                if metric in ("heart_rate", "breathing_rate", "spo2"):
                    store.patch(cid, {"vitals": {"sources": {metric: source if source != "sim" else "sim"}}}, record=False)
            accepted.append({"metric": metric, "value": float(value), "confidence": round(conf, 2), "label": label})
        if suit_tm and suits is not None:
            suits.telemetry(cid, suit_tm, sim=sim)
        if cabin:
            store.set_cabin(oxygen_pct=cabin.get("cabin_o2"), co2_ppm=cabin.get("cabin_co2"))
        with self.lock:
            d = self.seen.setdefault(cid, {}).setdefault(device, {"count": 0})
            if accepted:
                d.update(t=self.clock(), sim=bool(sim), readings={a["metric"]: a["value"] for a in accepted}, count=d["count"] + len(accepted))
        return {"device": device, "label": label, "accepted": accepted, "rejected": rejected}

    def status(self, cid: str, suit: dict | None = None, camera_on: bool | None = None) -> dict:
        """Every device: what it is, whether it is connected now, when it was last heard, what it last said."""
        now = self.clock()
        with self.lock:
            seen = {k: dict(v) for k, v in self.seen.get(cid, {}).items()}
        out = []
        for key, spec in DEVICES.items():
            s = seen.get(key) or {}
            fresh = bool(s.get("t")) and now - s["t"] <= FRESH_S
            state = ("SIM" if s.get("sim") else "LIVE") if fresh else spec["build"]
            row = {"id": key, "name": spec["name"], "worn": spec["worn"], "state": state, "connected": fresh, "build": spec["build"],
                   "last_seen_s": round(now - s["t"]) if s.get("t") else None, "last": s.get("readings") or {}, "count": s.get("count", 0),
                   "reports": spec["metrics"], "feeds": spec["feeds"], "transport": spec["transport"]}
            if key == "suit" and suit:
                row["suit"] = {k: suit.get(k) for k in ("mode", "integrity", "pressure_psi", "pressure_rate_psi_min", "o2_flow_lb_hr", "co2_mmhg", "label") if k in suit}
                if suit.get("mode") == "eva" and not fresh:
                    row["connected"], row["state"] = True, suit.get("label", "SIM")
            out.append(row)
        return {"crew_id": cid, "devices": out, "connected": [r["id"] for r in out if r["connected"]],
                "note": "The camera and microphone are real in this build. The watch, chest hub, patch, suit link and cabin sensors are designs or simulators using the same interface a real device would."}

    def summary(self, cid: str, suit: dict | None = None) -> str:
        """One sentence the assistant can say: what is connected and what each last reported."""
        st = self.status(cid, suit)
        on = [d for d in st["devices"] if d["connected"]]
        if not on:
            return "No worn device is sending right now. I can use the camera for a pulse and breathing scan, or you can tell me a reading."
        parts = []
        for d in on:
            last = ", ".join(f"{k.replace('_', ' ')} {v:g}" for k, v in list(d["last"].items())[:3])
            parts.append(f"{d['name']}{' (simulated)' if d['state'] == 'SIM' else ''}{': ' + last if last else ''}")
        return "Connected now: " + "; ".join(parts) + "."
