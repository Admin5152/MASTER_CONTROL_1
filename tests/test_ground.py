"""Store-and-forward to ground (SIM transport) and the new session log fields."""
from brain.ground import Ground


def test_packet_moves_from_queued_to_awaiting_reply():
    now = [1000.0]
    g = Ground(persist=False, one_way_min=12.7, clock=lambda: now[0])
    p = g.send("james", "exam", "Guided exam", {"hr": 64})
    assert p["status"] == "queued" and p["transport"] == "SIM"
    now[0] += 60
    assert g.list("james")[0]["status"] == "in transit"
    assert abs(g.list("james")[0]["eta_s"] - (12.7 * 60 - 60)) < 1e-6
    now[0] += 12.7 * 60 - 30
    assert g.list("james")[0]["status"] == "delivered"
    now[0] += 400
    assert g.list("james")[0]["status"] == "awaiting reply"
    assert g.list("amara") == []


def test_ground_routes(client):
    r = client.post("/api/ground/james", json={"kind": "exam", "title": "Guided exam", "body": {"steps": 6}})
    assert r.status_code == 200 and r.json()["status"] == "queued"
    assert client.post("/api/ground/james", json={"kind": "launch"}).status_code == 422
    lst = client.get("/api/ground?crew_id=james").json()
    assert lst["transport"] == "SIM" and lst["packets"][0]["title"] == "Guided exam"


def test_pvt_and_measures_log_fields_accepted(client):
    for f, v in (("session.pvt_lapses", 2), ("session.pvt_mean_ms", 312), ("session.sit_to_stand_s", 11.4), ("session.tandem_walk_s", 8.2)):
        assert client.post("/api/log/james", json={"field": f, "value": v, "source": "user"}).status_code == 200, f


def test_sentinel_skin_sim_feed(client):
    assert client.get("/api/aux/james").json()["skin"] == {"on": False}
    r = client.post("/api/skin/james", json={"on": True}).json()
    assert r["on"] is True
    eyes = r["zones"]["eyes"][0]
    assert eyes["field"] == "skin.onsd_mm" and eyes["unit"] == "mm" and 4.0 < eyes["value"] < 6.0
    assert any(lv.get("above") == 5.0 for lv in eyes["levels"]) and eyes["source"]["url"]
    assert r["zones"]["heart"][0]["field"] == "skin.ejection_fraction"
    assert client.get("/api/aux/james").json()["skin"]["on"] is True
    assert client.get("/api/aux/amara").json()["skin"] == {"on": False}
    client.post("/api/skin/james", json={"on": False})
    assert client.get("/api/aux/james").json()["skin"] == {"on": False}
