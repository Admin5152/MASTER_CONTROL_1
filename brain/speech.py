"""Speech in and out (brief sections 4.1, 4.2 and 9.5).

STT: Groq Whisper (`whisper-large-v3-turbo`) when a key is set and the network answers; otherwise
local faster-whisper (`models/whisper/base.en`, int8, CPU). Returns {"text", "source": "groq"|"local"}.

TTS: ElevenLabs (`eleven_flash_v2_5`, default voice River) -> Kokoro (`af_heart`, local) -> the browser
(the caller falls back to speechSynthesis when both fail). Every synthesis is cached on disk by
(engine, voice, text), so the demo lines and repeated replies cost nothing after the first time.
ElevenLabs characters are counted in data/tts_usage.json and capped (ELEVENLABS_CHAR_BUDGET, default
9000) so the plan's remaining credit is never exhausted by accident; past the cap Kokoro speaks.
Keys are read from the environment and never logged.
"""
from __future__ import annotations

import hashlib
import io
import json
import os
import re
import threading
import time
import wave
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parent.parent
MODELS = ROOT / "models"
DATA = ROOT / "data"
CACHE = DATA / "tts_cache"
USAGE = DATA / "tts_usage.json"

# Sentinel's four voices, chosen by the team from the ElevenLabs voice library: two male, two female.
# Nathaniel (a calm, crisp British assistant) is the default. Never the account's personal or cloned voices, and never a
# voice that imitates a real person.
ELEVEN_VOICES = {
    "nathaniel": ("wiF43F1vngB3iRFsbWhJ", "Nathaniel (British assistant)", "male"),
    "jon": ("JYUzXNeyCPmymMkfcicu", "Jon (warm, American)", "male"),
    "bri": ("pzXYLespwi48YnRBYxIW", "Bri (calm, warm)", "female"),
    "samara": ("19STyYD15bswVz51nqLf", "Samara (British)", "female"),
}
KOKORO_VOICES = {"af_heart": "Heart (Kokoro)", "af_nova": "Nova (Kokoro)", "am_michael": "Michael (Kokoro)", "bm_george": "George (Kokoro)"}
DEFAULT_VOICE = "nathaniel"
ELEVEN_MODEL = "eleven_flash_v2_5"
MAX_TTS_CHARS = 400


# how names are said aloud (the screen keeps the real spelling): "Eliah" is said "Elia"
PRONOUNCE = {"Eliah": "Elia"}


def say_as(text: str) -> str:
    """The text as it should be spoken: crew names respelled the way they are pronounced."""
    for name, spoken in PRONOUNCE.items():
        text = re.sub(r"\b" + re.escape(name) + r"\b", spoken, text, flags=re.IGNORECASE)
    return text


def _norm_text(text: str) -> str:
    from brain.llm import normalize  # local import: llm imports nothing from here
    t = say_as(normalize(text or ""))
    t = re.sub(r"\s+", " ", t).strip()
    return t[:MAX_TTS_CHARS]


# ---------------- STT ----------------

_whisper = None
_whisper_lock = threading.Lock()


def _local_whisper():
    global _whisper
    with _whisper_lock:
        if _whisper is None:
            from faster_whisper import WhisperModel
            path = MODELS / "whisper" / "base.en"
            args = dict(device="cpu", compute_type="int8", cpu_threads=2, download_root=str(MODELS / "whisper"))
            try:
                _whisper = WhisperModel(str(path) if path.exists() else "base.en", **args)
            except RuntimeError:
                # low memory (seen on a laptop with many apps open): free Kokoro, which reloads on its next use
                global _kokoro
                with _kokoro_lock:
                    _kokoro = None
                import gc
                gc.collect()
                _whisper = WhisperModel(str(path) if path.exists() else "base.en", **args)
        return _whisper


def stt_local(wav: bytes, timeout: float = 45.0) -> str:
    """Local faster-whisper (base.en, int8, CPU), run in a separate process (see brain/whisper_worker.py)."""
    import subprocess
    import sys
    env = dict(os.environ, OPENBLAS_NUM_THREADS="1", OMP_NUM_THREADS="2")
    r = subprocess.run([sys.executable, "-m", "brain.whisper_worker"], input=wav, capture_output=True, timeout=timeout,
                       cwd=str(ROOT), env=env)
    if r.returncode != 0:
        raise RuntimeError("local whisper failed")
    return json.loads(r.stdout.decode("utf-8") or "{}").get("text", "").strip()


VOCABULARY_HINT = (
    "Hey Sentinel, Sentinel, I'm Eliah, Aleah, this is Annie, Seth, Sad, Stanley, Gadiel, "
    "Stillpoint, Slipstream, Red Harvest, grounding, "
    "radiation, vitals, vision, health log, trends, cognitive, orb calm, aurora run, "
    "race, greenhouse, hardware, sentinel skin, crew, wellbeing, cabin, mission, body, "
    "heart rate, pulse, breathing rate, spo2, blood pressure, glucose, temperature, sleep, mood, "
    "head, eyes, heart, lungs, chest, stomach, gut, bones, muscles, spine, skull, ribcage, pelvis, "
    "rotate, zoom, xray, isolate, scan, check, triage, headache, sore, hurts, tight, "
    "Mars, Moon, Earth, Jupiter, Saturn, ISS, space station, NASA, Artemis, Apollo, orbit, astronaut, spacewalk, EVA, "
    "spacesuit, microgravity, oxygen, carbon dioxide, solar storm, light delay, rocket, launch, wait, hold on, go on"
)


_http: httpx.Client | None = None


def _client() -> httpx.Client:
    """One pooled, kept-alive client for speech in and out: no new TLS handshake per utterance or sentence."""
    global _http
    if _http is None:
        _http = httpx.Client(timeout=8.0, limits=httpx.Limits(max_keepalive_connections=6, keepalive_expiry=120))
    return _http


def warm_speech() -> None:
    """Open the STT and TTS connections ahead of the first utterance."""
    for url in ("https://api.groq.com/openai/v1/models", "https://api.elevenlabs.io/v1/models"):
        try:
            _client().get(url, timeout=4.0)
        except Exception:
            pass


def stt_groq(wav: bytes, timeout: float = 8.0, post=None) -> str:
    key = os.getenv("LLM_API_KEY", "").strip() or os.getenv("GROQ_API_KEY", "").strip()
    if not key:
        raise RuntimeError("no key")
    base = os.getenv("LLM_BASE_URL", "").strip().rstrip("/") or "https://api.groq.com/openai/v1"
    if "groq.com" not in base:
        base = "https://api.groq.com/openai/v1"
    files = {"file": ("speech.wav", wav, "audio/wav")}
    data = {
        "model": "whisper-large-v3-turbo",
        "language": "en",
        "response_format": "json",
        "temperature": "0",
        "prompt": VOCABULARY_HINT
    }
    if post is not None:
        r = post(f"{base}/audio/transcriptions", files, data)
    else:
        r = _client().post(f"{base}/audio/transcriptions", files=files, data=data, headers={"Authorization": f"Bearer {key}"}, timeout=timeout)
    if r.status_code != 200:
        raise RuntimeError(f"http {r.status_code}")
    return (r.json().get("text") or "").strip()


def stt(wav: bytes, prefer: str = "auto") -> dict:
    """Transcribe a WAV utterance. Groq first (if a key is set), local Whisper on any failure."""
    from brain.llm import normalize
    if prefer != "local":
        try:
            return {"text": normalize(stt_groq(wav)), "source": "groq"}
        except Exception:
            pass
    return {"text": normalize(stt_local(wav)), "source": "local"}


def warm_stt() -> None:
    """Nothing to warm: local Whisper runs in its own process per utterance."""


# ---------------- TTS ----------------

_kokoro = None
_kokoro_lock = threading.Lock()
_usage_lock = threading.Lock()


def _kokoro_model():
    global _kokoro
    with _kokoro_lock:
        if _kokoro is None:
            from kokoro_onnx import Kokoro
            _kokoro = Kokoro(str(MODELS / "tts" / "kokoro-v1.0.onnx"), str(MODELS / "tts" / "voices-v1.0.bin"))
        return _kokoro


def warm_kokoro() -> None:
    """Load Kokoro once and synthesise one short sentence (run in a background thread at startup)."""
    try:
        tts_kokoro("Ready.", "af_heart")
    except Exception:
        pass


def _wav_bytes(samples, rate: int) -> bytes:
    import numpy as np
    pcm = (np.clip(np.asarray(samples, dtype="float32"), -1, 1) * 32767).astype("<i2").tobytes()
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(rate); w.writeframes(pcm)
    return buf.getvalue()


def tts_kokoro(text: str, voice: str = "af_heart") -> bytes:
    if voice not in KOKORO_VOICES:
        voice = "af_heart"
    lang = "en-gb" if voice.startswith("b") else "en-us"
    samples, rate = _kokoro_model().create(text, voice=voice, speed=1.0, lang=lang)
    return _wav_bytes(samples, rate)


def eleven_key() -> str:
    return os.getenv("ELEVENLABS_API_KEY", "").strip()


def eleven_budget() -> int:
    try:
        return int(os.getenv("ELEVENLABS_CHAR_BUDGET", "9000"))
    except ValueError:
        return 9000


def _key_fp() -> str:
    """A short fingerprint of the ElevenLabs key (never the key): the meter counts per key."""
    import hashlib
    return hashlib.sha256(eleven_key().encode()).hexdigest()[:12] if eleven_key() else ""


def usage() -> dict:
    """Characters sent to ElevenLabs with the current key. A new key starts its own count at zero."""
    try:
        u = json.loads(USAGE.read_text(encoding="utf-8"))
    except Exception:
        u = {}
    if u.get("key_fp") != _key_fp():
        return {"eleven_chars": 0, "requests": 0, "key_fp": _key_fp()}
    return u


def _add_usage(chars: int) -> None:
    with _usage_lock:
        u = usage()
        u["eleven_chars"] = u.get("eleven_chars", 0) + chars
        u["requests"] = u.get("requests", 0) + 1
        u["updated"] = time.strftime("%Y-%m-%dT%H:%M:%S")
        u["key_fp"] = _key_fp()
        DATA.mkdir(exist_ok=True)
        USAGE.write_text(json.dumps(u), encoding="utf-8")


def tts_eleven(text: str, voice: str = DEFAULT_VOICE, timeout: float = 8.0, post=None) -> bytes:
    key = eleven_key()
    if not key:
        raise RuntimeError("no key")
    if usage().get("eleven_chars", 0) + len(text) > eleven_budget():
        raise RuntimeError("character budget reached")
    vid = ELEVEN_VOICES.get(voice, ELEVEN_VOICES[DEFAULT_VOICE])[0]
    url = f"https://api.elevenlabs.io/v1/text-to-speech/{vid}?output_format=mp3_44100_64"
    body = {"text": text, "model_id": ELEVEN_MODEL, "voice_settings": {"stability": 0.5, "similarity_boost": 0.75}}
    if post is not None:
        r = post(url, body)
    else:
        r = _client().post(url, json=body, headers={"xi-api-key": key, "accept": "audio/mpeg"}, timeout=timeout)
    if r.status_code != 200:
        raise RuntimeError(f"http {r.status_code}")
    _add_usage(len(text))
    return r.content


def _cache_path(engine: str, voice: str, text: str, ext: str) -> Path:
    h = hashlib.sha1(f"{engine}|{voice}|{text}".encode("utf-8")).hexdigest()[:24]
    return CACHE / f"{engine}-{voice}-{h}.{ext}"


def tts(text: str, voice: str = DEFAULT_VOICE, engine: str = "auto") -> dict:
    """Return {"audio": bytes, "mime", "source": "elevenlabs"|"kokoro", "cached": bool}. Raises if both fail."""
    text = _norm_text(text)
    if not text:
        raise ValueError("empty text")
    CACHE.mkdir(parents=True, exist_ok=True)
    eleven_voice = voice if voice in ELEVEN_VOICES else DEFAULT_VOICE
    kokoro_voice = voice if voice in KOKORO_VOICES else "af_heart"
        # ElevenLabs is the voice. Kokoro runs only when asked for by name (SENTINEL_TTS=kokoro, or test runs that must
    # not spend ElevenLabs credit); it is not in the live chain. If ElevenLabs fails, the page uses browser speech.
    order = ["kokoro"] if (engine == "kokoro" or voice in KOKORO_VOICES or os.getenv("SENTINEL_TTS") == "kokoro") else ["elevenlabs"]
    # cached ElevenLabs audio is free: use it even past the budget or offline
    for eng in order:
        p = _cache_path(eng, eleven_voice if eng == "elevenlabs" else kokoro_voice, text, "mp3" if eng == "elevenlabs" else "wav")
        if p.exists() and p.stat().st_size > 0:
            return {"audio": p.read_bytes(), "mime": "audio/mpeg" if eng == "elevenlabs" else "audio/wav", "source": eng, "cached": True}
    for eng in order:
        try:
            if eng == "elevenlabs":
                audio, mime, v = tts_eleven(text, eleven_voice), "audio/mpeg", eleven_voice
            else:
                audio, mime, v = tts_kokoro(text, kokoro_voice), "audio/wav", kokoro_voice
        except Exception as e:
            print(f"[sentinel voice] {eng} failed: {e}", flush=True)
            continue
        p = _cache_path(eng, v, text, "mp3" if eng == "elevenlabs" else "wav")
        try:
            p.write_bytes(audio)
        except OSError:
            pass
        return {"audio": audio, "mime": mime, "source": eng, "cached": False}
    raise RuntimeError("no TTS engine available")


def voices() -> dict:
    return {
        "default": DEFAULT_VOICE,
        "elevenlabs": [{"id": k, "name": v[1], "gender": v[2]} for k, v in ELEVEN_VOICES.items()] if eleven_key() else [],
        "kokoro": [{"id": k, "name": v} for k, v in KOKORO_VOICES.items()] if (MODELS / "tts" / "kokoro-v1.0.onnx").exists() else [],
        "eleven_chars_used": usage().get("eleven_chars", 0),
        "eleven_budget": eleven_budget(),
    }
