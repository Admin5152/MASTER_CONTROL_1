"""Local Whisper in its own process, loaded once and kept warm.

The model lives in a separate process (CTranslate2 keeps its memory away from the server). It used to start fresh for
every utterance (Python start, import, model load: 1.5-3 s each time); now the server starts it once and sends it
utterances over stdin, so each one costs only the transcription.

Protocol (--serve): for each request, 4-byte big-endian prompt length, the prompt (UTF-8), 4-byte big-endian WAV
length, the WAV bytes; the reply is one JSON line {"text": ...}. Without --serve: one WAV on stdin, one JSON reply.
"""
from __future__ import annotations

import io
import json
import struct
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def pcm16k(wav: bytes):
    """Decode a PCM WAV to mono float32 at 16 kHz (no PyAV: the venv's PyAV is incompatible with faster-whisper)."""
    import wave

    import numpy as np
    with wave.open(io.BytesIO(wav)) as w:
        rate, ch, width = w.getframerate(), w.getnchannels(), w.getsampwidth()
        raw = w.readframes(w.getnframes())
    dt = {1: "u1", 2: "<i2", 4: "<i4"}[width]
    x = np.frombuffer(raw, dtype=dt).astype("float32")
    x = (x - 128) / 128 if width == 1 else x / float(2 ** (8 * width - 1))
    if ch > 1:
        x = x.reshape(-1, ch).mean(axis=1)
    if rate != 16000:
        n = int(len(x) * 16000 / rate)
        x = np.interp(np.linspace(0, len(x) - 1, n), np.arange(len(x)), x).astype("float32")
    return x


def load():
    from faster_whisper import WhisperModel
    path = ROOT / "models" / "whisper" / "base.en"
    return WhisperModel(str(path) if path.exists() else "base.en", device="cpu", compute_type="int8", cpu_threads=2,
                        download_root=str(ROOT / "models" / "whisper"))


def transcribe(model, wav: bytes, prompt: str) -> str:
    segs, _ = model.transcribe(pcm16k(wav), language="en", beam_size=1, vad_filter=False, initial_prompt=prompt or None)
    return " ".join(s.text.strip() for s in segs).strip()


def _read(n: int) -> bytes | None:
    buf = b""
    while len(buf) < n:
        chunk = sys.stdin.buffer.read(n - len(buf))
        if not chunk:
            return None
        buf += chunk
    return buf


def serve() -> None:
    model = load()
    sys.stdout.write(json.dumps({"ready": True}) + "\n"); sys.stdout.flush()
    while True:
        head = _read(4)
        if head is None:
            return
        prompt = _read(struct.unpack(">I", head)[0]).decode("utf-8")
        wav = _read(struct.unpack(">I", _read(4))[0])
        try:
            out = {"text": transcribe(model, wav, prompt)}
        except Exception as e:   # one bad utterance never kills the worker
            out = {"error": type(e).__name__}
        sys.stdout.write(json.dumps(out) + "\n"); sys.stdout.flush()


def main() -> None:
    if "--serve" in sys.argv:
        return serve()
    from brain.speech import VOCABULARY_HINT
    sys.stdout.write(json.dumps({"text": transcribe(load(), sys.stdin.buffer.read(), VOCABULARY_HINT)}))


if __name__ == "__main__":
    main()
