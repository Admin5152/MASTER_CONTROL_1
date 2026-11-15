"""Radiation Watch: NOAA space weather parsing, storm level, dose passport model.

Live feed (fetched by the backend, never by the browser):
  integral-protons-1-day.json: list of {time_tag, satellite, flux, energy}; energy like ">=10 MeV"
  noaa-scales.json: object keyed "-1", "0", "1"...; "0" is now; S.Scale is a string or null
Offline fallback: the saved copies in shared/.
"""
from __future__ import annotations

import json
import datetime as dt
import math
import time
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parents[2]
SHARED = ROOT / "shared"
CACHE = ROOT / "data"
PROTON_URL = "https://services.swpc.noaa.gov/json/goes/primary/integral-protons-1-day.json"
SCALES_URL = "https://services.swpc.noaa.gov/products/noaa-scales.json"

# NOAA S-scale, >=10 MeV proton flux in pfu (thresholds.json radiation.storm_scale).
S_LEVELS = [(5, 1e5), (4, 1e4), (3, 1e3), (2, 1e2), (1, 1e1)]


def flux_to_level(flux: float | None) -> int:
    if flux is None:
        return 0
    for level, pfu in S_LEVELS:
        if flux >= pfu:
            return level
    return 0


def parse_protons(rows: list) -> dict:
    """Return the >=10 MeV series and the latest point."""
    series = []
    for r in rows:
        if not isinstance(r, dict):
            continue
        if str(r.get("energy", "")).replace(" ", "") != ">=10MeV":
            continue
        f = r.get("flux")
        t = r.get("time_tag")
        if isinstance(f, (int, float)) and not isinstance(f, bool) and math.isfinite(f) and f >= 0 and isinstance(t, str) and t:
            series.append({"t": t, "flux": float(f)})
    series.sort(key=lambda p: p["t"])
    latest = series[-1] if series else None
    return {
        "series": series,
        "latest_flux": latest["flux"] if latest else None,
        "time": latest["t"] if latest else None,
        "level": flux_to_level(latest["flux"] if latest else None),
    }


def parse_scales(obj: dict) -> dict:
    now = obj.get("0", {}) if isinstance(obj, dict) else {}
    s = (now.get("S") or {}).get("Scale")
    try:
        level = int(s) if s is not None else None
    except (TypeError, ValueError):
        level = None
    stamp = f"{now.get('DateStamp', '')}T{now.get('TimeStamp', '')}Z" if now.get("DateStamp") else None
    return {"s_scale": level, "time": stamp}


def load_snapshot() -> dict:
    raw = json.loads((SHARED / "radiation_snapshot.json").read_text(encoding="utf-8"))
    protons, scales = raw["protons"], raw["scales"]
    return combine(parse_protons(protons), parse_scales(scales), "snapshot")


def feed_freshness(data: dict, now: float | None = None) -> dict:
    """Age refers to the measurement time, never the cache-read time."""
    now = time.time() if now is None else now
    try:
        stamp = dt.datetime.fromisoformat(str(data.get("time", "")).replace("Z", "+00:00"))
        if stamp.tzinfo is None:
            stamp = stamp.replace(tzinfo=dt.timezone.utc)
        age = max(0.0, now - stamp.timestamp())
    except (ValueError, TypeError, OverflowError):
        age = None
    return {"age_seconds": age, "stale": age is None or age > 900,
            "feed_status": "stale" if age is None or age > 900 else data.get("source", "snapshot")}


def combine(p: dict, s: dict, source: str) -> dict:
    level = max(p["level"], s["s_scale"] or 0)
    data = {
        "source": source,
        "level": level,
        "flux_level": p["level"],
        "noaa_s_scale": s["s_scale"],
        "latest_flux": p["latest_flux"],
        "time": p["time"] or s["time"],
        "series": p["series"],
        "fetched": time.time(),
        "label": "SIM",
        "confidence": 1,
    }
    data.update(feed_freshness(data))
    return data


class SpaceWeather:
    """Fetches NOAA every 60 s; keeps the last good response on disk."""

    def __init__(self, fetch=None):
        self._fetch = fetch or self._http_fetch
        self.latest: dict | None = None
        self.last_try = 0.0

    @staticmethod
    def _http_fetch() -> tuple[list, dict]:
        with httpx.Client(timeout=8.0) as c:
            p = c.get(PROTON_URL)
            p.raise_for_status()
            s = c.get(SCALES_URL)
            s.raise_for_status()
            return p.json(), s.json()

    def refresh(self) -> dict:
        self.last_try = time.time()
        try:
            protons, scales = self._fetch()
            data = combine(parse_protons(protons), parse_scales(scales), "live")
            if not data["series"]:
                raise ValueError("no >=10 MeV rows")
            self.latest = data
            try:
                CACHE.mkdir(exist_ok=True)
                (CACHE / "spaceweather_cache.json").write_text(json.dumps({"protons": protons, "scales": scales}))
            except OSError:
                pass
            return data
        except Exception:
            self.latest = self._cached_or_snapshot()
            return self.latest

    def _cached_or_snapshot(self) -> dict:
        f = CACHE / "spaceweather_cache.json"
        if f.exists():
            try:
                raw = json.loads(f.read_text())
                data = combine(parse_protons(raw["protons"]), parse_scales(raw["scales"]), "snapshot")
                if not data["series"]:
                    raise ValueError("empty cached series")
                return data
            except (OSError, ValueError, KeyError):
                pass
        return load_snapshot()

    def get(self, max_age: float = 60.0) -> dict:
        if self.latest is None or time.time() - self.last_try > max_age:
            return self.refresh()
        return self.latest


# ---- dose passport (modelled, SIM) ----

def dose_rate(profile: str, thresholds: dict) -> float:
    rates = thresholds["radiation"]["dose_rates_msv_day"]
    return float(rates.get(profile, rates["iss"])["value"])


def cumulative_dose(profile: str, mission_day: float, thresholds: dict, storm_msv: float = 0.0) -> float:
    return dose_rate(profile, thresholds) * float(mission_day) + float(storm_msv)


def margin_days(cumulative: float, limit: float, rate: float) -> float | None:
    if rate <= 0:
        return None
    return max(0.0, (limit - cumulative) / rate)


def storm_dose_step(level: int, seconds: float, sheltered: bool, thresholds: dict, time_scale: float = 60.0) -> tuple[float, float]:
    """Dose (received, avoided) in mSv for `seconds` of real time at a storm level.

    time_scale: one real second counts as this many mission seconds (demo speed-up, 60 = 1 s per minute).
    """
    if seconds < 0 or time_scale < 0:
        raise ValueError("elapsed time must be nonnegative")
    per_hour = float(thresholds["radiation"]["storm_extra_msv_hour"]["by_level"].get(str(level), 0))
    unshielded = per_hour * seconds * time_scale / 3600.0
    if not sheltered:
        return unshielded, 0.0
    red = float(thresholds["radiation"]["shelter_reduction"]["value"])
    return unshielded * (1 - red), unshielded * red
