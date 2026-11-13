"""Acceptance tests for the brain (spec 6.1) and the Director validator (6.11)."""
import json
import os
from pathlib import Path

import pytest

from brain import llm
from brain.decision import decide
from brain.drift import compute_drift
from brain.medicine import load_kit, suggest
from brain.thresholds import evaluate_absolute, load_thresholds

ROOT = Path(__file__).resolve().parent.parent
TH = load_thresholds()


def test_quieter_flatter_voice_raises_drift_with_baseline_note(store):
    b = store.get("james")["baseline"]
    s = store.patch("james", {"voice": {"talk_time": b["talk_time"] * 0.6, "pitch": b["pitch"] * 0.85}})
    assert s["drift"]["flag"] is True
    assert "baseline" in s["drift"]["note"].lower()
    assert "less" in s["drift"]["note"] and "flatter" in s["drift"]["note"]
    metrics = {i["metric"] for i in s["drift"]["items"]}
    assert {"voice.talk_time", "voice.pitch"} <= metrics


def test_unknown_field_returns_422(client):
    r = client.post("/api/state/james/patch", json={"vitals": {"heart_rate": 70, "made_up": 1}})
    assert r.status_code == 422
    r = client.post("/api/state/james/patch", json={"private_field": True})
    assert r.status_code == 422
    r = client.post("/api/state/james/patch", json={"action": {"type": "launch_rocket"}})
    assert r.status_code == 422
    assert client.post("/api/state/james/patch", json={"vitals": {"heart_rate": 70}}).status_code == 200


def test_low_cabin_oxygen_flags_cabin_regardless(store):
    store.patch("james", {
        "manual": {"symptoms": ["headache"]},
        "state": {"stress": 0.9, "fatigue": 0.9},
        "vitals": {"heart_rate": 140, "spo2": 85},
        "radiation": {"storm_level": 4, "sheltered": False},
        "cabin": {"oxygen_pct": 18.0},
    })
    s = store.get("james")
    assert s["cabin"]["alert"] is True
    assert s["action"]["type"] == "flag_cabin"
    assert "ground" in s["action"]["detail"].lower()


def test_medicine_only_returns_stocked_items():
    kit = load_kit()
    ids = {i["id"] for i in kit["items"]}
    m = suggest("headache", kit)
    assert m["matched"] and m["item"]["id"] in ids
    assert "consult mission medical protocol before use" in m["text"].lower()
    n = suggest("xyzzy", kit)
    assert not n["matched"] and n["item"] is None
    assert n["text"] == kit["no_match"]
    # every mapping points at a stocked item
    assert set(kit["symptom_map"].values()) <= ids


def _decide(state):
    absolute = evaluate_absolute(state, TH)
    d = compute_drift(state, TH, {})
    return decide(state, absolute, d, load_kit())


def test_five_states_give_five_interventions(store):
    base = store.get("james")
    hr = base["baseline"]["heart_rate"]

    def variant(**patch):
        from brain.contract import deep_merge
        return deep_merge(base, patch)

    states = [
        variant(vitals={"heart_rate": round(hr * 1.3)}, state={"stress": 0.7}),          # stressed
        variant(state={"fatigue": 0.8}),                                                    # tired
        variant(manual={"mood": 1}),                                                        # low mood
        variant(manual={"sleep_hours": 4.5}),                                               # poor sleep
        variant(state={"emotion": "bored"}),                                                # bored
    ]
    out = [_decide(s) for s in states]
    interventions = [a["intervention"] for a in out]
    assert len(set(interventions)) == 5, interventions
    assert set(interventions) == {"breathing", "earth_window", "connection", "music", "aurora_run"}


def test_chat_without_key_uses_rules_and_cites_heart_rate(client):
    client.post("/api/state/james/patch", json={"vitals": {"heart_rate": 83}})
    r = client.post("/api/chat", json={"crew_id": "james", "transcript": "how am I doing"})
    assert r.status_code == 200
    body = r.json()
    assert body["source"] == "rules"
    assert "83" in body["reply"]
    assert isinstance(body["commands"], list)


def test_chat_invalid_llm_json_returns_text_and_no_commands(client, monkeypatch):
    monkeypatch.setenv("LLM_API_KEY", "test-key")
    monkeypatch.setattr(llm, "call_llm", lambda state, transcript, **kw: "You are doing fine today.")
    r = client.post("/api/chat", json={"crew_id": "james", "transcript": "how am I doing"}).json()
    assert r["source"] == "llm"
    assert r["reply"] == "You are doing fine today."
    assert r["commands"] == []


def test_chat_llm_number_not_in_state_falls_back(client, monkeypatch):
    monkeypatch.setenv("LLM_API_KEY", "test-key")
    monkeypatch.setattr(llm, "call_llm", lambda s, t, **kw: json.dumps({"reply": "Your heart rate is 187.", "commands": []}))
    r = client.post("/api/chat", json={"crew_id": "james", "transcript": "how am I doing"}).json()
    assert r["source"] == "rules"


def test_chat_llm_commands_validated(client, monkeypatch):
    monkeypatch.setenv("LLM_API_KEY", "test-key")
    content = json.dumps({"reply": "Let me show you.", "commands": [
        {"cmd": "point_to", "zone": "eyes"}, {"cmd": "self_destruct"}, {"cmd": "point_to", "zone": "spleen"},
        {"cmd": "open_screen", "name": "radiation"}, {"cmd": "start_scan"}, {"cmd": "close"}]})
    monkeypatch.setattr(llm, "call_llm", lambda s, t, **kw: content)
    r = client.post("/api/chat", json={"crew_id": "james", "transcript": "show me"}).json()
    assert r["commands"] == [{"cmd": "point_to", "zone": "eyes"}, {"cmd": "open_screen", "name": "radiation"},
                             {"cmd": "start_scan"}]


def test_validator_drops_unknown_command_and_zone():
    out = llm.validate_commands([{"cmd": "dance"}, {"cmd": "point_to", "zone": "tail"},
                                 {"cmd": "point_to", "zone": "heart"}, {"cmd": "show_chart", "metric": "heart_rate"}])
    assert out == [{"cmd": "point_to", "zone": "heart"}, {"cmd": "show_chart", "metric": "heart_rate"}]


@pytest.mark.skipif(not os.environ.get("LLM_API_KEY") and not (ROOT / ".env").exists(),
                    reason="no LLM key configured (.env missing); key-dependent test skipped")
def test_with_key_reply_contains_a_state_number():
    from dotenv import dotenv_values
    key = os.environ.get("LLM_API_KEY") or dotenv_values(ROOT / ".env").get("LLM_API_KEY", "")
    if not key:
        pytest.skip("LLM_API_KEY empty")
    os.environ["LLM_API_KEY"] = key
    from brain.store import Store
    st = Store(persist=False, fresh=True)
    r = llm.chat(st.get("james"), "How am I doing?")
    assert r["source"] == "llm", r
    import re
    nums = re.findall(r"\d+", r["reply"])
    assert nums and llm.numbers_ok(r["reply"], st.get("james"))


def test_every_threshold_has_source_and_kind():
    kinds = {"nasa", "clinical_reference", "demo_placeholder"}
    for metric, spec in TH["absolute"].items():
        for lvl in spec["levels"]:
            assert lvl["kind"] in kinds and "source" in lvl and "title" in lvl["source"], metric
    for metric, spec in TH["drift"].items():
        if metric.startswith("_"):
            continue
        assert spec["kind"] in kinds and "source" in spec, metric
    rad = TH["radiation"]
    for key in ("career_limit_msv", "spe_event_limit_msv", "storm_scale", "flag_storm_level", "shelter_reduction", "storm_extra_msv_hour"):
        assert rad[key]["kind"] in kinds and "source" in rad[key], key
    for p, r in rad["dose_rates_msv_day"].items():
        assert r["kind"] in kinds and r["source"]["url"], p
    for group in ("speaker_id", "rppg"):
        for k, v in TH[group].items():
            assert v["kind"] in kinds and "source" in v


def test_mock_data_satisfies_contract():
    from brain.contract import validate_full
    data = json.loads((ROOT / "shared" / "mock_data.json").read_text())
    assert len(data["crew"]) == 6
    for c in data["crew"]:
        validate_full(c)
