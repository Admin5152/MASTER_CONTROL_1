"""Pairing (critique fix): another device needs the PIN; this laptop does not."""
from fastapi.testclient import TestClient
import server


def test_the_laptop_needs_no_pin_and_another_device_does():
    local = TestClient(server.app)
    assert local.get("/api/crew").status_code == 200
    other = TestClient(server.app, client=("192.168.1.50", 5000))
    r = other.get("/api/crew")
    assert r.status_code == 401 and r.json()["pair"]
    assert other.get("/api/health").status_code == 200                  # health stays open
    assert other.get("/api/pin").status_code in (401, 403)              # the PIN is never shown remotely
    assert other.post("/api/pair", json={"pin": "000000" if server.PAIR_PIN != "000000" else "111111"}).status_code == 401
    assert other.post("/api/pair", json={"pin": server.PAIR_PIN}).status_code == 200
    assert other.get("/api/crew").status_code == 200                    # paired: the cookie opens the API
