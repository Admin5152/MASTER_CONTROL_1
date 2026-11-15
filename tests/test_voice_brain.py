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


FIXTURE = ROOT / "tests" / "fixtures" / "kokoro_check_heart_lungs_16k.wav"


@pytest.mark.skipif(not WHISPER or not FIXTURE.exists(), reason="local Whisper model or the Kokoro fixture is missing")
def test_stt_local_whisper_transcribes_kokoro_speech(client):
    """The fixture is Kokoro (af_heart) saying "Hey Sentinel, check my heart and my lungs.", resampled to 16 kHz."""
    r = client.post("/api/stt?prefer=local", content=FIXTURE.read_bytes(), headers={"Content-Type": "audio/wav"})
    if r.status_code == 503:
        # find out why: on a laptop short of commit memory the Whisper worker cannot allocate next to torch
        import os
        import subprocess
        import sys
        p = subprocess.run([sys.executable, "-m", "brain.whisper_worker"], input=FIXTURE.read_bytes(), capture_output=True,
                           cwd=str(ROOT), env=dict(os.environ, OPENBLAS_NUM_THREADS="1"))
        if b"failed to allocate memory" in p.stderr:
            pytest.skip("not enough free memory on this machine for local Whisper next to the server's torch stack")
    assert r.status_code == 200, r.text
    r = r.json()
    assert r["source"] == "local"
    t = r["text"].lower()
    assert "heart" in t and "lung" in t and "sentinel" in t.replace("centinel", "sentinel")


# runs after the STT test: on a laptop short of commit memory, Kokoro loaded in this process
# can leave too little for the separate Whisper worker
@pytest.mark.skipif(not KOKORO, reason="Kokoro model not present")
def test_tts_returns_audio_and_caches(client):
    body = {"text": "Sentinel test line, cached.", "engine": "kokoro", "voice": "af_heart"}
    r1 = client.post("/api/tts", json=body)
    assert r1.status_code == 200 and r1.headers["content-type"].startswith("audio/") and len(r1.content) > 4000
    assert r1.headers["x-tts-source"] == "kokoro"
    r2 = client.post("/api/tts", json=body)
    assert r2.headers["x-tts-cached"] == "true" and r2.content == r1.content
    assert client.post("/api/tts", json={"text": "  "}).status_code == 400


def test_prompt_forbids_invented_time_dependent_facts(monkeypatch):
    """Asked "how far is Mars", the model once said "currently about 80 million km, closest in two weeks": invented.
    The prompt must tell it to give averages and ranges and say it has no live data."""
    p = llm.SYSTEM_PROMPT.lower()
    assert "no live data" in p and "average and the range" in p and "unless the value is in" in p
    monkeypatch.setenv("LLM_API_KEY", "test-key")
    seen = {}

    def fake(state, transcript, history=None, **kw):
        seen["msgs"] = llm.build_messages(state, transcript, history)
        return "Mars averages about 225 million kilometres from Earth, between roughly 55 and 400 million. I don't have live data on where it is today."
    monkeypatch.setattr(llm, "call_llm", fake)
    r = llm.chat(_state(), "how far is Mars right now")
    assert r["source"] == "llm" and "live data" in r["reply"]
    assert "no live data" in seen["msgs"][0]["content"].lower()


def test_a_promised_action_without_a_command_line_still_happens():
    """The smaller fallback models say "Opening settings." and forget the COMMANDS line: the action is inferred."""
    from brain import llm
    assert llm.infer_commands("go to settings", "Opening settings.") == [{"cmd": "open_screen", "name": "settings"}]
    assert llm.infer_commands("start a breathing exercise", "Starting a guided breathing exercise.") == [{"cmd": "open_screen", "name": "orb_calm"}]
    assert llm.infer_commands("show me my heart", "Your heart rate is 51. Opening your vitals.") == [{"cmd": "point_to", "zone": "heart"}]
    assert llm.infer_commands("switch to light mode", "Switching to light mode.") == [{"cmd": "set_theme", "theme": "light"}]
    assert llm.infer_commands("why is the sky on mars red", "Dust scatters the light.") == []
    assert llm.infer_commands("how is my heart", "Your heart rate is 51, a little under your usual.") == []
    assert llm.validate_commands(llm.infer_commands("open the mars farm", "Opening the farm.")) == [{"cmd": "open_screen", "name": "greenhouse"}]


def test_health_questions_carry_the_matching_nasa_mrids():
    """A body question brings its NASA documents into the prompt; small talk brings none; MRID ids pass the number guard."""
    from brain import llm, mrid
    assert "MEDB 1.10" in [d["id"] for d in mrid.relevant("what happens to your eyes in space")]
    assert "MEDB 1.8" in [d["id"] for d in mrid.relevant("my ears are ringing")]
    assert "MR084L" not in [d["id"] for d in mrid.relevant("how is my heart")]      # "heart" is not "hear"
    assert mrid.relevant("tell me a joke") == []
    msgs = llm.build_messages({"crew_id": "x"}, "how are my bones")
    assert "NASA MRID EVIDENCE" in msgs[-1]["content"] and "MEDB 1.11" in msgs[-1]["content"]
    assert "NASA MRID EVIDENCE" not in llm.build_messages({"crew_id": "x"}, "tell me a joke")[-1]["content"]
    ev = llm.evidence_for("how are my bones")
    assert llm.numbers_ok("NASA scans bone density before and after flight, MEDB 1.11.", {}, "how are my bones " + ev)


def test_elevenlabs_meter_starts_fresh_for_a_new_key(tmp_path, monkeypatch):
    from brain import speech
    monkeypatch.setattr(speech, "USAGE", tmp_path / "tts_usage.json")
    monkeypatch.setattr(speech, "DATA", tmp_path)
    monkeypatch.setenv("ELEVENLABS_API_KEY", "old-key")
    speech._add_usage(25000)
    assert speech.usage()["eleven_chars"] == 25000
    monkeypatch.setenv("ELEVENLABS_API_KEY", "new-key")        # a new key with its own credits
    assert speech.usage()["eleven_chars"] == 0
    speech._add_usage(120)
    assert speech.usage()["eleven_chars"] == 120
    assert "new-key" not in (tmp_path / "tts_usage.json").read_text()   # only a fingerprint is stored


def test_eliah_is_spoken_elia_but_written_eliah():
    from brain.speech import say_as
    assert say_as("Hello Eliah, I'm Sentinel.") == "Hello Elia, I'm Sentinel."
    assert say_as("Ask Eliahs crew") == "Ask Eliahs crew"     # only the whole name
