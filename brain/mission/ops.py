"""Mission operations (Product Document sections 12, 13 and 21): environment, mode, the link to ground, the
EVA readiness check, and the digest for the flight surgeon.

- Environment comes from the mission profile: station (ISS), transit (Mars transit), base (Moon or Mars surface).
- Mode is an overlay: routine, eva, rest or contingency. EVA and rest pause routine reminders; at rest only
  urgent and cabin alerts break through.
- Comms: live on the station and the Moon, delayed on a Mars transit or the Mars surface (the one-way light delay),
  and blackout when the link is down (a SIM window from the demo panel or "simulate a comms blackout").
- The digest is a few lines of text in the format of section 21, built from the state; it is queued with the
  store-and-forward link, and a blackout holds it until the link returns.

Everything about the link is SIM: nothing leaves the laptop.
"""
from __future__ import annotations

import threading
import time

MODES = ("routine", "eva", "rest", "contingency")
ENV_OF = {"iss": "station", "mars_transit": "transit", "lunar": "base", "mars_surface": "base"}
LIVE_ONE_WAY_S = {"iss": 0.3, "lunar": 1.3}          # seconds: effectively live
PRIORITY = {0: "ROUTINE", 1: "WATCH", 2: "ACT", 3: "URGENT"}
SEV_LEVEL = {"ok": 0, "info": 1, "watch": 1, "act": 2, "alert": 3}
NAMES = {"vitals.heart_rate": "resting heart rate", "vitals.breathing_rate": "breathing rate", "vitals.spo2": "SpO2",
         "voice.talk_time": "talk time", "voice.pitch": "voice pitch", "cognitive.reaction_ms": "reaction time",
         "manual.sleep_hours": "sleep", "manual.mood": "mood", "manual.temp_c": "temperature", "state.stress": "stress"}


class Ops:
    def __init__(self, delayed_one_way_min: float = 12.7, clock=time.time):
        self.lock = threading.Lock()
        self.mode: dict[str, str] = {}
        self.blackout_until = 0.0
        self.delayed_one_way_min, self.clock = delayed_one_way_min, clock

    # ---- mode ----
    def set_mode(self, cid: str, mode: str) -> str:
        if mode not in MODES:
            raise ValueError(f"mode must be one of {MODES}")
        with self.lock:
            self.mode[cid] = mode
        return mode

    def get_mode(self, cid: str) -> str:
        return self.mode.get(cid, "routine")

    # ---- the link ----
    def blackout(self, minutes: float) -> float:
        with self.lock:
            self.blackout_until = self.clock() + max(0.0, minutes) * 60 if minutes > 0 else 0.0
        return self.blackout_until

    def comms(self, profile: str) -> dict:
        now = self.clock()
        if now < self.blackout_until:
            return {"status": "blackout", "label": "SIM", "minutes_left": round((self.blackout_until - now) / 60, 1),
                    "note": "No link to ground. Sentinel carries on; messages wait in the queue."}
        if profile in LIVE_ONE_WAY_S:
            return {"status": "live", "label": "SIM", "one_way_s": LIVE_ONE_WAY_S[profile]}
        return {"status": "delayed", "label": "SIM", "one_way_min": self.delayed_one_way_min,
                "note": f"About {self.delayed_one_way_min:g} minutes each way: Sentinel acts on board, ground reviews later."}

    def hold_until(self) -> float | None:
        return self.blackout_until if self.clock() < self.blackout_until else None

    # ---- status for the screen and the brain ----
    def status(self, cid: str, state: dict) -> dict:
        profile = (state.get("radiation") or {}).get("mission_profile", "iss")
        mode = self.get_mode(cid)
        env = ENV_OF.get(profile, "station")
        from brain.mission.environment import ENVS, MODES_SPEC, wait_tolerance_min
        env_meta = ENVS.get(env, ENVS["station"])
        mode_meta = MODES_SPEC.get(mode, MODES_SPEC["routine"])
        wt = wait_tolerance_min(profile)

        # Section 14.4: Duty and sleep schedule respect rest
        quiet_hours = False
        try:
            from brain.core.profile import profiles, is_in_sleep_block
            prof = profiles.get(cid)
            sb = prof.get("mission", {}).get("sleepBlock") or "22:00-06:00"
            from brain.core.store import store
            clock = store.mission_clock()
            cur_h = clock.get("hour", 8) + clock.get("minute", 0) / 60.0
            if is_in_sleep_block(sb, cur_h):
                quiet_hours = True
        except Exception:
            pass

        reminders_paused = mode_meta["reminders_paused"] or quiet_hours
        urgent_only = mode_meta["urgent_only"] or quiet_hours
        return {
            "env": env,
            "profile": profile,
            "mode": mode,
            "reminders_paused": reminders_paused,
            "urgent_only": urgent_only,
            "quiet_hours": quiet_hours,
            "contingency": mode == "contingency",
            "comms": self.comms(profile),
            "wait_tolerance_min": wt,
            "escalation_policy": env_meta.get("escalation"),
            "watches_harder": env_meta.get("watch"),
            "help_and_how_fast": env_meta.get("help_and_how_fast"),
            "mode_changes": mode_meta.get("changes"),
        }

    # ---- EVA readiness (section 12.2: readiness check before an EVA) ----
    @staticmethod
    def readiness(state: dict, suit: dict | None = None) -> dict:
        items = []
        v, b = state.get("vitals") or {}, state.get("baseline") or {}
        hr, hb = v.get("heart_rate"), b.get("heart_rate")
        if isinstance(hr, (int, float)) and isinstance(hb, (int, float)) and hb:
            dev = (hr - hb) / hb * 100
            items.append({"check": "Resting pulse", "ok": abs(dev) <= 20, "detail": f"{round(hr)} bpm, {dev:+.0f}% from your usual {round(hb)}"})
        sleep = (state.get("manual") or {}).get("sleep_hours")
        if isinstance(sleep, (int, float)):
            items.append({"check": "Sleep", "ok": sleep >= 6, "detail": f"{sleep:g} h last night" + ("" if sleep >= 6 else ", under 6 h")})
        act = state.get("action") or {}
        sev = act.get("severity", "ok")
        items.append({"check": "Open health alerts", "ok": SEV_LEVEL.get(sev, 0) < 2,
                      "detail": "none" if SEV_LEVEL.get(sev, 0) < 1 else (act.get("detail") or sev)})
        cabin = state.get("cabin") or {}
        items.append({"check": "Cabin air", "ok": not cabin.get("alert"), "detail": "within limits" if not cabin.get("alert") else "out of range"})
        if suit and suit.get("mode") == "eva":
            items.append({"check": "Suit pressure", "ok": suit.get("integrity") == "ok", "detail": f"{suit.get('pressure_psi')} psi, {suit.get('integrity')}"})
        ok = all(i["ok"] for i in items)
        return {"ready": ok, "label": "SIM", "items": items,
                "summary": ("Ready for the EVA: " if ok else "Hold the EVA: ") + "; ".join(f"{i['check'].lower()} {i['detail']}" for i in items if (not i["ok"]) or ok)}

    # ---- the digest (section 21) ----
    def digest(self, cid: str, state: dict, assessment: dict | None = None, suit: dict | None = None, note: str = "") -> dict:
        st = self.status(cid, state)
        act = state.get("action") or {}
        # Section 19.3: level 3 comes only from range limits, red-flag symptoms, cabin limits (and here a suit breach),
        # never from statistics alone; a personal-baseline change is at most level 2.
        drift_lv = max([min(2, SEV_LEVEL.get(i.get("severity", "ok"), 0)) for i in (state.get("drift") or {}).get("items", [])] or [0])
        limit_lv = max([SEV_LEVEL.get(i.get("severity", "ok"), 0) for i in (assessment or {}).get("absolute", [])] or [0])
        hard = act.get("type") in ("flag_cabin", "flag_redflag", "flag_radiation", "flag_ground")   # limits, red flags, cabin, storm
        level = max(SEV_LEVEL.get(act.get("severity", "ok"), 0) if hard else min(2, SEV_LEVEL.get(act.get("severity", "ok"), 0)), drift_lv, limit_lv)
        if (state.get("cabin") or {}).get("alert") or (suit and suit.get("integrity") == "breach"):
            level = 3
        v, b, m = state.get("vitals") or {}, state.get("baseline") or {}, state.get("manual") or {}
        drift = [i for i in (state.get("drift") or {}).get("items", []) if i.get("severity") != "ok"]
        summary = "; ".join(f"{NAMES.get(i.get('metric'), i.get('metric'))} {i.get('delta_pct', 0):+.0f}% vs own baseline" for i in drift[:4]) or "no change from own baseline"
        readings = []
        if v.get("heart_rate") is not None:
            readings.append(f"HR {round(v['heart_rate'])} (baseline {round(b.get('heart_rate') or 0)}, {(v.get('sources') or {}).get('heart_rate', 'sim')})")
        if v.get("spo2") is not None:
            readings.append(f"SpO2 {v['spo2']}%")
        if m.get("sleep_hours") is not None:
            readings.append(f"sleep {m['sleep_hours']} h (manual)")
        cog = state.get("cognitive") or {}
        if cog.get("last_ms"):
            readings.append(f"reaction {round(cog['last_ms'])} ms (test)")
        if m.get("mood") is not None:
            readings.append(f"mood {m['mood']}/5 (self)")
        if suit and suit.get("mode") == "eva":
            readings.append(f"suit {suit.get('pressure_psi')} psi {suit.get('integrity')}" + (f" at {suit.get('region_label')}" if suit.get("region_label") else ""))
        lines = [
            f"SENTINEL DIGEST | crew: {state.get('display_name', cid)} | env: {st['env']} | mode: {st['mode']} | priority: {PRIORITY[level]} | onboard time: {time.strftime('%Y-%m-%d %H:%M')}",
            f"Summary: {summary}.",
            "Readings: " + (" | ".join(readings) or "none"),
            f"Actions taken: {act.get('detail') or 'none'}",
            "Kit used: none",
            f"Question for flight surgeon: {note or ('advice on the pattern above' if level >= 1 else 'routine review, no question')}.",
            "Trend: 7-day numbers attached (no video, no images)",
        ]
        # Section 14.4: health background never placed in digest unless explicit consent (includeInDigest=True)
        try:
            from brain.core.profile import profiles
            prof = profiles.get(cid)
            h = prof.get("health") or {}
            if h.get("includeInDigest"):
                meds = ", ".join(m for m in h.get("regularMedicines", []) if m.lower() != "none") or "none"
                allergies = ", ".join(a for a in h.get("allergies", []) if a.lower() != "none") or "none"
                lines.insert(3, f"Health background (consented): allergies: {allergies} | medicines: {meds}")
        except Exception:
            pass
        return {"priority": PRIORITY[level], "level": level, "text": "\n".join(lines), "label": "SIM"}
