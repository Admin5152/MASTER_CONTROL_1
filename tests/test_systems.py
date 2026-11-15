"""Acceptance tests for Systems (spec 6.5) and Scenarios (6.7)."""
import time
from pathlib import Path

import pytest

from systems import speaker

ROOT = Path(__file__).resolve().parent.parent
FIX = ROOT / "tests" / "fixtures"


def test_cabin_oxygen_drop_sets_alert_and_flag_cabin(client):
    r = client.post("/api/cabin", json={"oxygen_pct": 18.2})
    assert r.status_code == 200
    s = client.get("/api/state/james").json()
    assert s["cabin"]["alert"] is True
    assert s["action"]["type"] == "flag_cabin"
    # every crew member sees it: the cabin is shared
    s2 = client.get("/api/state/amara").json()
    assert s2["action"]["type"] == "flag_cabin"
    client.post("/api/cabin", json={"acknowledge": True})
    s = client.get("/api/state/james").json()
    assert s["cabin"]["alert"] is False


def test_cabin_rejects_bad_values(client):
    assert client.post("/api/cabin", json={"oxygen_pct": "low"}).status_code == 422
    assert client.post("/api/cabin", json={"oxygen_pct": 140}).status_code == 422


def test_slow_reaction_raises_head_drift(store):
    s = store.patch("james", {"cognitive": {"baseline_ms": 300, "reaction_ms": 390}})
    items = [i for i in s["drift"]["items"] if i["metric"] == "cognitive.reaction_ms"]
    assert items and items[0]["zone"] == "head"
    assert items[0]["delta_pct"] == pytest.approx(30.0)
    assert "reaction time 30% slower" in s["drift"]["note"].lower()


def test_first_three_runs_set_reaction_baseline():
    from brain.core.store import Store
    st = Store(persist=False, fresh=True)
    st.internal["james"]["reaction_runs"] = 0  # a new crew member with no baseline yet
    for ms in (300, 340, 320):
        st.patch("james", {"cognitive": {"reaction_ms": ms}})
    assert st.get("james")["cognitive"]["baseline_ms"] == 320
    s = st.patch("james", {"cognitive": {"reaction_ms": 420}})
    assert st.get("james")["cognitive"]["baseline_ms"] == 320
    assert any(i["metric"] == "cognitive.reaction_ms" for i in s["drift"]["items"])


@pytest.mark.skipif(not speaker.available(), reason="Resemblyzer not installed")
@pytest.mark.skipif(not (FIX / "voice_a_1.wav").exists(), reason="voice fixtures missing")
def test_speaker_identify_two_voices_and_noise(tmp_path, monkeypatch):
    import io
    import wave

    import numpy as np

    monkeypatch.setattr(speaker, "VOICEPRINTS", tmp_path)
    speaker.enrol("voice_a", (FIX / "voice_a_1.wav").read_bytes())
    speaker.enrol("voice_b", (FIX / "voice_b_1.wav").read_bytes())
    ra = speaker.identify((FIX / "voice_a_2.wav").read_bytes())
    rb = speaker.identify((FIX / "voice_b_2.wav").read_bytes())
    assert ra["crew_id"] == "voice_a", ra
    assert rb["crew_id"] == "voice_b", rb
    rng = np.random.default_rng(0)
    noise = (rng.normal(0, 0.2, 16000 * 4) * 32767).clip(-32768, 32767).astype("<i2")
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(16000)
        w.writeframes(noise.tobytes())
    rn = speaker.identify(buf.getvalue())
    assert rn["crew_id"] is None, rn


def test_full_demo_passes_through_expected_actions(client):
    r = client.post("/api/scenario/full_demo?speed=25")
    assert r.status_code == 200
    deadline = time.time() + 30
    while time.time() < deadline:
        st = client.get("/api/scenario").json()
        if not st["running"]:
            break
        time.sleep(0.2)
    assert not st["running"], "full_demo did not finish"
    types = [a["type"] for a in st["action_log"]]
    # collapse repeats
    seq = [t for i, t in enumerate(types) if i == 0 or types[i - 1] != t]
    assert seq[0] == "none"
    i_calm = seq.index("offer_orb_calm")
    i_cabin = seq.index("flag_cabin")
    assert i_calm < i_cabin
    assert seq[-1] != "flag_cabin"  # oxygen recovered
    assert st["step"] == "done"


def test_unknown_scenario_404(client):
    assert client.post("/api/scenario/xyzzy").status_code == 404


def test_health_reports_subsystems(client):
    h = client.get("/api/health").json()
    assert set(h) >= {"llm", "speaker_id", "spaceweather", "tablet_url"}
    assert h["llm"] is False
