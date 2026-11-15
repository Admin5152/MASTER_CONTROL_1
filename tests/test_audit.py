"""Audit (INT-3, NFR-6, SI6): every event appears; actions are recorded; nothing sensitive is written."""
from brain.core.audit import Audit


def test_events_are_recorded_newest_first_and_filterable():
    a = Audit(persist=False)
    a.record("page", "reminder.due", "x", {"label": "morning vitals"})
    a.record("brain", "digest.queued", "x", {"priority": "ACT"})
    rows = a.recent()
    assert [r["event"] for r in rows] == ["digest.queued", "reminder.due"]
    assert a.recent(contains="digest")[0]["detail"]["priority"] == "ACT"


def test_large_or_deep_details_are_trimmed():
    e = Audit(persist=False).record("page", "x", None, {"long": "a" * 500, "deep": {"deeper": {"deepest": 1}}})
    assert len(e["detail"]["long"]) == 160 and e["detail"]["deep"]["deeper"] == "…"


def test_the_server_audits_actions_and_page_batches_without_sensitive_words():
    from fastapi.testclient import TestClient
    import server
    c = TestClient(server.app)
    cid = c.get("/api/crew").json()[0]["crew_id"]
    c.post("/api/audit", json={"crew_id": cid, "events": [{"t": 1, "event": "voice:capture", "detail": {"on": True}}], "counts": {"voice:level": 300}})
    c.patch(f"/api/profile/{cid}", json={"health": {"allergies": ["ibuprofen"]}})
    c.post(f"/api/safety/{cid}", json={"category": "self_harm"})
    rows = c.get("/api/audit").json()["entries"]
    names = [r["event"] for r in rows]
    assert {"voice:capture", "telemetry.counts", "profile.updated", "safety.urgent_concern"} <= set(names)
    blob = str(rows)
    assert "ibuprofen" not in blob   # health background never written
    c.delete(f"/api/profile/{cid}")
    server.ground.packets = [p for p in server.ground.packets if p["kind"] != "crisis"]
    server.ground._save()
