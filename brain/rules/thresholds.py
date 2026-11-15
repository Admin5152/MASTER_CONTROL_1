"""Absolute threshold checks. Pure: (state, thresholds) -> list of results.

Each result carries the threshold's kind and source so the UI can show them.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from brain.core.contract import get_path

SHARED = Path(__file__).resolve().parents[2] / "shared"
SEV_RANK = {"ok": 0, "none": 0, "info": 1, "watch": 2, "alert": 3}


def load_thresholds() -> dict:
    return json.loads((SHARED / "thresholds.json").read_text(encoding="utf-8"))


def _hit(level: dict, value: float) -> bool:
    if "below" in level and value < level["below"]:
        return True
    if "above" in level and value > level["above"]:
        return True
    return False


def evaluate_absolute(state: dict, thresholds: dict) -> list[dict]:
    """Return one result per metric that has a value: worst level hit, or ok."""
    results = []
    for metric, spec in thresholds["absolute"].items():
        value = get_path(state, metric)
        if value is None or isinstance(value, bool) or not isinstance(value, (int, float)):
            continue
        worst: dict | None = None
        for level in spec["levels"]:
            if _hit(level, float(value)):
                if worst is None or SEV_RANK[level["severity"]] > SEV_RANK[worst["severity"]]:
                    worst = level
        res: dict[str, Any] = {
            "metric": metric,
            "label": spec["label"],
            "value": value,
            "unit": spec["unit"],
            "zone": spec["zone"],
            "severity": worst["severity"] if worst else "ok",
            "levels": spec["levels"],
        }
        if worst:
            res["kind"] = worst["kind"]
            res["source"] = worst["source"]
            res["note"] = worst.get("note", "")
            bound = worst.get("below", worst.get("above"))
            res["limit"] = bound
            res["direction"] = "below" if "below" in worst else "above"
        results.append(res)
    return results


def worst_severity(items: list[dict]) -> str:
    worst = "ok"
    for it in items:
        if SEV_RANK.get(it.get("severity", "ok"), 0) > SEV_RANK[worst]:
            worst = it["severity"]
    return worst
