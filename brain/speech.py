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

# premade ElevenLabs voices only (never the account's personal or cloned voices)
ELEVEN_VOICES = {
    "river": ("SAz9YHcvj6GT2YYXdXww", "River"),
    "eric": ("cjVigY5qzO86Huf0OWal", "Eric"),
    "sarah": ("EXAVITQu4vr4xnSDxMaL", "Sarah"),
    "daniel": ("onwK4e9ZLuTAKqWW03F9", "Daniel"),
}
KOKORO_VOICES = {"af_heart": "Heart (Kokoro)", "af_nova": "Nova (Kokoro)", "am_michael": "Michael (Kokoro)", "bm_george": "George (Kokoro)"}
DEFAULT_VOICE = "river"
ELEVEN_MODEL = "eleven_flash_v2_5"
MAX_TTS_CHARS = 400


def _norm_text(text: str) -> str:
    from brain.llm import normalize  # local import: llm imports nothing from here
    t = normalize(text or "")
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


def stt_groq(wav: bytes, timeout: float = 8.0, post=None) -> str:
    key = os.getenv("LLM_API_KEY", "").strip() or os.getenv("GROQ_API_KEY", "").strip()
    if not key:
        raise RuntimeError("no key")
    base = os.getenv("LLM_BASE_URL", "").strip().rstrip("/") or "https://api.groq.com/openai/v1"
    if "groq.com" not in base:
        base = "https://api.groq.com/openai/v1"
    files = {"file": ("speech.wav", wav, "audio/wav")}
    data = {"model": "whisper-large-v3-turbo", "language": "en", "response_format": "json", "temperature": "0"}
    if post is not None:
        r = post(f"{base}/audio/transcriptions", files, data)
    else:
        with httpx.Client(timeout=timeout) as c:
            r = c.post(f"{base}/audio/transcriptions", files=files, data=data, headers={"Authorization": f"Bearer {key}"})
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


def usage() -> dict:
    try:
        return json.loads(USAGE.read_text(encoding="utf-8"))
    except Exception:
        return {"eleven_chars": 0, "requests": 0}


def _add_usage(chars: int) -> None:
    with _usage_lock:
        u = usage()
        u["eleven_chars"] = u.get("eleven_chars", 0) + chars
        u["requests"] = u.get("requests", 0) + 1
        u["updated"] = time.strftime("%Y-%m-%dT%H:%M:%S")
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
        with httpx.Client(timeout=timeout) as c:
            r = c.post(url, json=body, headers={"xi-api-key": key, "accept": "audio/mpeg"})
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
    order = ["elevenlabs", "kokoro"]
    if engine == "kokoro" or voice in KOKORO_VOICES:
        order = ["kokoro"]
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
        except Exception:
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
        "elevenlabs": [{"id": k, "name": v[1]} for k, v in ELEVEN_VOICES.items()] if eleven_key() else [],
        "kokoro": [{"id": k, "name": v} for k, v in KOKORO_VOICES.items()] if (MODELS / "tts" / "kokoro-v1.0.onnx").exists() else [],
        "eleven_chars_used": usage().get("eleven_chars", 0),
        "eleven_budget": eleven_budget(),
    }
