"""Baseline and drift engine. Pure: (state, thresholds, history_baselines) -> drift.

Every note is worded as change from the person's own baseline, never a diagnosis.
"""
from __future__ import annotations

from .contract import get_path

# Words for the note, by metric and direction of change.
PHRASES = {
    "voice.talk_time": ("talking {p}% more", "talking {p}% less"),
    "voice.pitch": ("pitch {p}% higher", "pitch {p}% flatter"),
    "vitals.heart_rate": ("heart rate {p}% above", "heart rate {p}% below"),
    "cognitive.reaction_ms": ("reaction time {p}% slower", "reaction time {p}% faster"),
    "manual.bp_systolic": ("systolic pressure {p}% higher", "systolic pressure {p}% lower"),
    "manual.glucose_mgdl": ("glucose {p}% higher", "glucose {p}% lower"),
    "manual.temp_c": ("temperature {p}% higher", "temperature {p}% lower"),
    "manual.sleep_hours": ("sleeping {p}% more", "sleeping {p}% less"),
    "manual.mood": ("mood {p}% higher", "mood {p}% lower"),
}


def pct_change(current: float, baseline: float) -> float:
    if not baseline:
        return 0.0
    return (current - baseline) / abs(baseline) * 100.0


def _baseline_for(state: dict, metric: str, spec: dict, history_baselines: dict) -> float | None:
    field = spec["baseline_field"]
    if field == "history":
        return history_baselines.get(metric)
    b = get_path(state, field)
    if isinstance(b, (int, float)) and not isinstance(b, bool) and b:
        return float(b)
    return None


def compute_drift(state: dict, thresholds: dict, history_baselines: dict | None = None) -> dict:
    """Return {flag, note, items}. items carry metric, delta_pct, zone, severity."""
    history_baselines = history_baselines or {}
    items = []
    phrases = []
    for metric, spec in thresholds["drift"].items():
        if metric.startswith("_"):
            continue
        cur = get_path(state, metric)
        if cur is None or isinstance(cur, bool) or not isinstance(cur, (int, float)):
            continue
        base = _baseline_for(state, metric, spec, history_baselines)
        if base is None:
            continue
        delta = pct_change(float(cur), base)
        d = spec["direction"]
        moved = (d == "up" and delta > 0) or (d == "down" and delta < 0) or d == "both"
        mag = abs(delta)
        if not moved or mag < spec["pct"]:
            continue
        severity = "alert" if mag >= 2 * spec["pct"] else "watch"
        items.append({"metric": metric, "delta_pct": round(delta, 1), "zone": spec["zone"], "severity": severity})
        up, down = PHRASES.get(metric, ("{p}% higher", "{p}% lower"))
        phrases.append((up if delta > 0 else down).format(p=round(mag)))

    # Fatigue and stress are simulated 0-1 indices with absolute levels; they map to zones
    # through thresholds.absolute and are reported as state items so the eye zone can light.
    for metric in ("state.fatigue", "state.stress"):
        spec = thresholds["absolute"].get(metric)
        val = get_path(state, metric)
        if not spec or not isinstance(val, (int, float)):
            continue
        sev = None
        for level in spec["levels"]:
            if "above" in level and val > level["above"]:
                if sev is None or level["severity"] == "alert":
                    sev = level["severity"]
        if sev:
            items.append({"metric": metric, "delta_pct": 0.0, "zone": spec["zone"], "severity": sev})
            phrases.append(f"{spec['label'].replace(' (SIM)', '').lower()} raised ({val:.1f} of 1)")

    name = state.get("display_name") or state.get("crew_id", "your")
    note = ""
    if phrases:
        body = ", ".join(phrases[:-1]) + (" and " if len(phrases) > 1 else "") + phrases[-1]
        note = f"{body[0].upper()}{body[1:]} compared with {name}'s usual baseline."
    return {"flag": bool(items), "note": note, "items": items}
