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
HISTORY_BASELINE_FIELDS = ["manual.bp_systolic", "manual.glucose_mgdl", "manual.temp_c", "manual.sleep_hours", "manual.sleep_quality", "manual.exercise_minutes", "manual.hydration_ml", "manual.mood"]
LOG_FIELDS = {"session.calm_start_hr", "session.calm_end_hr", "session.calm_recovery_s",
              "session.aurora_mood_before", "session.aurora_mood_after", "session.aurora_mood_change",
              "session.aurora_start_hr", "session.aurora_end_hr", "session.reaction_false_starts",
              "session.race_mood_before", "session.race_mood_after", "session.race_mood_change",
              "session.race_time_s", "session.race_position", "session.race_minutes",
              "session.pvt_lapses", "session.pvt_mean_ms", "session.sit_to_stand_s", "session.tandem_walk_s",
              "session.calm_minutes", "session.calm_mood_before", "session.calm_mood_after", "session.calm_mood_change",
              "session.race_boosts", "session.race_pb_s",
              "session.greenhouse_harvest_kg", "session.greenhouse_minutes",
              "session.greenhouse_mood_before", "session.greenhouse_mood_after", "session.greenhouse_mood_change",
              "session.grounding_mood_before", "session.grounding_mood_after", "session.grounding_mood_change"}


VALID_LABELS = {"LIVE", "LIVE estimate", "MANUAL", "SIM", "DESIGNED"}
INDICATOR_PATH_MAP = {
    "heart_rate": "vitals.heart_rate",
    "breathing_rate": "vitals.breathing_rate",
    "spo2": "vitals.spo2",
    "bp_sys": "manual.bp_systolic",
    "bp_systolic": "manual.bp_systolic",
    "bp_dia": "manual.bp_diastolic",
    "bp_diastolic": "manual.bp_diastolic",
    "glucose": "manual.glucose_mgdl",
    "blood_glucose": "manual.glucose_mgdl",
    "glucose_mgdl": "manual.glucose_mgdl",
    "temperature": "manual.temp_c",
    "temp": "manual.temp_c",
    "temp_c": "manual.temp_c",
    "sleep_hours": "manual.sleep_hours",
    "sleep": "manual.sleep_hours",
    "sleep_quality": "manual.sleep_quality",
    "mood": "manual.mood",
    "mood_self": "manual.mood",
    "stress": "manual.stress_self",
    "stress_self": "manual.stress_self",
    "energy": "manual.energy_self",
    "energy_self": "manual.energy_self",
    "connection": "manual.connection_self",
    "connection_self": "manual.connection_self",
    "exercise_minutes": "manual.exercise_minutes",
    "exercise": "manual.exercise_minutes",
    "hydration_ml": "manual.hydration_ml",
    "hydration": "manual.hydration_ml",
    "hydration_log": "manual.hydration_ml",
    "reaction_ms": "cognitive.reaction_ms",
    "reaction_time": "cognitive.reaction_ms",
    "reaction_lapses": "cognitive.reaction_lapses",
    "valence": "state.valence",
    "arousal": "state.arousal",
    "talk_share": "voice.talk_share",
    "time_alone_pct": "state.time_alone_pct",
    "voice_pitch": "voice.pitch",
    "cabin_o2": "cabin.oxygen_pct",
    "oxygen_pct": "cabin.oxygen_pct",
    "cabin_co2": "cabin.co2_ppm",
    "co2_ppm": "cabin.co2_ppm",
    "storm_level": "radiation.storm_level",
    "rad_dose_rate": "radiation.dose_rate_usv_h",
    "rad_cumulative": "radiation.cumulative_msv",
    "rad_event_level": "radiation.storm_level",
    "shelter_status": "radiation.sheltered",
    "missed_checkins": "manual.missed_checkins",
}


def now_iso() -> str:
    return dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _fill_defaults(state: dict) -> None:
    """Fields added after a crew record was written (wearable logging, symptom log): filled with empty values."""
    manual = state.setdefault("manual", {})
    for key, default in (("sleep_quality", None), ("exercise_minutes", None), ("hydration_ml", None), ("meals", []), ("symptom_log", []),
                         ("stress_self", None), ("energy_self", None), ("connection_self", None), ("mood_tags", [])):
        manual.setdefault(key, copy.deepcopy(default))
    state.setdefault("engagement", {}).setdefault("missed_checkins", 0)


def _repair_symptom_log(state: dict) -> None:
    """Keep only symptom entries in the contract's shape (zone, region, type, severity 1-3, onset, at)."""
    from .contract import ENUMS, SYMPTOM_ITEM, SYMPTOM_LOG_MAX
    good = []
    for e in state.get("manual", {}).get("symptom_log", []) or []:
        if not isinstance(e, dict) or not str(e.get("type", "")).strip():
            continue
        sev = e.get("severity")
        sev = sev if sev in (1, 2, 3) else (3 if isinstance(sev, (int, float)) and sev >= 7 else 2 if isinstance(sev, (int, float)) and sev >= 4 else 1)
        zone = e.get("zone") if e.get("zone") in ENUMS.get("manual.symptom_log.zone", []) else "whole_body"
        onset = e.get("onset") if e.get("onset") in ENUMS.get("manual.symptom_log.onset", []) else "now"
        good.append({**{k: "" for k in SYMPTOM_ITEM}, "zone": zone, "region": str(e.get("region", "")), "type": str(e["type"])[:40],
                     "severity": sev, "onset": onset, "at": str(e.get("at") or e.get("timestamp") or "")})
    state.setdefault("manual", {})["symptom_log"] = good[:SYMPTOM_LOG_MAX]


class Store:
    def __init__(self, persist: bool = True, fresh: bool = False):
        self.lock = threading.RLock()
        self.persist = persist
        self.radiation_events = []
        self.thresholds = load_thresholds()
        self.kit = load_kit()
        self.flag_storm_level = int(self.thresholds["radiation"]["flag_storm_level"]["value"])
        self.states: dict[str, dict] = {}
        self.history: dict[str, dict[str, list]] = {}
        self.internal: dict[str, dict] = {}
        self.non_reading_records: dict[str, dict[str, list[dict]]] = {}
        # "useful / not useful" feedback per rule (19.5): moves the personal-deviation cut-off only, never a safe limit
        self.sensitivity: dict[str, float] = {}
        self.clock = {"base_day": 120, "start_hour": 8.0, "skip_hours": 0.0, "started": time.time()}
        loaded = False
        if persist and not fresh and (DATA / "state.json").exists():
            loaded = self._load_saved()
            if not loaded:
                # never throw a crew's record away silently: keep the unreadable file beside the new one
                try:
                    (DATA / "state.json").replace(DATA / f"state.unreadable-{int(time.time())}.json")
                except OSError:
                    pass
        if not loaded:
            self.reset()

    # ---------- loading ----------
    def _mock(self) -> list[dict]:
        raw = json.loads((SHARED / "mock_data.json").read_text(encoding="utf-8"))
        return raw["crew"]

    def reset(self) -> None:
        with self.lock:
            self.radiation_events = []
            self.states = {}
            self.history = {}
            self.internal = {}
            self.non_reading_records = {}
            self.clock = {"base_day": 120, "start_hour": 8.0, "skip_hours": 0.0, "started": time.time()}
            for c in self._mock():
                _fill_defaults(c)
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
            "manual.sleep_quality": (s["manual"].get("sleep_quality") or 3.5, 0.5),
            "manual.exercise_minutes": (s["manual"].get("exercise_minutes") or 60, 12),
            "manual.hydration_ml": (s["manual"].get("hydration_ml") or 2200, 250),
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
            from brain.vault import read_json
            raw = read_json(DATA / "state.json")   # encrypted at rest (plaintext from older installs is read once)
            self.states = raw["states"]
            self.history = raw["history"]
            self.non_reading_records = raw.get("records", {})
            self.internal = raw.get("internal", {cid: {"storm_received": 0.0, "storm_avoided": 0.0, "reaction_runs": 0} for cid in self.states})
            self.clock = raw.get("clock", self.clock)
            models = {c["crew_id"]: c.get("body_model", "male") for c in self._mock()}
            names = {c["crew_id"]: c["display_name"] for c in self._mock()}
            for cid in self.states:
                if cid in names and self.states[cid].get("display_name") != names[cid]:   # the roster changed: it wins
                    self.states[cid]["display_name"] = names[cid]
                    self.states[cid]["body_model"] = models[cid]
                self.states[cid].setdefault("body_model", models.get(cid, "male"))  # saved before body_model existed
                _fill_defaults(self.states[cid])   # saved before these fields existed
                _repair_symptom_log(self.states[cid])   # one malformed entry must not cost the whole record
                for key, value in {"label": "SIM", "confidence": 1, "event_level": "quiet", "shelter_status": False, "dose_rate_usv_h": 0.0, "shielding_factor": 1.0}.items():
                    self.states[cid]["radiation"].setdefault(key, value)
                self.states[cid]["radiation"].setdefault("location", {"latitude": None, "longitude": None, "source": "unknown", "updated": ""})
                validate_full(self.states[cid])
                self._recompute(cid)
            return True
        except Exception:
            return False

    def _save(self) -> None:
        if not self.persist:
            return
        try:
            from brain.vault import write_json
            write_json(DATA / "state.json", {"states": self.states, "history": self.history, "internal": self.internal, "clock": self.clock,
                                               "records": self.non_reading_records})
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

    def ingest_reading(self, cid: str, reading: dict) -> dict:
        """Ingest a validated reading with label and confidence (INT-1, SI1).
        Rejects if missing valid label or confidence.
        """
        with self.lock:
            if not self.has(cid):
                raise KeyError(f"unknown crew member {cid}")
            label = reading.get("label")
            if not label or label not in VALID_LABELS:
                raise ValueError(f"reading missing or invalid label; must be one of {sorted(VALID_LABELS)}")
            conf = reading.get("confidence")
            if conf is None or not isinstance(conf, (int, float)) or isinstance(conf, bool) or not (0.0 <= float(conf) <= 1.0):
                raise ValueError("reading missing or invalid confidence; must be number between 0.0 and 1.0")
            metric = reading.get("metric") or reading.get("indicator") or reading.get("field")
            if not metric:
                raise ValueError("reading missing metric or indicator")
            val = reading.get("value")
            if val is None or not isinstance(val, (int, float)) or isinstance(val, bool):
                raise ValueError("reading missing numeric value")

            path = INDICATOR_PATH_MAP.get(str(metric), str(metric))
            parts = path.split(".")
            if len(parts) == 2:
                patch = {parts[0]: {parts[1]: val}}
            elif len(parts) == 1:
                patch = {parts[0]: val}
            else:
                patch = {}

            source = reading.get("source") or ("manual" if label == "MANUAL" else "camera" if label == "LIVE" else "sim")

            # Append to history with complete honesty metadata
            h = self.history[cid].setdefault(path, [])
            point = {"t": time.time(), "v": float(val), "source": source, "label": label, "confidence": float(conf)}
            h.append(point)
            if len(h) > HISTORY_CAP:
                del h[: len(h) - HISTORY_CAP]

            # Patch state and run sequential pipeline: radiation -> thresholds -> drift -> decision
            return self.patch(cid, patch, record=False)

    def record_non_reading(self, cid: str, record_type: str, data: dict) -> dict:
        """Record a non-reading record (Section 17): symptoms, protocol runs, kit usage,
        alert feedback, schedule context, data-quality scores, mood tags, journal entries,
        crew pulse, audit log.
        """
        with self.lock:
            if not self.has(cid) and record_type != "crew_pulse":
                raise KeyError(f"unknown crew member {cid}")
            from .indicators import validate_non_reading_record
            sanitized = validate_non_reading_record(record_type, data)
            if cid not in self.non_reading_records:
                self.non_reading_records[cid] = {}
            self.non_reading_records[cid].setdefault(record_type, []).append(sanitized)

            # Mirror specific types into existing state schemas if applicable
            if record_type == "symptom" and self.has(cid):
                # the state's symptom log has a frozen shape (contract): zone, region, type, severity 1-3, onset, time.
                # A record on the 0-10 scale is mapped (0-3 mild, 4-6 moderate, 7-10 severe); anything else would
                # make the saved state fail validation at the next start.
                from .contract import ENUMS, SYMPTOM_LOG_MAX
                s = self.states[cid]
                sev = sanitized.get("severity", 0)
                sev = 3 if sev >= 7 else 2 if sev >= 4 else 1
                zone = {"chest": "heart", "skin": "whole_body"}.get(str(sanitized.get("zone", "")), str(sanitized.get("zone", "")))
                if zone not in ENUMS.get("manual.symptom_log.zone", [zone]):
                    zone = "whole_body"
                onset = sanitized.get("onset", "now")
                if onset not in ENUMS.get("manual.symptom_log.onset", [onset]):
                    onset = "now"
                entry = {"zone": zone, "region": "", "type": str(sanitized.get("type", "symptom"))[:40] or "symptom",
                         "severity": sev, "onset": onset, "at": sanitized["timestamp"]}
                manual = s.setdefault("manual", {})
                manual["symptom_log"] = [entry, *[e for e in manual.get("symptom_log", []) if isinstance(e, dict) and e.get("type")]][:SYMPTOM_LOG_MAX]
                self._recompute(cid)
            elif record_type == "mood_tags" and self.has(cid):
                s = self.states[cid]
                s.setdefault("manual", {})["mood_tags"] = list(sanitized.get("tags", []))[:8]   # today's tags, context only

            self._save()
            return sanitized

    def add_crew(self, display_name: str, body_model: str = "male") -> dict:
        """A new crew member: a clean record (no borrowed readings, no SIM history) so their baseline starts at
        "Calibrating" and fills from their own check-ins. Everything else in the system works for them at once."""
        import re
        name = re.sub(r"\s+", " ", str(display_name or "")).strip()[:24]
        if len(name) < 2:
            raise ValueError("a name needs at least two characters")
        with self.lock:
            if any(s["display_name"].lower() == name.lower() for s in self.states.values()):
                raise ValueError(f"{name} is already on the crew")
            base = re.sub(r"[^a-z0-9]", "", name.lower())[:12] or "crew"
            cid, n = base, 2
            while cid in self.states:
                cid, n = f"{base}{n}", n + 1
            ref = next(iter(self.states.values()))
            s = copy.deepcopy(self._mock()[0])
            _fill_defaults(s)
            s.update(crew_id=cid, display_name=name, body_model=body_model if body_model in ("male", "female") else "male")
            for k in ("bp_systolic", "bp_diastolic", "glucose_mgdl", "temp_c", "sleep_hours", "sleep_quality", "exercise_minutes", "hydration_ml", "mood",
                      "stress_self", "energy_self", "connection_self"):
                s["manual"][k] = None
            s["manual"].update(symptoms=[], symptom_log=[], meals=[], mood_tags=[], updated=None)
            s["cognitive"].update(reaction_ms=None, baseline_ms=None)
            s["identity"] = {"confidence": 0.0, "source": "manual"}
            s["cabin"] = copy.deepcopy(ref["cabin"])
            s["radiation"]["mission_profile"] = ref["radiation"]["mission_profile"]
            s["radiation"]["mission_day"] = ref["radiation"]["mission_day"]
            s["engagement"].update(checkins_today=0, missed_checkins=0, streak_days=0)
            validate_full(s)
            self.states[cid] = s
            self.history[cid] = {}
            self.internal[cid] = {"storm_received": 0.0, "storm_avoided": 0.0, "reaction_runs": 0, "added": time.time()}
            self._recompute(cid)
            self._save()
            return {"crew_id": cid, "display_name": name}

    def record_event(self, cid: str, kind: str, data: dict, cap: int = 300) -> dict:
        """A dated record that is not a reading (an exercise session, for example)."""
        with self.lock:
            entry = {**data, "timestamp": now_iso(), "t": time.time()}
            lst = self.non_reading_records.setdefault(cid, {}).setdefault(kind, [])
            lst.append(entry)
            del lst[:-cap]
            self._save()
            return copy.deepcopy(entry)

    def record_scan(self, cid: str, scan: dict) -> dict:
        """A finished scan (the 15-second face scan, or the full body scan): what it measured, how sure, and when.
        The readings themselves go through ingest_reading; this is the record that a scan happened and what it found."""
        with self.lock:
            if not self.has(cid):
                raise KeyError(f"unknown crew member {cid}")
            entry = {**scan, "timestamp": now_iso(), "t": time.time()}
            lst = self.non_reading_records.setdefault(cid, {}).setdefault("scan", [])
            lst.append(entry)
            del lst[:-200]
            self._save()
            return copy.deepcopy(entry)

    def get_non_reading(self, cid: str, record_type: str | None = None) -> list[dict] | dict[str, list[dict]]:
        """Retrieve non-reading records for a crew member."""
        with self.lock:
            crew_records = self.non_reading_records.get(cid, {})
            if record_type:
                return copy.deepcopy(crew_records.get(record_type, []))
            return copy.deepcopy(crew_records)

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
        point = {"t": time.time(), "v": value, "source": source}
        if field.startswith("radiation."):
            point.update(label="SIM", confidence=1)
        elif source in ("user", "manual"):
            point.update(label="MANUAL", confidence=1.0)   # typed or tapped by the crew member
        elif source in ("camera", "sensor", "voice"):
            point.update(label="LIVE")   # measured now; the camera pulse is an estimate and its quality is kept with each scan
        h.append(point)
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
            if received < 0 or avoided < 0:
                raise ValueError("dose increments must be nonnegative")
            it["storm_received"] += received * self.states[cid]["radiation"].get("shielding_factor", 1.0)
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
        rad["label"] = "SIM"
        rad["confidence"] = 1
        rad["event_level"] = "storm" if rad["storm_level"] >= 3 else "elevated" if rad["storm_level"] >= 1 else "quiet"
        rad["shelter_status"] = rad["storm_level"] >= 3
        rad["dose_rate_msv_day"] = dose_rate(rad["mission_profile"], th)
        extra = float(th["radiation"]["storm_extra_msv_hour"]["by_level"].get(str(rad["storm_level"]), 0))
        shield = rad.get("shielding_factor", 1.0) * (1 - th["radiation"]["shelter_reduction"]["value"] if rad["sheltered"] else 1)
        rad["dose_rate_usv_h"] = (rad["dose_rate_msv_day"] / 24 + extra) * 1000 * shield
        rad["cumulative_msv"] = round(cumulative_dose(rad["mission_profile"], rad["mission_day"], th, it["storm_received"] + it.get("feed_baseline_msv", 0.0)), 6)
        rad["career_limit_msv"] = th["radiation"]["career_limit_msv"]["value"]
        absolute = evaluate_absolute(s, th)
        s["cabin"]["alert"] = any(r["zone"] == "cabin" and r["severity"] == "alert" for r in absolute)
        adj = [self.sensitivity.get(r, 0.0) for r in ("gentle_checkin", "offer_orb_calm", "offer_intervention", "flag_pattern")]
        d = compute_drift(s, th, self._history_baselines(cid), scale=1.0 + max(adj, key=abs))
        # context (S4, S5): pulse and breathing right after exercise, or a low-confidence camera pulse, are
        # estimates: shown, never alarming
        quiet = self._quiet(cid)
        if quiet:
            absolute = self._mute(absolute, quiet)
            d = {**d, "items": [i for i in d["items"] if i.get("metric") not in quiet]}
        s["drift"] = {"flag": d["flag"] if d["items"] else False, "note": d["note"] if d["items"] else "", "items": d["items"]}
        view = s
        if "vitals.heart_rate" in quiet and get_path(s, "baseline.heart_rate"):
            view = copy.deepcopy(s); view["vitals"]["heart_rate"] = s["baseline"]["heart_rate"]   # an estimate drives no decision
        act = decide(view, absolute, d, self.kit, self.flag_storm_level)
        HARD = ("flag_cabin", "flag_redflag", "flag_radiation", "flag_ground")
        if act.get("severity") == "alert" and act.get("type") not in HARD:
            act = {**act, "severity": "watch"}   # section 19.3: a change from your own baseline is never above level 2
        # settling in (S16): after an environment switch, a personal-baseline change reads as adjusting;
        # ranges, cabin air, radiation and red flags still alert
        day = int(self.mission_clock()["mission_day"]) if self.clock else 0
        if it.get("settling_until_day", -1) > day and act.get("severity") != "alert" and act.get("type") in ("offer_orb_calm", "offer_intervention", "gentle_checkin", "flag_pattern"):
            act = {**act, "severity": "info", "detail": "Adjusting to the new environment: " + (act.get("detail") or "")}
        # same problem, different plan (S17, 13.3): urgent cards carry what this environment and mode mean for help
        if act.get("severity") == "alert" and act.get("type") in HARD:
            from brain.environment import card_note
            mode = it.get("mode", "routine")
            note = card_note(rad["mission_profile"], "air" if act.get("type") == "flag_cabin" else "severe", mode=mode)
            if note and note not in (act.get("detail") or ""):
                act = {**act, "detail": f"{act.get('detail', '')} {note}".strip()}
        s["action"] = act
        it["wellbeing"] = self._wellbeing(cid, s, d)

    # ---- context, environment and wellbeing (outside the frozen contract; read through extras()) ----
    def _quiet(self, cid: str) -> set:
        """Readings that are estimates right now (S4 post-exercise, S5 low confidence): shown, never alarming."""
        it, q = self.internal.get(cid, {}), set()
        if it.get("post_exercise_until", 0) > time.time():
            q |= {"vitals.heart_rate", "vitals.breathing_rate"}
        if it.get("hr_confidence") is not None and it["hr_confidence"] < 0.35:
            q.add("vitals.heart_rate")
        return q

    @staticmethod
    def _mute(absolute: list, quiet: set) -> list:
        return [r if r["metric"] not in quiet else {**r, "severity": "ok", "estimate": True} for r in absolute]

    def set_context(self, cid: str, activity: str | None = None, minutes: float = 30, hr_confidence: float | None = None) -> dict:
        with self.lock:
            it = self.internal.setdefault(cid, {})
            if activity == "post_exercise":
                it["post_exercise_until"] = time.time() + max(1.0, minutes) * 60
            elif activity == "none":
                it.pop("post_exercise_until", None)
            if hr_confidence is not None:
                it["hr_confidence"] = max(0.0, min(1.0, float(hr_confidence)))
            self._recompute(cid)
            return self.extras(cid)

    def set_environment(self, cid: str, profile: str) -> dict:
        """Confirmed switch (S9, S11): new profile, settling-in starts, statuses recompute; returns what changed."""
        from brain.environment import SETTLING_DAYS, changes, profile_config
        with self.lock:
            old = self.states[cid]["radiation"]["mission_profile"]
        self.patch(cid, {"radiation": {"mission_profile": profile}}, record=False)
        with self.lock:
            it = self.internal.setdefault(cid, {})
            it["settling_until_day"] = int(self.mission_clock()["mission_day"]) + SETTLING_DAYS
            cfg = profile_config(profile)
            it["environment_profile"] = cfg
            self._recompute(cid)
            return {"from": old, "to": profile, "changes": changes(old, profile), "profile_config": cfg, **self.extras(cid)}

    def _wellbeing(self, cid: str, s: dict, d: dict) -> dict:
        """Four dimensions against the person's usual (section 15.2); level 0-2 here (3 only from the safety flow);
        the top three tools in the order that suits this person (profile "what helps me" first)."""
        try:
            from brain.profile import profiles
            from brain.wellbeing import wellbeing
            prof = profiles.get(cid)
            res = wellbeing.evaluate(cid, s, d, profile=prof)
            return {
                "level": res["level"],
                "dims": res["dims"],
                "tools": res["tools"],
                "wording": res.get("wording", "You're steady."),
                "details": res.get("details", {}),
            }
        except Exception:
            mood, fatigue, stress = get_path(s, "manual.mood"), get_path(s, "state.fatigue") or 0, get_path(s, "state.stress") or 0
            talk = next((i for i in d.get("items", []) if i.get("metric") == "voice.talk_time"), None)
            dims = {"mood": 1 if isinstance(mood, (int, float)) and mood <= 2 else 0, "energy": 1 if fatigue >= 0.6 else 0,
                    "stress": 1 if stress >= 0.6 else 0, "connection": 1 if talk and talk.get("delta_pct", 0) <= -40 else 0}
            low = sum(dims.values())
            try:
                from brain.profile import profiles
                helps = list(profiles.get(cid)["wellbeingPlan"].get("whatHelps") or [])
            except Exception:
                helps = []
            order = list(dict.fromkeys(helps + ["orb_calm", "grounding", "greenhouse", "race"]))
            return {"level": 0 if low == 0 else 1 if low == 1 else 2, "dims": dims, "tools": order[:3] if low else []}

    def extras(self, cid: str) -> dict:
        it = self.internal.get(cid, {})
        day = int(self.mission_clock()["mission_day"])
        prof = self.states[cid]["radiation"]["mission_profile"]
        from brain.environment import PROFILE_ENV
        return {"environment": PROFILE_ENV.get(prof, "station"), "profile": prof,
                "settling_in": it.get("settling_until_day", -1) > day, "settling_days_left": max(0, it.get("settling_until_day", -1) - day),
                "post_exercise": it.get("post_exercise_until", 0) > time.time(),
                "hr_estimate": it.get("hr_confidence") is not None and it["hr_confidence"] < 0.35,
                "wellbeing": it.get("wellbeing") or {"level": 0, "dims": {}, "tools": []}}

    def assessment(self, cid: str) -> dict:
        """Threshold results with kind and source, zone status, and the dose passport numbers."""
        with self.lock:
            s = self.states[cid]
            absolute = self._mute(evaluate_absolute(s, self.thresholds), self._quiet(cid))
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

    def indicator_detail(self, cid: str, metric: str) -> dict:
        """Indicator detail screen support (Section 16.1): value, status, trend band, facts, source label, estimate flag."""
        with self.lock:
            s = self.states[cid]
            asmt = self.assessment(cid)
            abs_match = next((a for a in asmt.get("absolute", []) if a.get("metric") == metric or metric in a.get("metric", "")), None)
            drift_match = next((d for d in s.get("drift", {}).get("items", []) if d.get("metric") == metric or metric in d.get("metric", "")), None)

            val = get_path(s, metric) if "." in metric else (get_path(s, f"vitals.{metric}") or get_path(s, f"manual.{metric}") or get_path(s, f"cognitive.{metric}"))
            base = get_path(s, f"baseline.{metric.split('.')[-1]}")

            spec = self.thresholds.get("metrics", {}).get(metric, {})
            unit = spec.get("unit") or (abs_match.get("unit") if abs_match else "")

            status = "ok"
            if abs_match:
                status = abs_match.get("severity", "ok")
            elif drift_match:
                status = drift_match.get("severity", "ok")

            from .indicators import resolve_indicator_id, TRACKED_INDICATORS
            ind_id = resolve_indicator_id(metric)
            ind_meta = TRACKED_INDICATORS.get(ind_id) if ind_id else None

            facts = {
                "how_to_measure": f"Standard onboard measurement protocol for {metric}.",
                "why_it_matters": f"Key indicator of astronaut physiological adaptation in microgravity.",
                "what_to_do": "Maintain nominal routine if steady; follow clinical protocol steps if drifting.",
                "source_mrid": spec.get("source_mrid") or spec.get("source") or "NASA JSC 28913",
            }
            if ind_meta:
                facts["how_to_measure"] = ind_meta["how_captured"]
                facts["why_it_matters"] = f"HRP Risk: {ind_meta['hrp_risk']}."
                facts["source_mrid"] = f"NASA MRID {', '.join(ind_meta['nasa_mrids'])} (JSC 28913)"
                facts["group"] = ind_meta["group"]
                facts["worse_when"] = ind_meta["worse_when"]
                facts["label"] = ind_meta["label"]
                facts["hrp_risk"] = ind_meta["hrp_risk"]
                if not unit and ind_meta.get("unit"):
                    unit = ind_meta["unit"]

            if metric in ("vitals.heart_rate", "heart_rate"):
                facts["how_to_measure"] = "Continuous pulse oximetry, ECG patch, or camera photoplethysmography."
                facts["why_it_matters"] = "HRP Risk: Cardiovascular Adaptations. Reflects cardiovascular autonomic tone and microgravity fluid redistribution."
                facts["what_to_do"] = "If elevated without exertion, offer guided breathing or check for dehydration."
                facts["source_mrid"] = "NASA MRID MEDB 2.1 (JSC 28913)"
            elif metric in ("cognitive.reaction_ms", "reaction_ms"):
                facts["how_to_measure"] = "Standardized 30-second psychomotor vigilance reaction test."
                facts["why_it_matters"] = "Measures acute cognitive fatigue, sleep debt, and spatial adaptation."
                facts["what_to_do"] = "If reaction times lag > 20%, recommend a short rest break before EVA or critical tasks."
                facts["source_mrid"] = "NASA MRID MR042S (JSC 28913)"
            elif metric in ("vitals.spo2", "spo2"):
                facts["how_to_measure"] = "Optical pulse oximeter on fingertip or earlobe."
                facts["why_it_matters"] = "Ensures sufficient arterial oxygen saturation under cabin atmospheric pressures."
                facts["what_to_do"] = "If below 94%, verify cabin O2 partial pressure and check for ventilation pocketing."
                facts["source_mrid"] = "NASA MRID MEDB 2.2 (JSC 28913)"

            quiet = self._quiet(cid)
            is_estimate = metric in quiet or f"vitals.{metric}" in quiet

            hist_pts = self.history.get(cid, {}).get(metric if "." in metric else f"vitals.{metric}", [])[-14:]

            return {
                "crew_id": cid,
                "metric": metric,
                "indicator_id": ind_id or metric,
                "value": val,
                "unit": unit,
                "status": status,
                "baseline": base,
                "spread": spec.get("spread", 3.0),
                "is_estimate": is_estimate,
                "label": "LIVE" if not is_estimate else "SIM",
                "confidence": 0.95 if not is_estimate else 0.30,
                "facts": facts,
                "history": hist_pts,
            }

    # ---------- the saved record and the personal baseline model ----------
    RECORD_SKIP = ("session.", "radiation.", "cabin.", "engagement.", "identity.", "state.")

    def saved_record(self, cid: str) -> dict:
        """What is stored for one person: every field with its count, how many were entered or measured
        (not SIM), and the newest entry. This is what the Health log shows after a save."""
        with self.lock:
            fields = {}
            for f, pts in self.history.get(cid, {}).items():
                if not pts or f.startswith(("radiation.", "cabin.", "engagement.", "identity.")):
                    continue
                real = [p for p in pts if p.get("source") not in ("sim", "scenario", "unknown", None)]
                last = pts[-1]
                fields[f] = {"count": len(pts), "entered": len(real), "last": last["v"], "last_t": last["t"],
                             "last_source": last.get("source"),
                             "last_label": last.get("label") or ("SIM" if last.get("source") == "sim" else "LIVE"),
                             "recent": [{"t": p["t"], "v": p["v"], "source": p.get("source")} for p in real[-5:]]}
            recs = {k: len(v) for k, v in self.non_reading_records.get(cid, {}).items()}
            return {"crew_id": cid, "fields": fields, "records": recs,
                    "symptoms": copy.deepcopy(self.states[cid]["manual"].get("symptom_log", [])),
                    "persisted": bool(self.persist), "file": "data/state.json (encrypted at rest)"}

    def learn_baselines(self, cid: str, apply: bool = False, skip: set | None = None) -> dict:
        """Fit this person's "normal" from their own stored readings (section 19.2): a robust median and spread
        (MAD) per indicator, leaving out low-confidence and post-exercise points. Statistical, explainable, and
        bounded: it moves the personal baseline only; range limits, cabin air and red flags never change."""
        from .pipeline import pipeline
        with self.lock:
            out = {}
            for f, pts in self.history.get(cid, {}).items():
                if f.startswith(self.RECORD_SKIP):
                    continue
                d = pipeline.derive(cid, pts)
                entered = sum(1 for p in pts if p.get("source") not in ("sim", "scenario", "unknown", None))
                out[f] = {"median": d["median"], "spread": d["spread"], "count": d["count"], "entered": entered,
                          "calibrated": d["calibrated"], "stage": d["stage"], "trend_slope": d.get("trend_slope", 0.0)}
            applied = {}
            if apply:
                s = self.states[cid]
                for field, key in (("vitals.heart_rate", "heart_rate"), ("voice.talk_time", "talk_time"), ("voice.pitch", "pitch")):
                    m = out.get(field)
                    if m and m["calibrated"] and key not in (skip or set()) and m["median"]:
                        applied[key] = {"from": s["baseline"].get(key), "to": round(m["median"], 1)}
                        s["baseline"][key] = round(m["median"], 1)
                self.internal.setdefault(cid, {})["baseline_learned_at"] = time.time()
                self._recompute(cid)
                self._save()
            return {"crew_id": cid, "indicators": out, "applied": applied,
                    "learned_at": self.internal.get(cid, {}).get("baseline_learned_at"),
                    "method": "rolling median and median absolute deviation over each person's own stored readings",
                    "note": "No labelled astronaut dataset exists, so this is a statistical model fitted per person, not a trained classifier."}

    def apply_radiation_feed(self, data: dict) -> None:
        """Record one feed cycle and transition events, including quiet recovery."""
        with self.lock:
            for cid in self.states:
                it = self.internal[cid]
                now = time.time()
                elapsed = max(0.0, now - it.get("radiation_last_cycle", now))
                it["radiation_last_cycle"] = now
                current = self.states[cid]["radiation"]
                it["feed_baseline_msv"] = it.get("feed_baseline_msv", 0.0) + current["dose_rate_msv_day"] * current["shielding_factor"] * elapsed / 86400
                previous = self.states[cid]["radiation"]["event_level"]
                state = self.patch(cid, {"radiation": {
                    "storm_level": int(data["level"]),
                    "source": "live_feed" if data["source"] == "live" else "model",
                    "label": "SIM", "confidence": 1,
                }})
                r = state["radiation"]
                self._append(cid, "radiation.dose_rate_usv_h", r["dose_rate_usv_h"], "sim")
                self._append(cid, "radiation.cumulative_msv", r["cumulative_msv"], "sim")
                payload = {"crewId": cid, "dose_rate": r["dose_rate_usv_h"],
                           "cumulative": r["cumulative_msv"], "event_level": r["event_level"],
                           "shelter_status": r["shelter_status"], "label": "SIM", "confidence": 1}
                self.radiation_events.append({"event": "radiation.updated", "payload": payload})
                if previous != r["event_level"]:
                    event = "radiation.resolved" if r["event_level"] == "quiet" else "radiation.alert"
                    self.radiation_events.append({"event": event, "payload": {
                        **payload, "previous_level": previous, "shelter_advised": r["shelter_status"]}})
                    if previous == "storm" and not r["shelter_status"]:
                        self.radiation_events.append({"event": "shelter.cleared", "payload": payload})
                    if r["shelter_status"]:
                        self.radiation_events.append({"event": "shelter.advised", "payload": {
                            **payload, "reason": "Demo S3 storm threshold crossed",
                            "checklist": json.loads((SHARED / "radiation_protocol.json").read_text(encoding="utf-8"))["checklist"]}})
            del self.radiation_events[:-2000]
            self._save()