"""v2 brain and voice: general vs health questions, memory, streaming, normalisation, new commands,
/api/tts (Kokoro, cached) and /api/stt (Kokoro speech transcribed by local Whisper). No ElevenLabs
credit is spent here: TTS tests force the Kokoro engine."""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from brain import llm

ROOT = Path(__file__).resolve().parent.parent
KOKORO = (ROOT / "models" / "tts" / "kokoro-v1.0.onnx").exists()
WHISPER = (ROOT / "models" / "whisper" / "base.en" / "model.bin").exists()


@pytest.fixture(autouse=True)
def _clean_memory():
    llm.forget()
    yield
    llm.forget()


def _state():
    from brain.store import Store
    return Store(persist=False, fresh=True).get("james")


def test_health_and_general_questions_are_told_apart():
    for q in ["how am I doing", "how is my heart", "I feel tired", "what is my radiation dose", "how is the cabin air"]:
        assert llm.is_health_question(q), q
    for q in ["how far is Mars", "tell me a joke", "what is the capital of Ghana", "explain how a rocket works"]:
        assert not llm.is_health_question(q), q


def test_general_answer_may_cite_numbers_not_in_state(monkeypatch):
    monkeypatch.setenv("LLM_API_KEY", "test-key")
    monkeypatch.setattr(llm, "call_llm", lambda s, t, **kw: "Mars is about 225 million kilometres from Earth on average. Light takes about 12.5 minutes to cross that.")
    r = llm.chat(_state(), "how far is Mars")
    assert r["source"] == "llm" and r["kind"] == "general" and "225" in r["reply"]


def test_health_answer_with_invented_number_falls_back_to_rules(monkeypatch):
    monkeypatch.setenv("LLM_API_KEY", "test-key")
    monkeypatch.setattr(llm, "call_llm", lambda s, t, **kw: "Your heart rate is 187, which is high.")
    r = llm.chat(_state(), "how is my heart")
    assert r["source"] == "rules"


def test_offline_general_question_says_it_needs_a_connection(monkeypatch):
    monkeypatch.setenv("LLM_API_KEY", "")
    r = llm.chat(_state(), "what is the capital of Ghana")
    assert r["source"] == "rules" and "connection" in r["reply"].lower()
    assert "accra" not in r["reply"].lower()


def test_memory_keeps_last_eight_turns_and_is_sent(monkeypatch):
    monkeypatch.setenv("LLM_API_KEY", "test-key")
    seen = {}

    def fake(state, transcript, history=None, **kw):
        seen["history"] = history
        return f"Answer to {transcript}."
    monkeypatch.setattr(llm, "call_llm", fake)
    st = _state()
    for i in range(10):
        llm.chat(st, f"question {i}", crew_id="james")
    h = llm.history_for("james")
    assert len(h) == 16 and h[0]["content"] == "question 2" and h[-1]["content"] == "Answer to question 9."
    llm.chat(st, "and why?", crew_id="james")
    assert seen["history"][-2]["content"] == "question 9"
    assert llm.history_for("amara") == []


def test_commands_line_is_parsed_and_never_spoken():
    reply, cmds = llm.parse_llm_content('Let me show you your heart.\nCOMMANDS: [{"cmd":"point_to","zone":"heart"},{"cmd":"dance"}]')
    assert reply == "Let me show you your heart." and cmds == [{"cmd": "point_to", "zone": "heart"}]


def test_validator_accepts_v2_commands():
    out = llm.validate_commands([{"cmd": "check_zone", "zones": ["eyes", "head", "tail"]}, {"cmd": "rotate_body", "view": "back"},
                                 {"cmd": "isolate", "part": "spine"}])
    assert out == [{"cmd": "check_zone", "zones": ["eyes", "head"]}, {"cmd": "rotate_body", "view": "back"}, {"cmd": "isolate", "part": "spine"}]
    assert llm.validate_commands([{"cmd": "xray", "style": "neon"}, {"cmd": "zoom_body", "zone": "reset"}, {"cmd": "isolate", "part": "tail"}]) == \
        [{"cmd": "xray", "on": True}, {"cmd": "zoom_body", "zone": "reset"}]


def test_unicode_is_normalised_for_speech():
    assert llm.normalize("9 km and non‑breaking") == "9 km and non-breaking"


def test_stream_yields_sentences_then_final(monkeypatch):
    def fake_stream(state, transcript, history=None):
        yield from ["Mars is the fourth ", "planet. It is red because of iron oxide", " dust. Want to know more?\nCOMMANDS: ", '[{"cmd":"open_screen","name":"mission"}]']
    evs = list(llm.chat_stream(_state(), "tell me about Mars", crew_id="james", stream=fake_stream))
    sents = [e["text"] for e in evs if e["type"] == "sentence"]
    assert sents == ["Mars is the fourth planet.", "It is red because of iron oxide dust.", "Want to know more?"]
    final = evs[-1]
    assert final["type"] == "final" and final["source"] == "llm" and final["commands"] == [{"cmd": "open_screen", "name": "mission"}]
    assert llm.history_for("james")[-1]["content"].startswith("Mars is the fourth planet.")


def test_stream_health_bad_number_falls_back_before_speaking(monkeypatch):
    def fake_stream(state, transcript, history=None):
        yield "Your heart rate is 187 right now. "
        yield "That is fine."
    evs = list(llm.chat_stream(_state(), "how is my heart", crew_id="james", stream=fake_stream))
    assert all(e["source"] == "rules" for e in evs)


def test_stream_endpoint_without_key_returns_rules_ndjson(client):
    r = client.post("/api/chat/stream", json={"crew_id": "james", "transcript": "how am I doing"})
    lines = [json.loads(x) for x in r.text.strip().splitlines()]
    assert lines[-1]["type"] == "final" and lines[-1]["source"] == "rules"
    assert any(x["type"] == "sentence" for x in lines)


@pytest.mark.skipif(not KOKORO, reason="Kokoro model not present")
def test_tts_returns_audio_and_caches(client):
    body = {"text": "Sentinel test line, cached.", "engine": "kokoro", "voice": "af_heart"}
    r1 = client.post("/api/tts", json=body)
    assert r1.status_code == 200 and r1.headers["content-type"].startswith("audio/") and len(r1.content) > 4000
    assert r1.headers["x-tts-source"] == "kokoro"
    r2 = client.post("/api/tts", json=body)
    assert r2.headers["x-tts-cached"] == "true" and r2.content == r1.content
    assert client.post("/api/tts", json={"text": "  "}).status_code == 400


@pytest.mark.skipif(not (KOKORO and WHISPER), reason="Kokoro or local Whisper model not present")
def test_stt_local_whisper_transcribes_kokoro_speech(client):
    import io
    import wave

    import numpy as np
    from brain import speech
    wav = speech.tts_kokoro("Hey Sentinel, check my heart and my lungs.", "af_heart")
    with wave.open(io.BytesIO(wav)) as w:
        rate, pcm = w.getframerate(), np.frombuffer(w.readframes(w.getnframes()), dtype="<i2").astype("float32")
    n = int(len(pcm) * 16000 / rate)
    pcm16 = np.interp(np.linspace(0, len(pcm) - 1, n), np.arange(len(pcm)), pcm).astype("<i2")
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(16000); w.writeframes(pcm16.tobytes())
    r = client.post("/api/stt?prefer=local", content=buf.getvalue(), headers={"Content-Type": "audio/wav"}).json()
    assert r["source"] == "local"
    t = r["text"].lower()
    assert "heart" in t and "lung" in t and "sentinel" in t.replace("centinel", "sentinel")
