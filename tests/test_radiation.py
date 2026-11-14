"""Acceptance tests for Radiation Watch (spec 6.8)."""
import json
from pathlib import Path

from brain.radiation import SpaceWeather, cumulative_dose, flux_to_level, load_snapshot, parse_protons, storm_dose_step
from brain.thresholds import load_thresholds

ROOT = Path(__file__).resolve().parent.parent
TH = load_thresholds()


def test_flux_to_storm_level():
    assert flux_to_level(5) == 0
    assert flux_to_level(10) == 1
    assert flux_to_level(100) == 2
    assert flux_to_level(1000) == 3
    assert flux_to_level(10000) == 4
    assert flux_to_level(100000) == 5
    assert flux_to_level(None) == 0


def test_parser_reads_saved_snapshot():
    snap = load_snapshot()
    assert snap["source"] == "snapshot"
    assert isinstance(snap["level"], int) and 0 <= snap["level"] <= 5
    assert snap["time"] and snap["time"].startswith("20")
    assert len(snap["series"]) > 100
    rows = json.loads((ROOT / "shared" / "swpc_protons_1day.json").read_text())
    p = parse_protons(rows)
    assert all(pt["flux"] >= 0 for pt in p["series"])


def test_spaceweather_falls_back_to_snapshot_when_network_fails(client, monkeypatch, tmp_path):
    import server
    import brain.radiation as rad

    def boom():
        raise OSError("network down")

    monkeypatch.setattr(rad, "CACHE", tmp_path)  # no cached copy either
    sw = SpaceWeather(fetch=boom)
    monkeypatch.setattr(server, "spaceweather", sw)
    sw.refresh()
    r = client.get("/api/spaceweather").json()
    assert r["source"] == "snapshot"
    assert "level" in r and r["time"]


def test_mars_transit_day_180_dose():
    rate = TH["radiation"]["dose_rates_msv_day"]["mars_transit"]["value"]
    assert cumulative_dose("mars_transit", 180, TH) == 180 * rate


def test_store_cumulative_matches_model(store):
    s = store.patch("james", {"radiation": {"mission_profile": "mars_transit", "mission_day": 180}})
    rate = TH["radiation"]["dose_rates_msv_day"]["mars_transit"]["value"]
    assert abs(s["radiation"]["cumulative_msv"] - 180 * rate) < 1e-6
    assert s["radiation"]["dose_rate_msv_day"] == rate


def test_storm_s3_unsheltered_flags_radiation_sheltered_does_not(store):
    s = store.patch("james", {"radiation": {"storm_level": 3, "sheltered": False}})
    assert s["action"]["type"] == "flag_radiation"
    s = store.patch("james", {"radiation": {"storm_level": 3, "sheltered": True}})
    assert s["action"]["type"] != "flag_radiation"


def test_shelter_halves_storm_dose():
    rec, av = storm_dose_step(3, 60, False, TH)
    rec2, av2 = storm_dose_step(3, 60, True, TH)
    assert av == 0 and abs(rec2 - rec * 0.5) < 1e-9 and abs(av2 - rec * 0.5) < 1e-9


def test_feed_cycle_transitions_and_metadata(store):
    for level, expected in [(0, "quiet"), (1, "elevated"), (3, "storm"), (0, "quiet")]:
        store.apply_radiation_feed({"level": level, "source": "snapshot"})
        r = store.get("james")["radiation"]
        assert r["event_level"] == expected
        assert r["shelter_status"] == (level >= 3)
        assert r["label"] == "SIM" and r["confidence"] == 1
    events = [e for e in store.radiation_events if e["payload"]["crewId"] == "james"]
    assert sum(e["event"] == "radiation.updated" for e in events) == 4
    assert sum(e["event"] == "radiation.alert" for e in events) == 2
    assert any(e["event"] == "shelter.advised" for e in events)
    assert any(e["event"] == "radiation.resolved" for e in events)
    assert any(e["event"] == "shelter.cleared" for e in events)


def test_readings_reject_missing_or_invalid_metadata(store):
    import pytest
    from brain.contract import ContractError
    for patch in [{"cumulative_msv": 2}, {"dose_rate_usv_h": 1, "label": "LIVE", "confidence": 1},
                  {"event_level": "storm", "label": "SIM", "confidence": 0.5}]:
        with pytest.raises(ContractError):
            store.patch("james", {"radiation": patch})


def test_negative_or_nonfinite_flux_is_ignored():
    rows = [{"energy": ">=10 MeV", "time_tag": "2026-01-01", "flux": v}
            for v in [-1, float("nan"), float("inf"), True]]
    assert parse_protons(rows)["series"] == []


def test_shielding_controls_current_rate(store):
    store.apply_radiation_feed({"level": 3, "source": "snapshot"})
    before = store.get("james")["radiation"]["dose_rate_usv_h"]
    after = store.patch("james", {"radiation": {"shielding_factor": 0.25}})["radiation"]
    assert after["dose_rate_usv_h"] == before * 0.25


def test_storm_dose_accumulates_monotonically(store):
    before = store.get("james")["radiation"]["cumulative_msv"]
    for _ in range(3):
        received, avoided = storm_dose_step(3, 60, True, TH, time_scale=1)
        store.add_storm_dose_for("james", received, avoided)
        current = store.get("james")["radiation"]["cumulative_msv"]
        assert current >= before
        before = current

def test_feed_integrates_elapsed_time_and_marks_history(store, monkeypatch):
    import brain.store as module
    now = [1000.0]
    monkeypatch.setattr(module.time, "time", lambda: now[0])
    store.apply_radiation_feed({"level": 0, "source": "snapshot"})
    before = store.get("james")["radiation"]["cumulative_msv"]
    now[0] += 3600
    store.apply_radiation_feed({"level": 0, "source": "snapshot"})
    assert store.get("james")["radiation"]["cumulative_msv"] > before
    point = store.history_for("james", "radiation.dose_rate_usv_h")[-1]
    assert point["label"] == "SIM" and point["confidence"] == 1


def test_radiation_event_endpoint(client):
    import server
    server.store.apply_radiation_feed({"level": 3, "source": "snapshot"})
    events = client.get("/api/radiation/events").json()["events"]
    assert any(e["event"] == "shelter.advised" for e in events)


def test_surface_location_contract(store):
    import pytest
    from brain.contract import ContractError
    loc = {"latitude": -4.5895, "longitude": 137.4417, "source": "sim", "updated": ""}
    state = store.patch("james", {"radiation": {"mission_profile": "mars_surface", "location": loc}})
    assert state["radiation"]["location"] == loc
    for key, value in [("latitude", 91), ("longitude", 181), ("latitude", "north")]:
        with pytest.raises(ContractError):
            store.patch("james", {"radiation": {"location": {key: value}}})



def test_feed_freshness_uses_measurement_timestamp():
    from brain.radiation import feed_freshness
    data = {"time": "2026-01-01T00:00:00Z", "source": "live"}
    assert not feed_freshness(data, 1767225600 + 60)["stale"]
    assert feed_freshness(data, 1767225600 + 901)["stale"]
    assert feed_freshness({"time": "invalid"})["stale"]


def test_shelter_clears_when_storm_drops_to_elevated(store):
    store.apply_radiation_feed({"level": 3, "source": "snapshot"})
    store.apply_radiation_feed({"level": 1, "source": "snapshot"})
    assert not store.get("james")["radiation"]["shelter_status"]
    assert any(e["event"] == "shelter.cleared" for e in store.radiation_events)
