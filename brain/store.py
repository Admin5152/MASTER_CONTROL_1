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


def now_iso() -> str:
    return dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _fill_defaults(state: dict) -> None:
    """Fields added after a crew record was written (wearable logging, symptom log): filled with empty values."""
    manual = state.setdefault("manual", {})
    for key, default in (("sleep_quality", None), ("exercise_minutes", None), ("hydration_ml", None), ("meals", []), ("symptom_log", [])):
        manual.setdefault(key, copy.deepcopy(default))
    state.setdefault("engagement", {}).setdefault("missed_checkins", 0)


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
            self.radiation_events = []
            self.states = {}
            self.history = {}
            self.internal = {}
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
            raw = json.loads((DATA / "state.json").read_text(encoding="utf-8"))
            self.states = raw["states"]
            self.history = raw["history"]
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
        point = {"t": time.time(), "v": value, "source": source}
        if field.startswith("radiation."):
            point.update(label="SIM", confidence=1)
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
        d = compute_drift(s, th, self._history_baselines(cid))
        # context (S4, S5): pulse and breathing right after exercise, or a low-confidence camera pulse, are
        # estimates: shown, never alarming
        quiet = self._quiet(cid)
        if quiet:
            absolute = self._mute(absolute, quiet)
            d = {**d, "items": [i for i in d["items"] if i.get("metric") not in quiet]}
        s["drift"] = {"flag": d["flag"] if d["items"] else False, "note": d["note"] if d["items"] else "", "items": d["items"]}
        act = decide(s, absolute, d, self.kit, self.flag_storm_level)
        # settling in (S16): after an environment switch, a personal-baseline change reads as adjusting;
        # ranges, cabin air, radiation and red flags still alert
        day = int(self.mission_clock()["mission_day"]) if self.clock else 0
        if it.get("settling_until_day", -1) > day and act.get("severity") != "alert" and act.get("type") in ("offer_orb_calm", "offer_intervention", "gentle_checkin"):
            act = {**act, "severity": "info", "detail": "Adjusting to the new environment: " + (act.get("detail") or "")}
        # same problem, different plan (S17): urgent cards carry what this environment means for help
        if act.get("severity") == "alert":
            from brain.environment import card_note
            note = card_note(rad["mission_profile"], "air" if act.get("type") == "flag_cabin" else "severe")
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
        from brain.environment import SETTLING_DAYS, changes
        with self.lock:
            old = self.states[cid]["radiation"]["mission_profile"]
        self.patch(cid, {"radiation": {"mission_profile": profile}}, record=False)
        with self.lock:
            it = self.internal.setdefault(cid, {})
            it["settling_until_day"] = int(self.mission_clock()["mission_day"]) + SETTLING_DAYS
            self._recompute(cid)
            return {"from": old, "to": profile, "changes": changes(old, profile), **self.extras(cid)}

    def _wellbeing(self, cid: str, s: dict, d: dict) -> dict:
        """Four dimensions against the person's usual (section 15.2); level 0-2 here (3 only from the safety flow);
        the top three tools in the order that suits this person (profile "what helps me" first)."""
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