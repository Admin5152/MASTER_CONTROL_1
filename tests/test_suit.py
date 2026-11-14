"""Suit integrity (SIM): a leak is flagged from falling pressure, in the right region, and clears when sealed."""
import time

from brain.suit import BREACH_PSI, NOMINAL_PSI, Suits, region_from_text


def test_stowed_in_the_cabin_and_steady_on_an_eva():
    s = Suits()
    assert s.status("a")["integrity"] == "stowed"
    st = s.set_mode("a", "eva")
    assert st["integrity"] == "ok" and st["pressure_psi"] == NOMINAL_PSI


def test_a_leak_is_flagged_in_its_region_and_pressure_falls():
    s = Suits(); s.leak("a", "left_glove", "leak"); t = time.time()
    st = s.status("a", t + 60)
    assert st["integrity"] == "breach" and st["region"] == "left_glove" and st["zone"] == "bones"
    assert st["pressure_psi"] < NOMINAL_PSI and st["pressure_rate_psi_min"] < 0 and st["steps"]
    assert s.status("a", t + 600)["pressure_psi"] < BREACH_PSI


def test_a_slow_leak_is_a_watch_and_sealing_clears_it():
    s = Suits(); s.leak("a", "right_leg", "slow")
    assert s.status("a", time.time() + 30)["integrity"] == "watch"
    assert s.seal("a")["integrity"] == "ok"


def test_regions_from_what_was_said():
    assert region_from_text("there's a hole in my right boot") == "right_boot"
    assert region_from_text("my visor is cracked") == "helmet"
    assert region_from_text("suit leak") == "left_glove"


def test_suit_endpoint_and_aux():
    from fastapi.testclient import TestClient
    import server
    c = TestClient(server.app)
    cid = c.get("/api/crew").json()[0]["crew_id"]
    assert c.post(f"/api/suit/{cid}", json={"action": "leak", "text": "leak in the helmet"}).json()["region"] == "helmet"
    assert c.get(f"/api/aux/{cid}").json()["suit"]["integrity"] in ("watch", "breach")
    assert c.post(f"/api/suit/{cid}", json={"action": "iva"}).json()["integrity"] == "stowed"
    assert c.post(f"/api/suit/{cid}", json={"action": "fly"}).status_code == 400
