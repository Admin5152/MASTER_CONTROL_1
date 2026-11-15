"""Trends & Correlation Subsystem (Product Document Section 16.1 Screen 7).

Covers:
- Trends screen: Per-indicator charts, wellbeing dimensions, sleep and reaction time correlation view, weekly report.
- Special states: 'Not enough data' (< 3 points).
"""
from __future__ import annotations

import copy
import statistics


class TrendsEngine:
    """Aggregates multi-indicator trends and sleep-reaction correlations (Section 16.1)."""

    @staticmethod
    def get_trends(cid: str, store, days: int = 7) -> dict:
        """Returns 7-day multi-indicator trends, sleep vs reaction correlation, and data sufficiency flag."""
        hist = store.history.get(cid, {})

        def _series(field: str):
            pts = hist.get(field, [])[-days:]
            return [{"t": p.get("t"), "v": p.get("v"), "label": p.get("source", "SIM")} for p in pts]

        sleep_pts = _series("manual.sleep_hours")
        reaction_pts = _series("cognitive.reaction_ms")
        hr_pts = _series("vitals.heart_rate")
        spo2_pts = _series("vitals.spo2")
        mood_pts = _series("manual.mood")
        stress_pts = _series("state.stress")

        # Sleep vs Reaction Correlation View
        correlated = []
        for i in range(min(len(sleep_pts), len(reaction_pts))):
            correlated.append({
                "day_index": i + 1,
                "sleep_hours": sleep_pts[i]["v"],
                "reaction_ms": reaction_pts[i]["v"],
            })

        total_pts = len(sleep_pts) + len(hr_pts)
        has_enough_data = total_pts >= 3

        return {
            "crew_id": cid,
            "days": days,
            "has_enough_data": has_enough_data,
            "special_state": "nominal" if has_enough_data else "not_enough_data",
            "sleep_vs_reaction": correlated,
            "indicators": {
                "heart_rate": hr_pts,
                "spo2": spo2_pts,
                "sleep_hours": sleep_pts,
                "reaction_ms": reaction_pts,
            },
            "wellbeing": {
                "mood": mood_pts,
                "stress": stress_pts,
            },
            "summary": {
                "sleep_mean": round(statistics.mean([p["v"] for p in sleep_pts]), 1) if sleep_pts else None,
                "reaction_mean": round(statistics.mean([p["v"] for p in reaction_pts]), 1) if reaction_pts else None,
                "hr_mean": round(statistics.mean([p["v"] for p in hr_pts]), 1) if hr_pts else None,
            },
        }


trends = TrendsEngine()
