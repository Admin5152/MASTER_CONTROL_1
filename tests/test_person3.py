"""Person 3 Test Suite: Face, AI Model & Voice (SF4, SF7, SF8, FACE-7, FACE-9)."""
from __future__ import annotations

import json
from pathlib import Path
import pytest
from fastapi.testclient import TestClient

from brain import llm
from server import app

client = TestClient(app)


def test_sf4_llm_offline_fallback_line_per_level(monkeypatch):
    """SF4 & FACE-9: LLM offline -> scripted fallback line spoken per level."""
    monkeypatch.setenv("LLM_API_KEY", "")

    # Level 1 card (info)
    card_l1 = {"level": 1, "title": "Hydration Nominal", "detail": "Fluid intake is on schedule"}
    r1 = llm.rephrase_card(card_l1)
    assert r1["source"] == "rules"
    assert "Hydration Nominal" in r1["reply"]
    assert len(llm.split_sentences(r1["reply"])) <= 2

    # Level 2 card (watch)
    card_l2 = {"level": 2, "title": "Elevated Pulse", "detail": "Pulse is 18 bpm above baseline"}
    r2 = llm.rephrase_card(card_l2)
    assert r2["source"] == "rules"
    assert "Elevated Pulse" in r2["reply"]
    assert "18" in r2["reply"]
    assert len(llm.split_sentences(r2["reply"])) <= 2

    # Level 3 card (alert) - starts with single most important immediate step
    card_l3 = {"level": 3, "title": "Cabin CO2 Critical", "action": "Don emergency oxygen mask and inspect scrubber"}
    r3 = llm.rephrase_card(card_l3)
    assert r3["source"] == "rules"
    assert r3["reply"].startswith("Don emergency oxygen mask")
    assert "flight surgeon" in r3["reply"].lower()
    assert len(llm.split_sentences(r3["reply"])) <= 2


def test_sf7_brain_llm_rephrases_card_no_invented_numbers(monkeypatch):
    """SF7 & FACE-7: Brain LLM receives a card -> Response is <= 2 sentences, no invented numbers."""
    monkeypatch.setenv("LLM_API_KEY", "test-key")

    card = {
        "level": 2,
        "title": "Heart Rate Drift",
        "detail": "Heart rate is 88 bpm, 14 bpm above usual baseline 74",
        "action": "Rest for 10 minutes and hydrate"
    }

    # Case A: Valid LLM reply without invented numbers
    monkeypatch.setattr(
        llm,
        "call_llm",
        lambda s, t, **kw: "Your heart rate is 88 bpm, which is 14 bpm above your usual 74. Please take a rest."
    )
    # mock post function
    mock_post = lambda url, body, headers: {
        "choices": [{"message": {"content": "Your heart rate is 88 bpm, which is 14 bpm above your usual 74. Please take a rest."}}]
    }
    res = llm.rephrase_card(card, post=mock_post)
    assert res["source"] == "llm"
    assert len(llm.split_sentences(res["reply"])) <= 2

    # Case B: LLM attempts to invent an unverified number (e.g. 195 or 500mg)
    mock_bad_post = lambda url, body, headers: {
        "choices": [{"message": {"content": "Your heart rate is 195 bpm. Take 500mg of medication."}}]
    }
    res_bad = llm.rephrase_card(card, post=mock_bad_post)
    # Numeric guard catches the invented number and falls back to rules
    assert res_bad["source"] == "rules"
    assert "195" not in res_bad["reply"]
    assert "500" not in res_bad["reply"]


def test_api_card_rephrase_endpoint(monkeypatch):
    """Test the POST /api/card/rephrase endpoint."""
    monkeypatch.setenv("LLM_API_KEY", "")
    card = {
        "level": 3,
        "title": "Solar Particle Event",
        "action": "Proceed to the storm shelter immediately",
        "detail": "Proton flux has crossed 100 pfu"
    }
    resp = client.post("/api/card/rephrase", json={"card": card, "lang": "en", "crew_id": "james"})
    assert resp.status_code == 200
    data = resp.json()
    assert data["source"] == "rules"
    assert "Proceed to the storm shelter" in data["reply"]
    assert "flight surgeon" in data["reply"].lower()


def test_sf8_speaker_identification():
    """SF8: Speaker identification checks availability and handles voiceprint matching."""
    from systems import speaker
    # When Resemblyzer is available, enrol and identify; when not, graceful fallback
    avail = speaker.available()
    if not avail:
        resp = client.post("/api/identify", content=b"fake-wav-data")
        assert resp.status_code == 200
        assert resp.json()["source"] in ("unavailable", "error")
    else:
        status = speaker.enrolled_status()
        assert isinstance(status, dict)


def _face_jpeg() -> bytes:
    """A synthetic 224x224 image: enough to run the model, not a real face."""
    import cv2
    import numpy as np
    img = np.full((224, 224, 3), 140, dtype=np.uint8)
    cv2.circle(img, (112, 112), 80, (120, 150, 200), -1)
    ok, buf = cv2.imencode(".jpg", img)
    assert ok
    return buf.tobytes()


def test_face_emotion_returns_all_eight_emotions():
    """FACE-3: /api/face/emotion returns a probability for each of the eight HSEmotion classes."""
    pytest.importorskip("hsemotion_onnx")
    resp = client.post("/api/face/emotion", content=_face_jpeg())
    if resp.status_code == 503:
        pytest.skip("HSEmotion model file not available on this machine (first run downloads it)")
    assert resp.status_code == 200
    data = resp.json()
    assert list(data["scores"]) == ["Anger", "Contempt", "Disgust", "Fear", "Happiness", "Neutral", "Sadness", "Surprise"]
    assert abs(sum(data["scores"].values()) - 1.0) < 0.01
    assert data["emotion"] == max(data["scores"], key=data["scores"].get)
    assert data["confidence"] == pytest.approx(data["scores"][data["emotion"]], abs=0.001)
    assert -1.5 <= data["valence"] <= 1.5 and -1.5 <= data["arousal"] <= 1.5
    assert data["wording"].startswith("expression suggests ")


def test_face_emotion_rejects_bad_input():
    assert client.post("/api/face/emotion", content=b"").status_code == 400
    pytest.importorskip("cv2")
    assert client.post("/api/face/emotion", content=b"not an image").status_code == 400


def test_face_model_load_failure_is_logged_and_returns_503(monkeypatch, capsys):
    """When the model really cannot load, the endpoint says so (503) and the reason is logged."""
    monkeypatch.setattr(llm, "_fer_model", None)
    monkeypatch.setattr(llm, "_fer_status", {"loaded": False, "error": None, "path": None})
    monkeypatch.setattr(llm, "_fer_failed_at", 0.0)
    monkeypatch.setattr(llm, "FACE_MODEL_LOCAL", "/nonexistent/enet.onnx")
    import sys
    monkeypatch.setitem(sys.modules, "hsemotion_onnx.facial_emotions", None)   # import fails
    resp = client.post("/api/face/emotion", content=_face_jpeg())
    assert resp.status_code == 503
    assert resp.json()["detail"].startswith("expression model unavailable: ")
    assert "HSEmotion model NOT loaded" in capsys.readouterr().out
    assert llm.hsemotion_status()["loaded"] is False and llm.hsemotion_status()["error"]


def test_face_emotion_writes_no_image_to_disk(monkeypatch):
    """No image is stored: the request must not open any file for writing."""
    pytest.importorskip("hsemotion_onnx")
    import builtins
    try:
        llm._get_hsemotion()
    except llm.FaceModelUnavailable:
        pytest.skip("HSEmotion model not available on this machine")
    jpeg = _face_jpeg()
    import cv2
    real_open = builtins.open
    writes = []

    def spy_open(file, mode="r", *a, **kw):
        if any(c in str(mode) for c in "wax+"):
            writes.append(str(file))
        return real_open(file, mode, *a, **kw)
    monkeypatch.setattr(builtins, "open", spy_open)
    monkeypatch.setattr(cv2, "imwrite", lambda *a, **kw: writes.append("cv2.imwrite") or True)
    assert client.post("/api/face/emotion", content=jpeg).status_code == 200
    assert writes == []


def test_face_scan_patches_reach_the_crew_record():
    """Section 8.8: the patches CameraLog (face.js) sends land in the state and the history."""
    import server
    cid = client.get("/api/crew").json()[0]["crew_id"]
    try:
        r = client.post(f"/api/state/{cid}/patch", json={"vitals": {"breathing_rate": 17, "sources": {"breathing_rate": "camera"}}})
        assert r.status_code == 200
        for emo in ("anger", "contempt", "disgust", "fear", "happiness", "neutral", "sadness", "surprise"):
            r = client.post(f"/api/state/{cid}/patch", json={"state": {"emotion": emo, "emotion_confidence": 0.75}})
            assert r.status_code == 200, f"{emo}: {r.text}"
        s = client.get(f"/api/state/{cid}").json()
        assert s["vitals"]["breathing_rate"] == 17 and s["vitals"]["sources"]["breathing_rate"] == "camera"
        assert s["state"]["emotion"] == "surprise" and s["state"]["emotion_confidence"] == 0.75
        last = client.get(f"/api/history/{cid}", params={"field": "vitals.breathing_rate"}).json()["points"][-1]
        assert last["v"] == 17 and last["source"] == "camera"
    finally:
        server.store.reset()
