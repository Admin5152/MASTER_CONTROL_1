"""In-memory state store with persistence and history.

- Loaded from shared/mock_data.json at start (or data/state.json if present and not reset).
- Every patch is validated against the contract, deep-merged, and re-run through
  radiation model -> thresholds -> drift -> decision.
- History: append-only per numeric field, capped at 2,000 points per field.
"""
from __future__ import annotations

import copy
import datetime as dt
import json
import random
import statistics
import threading
import time
from pathlib import Path

from .contract import deep_merge, get_path, numeric_leaves, validate_full, validate_patch
from .decision import decide
from .drift import compute_drift
from .medicine import load_kit
from .radiation import cumulative_dose, dose_rate, margin_days
from .thresholds import SEV_RANK, evaluate_absolute, load_thresholds

ROOT = Path(__file__).resolve().parent.parent
SHARED = ROOT / "shared"
DATA = ROOT / "data"
HISTORY_CAP = 2000
ZONES = ["head", "eyes", "heart", "lungs", "gut", "bones", "whole_body"]
HISTORY_BASELINE_FIELDS = ["manual.bp_systolic", "manual.glucose_mgdl", "manual.temp_c", "manual.sleep_hours", "manual.mood"]
LOG_FIELDS = {"session.calm_start_hr", "session.calm_end_hr", "session.calm_recovery_s",
              "session.aurora_mood_before", "session.aurora_mood_after", "session.aurora_mood_change",
              "session.aurora_start_hr", "session.aurora_end_hr", "session.reaction_false_starts"}


def now_iso() -> str:
    return dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


class Store:
    def __init__(self, persist: bool = True, fresh: bool = False):
        self.lock = threading.RLock()
        self.persist = persist
        self.thresholds = load_thresholds()
        self.kit = load_kit()
        self.flag_storm_level = int(self.thresholds["radiation"]["flag_storm_level"]["value"])
        self.states: dict[str, dict] = {}
        self.history: dict[str, dict[str, list]] = {}
        self.internal: dict[str, dict] = {}
        self.clock = {"base_day": 120, "start_hour": 8.0, "skip_hours": 0.0, "started": time.time()}
        loaded = False
        if persist and not fresh and (DATA / "state.json").exists():
            loaded = self._load_saved()
        if not loaded:
            self.reset()

    # ---------- loading ----------
    def _mock(self) -> list[dict]:
        raw = json.loads((SHARED / "mock_data.json").read_text(encoding="utf-8"))
        return raw["crew"]

    def reset(self) -> None:
        with self.lock:
            self.states = {}
            self.history = {}
            self.internal = {}
            self.clock = {"base_day": 120, "start_hour": 8.0, "skip_hours": 0.0, "started": time.time()}
            for c in self._mock():
                validate_full(c)
                cid = c["crew_id"]
                self.states[cid] = copy.deepcopy(c)
                self.history[cid] = {}
                self.internal[cid] = {"storm_received": 0.0, "storm_avoided": 0.0, "reaction_runs": 3 if c["cognitive"]["baseline_ms"] else 0}
                self._seed_history(cid)
                self._recompute(cid)
            self._save()

    def _seed_history(self, cid: str) -> None:
        """Fourteen days of SIM history so trend charts have context. Labelled source 'sim'."""
        s = self.states[cid]
        rnd = random.Random(cid)
        now = time.time()
        fields = {
            "vitals.heart_rate": (s["baseline"]["heart_rate"], 3.0),
            "vitals.breathing_rate": (s["vitals"]["breathing_rate"], 1.0),
            "vitals.spo2": (s["vitals"]["spo2"], 0.6),
            "manual.bp_systolic": (s["manual"]["bp_systolic"], 4.0),
            "manual.bp_diastolic": (s["manual"]["bp_diastolic"], 3.0),
            "manual.glucose_mgdl": (s["manual"]["glucose_mgdl"], 6.0),
            "manual.temp_c": (s["manual"]["temp_c"], 0.15),
            "manual.sleep_hours": (s["manual"]["sleep_hours"], 0.4),
            "manual.mood": (s["manual"]["mood"], 0.5),
            "cognitive.reaction_ms": (s["cognitive"]["baseline_ms"], 12.0),
            "voice.talk_time": (s["baseline"]["talk_time"], 0.4),
            "voice.pitch": (s["baseline"]["pitch"], 3.0),
            "cabin.oxygen_pct": (20.9, 0.05),
            "cabin.co2_ppm": (600, 60),
        }
        for field, (mean, sd) in fields.items():
            pts = []
            for d in range(14, 0, -1):
                v = rnd.gauss(mean, sd)
                if field == "manual.mood":
                    v = max(1, min(5, round(v)))
                elif field in ("vitals.spo2",):
                    v = min(100, round(v))
                else:
                    v = round(v, 2 if field == "manual.temp_c" else 1)
                pts.append({"t": now - d * 86400, "v": v, "source": "sim"})
            self.history[cid][field] = pts

    def _load_saved(self) -> bool:
        try:
            raw = json.loads((DATA / "state.json").read_text(encoding="utf-8"))
            self.states = raw["states"]
            self.history = raw["history"]
            self.internal = raw.get("internal", {cid: {"storm_received": 0.0, "storm_avoided": 0.0, "reaction_runs": 0} for cid in self.states})
            self.clock = raw.get("clock", self.clock)
            for cid in self.states:
                validate_full(self.states[cid])
                self._recompute(cid)
            return True
        except Exception:
            return False

    def _save(self) -> None:
        if not self.persist:
            return
        try:
            DATA.mkdir(exist_ok=True)
            tmp = DATA / "state.json.tmp"
            tmp.write_text(json.dumps({"states": self.states, "history": self.history,
                                       "internal": self.internal, "clock": self.clock}))
            tmp.replace(DATA / "state.json")
        except OSError:
            pass

    # ---------- reads ----------
    def crew(self) -> list[dict]:
        with self.lock:
            return [{"crew_id": c, "display_name": s["display_name"]} for c, s in self.states.items()]

    def get(self, cid: str) -> dict:
        with self.lock:
            return copy.deepcopy(self.states[cid])

    def has(self, cid: str) -> bool:
        return cid in self.states

    def history_for(self, cid: str, field: str) -> list[dict]:
        with self.lock:
            return list(self.history.get(cid, {}).get(field, []))

    # ---------- writes ----------
    def patch(self, cid: str, patch: dict, record: bool = True, source: str | None = None) -> dict:
        validate_patch(patch)
        with self.lock:
            s = deep_merge(self.states[cid], patch)
            s["timestamp"] = now_iso()
            self.states[cid] = s
            if record:
                src = source or get_path(s, "vitals.source") or "unknown"
                for field, value in numeric_leaves(patch):
                    if field in ("timestamp",):
                        continue
                    fsrc = source or self._field_source(s, field, src)
                    self._append(cid, field, value, fsrc)
            if "cognitive" in patch and "reaction_ms" in patch["cognitive"] and "baseline_ms" not in patch["cognitive"]:
                self._update_reaction_baseline(cid)
            self._recompute(cid)
            self._save()
            return copy.deepcopy(self.states[cid])

    def _field_source(self, s: dict, field: str, default: str) -> str:
        if field.startswith("vitals."):
            key = field.split(".", 1)[1]
            return get_path(s, f"vitals.sources.{key}") or default
        if field.startswith(("manual.", "cognitive.", "wellbeing.")):
            return "user"
        if field.startswith(("cabin.", "radiation.")):
            return "sim"
        if field.startswith("voice."):
            return "voice"
        return default

    def _append(self, cid: str, field: str, value: float, source: str) -> None:
        h = self.history[cid].setdefault(field, [])
        h.append({"t": time.time(), "v": value, "source": source})
        if len(h) > HISTORY_CAP:
            del h[: len(h) - HISTORY_CAP]

    def log(self, cid: str, field: str, value: float, source: str) -> None:
        if field not in LOG_FIELDS:
            raise ValueError(f"unknown log field {field}")
        with self.lock:
            self._append(cid, field, float(value), source)
            self._save()

    def _update_reaction_baseline(self, cid: str) -> None:
        """The first three runs set the baseline (median of the three)."""
        s = self.states[cid]
        it = self.internal.setdefault(cid, {"storm_received": 0.0, "storm_avoided": 0.0, "reaction_runs": 0})
        it["reaction_runs"] = it.get("reaction_runs", 0) + 1
        runs = [p["v"] for p in self.history[cid].get("cognitive.reaction_ms", []) if p["source"] != "sim"]
        if it["reaction_runs"] <= 3:
            s["cognitive"]["baseline_ms"] = round(statistics.median(runs[-it["reaction_runs"]:])) if runs else s["cognitive"]["baseline_ms"]

    def set_cabin(self, oxygen_pct: float | None = None, co2_ppm: float | None = None) -> None:
        patch: dict = {"cabin": {}}
        if oxygen_pct is not None:
            patch["cabin"]["oxygen_pct"] = round(float(oxygen_pct), 2)
        if co2_ppm is not None:
            patch["cabin"]["co2_ppm"] = round(float(co2_ppm))
        for cid in list(self.states):
            self.patch(cid, patch, source="sim")

    def set_all(self, patch: dict, source: str | None = None, record: bool = True) -> None:
        for cid in list(self.states):
            self.patch(cid, patch, record=record, source=source)

    def add_storm_dose_for(self, cid: str, received: float, avoided: float) -> None:
        with self.lock:
            it = self.internal.setdefault(cid, {"storm_received": 0.0, "storm_avoided": 0.0, "reaction_runs": 0})
            it["storm_received"] += received
            it["storm_avoided"] += avoided
            self._recompute(cid)

    # ---------- clock ----------
    def mission_clock(self) -> dict:
        with self.lock:
            elapsed_h = (time.time() - self.clock["started"]) / 3600.0
            total_h = self.clock["start_hour"] + elapsed_h + self.clock["skip_hours"]
            day = self.clock["base_day"] + int(total_h // 24)
            hour = total_h % 24
            return {"mission_day": day, "hour": int(hour), "minute": int((hour % 1) * 60),
                    "total_hours": total_h, "skip_hours": self.clock["skip_hours"]}

    def advance_clock(self, hours: float) -> dict:
        with self.lock:
            self.clock["skip_hours"] += float(hours)
            day = self.mission_clock()["mission_day"]
            for cid in self.states:
                if self.states[cid]["radiation"]["mission_day"] != day:
                    s = self.states[cid]
                    s["radiation"]["mission_day"] = day
                    s["engagement"]["checkins_today"] = 0
                    self._recompute(cid)
            self._save()
            return self.mission_clock()

    # ---------- derived ----------
    def _history_baselines(self, cid: str) -> dict:
        out = {}
        for f in HISTORY_BASELINE_FIELDS:
            pts = self.history.get(cid, {}).get(f, [])
            if len(pts) >= 4:
                out[f] = statistics.median(p["v"] for p in pts[:-1])
        return out

    def _recompute(self, cid: str) -> None:
        s = self.states[cid]
        th = self.thresholds
        rad = s["radiation"]
        it = self.internal.setdefault(cid, {"storm_received": 0.0, "storm_avoided": 0.0, "reaction_runs": 0})
        rad["dose_rate_msv_day"] = dose_rate(rad["mission_profile"], th)
        rad["cumulative_msv"] = round(cumulative_dose(rad["mission_profile"], rad["mission_day"], th, it["storm_received"]), 3)
        rad["career_limit_msv"] = th["radiation"]["career_limit_msv"]["value"]
        absolute = evaluate_absolute(s, th)
        s["cabin"]["alert"] = any(r["zone"] == "cabin" and r["severity"] == "alert" for r in absolute)
        d = compute_drift(s, th, self._history_baselines(cid))
        s["drift"] = {"flag": d["flag"], "note": d["note"], "items": d["items"]}
        s["action"] = decide(s, absolute, d, self.kit, self.flag_storm_level)

    def assessment(self, cid: str) -> dict:
        """Threshold results with kind and source, zone status, and the dose passport numbers."""
        with self.lock:
            s = self.states[cid]
            absolute = evaluate_absolute(s, self.thresholds)
            zones = {z: "ok" for z in ZONES}
            for item in absolute + s["drift"]["items"]:
                z = item.get("zone")
                if z in zones and SEV_RANK.get(item["severity"], 0) > SEV_RANK.get(zones[z], 0):
                    zones[z] = "watch" if item["severity"] == "info" else item["severity"]
            if s["radiation"]["storm_level"] >= self.flag_storm_level:
                zones["whole_body"] = "alert" if not s["radiation"]["sheltered"] else "watch"
            elif s["radiation"]["storm_level"] >= 1 and zones["whole_body"] == "ok":
                zones["whole_body"] = "watch"
            it = self.internal.get(cid, {})
            rad = s["radiation"]
            provenance = {f: pts[-1]["source"] for f, pts in self.history.get(cid, {}).items() if pts}
            return {
                "absolute": absolute,
                "zones": zones,
                "provenance": provenance,
                "radiation": {
                    "storm_received_msv": round(it.get("storm_received", 0.0), 4),
                    "storm_avoided_msv": round(it.get("storm_avoided", 0.0), 4),
                    "margin_days": margin_days(rad["cumulative_msv"], rad["career_limit_msv"], rad["dose_rate_msv_day"]),
                    "rate_source": self.thresholds["radiation"]["dose_rates_msv_day"][rad["mission_profile"]],
                },
            }
