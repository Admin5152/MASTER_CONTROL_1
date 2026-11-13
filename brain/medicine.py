"""Medicine suggestion: only ever returns an item that is on the kit list."""
from __future__ import annotations

import json
from pathlib import Path

SHARED = Path(__file__).resolve().parent.parent / "shared"


def load_kit() -> dict:
    return json.loads((SHARED / "med_kit.json").read_text(encoding="utf-8"))


def suggest(symptom: str, kit: dict | None = None) -> dict:
    kit = kit or load_kit()
    s = (symptom or "").strip().lower()
    item_id = kit["symptom_map"].get(s)
    items = {i["id"]: i for i in kit["items"]}
    zone = kit.get("symptom_zone", {}).get(s, "")
    if item_id and item_id in items:
        item = items[item_id]
        return {
            "matched": True,
            "symptom": s,
            "item": item,
            "zone": zone,
            "text": f"Stocked item for {s}: {item['name']} ({item['pack']}). {kit['caveat']}",
        }
    return {"matched": False, "symptom": s, "item": None, "zone": zone, "text": kit["no_match"]}
