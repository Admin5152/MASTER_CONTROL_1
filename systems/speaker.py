"""Speaker ID with Resemblyzer voiceprints (optional).

If Resemblyzer is not installed, `available()` is False and the app uses the manual
crew selector. Audio arrives as 16 kHz mono 16-bit WAV, encoded in the browser.
"""
from __future__ import annotations

import io
import threading
import wave
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
VOICEPRINTS = ROOT / "voiceprints"
MIN_SIMILARITY = 0.75

_encoder = None
_lock = threading.Lock()
_import_error: str | None = None


def available() -> bool:
    global _import_error
    try:
        import resemblyzer  # noqa: F401
        return True
    except Exception as e:  # pragma: no cover - depends on install
        _import_error = str(e)
        return False


def _get_encoder():
    global _encoder
    with _lock:
        if _encoder is None:
            from resemblyzer import VoiceEncoder
            _encoder = VoiceEncoder("cpu", verbose=False)
        return _encoder


def wav_to_float(data: bytes) -> tuple[np.ndarray, int]:
    with wave.open(io.BytesIO(data), "rb") as w:
        sr = w.getframerate()
        ch = w.getnchannels()
        width = w.getsampwidth()
        frames = w.readframes(w.getnframes())
    if width != 2:
        raise ValueError("expected 16-bit PCM WAV")
    a = np.frombuffer(frames, dtype="<i2").astype(np.float32) / 32768.0
    if ch > 1:
        a = a.reshape(-1, ch).mean(axis=1)
    return a, sr


def embed(data: bytes) -> np.ndarray:
    from resemblyzer import preprocess_wav
    audio, sr = wav_to_float(data)
    if len(audio) < sr * 0.5:
        raise ValueError("clip too short")
    wav = preprocess_wav(audio, source_sr=sr)
    if len(wav) < 16000 * 0.3:
        raise ValueError("no voiced audio found")
    return _get_encoder().embed_utterance(wav)


def enrol(crew_id: str, data: bytes) -> dict:
    e = embed(data)
    VOICEPRINTS.mkdir(exist_ok=True)
    np.save(VOICEPRINTS / f"{crew_id}.npy", e)
    return {"crew_id": crew_id, "dims": int(e.shape[0])}


def enrolled() -> dict[str, np.ndarray]:
    out = {}
    if VOICEPRINTS.exists():
        for f in VOICEPRINTS.glob("*.npy"):
            out[f.stem] = np.load(f)
    return out


def match(e: np.ndarray, prints: dict[str, np.ndarray], min_sim: float = MIN_SIMILARITY) -> dict:
    best_id, best = None, -1.0
    for cid, p in prints.items():
        sim = float(np.dot(e, p) / (np.linalg.norm(e) * np.linalg.norm(p) + 1e-9))
        if sim > best:
            best_id, best = cid, sim
    if best_id is None or best < min_sim:
        return {"crew_id": None, "confidence": round(max(best, 0.0), 3), "source": "voice"}
    return {"crew_id": best_id, "confidence": round(best, 3), "source": "voice"}


def identify(data: bytes) -> dict:
    prints = enrolled()
    if not prints:
        return {"crew_id": None, "confidence": 0.0, "source": "none", "reason": "no voiceprints enrolled"}
    try:
        e = embed(data)
    except ValueError as err:
        return {"crew_id": None, "confidence": 0.0, "source": "voice", "reason": str(err)}
    return match(e, prints)


def enrolled_status() -> dict:
    """Which crew members have a voiceprint: {"available": bool, "enrolled": [crew_id, ...]}."""
    try:
        return {"available": available(), "enrolled": sorted(enrolled().keys())}
    except Exception as e:   # a broken voiceprint file must not take speaker ID down
        return {"available": False, "enrolled": [], "error": str(e)[:120]}
