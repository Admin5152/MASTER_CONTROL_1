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


def test_storm_s2_unsheltered_flags_radiation_sheltered_does_not(store):
    s = store.patch("james", {"radiation": {"storm_level": 2, "sheltered": False}})
    assert s["action"]["type"] == "flag_radiation"
    s = store.patch("james", {"radiation": {"storm_level": 2, "sheltered": True}})
    assert s["action"]["type"] != "flag_radiation"


def test_shelter_halves_storm_dose():
    rec, av = storm_dose_step(3, 60, False, TH)
    rec2, av2 = storm_dose_step(3, 60, True, TH)
    assert av == 0 and abs(rec2 - rec * 0.5) < 1e-9 and abs(av2 - rec * 0.5) < 1e-9
