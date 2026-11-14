"""Contract template, patch validation and deep merge.

The template is the frozen contract plus the listed additions (shared/contract.json).
A patch may only use keys that exist in the template; anything else is rejected so
nobody invents private fields.
"""
from __future__ import annotations

import copy
import json
from pathlib import Path
from typing import Any

SHARED = Path(__file__).resolve().parent.parent / "shared"


class ContractError(ValueError):
    def __init__(self, path: str, message: str):
        super().__init__(f"{path}: {message}")
        self.path = path
        self.message = message


def deep_merge(base: dict, patch: dict) -> dict:
    """Return a new dict: patch merged into base. Lists and scalars replace."""
    out = copy.deepcopy(base)
    for k, v in patch.items():
        if isinstance(v, dict) and isinstance(out.get(k), dict):
            out[k] = deep_merge(out[k], v)
        else:
            out[k] = copy.deepcopy(v)
    return out


def _load() -> tuple[dict, dict]:
    raw = json.loads((SHARED / "contract.json").read_text(encoding="utf-8"))
    template = deep_merge(raw["frozen"], raw["additions"])
    return template, raw["enums"]


TEMPLATE, ENUMS = _load()
# drift.items is a list of objects; describe the item shape separately.
DRIFT_ITEM = TEMPLATE["drift"]["items"][0]


def _is_number(v: Any) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def _enum_for(path: str) -> list[str] | None:
    if path in ENUMS:
        return ENUMS[path]
    parent = path.rsplit(".", 1)[0]
    return ENUMS.get(parent + ".*")


def _check_value(path: str, tmpl: Any, value: Any) -> None:
    if isinstance(tmpl, dict):
        if not isinstance(value, dict):
            raise ContractError(path, "expected an object")
        _check_obj(path, tmpl, value)
        return
    if isinstance(tmpl, list):
        if not isinstance(value, list):
            raise ContractError(path, "expected a list")
        if path == "drift.items":
            for i, item in enumerate(value):
                if not isinstance(item, dict):
                    raise ContractError(f"{path}[{i}]", "expected an object")
                _check_obj("drift.items", DRIFT_ITEM, item, display=f"{path}[{i}]")
        elif path == "manual.symptoms":
            if not all(isinstance(s, str) for s in value):
                raise ContractError(path, "symptoms must be strings")
        return
    if tmpl is None:
        if value is not None and not _is_number(value) and not isinstance(value, str):
            raise ContractError(path, "expected a number, string or null")
        return
    if isinstance(tmpl, bool):
        if not isinstance(value, bool):
            raise ContractError(path, "expected true or false")
        return
    if _is_number(tmpl):
        if not _is_number(value):
            raise ContractError(path, "expected a number")
        return
    if isinstance(tmpl, str):
        if not isinstance(value, str):
            raise ContractError(path, "expected a string")
        allowed = _enum_for(path)
        if allowed is not None and value not in allowed:
            raise ContractError(path, f"must be one of {allowed}")
        return


def _check_obj(path: str, tmpl: dict, value: dict, display: str | None = None) -> None:
    for k, v in value.items():
        child = f"{path}.{k}" if path else k
        if k not in tmpl:
            raise ContractError(f"{display or path}.{k}".lstrip("."), "unknown field")
        _check_value(child, tmpl[k], v)


def validate_patch(patch: Any) -> None:
    """Raise ContractError if the patch uses an unknown field or a wrong type."""
    if not isinstance(patch, dict):
        raise ContractError("", "patch must be an object")
    if "crew_id" in patch:
        raise ContractError("crew_id", "crew_id cannot be patched")
    rad = patch.get("radiation", {})
    if not isinstance(rad, dict):
        raise ContractError("radiation", "expected an object")
    _check_obj("", TEMPLATE, patch)
    loc = rad.get("location", {})
    for key, limit in (("latitude", 90), ("longitude", 180)):
        value = loc.get(key)
        if value is not None and (not _is_number(value) or not -limit <= value <= limit):
            raise ContractError("radiation.location." + key, "invalid coordinate")
    readings = {"dose_rate_usv_h", "dose_rate_msv_day", "cumulative_msv", "event_level", "shelter_status"}
    if readings.intersection(rad) and (rad.get("label") != "SIM" or rad.get("confidence") != 1):
        raise ContractError("radiation", 'readings require label SIM and confidence 1')
    if "label" in rad and rad["label"] != "SIM":
        raise ContractError("radiation.label", "must be SIM")
    if "confidence" in rad and (isinstance(rad["confidence"], bool) or rad["confidence"] != 1):
        raise ContractError("radiation.confidence", "must be 1")
    if "shielding_factor" in rad and not 0 <= rad["shielding_factor"] <= 1:
        raise ContractError("radiation.shielding_factor", "must be between 0 and 1")
    _check_obj("", TEMPLATE, patch)


def validate_full(obj: dict) -> None:
    """Check a whole state object (used on mock data at start)."""
    _check_obj("", TEMPLATE, {k: v for k, v in obj.items()})
    missing = _missing("", TEMPLATE, obj)
    if missing:
        raise ContractError(missing[0], "missing field")
    validate_patch({"radiation": obj["radiation"]})


def _missing(path: str, tmpl: dict, obj: dict) -> list[str]:
    out = []
    for k, v in tmpl.items():
        p = f"{path}.{k}" if path else k
        if k not in obj:
            out.append(p)
        elif isinstance(v, dict) and isinstance(obj[k], dict):
            out += _missing(p, v, obj[k])
    return out


def numeric_leaves(obj: dict, prefix: str = "") -> list[tuple[str, float]]:
    out = []
    for k, v in obj.items():
        p = f"{prefix}.{k}" if prefix else k
        if isinstance(v, dict):
            out += numeric_leaves(v, p)
        elif _is_number(v):
            out.append((p, float(v)))
    return out


def get_path(obj: dict, path: str, default: Any = None) -> Any:
    cur: Any = obj
    for part in path.split("."):
        if not isinstance(cur, dict) or part not in cur:
            return default
        cur = cur[part]
    return cur
