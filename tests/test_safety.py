"""W14: the safety flow uses fixed lines, alerts people, and the language model is never asked."""
import json
from pathlib import Path

from brain.ai import llm
from brain.rules import safety

CASES = json.loads((Path(__file__).parent / "fixtures" / "safety_cases.json").read_text(encoding="utf-8"))


def test_same_cases_as_the_page():
    for text, cat in CASES:
        assert safety.concern(text) == cat, text


def test_the_language_model_is_never_asked():
    called = []
    def fake_stream(*a, **k):
        called.append(1); yield "Here is some advice."
    out = list(llm.chat_stream({"crew_id": "a", "display_name": "Eliah"}, "I want to die", crew_id="a", stream=fake_stream))
    assert not called
    assert out[0]["text"] == safety.LINES["first"] and out[-1]["source"] == "safety"
    assert {"cmd": "open_screen", "name": "grounding"} in out[-1]["commands"]


def test_alert_endpoint_sends_only_the_category():
    from fastapi.testclient import TestClient
    import server
    c = TestClient(server.app)
    cid = c.get("/api/crew").json()[0]["crew_id"]
    r = c.post(f"/api/safety/{cid}", json={"category": "self_harm"}).json()
    assert r["packet"]["priority"] == "URGENT" and r["packet"]["kind"] == "crisis" and r["buddy"] and r["commander"]
    assert "want to die" not in json.dumps(r["packet"])
    server.ground.packets = [p for p in server.ground.packets if p["kind"] != "crisis"]
    server.ground._save()   # leave the real queue as it was
