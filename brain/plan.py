"""Plan & Schedule Subsystem (Product Document Section 16.1 & Section 25.1).

Covers:
- Plan screen: Today's reminders list, upcoming events, snooze, schedule templates.
- Special states: Schedule conflicts detected and highlighted.
- Reminder states: scheduled, due, presented, done, snoozed, missed.
- Reminder types: checkin, measurement, treatment_timer, recheck, exercise, hydration, sleep_winddown, mood, kit_check.
"""
from __future__ import annotations

import copy
import json
import os
import threading
import time
import uuid
from pathlib import Path

DATA = Path(__file__).resolve().parent.parent / "data"

SCHEDULE_TEMPLATES = {
    "transit_day_v1": {
        "id": "transit_day_v1",
        "title": "Deep-Space Transit Standard Day",
        "environment": "transit",
        "events": [
            {"id": "wake", "time": "06:30", "title": "Wake & Fast Vitals Entry", "type": "checkin", "duration_m": 10},
            {"id": "breakfast", "time": "07:00", "title": "Nutrition & Morning Hydration", "type": "hydration", "duration_m": 30},
            {"id": "checkin", "time": "08:00", "title": "Daily Health Check-in (Scan & Reaction)", "type": "checkin", "duration_m": 15},
            {"id": "work_1", "time": "08:30", "title": "Mission Science & Operations Block 1", "type": "duty", "duration_m": 210},
            {"id": "lunch", "time": "12:00", "title": "Midday Meal & Social Connection", "type": "hydration", "duration_m": 45},
            {"id": "exercise", "time": "13:30", "title": "Scheduled Countermeasure Exercise (T2/CEVIS)", "type": "exercise", "duration_m": 90},
            {"id": "work_2", "time": "15:30", "title": "Vehicle Maintenance & Habitability", "type": "duty", "duration_m": 150},
            {"id": "dinner", "time": "18:30", "title": "Evening Meal & Crew Debrief", "type": "hydration", "duration_m": 60},
            {"id": "wellbeing", "time": "19:30", "title": "Personal Time & Wellbeing Tools", "type": "mood", "duration_m": 60},
            {"id": "winddown", "time": "21:30", "title": "Evening Wind-down & Lighting Shift", "type": "sleep_winddown", "duration_m": 30},
            {"id": "sleep", "time": "22:00", "title": "Crew Sleep Block (DND Active)", "type": "sleep", "duration_m": 510},
        ],
    },
    "station_day_v1": {
        "id": "station_day_v1",
        "title": "Orbital Station Routine Day",
        "environment": "station",
        "events": [
            {"id": "wake", "time": "06:00", "title": "Wake & 2-Tap Mood Check", "type": "checkin", "duration_m": 10},
            {"id": "checkin", "time": "07:30", "title": "Morning Clinical Check-in", "type": "checkin", "duration_m": 15},
            {"id": "exercise_am", "time": "09:00", "title": "ARED Resistive Exercise", "type": "exercise", "duration_m": 75},
            {"id": "station_ops", "time": "11:00", "title": "Payload & Station Maintenance", "type": "duty", "duration_m": 240},
            {"id": "exercise_pm", "time": "16:00", "title": "T2 Aerobic Exercise", "type": "exercise", "duration_m": 60},
            {"id": "winddown", "time": "21:00", "title": "Circadian Wind-down", "type": "sleep_winddown", "duration_m": 30},
            {"id": "sleep", "time": "21:30", "title": "Sleep Period", "type": "sleep", "duration_m": 510},
        ],
    },
}


class PlanEngine:
    """Manages reminders, schedule templates, snoozing, and conflict detection (Section 16.1 & 25.1)."""

    def __init__(self, persist: bool | None = None):
        self.persist = (os.getenv("SENTINEL_NO_PERSIST") != "1") if persist is None else persist
        self.lock = threading.Lock()
        self.reminders: dict[str, list[dict]] = {}
        if self.persist:
            try:
                from brain.vault import read_json
                self.reminders = read_json(DATA / "reminders.json")
            except (OSError, ValueError):
                self.reminders = {}

    def _save(self) -> None:
        if self.persist:
            from brain.vault import write_json
            write_json(DATA / "reminders.json", self.reminders)

    def get_template(self, template_id: str = "transit_day_v1") -> dict:
        """Returns the schedule template definition."""
        return copy.deepcopy(SCHEDULE_TEMPLATES.get(template_id, SCHEDULE_TEMPLATES["transit_day_v1"]))

    def get_plan(self, cid: str, profile: dict | None = None, current_hour: float | None = None, day: int | None = None) -> dict:
        """Constructs today's schedule, active reminders, upcoming items, and conflict detection."""
        profile = profile or {}
        pref = profile.get("preferences") or {}
        mission = profile.get("mission") or {}
        template_id = mission.get("dutySchedule") or "transit_day_v1"
        template = self.get_template(template_id)

        # Checkin and winddown customized from profile if set
        checkin_t = (pref.get("reminderTimes") or {}).get("checkin", "08:00")
        winddown_t = (pref.get("reminderTimes") or {}).get("winddown", "21:30")
        sleep_block = mission.get("sleepBlock", "22:00-06:00")

        if current_hour is None:
            try:
                from brain.store import store
                clock = store.mission_clock()
                current_hour = clock.get("hour", 8) + clock.get("minute", 0) / 60.0
            except Exception:
                current_hour = 8.5

        with self.lock:
            user_reminders = copy.deepcopy(self.reminders.get(cid, []))

        # Build baseline reminders for today from template
        today_reminders = []
        for ev in template["events"]:
            # Map event time to decimal
            try:
                eh, em = [float(x) for x in ev["time"].split(":")]
                ev_time_dec = eh + em / 60.0
            except Exception:
                ev_time_dec = 8.0

            # Find if this reminder exists in user_reminders
            rid = f"rem_{ev['id']}"
            existing = next((r for r in user_reminders if r.get("id") == rid), None) or next(
                (r for r in user_reminders if r.get("event_id") == ev["id"] and (day is None or r.get("mission_day") in (None, day))), None)
            if existing and day is not None and existing.get("day") not in (None, day):
                user_reminders.remove(existing)   # ticked or snoozed on an earlier mission day
                existing = None
            state = "past" if current_hour >= ev_time_dec + 1.0 else "due" if abs(current_hour - ev_time_dec) <= 0.5 else "scheduled"
            if existing:
                if existing.get("state") == "snoozed" and existing.get("snoozed_until", 0) <= time.time():
                    existing["state"] = "due"
                today_reminders.append({"id": rid, "event_id": ev["id"], "title": ev["title"], "time": ev["time"], "type": ev["type"],
                                        "snooze_count": 0, "linked": {}, **existing, "id": rid})
            else:
                today_reminders.append({
                    "id": f"rem_{ev['id']}",
                    "event_id": ev["id"],
                    "title": ev["title"],
                    "time": ev["time"],
                    "type": ev["type"],
                    "state": state,
                    "snooze_count": 0,
                    "linked": {},
                })

        # Add custom active reminders (timers, rechecks)
        for r in user_reminders:
            if day is not None and (r.get("event_id") or r.get("mission_day") not in (None, day)):
                continue   # a template event (already listed above) or another day's copy from the seven-day expansion
            if not any(tr["id"] == r["id"] for tr in today_reminders) and r.get("title"):
                today_reminders.append(r)

        # Conflict Detection (Section 16.1 Special States: "Conflicts shown")
        conflicts = self._detect_conflicts(today_reminders, sleep_block)

        return {
            "crew_id": cid,
            "template_id": template_id,
            "template_title": template["title"],
            "current_hour": round(current_hour, 2),
            "today_reminders": today_reminders,
            "conflicts": conflicts,
            "has_conflicts": len(conflicts) > 0,
            "sleep_block": sleep_block,
            "checkin_time": checkin_t,
            "winddown_time": winddown_t,
        }

    @staticmethod
    def _detect_conflicts(reminders: list[dict], sleep_block: str) -> list[dict]:
        """Detects scheduling conflicts, e.g. high-workload task scheduled during sleep block."""
        from brain.profile import is_in_sleep_block
        conflicts = []
        for r in reminders:
            t_str = r.get("time", "")
            if not t_str or ":" not in t_str:
                continue
            try:
                h, m = [float(x) for x in t_str.split(":")]
                dec_h = h + m / 60.0
                if r.get("type") in ("exercise", "duty") and is_in_sleep_block(sleep_block, dec_h):
                    conflicts.append({
                        "reminder_id": r.get("id"),
                        "title": r.get("title"),
                        "time": t_str,
                        "conflict_type": "sleep_block_overlap",
                        "description": f"'{r.get('title')}' at {t_str} conflicts with designated crew sleep block ({sleep_block}).",
                    })
            except Exception:
                pass
        return conflicts

    def snooze_reminder(self, cid: str, reminder_id: str, minutes: int = 15, day: int | None = None) -> dict:
        """Snoozes a reminder by N minutes and advances snooze_count."""
        with self.lock:
            user_rems = self.reminders.setdefault(cid, [])
            rem = next((r for r in user_rems if r.get("id") == reminder_id), None)
            if not rem:
                rem = {"id": reminder_id, "snooze_count": 0, "state": "scheduled"}
                user_rems.append(rem)

            if day is not None and rem.get("day") not in (None, day):
                rem["snooze_count"] = 0   # a new mission day: the limit starts again
            if day is not None:
                rem["day"] = day
            if rem.get("snooze_count", 0) >= 2:
                raise ValueError("This reminder has been snoozed twice already; it stays until it is done.")
            rem["snooze_count"] = rem.get("snooze_count", 0) + 1
            rem["state"] = "snoozed"
            rem["snoozed_until"] = time.time() + (minutes * 60)
            self._save()
            return copy.deepcopy(rem)

    def complete_reminder(self, cid: str, reminder_id: str, day: int | None = None) -> dict:
        """Marks a reminder done."""
        with self.lock:
            user_rems = self.reminders.setdefault(cid, [])
            rem = next((r for r in user_rems if r.get("id") == reminder_id), None)
            if not rem:
                rem = {"id": reminder_id, "state": "scheduled"}
                user_rems.append(rem)

            rem["state"] = "done"
            if day is not None:
                rem["day"] = day
            rem["completed_at"] = time.time()
            self._save()
            return copy.deepcopy(rem)

    def add_reminder(self, cid: str, title: str, time_str: str, rem_type: str = "measurement", linked: dict | None = None) -> dict:
        """Adds a custom reminder (e.g. kit recheck, timer)."""
        rem = {
            "id": f"rem_{uuid.uuid4().hex[:8]}",
            "title": str(title).strip()[:80],
            "time": time_str,
            "type": rem_type,
            "state": "scheduled",
            "snooze_count": 0,
            "linked": linked or {},
            "created_at": time.time(),
        }
        with self.lock:
            self.reminders.setdefault(cid, []).append(rem)
            self._save()
        return rem

    # ---- Section 20 Scheduling Algorithm (7 Steps) ----
    def expand_schedule_7days(self, cid: str, profile: dict | None = None, start_day: int = 120) -> list[dict]:
        """Step 1: On profile load, expand the schedule template into reminders for the next seven days."""
        profile = profile or {}
        mission = profile.get("mission") or {}
        template_id = mission.get("dutySchedule") or "transit_day_v1"
        template = self.get_template(template_id)

        all_reminders = []
        for day_offset in range(7):
            current_mission_day = start_day + day_offset
            for ev in template["events"]:
                rem_id = f"rem_d{current_mission_day}_{ev['id']}"
                all_reminders.append({
                    "id": rem_id,
                    "mission_day": current_mission_day,
                    "event_id": ev["id"],
                    "title": ev["title"],
                    "time": ev["time"],
                    "type": ev["type"],
                    "state": "scheduled",
                    "snooze_count": 0,
                    "linked": {"mission_day": current_mission_day},
                })

        with self.lock:
            # Merge with existing reminders
            existing = {r["id"] for r in self.reminders.get(cid, [])}
            new_rems = [r for r in all_reminders if r["id"] not in existing]
            self.reminders.setdefault(cid, []).extend(new_rems)
            self._save()

        return copy.deepcopy(all_reminders)

    def tick_one_minute(self, cid: str, current_hour_dec: float, mode: str = "routine", sleep_block: str = "22:00-06:00") -> dict:
        """Step 2 & 3: One-minute tick moves due reminders to 'due' and respects sleep and EVA blocks.
        
        Protocol reminders (recheck, treatment_timer) outrank routine ones.
        """
        from brain.profile import is_in_sleep_block
        due_list = []
        with self.lock:
            rems = self.reminders.setdefault(cid, [])
            for r in rems:
                if r.get("state") != "scheduled":
                    continue
                t_str = r.get("time", "")
                if ":" not in t_str:
                    continue
                try:
                    h, m = [float(x) for x in t_str.split(":")]
                    r_dec = h + m / 60.0
                except Exception:
                    continue

                if current_hour_dec >= r_dec:
                    # Respect sleep and EVA blocks per Section 20 Step 3
                    is_protocol = r.get("type") in ("recheck", "treatment_timer")
                    is_sleep = is_in_sleep_block(sleep_block, current_hour_dec)
                    is_eva = mode in ("eva", "sortie")

                    if (is_sleep or is_eva) and not is_protocol:
                        r["state"] = "paused"
                        r["paused_reason"] = "sleep_block" if is_sleep else "eva_mode"
                    else:
                        r["state"] = "due"
                        r["due_at"] = time.time()
                        due_list.append(r)

            self._save()

        # Step 3: Priority ranking (protocol reminders outrank routine ones)
        ranked_due = self.rank_reminders(due_list)
        return {
            "crew_id": cid,
            "current_hour": current_hour_dec,
            "due_count": len(ranked_due),
            "due_reminders": ranked_due,
        }

    @staticmethod
    def rank_reminders(reminders: list[dict]) -> list[dict]:
        """Rank reminders: protocol reminders (recheck, treatment_timer) outrank routine ones."""
        priority_order = {
            "treatment_timer": 0,
            "recheck": 1,
            "measurement": 2,
            "checkin": 3,
            "exercise": 4,
            "hydration": 5,
            "sleep_winddown": 6,
            "mood": 7,
            "kit_check": 8,
            "duty": 9,
        }
        return sorted(reminders, key=lambda r: priority_order.get(r.get("type", "duty"), 9))

    def handle_miss(self, cid: str, reminder_id: str, miss_after_min: int = 15, retry_min: int = 10) -> dict:
        """Step 4 & 5: Reminder with no response after missAfterMin becomes missed,
        is re-presented once after retryMin with a softer prompt, and if missed again increments missed_checkins.
        Three misses in a row adds a line to the next digest; never phrased as a judgment.
        """
        with self.lock:
            rems = self.reminders.setdefault(cid, [])
            rem = next((r for r in rems if r.get("id") == reminder_id), None)
            if not rem:
                if not reminder_id.startswith("rem_"):
                    raise KeyError(f"unknown reminder {reminder_id}")
                rem = {"id": reminder_id, "state": "scheduled", "title": reminder_id[4:].replace("_", " ")}   # a schedule reminder, first touched now
                rems.append(rem)

            re_presented = rem.get("re_presented", False)
            if not re_presented:
                # Re-present once with softer prompt
                rem["state"] = "re_presented"
                rem["re_presented"] = True
                rem["soft_prompt"] = f"Gentle check-in: '{rem.get('title')}' is ready whenever you have a moment."
                rem["retry_at"] = time.time() + (retry_min * 60)
                self._save()
                return copy.deepcopy(rem)

            # Missed again: increment missed_checkins
            rem["state"] = "missed"
            rem["missed_at"] = time.time()
            self._save()

        # Update store missed_checkins
        consecutive = 1
        try:
            from brain.store import store
            s = store.get(cid)
            missed_count = s.get("manual", {}).get("missed_checkins", 0) + 1
            store.patch(cid, {"manual": {"missed_checkins": missed_count}})
            consecutive = missed_count
        except Exception:
            pass

        # Step 5: Three misses in a row adds a line to next digest
        digest_note = ""
        if consecutive >= 3:
            digest_note = "Three consecutive scheduled check-ins uncompleted; team review recommended."

        return {
            **copy.deepcopy(rem),
            "missed_checkins_count": consecutive,
            "consecutive_alert": consecutive >= 3,
            "digest_note": digest_note,
        }

    def create_recheck_reminder(self, cid: str, protocol_title: str, recheck_after_min: int = 45, current_hour_dec: float | None = None) -> dict:
        """Step 6: Accepting a recommendation creates a recheck reminder at now plus recheckAfterMin."""
        now = time.time()
        dec_h = (current_hour_dec if current_hour_dec is not None else 8.0) + (recheck_after_min / 60.0)
        h = int(dec_h) % 24
        m = int((dec_h - int(dec_h)) * 60)
        time_str = f"{h:02d}:{m:02d}"

        rem = {
            "id": f"recheck_{uuid.uuid4().hex[:8]}",
            "title": f"Recheck: {protocol_title}",
            "time": time_str,
            "type": "recheck",
            "state": "scheduled",
            "snooze_count": 0,
            "created_at": now,
            "due_timestamp": now + (recheck_after_min * 60),
            "linked": {"protocol": protocol_title, "interval_min": recheck_after_min},
        }
        with self.lock:
            self.reminders.setdefault(cid, []).append(rem)
            self._save()
        return rem


plan = PlanEngine()
